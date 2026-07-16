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
Sirve el front estático (web/dist) en / si existe.
"""

from __future__ import annotations

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

# --- almacenamiento ---
DATA_DIR = Path(os.environ.get("PINPOINT_DATA", "/pinpoint-data")).resolve()
SOURCES_DIR = DATA_DIR / "sources"
SOURCES_DIR.mkdir(parents=True, exist_ok=True)

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
    sid = uuid.uuid4().hex[:12]
    SOURCES[sid] = Source(id=sid, bin_path=body.bin_path, video_path=body.video_path)
    return {"id": sid}


@app.post("/api/sources/upload")
async def upload_source(bin: UploadFile = File(...), video: UploadFile = File(...)):
    """Sube bin+video al servidor y los registra."""
    sid = uuid.uuid4().hex[:12]
    sdir = SOURCES_DIR / sid
    sdir.mkdir(parents=True, exist_ok=True)
    bin_path = sdir / (bin.filename or "log.bin")
    vid_path = sdir / (video.filename or "video.mkv")
    for up, dst in ((bin, bin_path), (video, vid_path)):
        with open(dst, "wb") as f:
            shutil.copyfileobj(up.file, f)
    SOURCES[sid] = Source(id=sid, bin_path=str(bin_path), video_path=str(vid_path))
    return {"id": sid}


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
    }


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
    fov_scale: float = Query(1.0, description="factor sobre tan(FOV/2) — gran angular: ~1.25 según la distorsión Brown de ODM"),
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

    # fov_scale actúa en espacio tangente (donde vive la distorsión de la lente):
    # fov' = 2·atan(scale · tan(fov/2))
    import math as _math
    if fov_scale != 1.0:
        fov_h = 2 * _math.degrees(_math.atan(fov_scale * _math.tan(_math.radians(fov_h / 2))))
        fov_v = 2 * _math.degrees(_math.atan(fov_scale * _math.tan(_math.radians(fov_v / 2))))

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
    fov_scale: float = Query(1.0),
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
    import math as _math
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

    if fov_scale != 1.0:
        fov_h = 2 * _math.degrees(_math.atan(fov_scale * _math.tan(_math.radians(fov_h / 2))))
        fov_v = 2 * _math.degrees(_math.atan(fov_scale * _math.tan(_math.radians(fov_v / 2))))

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
