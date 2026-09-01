"""
PinPoint server — FastAPI fino sobre el núcleo pinpoint_core/.

Filosofía: el servidor NO tiene lógica de negocio; solo expone pinpoint_core/
por HTTP y gestiona los ficheros de cada fuente (bin + vídeo).

Endpoints:
  GET  /api/health
  POST /api/sources                     registra bin+vídeo de una ruta del servidor (o subida)
  GET  /api/sources/{id}/log            -> GeoJSON de trayectoria + perfil + despegue
  GET  /api/sources/{id}/video/info     -> metadatos del vídeo
  GET  /api/sources/{id}/video/stream   -> vídeo con soporte Range (para <video>)
  GET  /api/sources/{id}/position       -> dónde está el dron en el instante tv
  GET  /api/sources/{id}/frame          -> un fotograma JPEG en tv
  GET  /api/sources/{id}/footprint      -> footprint del frame sobre el terreno en tv
  GET  /api/sources/{id}/project_point  -> proyecta un píxel al terreno (con actitud u ortogonal)
  GET  /api/sources/{id}/campaign       -> campaña de puntos de control guardada para este vuelo
  PUT  /api/sources/{id}/campaign       -> guarda la campaña (config + puntos) junto al vuelo
Sirve el front estático (web/dist) en / si existe.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass, asdict, field
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pinpoint_core import binlog as _binlog
from pinpoint_core import video as _video
from pinpoint_core import sync as _sync
from pinpoint_core import footprint as _footprint
from pinpoint_core import terrain as _terrain
from pinpoint_core import candidates as _cand

# --- almacenamiento ---
DATA_DIR = Path(os.environ.get("PINPOINT_DATA", "/pinpoint-data")).resolve()
SOURCES_DIR = DATA_DIR / "sources"
SOURCES_DIR.mkdir(parents=True, exist_ok=True)
# Campañas de puntos de control, UNA por vuelo, por su clave estable (ver
# Source.key): el id de sesión es un uuid en memoria y cambia al reiniciar.
CAMPAIGNS_DIR = DATA_DIR / "campaigns"
CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)
# Registro persistente de vuelos (clave -> rutas): al arrancar se vuelven a
# registrar, así "sources" no vuelve a 0 con cada reinicio.
REGISTRY_PATH = DATA_DIR / "registry.json"

# --- biblioteca de vuelos ---
# Carpeta del servidor donde viven los vídeos y los logs. La pantalla inicial la
# lista en dos desplegables (vídeos y .bin) y las subidas van aquí, así todo el
# material está en un único sitio y la cuota lo cubre entero.
LIBRARY_DIR = Path(os.environ.get(
    "PINPOINT_LIBRARY", "/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico"))
# Tope de ocupación de esa carpeta. Al alcanzarlo se rechazan las subidas
# nuevas; nunca se borra nada por su cuenta (son datos de campaña).
LIBRARY_QUOTA_BYTES = int(float(os.environ.get("PINPOINT_QUOTA_GB", "25")) * 1024 ** 3)

VIDEO_EXT = {".mkv", ".mp4", ".mov", ".avi", ".m4v", ".ts", ".webm"}
BIN_EXT = {".bin", ".log", ".tlog", ".px4log", ".ulg"}


def _library_files(exts: set[str]) -> list[dict]:
    """Ficheros de la biblioteca con esas extensiones, recorriendo subcarpetas."""
    if not LIBRARY_DIR.is_dir():
        return []
    out = []
    for p in sorted(LIBRARY_DIR.rglob("*")):
        if p.is_file() and p.suffix.lower() in exts and not p.name.startswith("."):
            try:
                st = p.stat()
            except OSError:
                continue
            out.append({
                "path": str(p),
                # nombre relativo: con subcarpetas por vuelo distingue homónimos
                "name": str(p.relative_to(LIBRARY_DIR)),
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            })
    return out


def _library_usage() -> int:
    """Bytes ocupados por la biblioteca (suma recursiva)."""
    if not LIBRARY_DIR.is_dir():
        return 0
    total = 0
    for p in LIBRARY_DIR.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def _safe_library_name(nombre: str, exts: set[str]) -> str:
    """Nombre saneado para escribir en la biblioteca.

    Se queda con el basename y filtra caracteres raros, de modo que un nombre
    como '../../etc/x' no pueda escribir fuera de LIBRARY_DIR.
    """
    base = os.path.basename(nombre or "")
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).lstrip(".") or "fichero"
    if Path(base).suffix.lower() not in exts:
        raise HTTPException(400, f"extensión no admitida: {base}")
    return base


app = FastAPI(title="PinPoint", version="0.2.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ======================= modelo de datos en memoria =======================
@dataclass
class Source:
    id: str
    bin_path: str
    video_path: str
    # caché perezosa del log parseado (parsear es caro)
    _log: _binlog.BinLog | None = None
    # caché de modelos de terreno por fuente pedida ("ign"|"cop"|"flat"): el
    # ráster se descarga UNA VEZ por fuente y se reutiliza en cada proyección.
    _terrain: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        """Clave ESTABLE del vuelo: hash de las rutas del bin y del vídeo. Con
        ella la campaña de GCP sobrevive a reinicios y a re-registrar el vuelo."""
        h = hashlib.sha1(f"{self.bin_path}|{self.video_path}".encode()).hexdigest()
        return h[:16]

    @property
    def label(self) -> str:
        return os.path.basename(self.video_path)

    def log(self) -> _binlog.BinLog:
        if self._log is None:
            self._log = _binlog.parse_bin(self.bin_path)
        return self._log

    def terrain(self, source: str) -> tuple[object, str]:
        """Devuelve (modelo, fuente_efectiva) para la fuente pedida, cacheado.
        La fuente efectiva puede degradar a 'flat' (fuera de cobertura o fallo)."""
        if source not in self._terrain:
            log = self.log()
            min_lat, min_lng, max_lat, max_lng = log.bbox()
            bbox = _terrain.BBox(min_lat, min_lng, max_lat, max_lng)
            self._terrain[source] = _terrain.load_terrain(source, bbox, ground_msl=log.alt0)
        return self._terrain[source]


SOURCES: dict[str, Source] = {}


def _load_registry() -> dict:
    try:
        return json.loads(REGISTRY_PATH.read_text()) if REGISTRY_PATH.exists() else {}
    except Exception:  # noqa: BLE001
        return {}


def _remember(src: Source) -> None:
    reg = _load_registry()
    reg[src.key] = {"bin_path": src.bin_path, "video_path": src.video_path}
    tmp = REGISTRY_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(reg, indent=1))
    tmp.replace(REGISTRY_PATH)


def _register(bin_path: str, video_path: str, sid: str | None = None) -> Source:
    """Registra (o reutiliza) un vuelo por sus rutas. Misma pareja de rutas =>
    misma clave y, si ya estaba en memoria, misma sesión."""
    for src in SOURCES.values():
        if src.bin_path == bin_path and src.video_path == video_path:
            return src
    sid = sid or uuid.uuid4().hex[:12]
    src = Source(id=sid, bin_path=bin_path, video_path=video_path)
    SOURCES[sid] = src
    _remember(src)
    return src


def _restore_registry() -> None:
    for entry in _load_registry().values():
        b, v = entry.get("bin_path", ""), entry.get("video_path", "")
        if os.path.exists(b) and os.path.exists(v):
            _register(b, v)


_restore_registry()


# ======================= helpers =======================
def _get_source(sid: str) -> Source:
    s = SOURCES.get(sid)
    if s is None:
        raise HTTPException(404, f"source {sid} no encontrada")
    return s


def _ground_under_drone(s: Source, sr, tv: float, terrain: str) -> tuple[float | None, str]:
    """Cota del terreno (MSL) bajo la posición del dron en el instante tv, según
    el modelo pedido. Devuelve (cota | None, fuente_efectiva).

    None => que la proyección use su valor por defecto (la cota del despegue),
    es decir, terreno plano. Se usa la cota BAJO EL DRON (no bajo el píxel): es
    una aproximación de primer orden que corrige el grueso del sesgo por relieve;
    el ray-cast contra terreno inclinado queda para más adelante."""
    if terrain == "flat":
        return None, "flat"
    log = s.log()
    model, eff = s.terrain(terrain)
    if eff == "flat":
        return None, "flat"
    t_log = log.t0_us + sr.video_start_trel + tv
    lat, lng, _alt = log.interp_position(t_log)
    z = model.elevation(lat, lng)
    if z is None:
        return None, "flat"   # punto fuera del ráster -> plano
    return z, eff


# ======================= endpoints =======================
@app.get("/api/health")
def health():
    return {"status": "ok", "sources": len(SOURCES)}


@app.get("/api/library")
def library():
    """Contenido de la carpeta de vuelos y estado de la cuota.

    Alimenta los dos desplegables de la pantalla inicial. Vídeos y logs van por
    separado y sin emparejar: se elige uno de cada lista.
    """
    usado = _library_usage()
    return {
        "dir": str(LIBRARY_DIR),
        "exists": LIBRARY_DIR.is_dir(),
        "writable": LIBRARY_DIR.is_dir() and os.access(LIBRARY_DIR, os.W_OK),
        "videos": _library_files(VIDEO_EXT),
        "logs": _library_files(BIN_EXT),
        "quota": {
            "used": usado,
            "limit": LIBRARY_QUOTA_BYTES,
            "free": max(0, LIBRARY_QUOTA_BYTES - usado),
            "pct": round(100 * usado / LIBRARY_QUOTA_BYTES, 1) if LIBRARY_QUOTA_BYTES else 0.0,
        },
    }


@app.post("/api/library/upload")
async def library_upload(file: UploadFile = File(...), kind: str = Form("video")):
    """Sube UN fichero (vídeo o log) a la carpeta de vuelos, respetando la cuota.

    Se escribe a un temporal y se va comprobando el tamaño mientras entra: así
    una subida que se pasaría de cuota se corta a mitad y no deja el disco lleno.
    Al terminar, el fichero aparece en el desplegable correspondiente.
    """
    exts = BIN_EXT if kind == "log" else VIDEO_EXT
    if not LIBRARY_DIR.is_dir():
        raise HTTPException(400, f"la carpeta de vuelos no existe: {LIBRARY_DIR}")
    if not os.access(LIBRARY_DIR, os.W_OK):
        raise HTTPException(
            403, f"la carpeta de vuelos es de solo lectura: {LIBRARY_DIR}")

    nombre = _safe_library_name(file.filename or "", exts)
    destino = LIBRARY_DIR / nombre
    if destino.exists():
        raise HTTPException(409, f"ya existe un fichero con ese nombre: {nombre}")

    libre = LIBRARY_QUOTA_BYTES - _library_usage()
    if libre <= 0:
        raise HTTPException(
            507, f"cuota agotada ({LIBRARY_QUOTA_BYTES / 1024**3:.0f} GB): borra algo antes de subir")

    tmp = LIBRARY_DIR / f".subiendo_{uuid.uuid4().hex[:8]}"
    escrito = 0
    try:
        with open(tmp, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                escrito += len(chunk)
                if escrito > libre:
                    raise HTTPException(
                        507,
                        f"la subida supera la cuota: quedan {libre / 1024**3:.1f} GB "
                        f"de {LIBRARY_QUOTA_BYTES / 1024**3:.0f} GB")
                f.write(chunk)
        tmp.replace(destino)
    except Exception:
        tmp.unlink(missing_ok=True)      # no dejar restos a medio subir
        raise

    usado = _library_usage()
    return {
        "name": nombre, "path": str(destino), "size": escrito, "kind": kind,
        "quota": {"used": usado, "limit": LIBRARY_QUOTA_BYTES,
                  "free": max(0, LIBRARY_QUOTA_BYTES - usado)},
    }


class RegisterBody(BaseModel):
    # rutas EN EL SERVIDOR (modo servidor); o usa el endpoint de subida
    bin_path: str
    video_path: str


@app.post("/api/sources")
def register_source(body: RegisterBody):
    """Registra un par (bin, video) que ya están en el disco del servidor."""
    if not os.path.exists(body.bin_path):
        raise HTTPException(400, f"no existe: {body.bin_path}")
    if not os.path.exists(body.video_path):
        raise HTTPException(400, f"no existe: {body.video_path}")
    src = _register(body.bin_path, body.video_path)
    return {"id": src.id, "key": src.key, "label": src.label}


@app.get("/api/sources")
def list_sources():
    """Vuelos conocidos (registrados o subidos), con si tienen campaña guardada."""
    return [
        {
            "id": s.id, "key": s.key, "label": s.label,
            "bin_path": s.bin_path, "video_path": s.video_path,
            "has_campaign": _campaign_path(s).exists(),
        }
        for s in SOURCES.values()
    ]


@app.post("/api/sources/upload")
async def upload_source(bin: UploadFile = File(...), video: UploadFile = File(...)):
    """Sube bin+video al servidor y los registra. La carpeta se llama por el
    hash del contenido del .bin: subir el mismo vuelo dos veces cae en la misma
    carpeta (no se duplica el vídeo) y conserva la clave, y con ella la campaña."""
    tmp = SOURCES_DIR / f"_up_{uuid.uuid4().hex[:8]}"
    tmp.mkdir(parents=True, exist_ok=True)
    bin_name = os.path.basename(bin.filename or "log.bin")
    vid_name = os.path.basename(video.filename or "video.mkv")
    h = hashlib.sha1()
    with open(tmp / bin_name, "wb") as f:
        while chunk := bin.file.read(1024 * 1024):
            h.update(chunk)
            f.write(chunk)
    sid = h.hexdigest()[:12]
    sdir = SOURCES_DIR / sid
    sdir.mkdir(parents=True, exist_ok=True)
    (tmp / bin_name).replace(sdir / bin_name)
    vid_path = sdir / vid_name
    # el vídeo sólo se vuelve a escribir si no está ya (mismo nombre y tamaño)
    size = getattr(video, "size", None)
    if not (vid_path.exists() and size and vid_path.stat().st_size == size):
        with open(tmp / vid_name, "wb") as f:
            shutil.copyfileobj(video.file, f)
        (tmp / vid_name).replace(vid_path)
    shutil.rmtree(tmp, ignore_errors=True)
    src = _register(str(sdir / bin_name), str(vid_path), sid=sid)
    return {"id": src.id, "key": src.key, "label": src.label}


@app.get("/api/sources/{sid}/log")
def source_log(sid: str, step: int = Query(1, ge=1)):
    """Trayectoria (GeoJSON) + perfil de altitud + despegue detectado."""
    s = _get_source(sid)
    log = s.log()
    takeoff = log.detect_takeoff()
    return {
        "geojson": log.to_geojson(step=step),
        "profile": log.altitude_profile(step=max(1, len(log.gps) // 300)),
        "takeoff_trel": takeoff,
        "duration_s": log.duration_s,
        "utc_start": log.utc_start.isoformat(),
        "utc_end": log.utc_end.isoformat(),
        "bbox": list(log.bbox()),
        "alt0": log.alt0,
        "source_key": s.key,
        "source_label": s.label,
    }


@app.get("/api/sources/{sid}/candidates")
def source_candidates(
    sid: str,
    mode: str = Query("straight", description="straight (E1) | turns (E3)"),
    method: str = Query("manual"),
    offset: float = Query(0.0),
    n: int = Query(25, ge=1, le=200, description="straight: nº de tramos"),
    max_roll: float = Query(3.0, description="straight: |roll| máximo (°)"),
    min_agl: float = Query(20.0),
    per_bin: int = Query(2, ge=1, le=5, description="turns: candidatos por franja de roll"),
):
    """Instantes del vídeo que merece la pena mirar para marcar puntos de
    control, elegidos sólo con la telemetría (ver pinpoint_core/candidates.py)."""
    s = _get_source(sid)
    log = s.log()
    v = _video.probe(s.video_path)
    if method == "takeoff":
        sr = _sync.by_takeoff(log)
    elif method == "creation_time":
        sr = _sync.by_creation_time(log, v)
    else:
        sr = _sync.manual(offset)
    if mode == "turns":
        c = _cand.turn_candidates(log, sr, v.duration_s, per_bin=per_bin, min_agl=min_agl)
    else:
        c = _cand.straight_candidates(log, sr, v.duration_s, n=n, max_roll=max_roll, min_agl=min_agl)
    return {"mode": mode, "candidates": _cand.to_dicts(c)}


# ======================= campaña de puntos de control =======================
def _campaign_path(s: Source) -> Path:
    return CAMPAIGNS_DIR / f"{s.key}.json"


@app.get("/api/sources/{sid}/campaign")
def campaign_get(sid: str):
    """La campaña guardada para este vuelo (por su clave estable), o 404."""
    s = _get_source(sid)
    p = _campaign_path(s)
    if not p.exists():
        raise HTTPException(404, "sin campaña guardada para este vuelo")
    return JSONResponse(content=json.loads(p.read_text()))


@app.put("/api/sources/{sid}/campaign")
async def campaign_put(sid: str, request: Request):
    """Guarda la campaña (config + frames + puntos) tal cual la manda el front.
    El servidor no la interpreta: es el respaldo de horas de marcado."""
    s = _get_source(sid)
    body = await request.json()
    if not isinstance(body, dict) or "frames" not in body:
        raise HTTPException(400, "campaña inválida")
    body["source_key"] = s.key
    body["source_label"] = s.label
    p = _campaign_path(s)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(body, ensure_ascii=False, indent=1))
    tmp.replace(p)   # escritura atómica: nunca un fichero a medias
    n_pts = sum(len(f.get("points", [])) for f in body.get("frames", []))
    return {"ok": True, "key": s.key, "frames": len(body.get("frames", [])), "points": n_pts}


@app.get("/api/sources/{sid}/video/info")
def source_video_info(sid: str):
    s = _get_source(sid)
    v = _video.probe(s.video_path)
    d = asdict(v)
    d["creation_time"] = v.creation_time.isoformat() if v.creation_time else None
    d["is_reencoded"] = v.is_reencoded
    return d


@app.get("/api/sources/{sid}/video/stream")
def source_video_stream(sid: str, request: Request):
    """Sirve el vídeo con soporte de Range para que el <video> pueda hacer seek."""
    s = _get_source(sid)
    path = s.video_path
    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")

    # tipo MIME básico por extensión
    ext = os.path.splitext(path)[1].lower()
    ctype = {".mkv": "video/x-matroska", ".mp4": "video/mp4",
             ".mov": "video/quicktime", ".webm": "video/webm"}.get(ext, "video/mp4")

    if range_header is None:
        return FileResponse(path, media_type=ctype)

    m = re.match(r"bytes=(\d+)-(\d*)", range_header)
    start = int(m.group(1)) if m else 0
    end = int(m.group(2)) if (m and m.group(2)) else file_size - 1
    end = min(end, file_size - 1)
    length = end - start + 1

    def _iter():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    return StreamingResponse(_iter(), status_code=206, headers=headers, media_type=ctype)


@app.get("/api/sources/{sid}/position")
def source_position(
    sid: str,
    tv: float = Query(..., description="instante del vídeo en s desde su frame 0"),
    method: str = Query("takeoff"),
    offset: float = Query(0.0, description="offset manual (solo method=manual)"),
):
    """EL ENDPOINT DEL AJUSTADOR: dónde estaba el dron en el instante tv del vídeo,
    según el método de sincronización. El front pinta esto como marcador en el mapa."""
    s = _get_source(sid)
    log = s.log()
    v = _video.probe(s.video_path)
    if method == "takeoff":
        sr = _sync.by_takeoff(log)
    elif method == "creation_time":
        sr = _sync.by_creation_time(log, v)
    elif method == "manual":
        sr = _sync.manual(offset)
    else:
        raise HTTPException(400, f"method desconocido: {method}")

    lat, lng, alt, yaw = _sync.position_for_video_time(log, sr, tv)
    return {
        "tv": tv,
        "lat": lat, "lng": lng, "alt": alt, "yaw": yaw,
        "alt_rel": alt - log.alt0,
        "video_start_trel": sr.video_start_trel,
        "method": sr.method,
        "detail": sr.detail,
        "tz_offset_hours": sr.tz_offset_hours,
    }


@app.get("/api/sources/{sid}/frame")
def source_frame(
    sid: str,
    tv: float = Query(..., description="instante del vídeo en s"),
    quality: int = Query(3, ge=2, le=31),
):
    """Un frame del vídeo en el instante tv, como JPEG. Para el previsualizador
    de solape (comparar frame actual vs siguiente según fps)."""
    s = _get_source(sid)
    try:
        jpg = _video.extract_single_frame(s.video_path, tv, quality=quality)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))
    return Response(content=jpg, media_type="image/jpeg")


@app.get("/api/sources/{sid}/footprint")
def source_footprint(
    sid: str,
    tv: float = Query(..., description="instante del vídeo en s desde su frame 0"),
    method: str = Query("takeoff"),
    offset: float = Query(0.0),
    fov_h: float = Query(72.3, description="FOV horizontal en grados (visible: 72.3)"),
    fov_v: float = Query(44.6, description="FOV vertical en grados (visible: 44.6)"),
    max_pitch_dev: float = Query(15.0, description="desviación máx pitch vs -90° (grados)"),
    max_roll_dev: float = Query(10.0, description="|roll| máximo (grados)"),
    min_agl: float = Query(20.0, description="altura mínima sobre terreno (m)"),
    d_pitch: float = Query(0.0, description="delta manual de cabeceo (grados)"),
    d_roll: float = Query(0.0, description="delta manual de alabeo (grados)"),
    terrain: str = Query("flat", description="modelo del terreno: flat | ign | srtm"),
):
    """Footprint del frame sobre el suelo en el instante tv: 4 esquinas lat/lng.
    El front lo usa para pegar el frame en el mapa (MapLibre image source).

    Devuelve nadir_ok=False (con 'reason') si la cámara está demasiado oblicua o
    baja para que la proyección plana sea fiable -> el front no pinta la imagen.

    El AGL usa el modelo del terreno pedido (flat = cota del despegue; ign/srtm =
    cota real bajo el dron). La fuente EFECTIVA se devuelve en 'terrain_source'
    (puede degradar a flat fuera de cobertura)."""
    s = _get_source(sid)
    log = s.log()
    if method == "takeoff":
        sr = _sync.by_takeoff(log)
    elif method == "creation_time":
        sr = _sync.by_creation_time(log, _video.probe(s.video_path))
    elif method == "manual":
        sr = _sync.manual(offset)
    else:
        raise HTTPException(400, f"method desconocido: {method}")

    ground_msl, terrain_eff = _ground_under_drone(s, sr, tv, terrain)

    fp = _footprint.compute_footprint(
        log, sr, tv, fov_h=fov_h, fov_v=fov_v,
        max_pitch_dev=max_pitch_dev, max_roll_dev=max_roll_dev, min_agl=min_agl,
        pitch_offset=d_pitch, roll_offset=d_roll,
        ground_alt_msl=ground_msl,
    )
    return {
        "terrain_source": terrain_eff,
        "tv": fp.tv,
        "valid": fp.valid,
        "nadir_ok": fp.nadir_ok,
        "reason": fp.reason,
        "drone": [fp.drone_lat, fp.drone_lng],
        "agl": fp.agl,
        "yaw": fp.yaw,
        "pitch": fp.pitch,
        "roll": fp.roll,
        "drone_roll": fp.drone_roll,
        "drone_pitch": fp.drone_pitch,
        "clipped": fp.clipped,
        # rectángulo nadir (para la IMAGEN), [lng,lat] TL,TR,BR,BL
        "corners": [[lng, lat] for (lat, lng) in fp.corners],
        # silueta real / trapecio (para el CONTORNO), [lng,lat] TL,TR,BR,BL
        "outline_corners": [[lng, lat] for (lat, lng) in (fp.outline_corners or [])],
        "has_gimbal": log.has_gimbal,
    }


@app.get("/api/sources/{sid}/project_point")
def source_project_point(
    sid: str,
    tv: float = Query(...),
    px: float = Query(..., description="píxel X en la imagen (origen arriba-izq)"),
    py: float = Query(..., description="píxel Y en la imagen"),
    img_w: float = Query(...),
    img_h: float = Query(...),
    method: str = Query("takeoff"),
    offset: float = Query(0.0),
    fov_h: float = Query(72.3),
    fov_v: float = Query(44.6),
    d_pitch: float = Query(0.0),
    d_roll: float = Query(0.0),
    ortho: bool = Query(False, description="cancelar la actitud: pinhole nadir puro (línea base)"),
    terrain: str = Query("flat", description="modelo del terreno: flat | ign | cop"),
):
    """Proyecta un píxel marcado en la foto al suelo (lat/lng), con la misma
    geometría de actitud completa que el contorno. Para el modo 'marcar punto'.

    ortho=True devuelve la proyección SIN actitud (nadir perfecto, mismo yaw/AGL/
    FOV): la geometría del rectángulo que pinta "Project the frame image".

    terrain elige el modelo del terreno para el AGL (flat = cota del despegue;
    ign/cop = cota real bajo el dron). La fuente efectiva va en 'terrain_source'."""
    s = _get_source(sid)
    log = s.log()
    if method == "takeoff":
        sr = _sync.by_takeoff(log)
    elif method == "creation_time":
        sr = _sync.by_creation_time(log, _video.probe(s.video_path))
    elif method == "manual":
        sr = _sync.manual(offset)
    else:
        raise HTTPException(400, f"method desconocido: {method}")

    ground_msl, terrain_eff = _ground_under_drone(s, sr, tv, terrain)

    r = _footprint.project_pixel(
        log, sr, tv, px, py, img_w, img_h,
        fov_h=fov_h, fov_v=fov_v, pitch_offset=d_pitch, roll_offset=d_roll,
        ortho=ortho, ground_alt_msl=ground_msl,
    )
    r["terrain_source"] = terrain_eff
    return r


@app.get("/api/sources/{sid}/terrain/meta")
def terrain_meta(sid: str, terrain: str = Query("ign")):
    """Metadatos de la capa MDT: bounds [lng,lat] para pegar la imagen y la
    fuente efectiva. Vacío (available=False) si no hay ráster (flat / fuera de
    cobertura)."""
    s = _get_source(sid)
    model, eff = s.terrain(terrain)
    if eff == "flat" or not hasattr(model, "bounds_lnglat"):
        return {"available": False, "terrain_source": eff}
    return {
        "available": True,
        "terrain_source": eff,
        "bounds": model.bounds_lnglat(),   # TL,TR,BR,BL [lng,lat]
    }


@app.get("/api/sources/{sid}/terrain/image")
def terrain_image(sid: str, terrain: str = Query("ign")):
    """PNG coloreado del MDT (hillshade + rampa de altura) para pintarlo como
    capa. Es el MISMO ráster que se usa para el AGL."""
    s = _get_source(sid)
    model, eff = s.terrain(terrain)
    if eff == "flat" or not hasattr(model, "render_png"):
        raise HTTPException(404, "no hay MDT para esta fuente")
    png = model.render_png()
    if not png:
        raise HTTPException(500, "no se pudo renderizar el MDT (¿falta Pillow?)")
    return Response(content=png, media_type="image/png")


@app.get("/api/sources/{sid}/terrain/elevation")
def terrain_elevation(
    sid: str,
    lat: float = Query(...),
    lng: float = Query(...),
    terrain: str = Query("ign"),
):
    """Cota del terreno (MSL, m) en un punto — para mostrarla al pasar el ratón.
    z=None si el punto está fuera del ráster."""
    s = _get_source(sid)
    model, eff = s.terrain(terrain)
    z = None if eff == "flat" else model.elevation(lat, lng)
    return {"terrain_source": eff, "z": z}


# --- front estático (si existe web/dist) ---
# El front se construye en web/dist; el server lo sirve en / si está presente
# (en desarrollo se usa el dev-server de Vite y esto no aplica).
_web_dist = Path(__file__).parent.parent / "web" / "dist"
if _web_dist.exists():
    app.mount("/", StaticFiles(directory=str(_web_dist), html=True), name="web")
