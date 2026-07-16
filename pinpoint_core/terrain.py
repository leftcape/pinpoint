"""
Modelo digital del terreno (MDT) — cota del suelo (MSL) en cualquier lat/lng.

Por qué existe
--------------
La proyección de un píxel al suelo necesita el AGL (altura del dron sobre el
terreno). Si se asume terreno plano a la cota del despegue, en zonas con
desnivel el AGL está sesgado y la proyección se aleja: a 100 m de altura, cada
metro de error en el AGL desplaza el punto ~1 m por cada 45° fuera de nadir. En
un vuelo con decenas de metros de relieve eso contamina la medida del error.

Fuentes (elegibles por el usuario, para comparar)
-------------------------------------------------
  IGN   : MDT 5 m del IGN (WCS). Solo ESPAÑA. Máxima precisión.
  COP   : Copernicus DEM 90 m (bucket abierto de AWS). Todo el mundo, sin login.
  FLAT  : terreno plano a la cota del despegue (lo de siempre; último recurso).

Todas exponen la MISMA forma: se descarga UNA VEZ un ráster pequeño para el
bounding box del vuelo (al registrar la fuente) y luego se muestrea en muchos
puntos sin más red. Si una fuente no cubre la zona o falla, se degrada a FLAT.

DATUM VERTICAL
--------------
Las tres fuentes y la altitud del dron están en el MISMO sistema (ortométrico /
sobre el nivel del mar): el `GPS.Alt` de ArduPilot es MSL ortométrico (el
receptor GNSS ya le resta su modelo de geoide), IGN da cota ortométrica y
Copernicus DEM es EGM2008 (también ortométrico). Por tanto AGL = alt_dron − cota
directamente, SIN corrección de geoide. (Solo haría falta el geoide si entrara
una altitud elipsoidal cruda WGS84; no es el caso.)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.request import urlopen
from urllib.error import URLError
import io

TerrainSource = Literal["ign", "cop", "flat"]


@dataclass
class BBox:
    """Recuadro geográfico (grados). El del vuelo, con algo de margen."""
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float

    def padded(self, frac: float = 0.1) -> "BBox":
        dlat = (self.max_lat - self.min_lat) * frac
        dlng = (self.max_lng - self.min_lng) * frac
        return BBox(
            self.min_lat - dlat, self.min_lng - dlng,
            self.max_lat + dlat, self.max_lng + dlng,
        )


class TerrainModel(Protocol):
    """Interfaz común: cota del terreno (MSL, m) en un punto. None si no hay dato."""
    source: TerrainSource

    def elevation(self, lat: float, lng: float) -> float | None:
        ...


# ---------------------------------------------------------------------------
# FLAT — plano a la cota del despegue (sin red, siempre disponible)
# ---------------------------------------------------------------------------

@dataclass
class FlatTerrain:
    """Terreno plano: devuelve siempre la misma cota. El comportamiento v0.1.0."""
    ground_msl: float
    source: TerrainSource = "flat"

    def elevation(self, lat: float, lng: float) -> float | None:
        return self.ground_msl


# ---------------------------------------------------------------------------
# Ráster en memoria — base común de IGN y SRTM
# ---------------------------------------------------------------------------

@dataclass
class RasterTerrain:
    """Un ráster de elevación ya descargado, muestreable por lat/lng.

    Guarda la matriz de cotas y la transformación afín (píxel -> geo) para poder
    indexar sin volver a tocar la red. `undulation` es la corrección de geoide a
    sumar (0 si la fuente ya está en el datum del dron)."""
    _data: "any"                 # numpy 2D (float), norte arriba
    _transform: "any"            # rasterio Affine (col,row -> lng,lat)
    nodata: float
    source: TerrainSource
    undulation: float = 0.0      # m a sumar (ver geoid); constante en un bbox pequeño

    def elevation(self, lat: float, lng: float) -> float | None:
        # geo -> índice de píxel con la inversa de la afín
        inv = ~self._transform
        col, row = inv * (lng, lat)
        r, c = int(row), int(col)
        h, w = self._data.shape
        if not (0 <= r < h and 0 <= c < w):
            return None
        v = float(self._data[r, c])
        if self.nodata is not None and (v == self.nodata or v < -1000 or v != v):
            return None
        return v + self.undulation

    def bounds_lnglat(self) -> list[list[float]]:
        """4 esquinas [lng,lat] del ráster en orden TL,TR,BR,BL — para pegar la
        imagen coloreada en el mapa (MapLibre image source)."""
        h, w = self._data.shape
        tr = self._transform
        tl = tr * (0, 0)
        trr = tr * (w, 0)
        br = tr * (w, h)
        bl = tr * (0, h)
        return [[tl[0], tl[1]], [trr[0], trr[1]], [br[0], br[1]], [bl[0], bl[1]]]

    def render_png(self) -> bytes | None:
        """Colorea el ráster: rampa de altura + relieve sombreado (hillshade), con
        transparencia donde no hay dato. Es EL MISMO ráster que se usa para el
        AGL, así que ves exactamente el modelo que gobierna la proyección."""
        try:
            import numpy as np
            from PIL import Image
        except ImportError:
            return None

        z = np.asarray(self._data, dtype="float64")
        valid = np.isfinite(z) & (z > -1000)
        if self.nodata is not None:
            valid &= z != self.nodata
        if not valid.any():
            return None

        zmin = float(np.percentile(z[valid], 2))
        zmax = float(np.percentile(z[valid], 98))
        rng = max(zmax - zmin, 1e-6)
        t = np.clip((z - zmin) / rng, 0.0, 1.0)  # 0..1 por altura

        # rampa tipo terreno: verde-bajo -> ocre -> marrón -> blanco-alto
        stops = np.array([
            [0.0, 60, 120, 70],
            [0.35, 180, 170, 90],
            [0.6, 150, 110, 60],
            [0.85, 120, 90, 70],
            [1.0, 245, 245, 245],
        ])
        rgb = np.empty(z.shape + (3,), dtype="float64")
        for k in range(3):
            rgb[..., k] = np.interp(t, stops[:, 0], stops[:, k + 1])

        # hillshade: iluminación desde el NO (az 315°, alt 45°) sobre la pendiente
        px_deg = abs(self._transform.a)
        m_per_deg = 111320.0
        cell = max(px_deg * m_per_deg, 1e-3)
        gy, gx = np.gradient(np.where(valid, z, zmin), cell)
        slope = np.arctan(np.hypot(gx, gy))
        aspect = np.arctan2(-gx, gy)
        az = np.radians(315.0)
        alt = np.radians(45.0)
        shade = (np.sin(alt) * np.cos(slope) +
                 np.cos(alt) * np.sin(slope) * np.cos(az - aspect))
        shade = np.clip(shade, 0.0, 1.0)
        # mezcla: color modulado por el sombreado (0.5..1.15 para no apagar del todo)
        f = (0.5 + 0.65 * shade)[..., None]
        out = np.clip(rgb * f, 0, 255).astype("uint8")

        alpha = np.where(valid, 220, 0).astype("uint8")  # semitransparente
        rgba = np.dstack([out, alpha])
        img = Image.fromarray(rgba, mode="RGBA")
        import io as _io
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


def _read_geotiff(raw: bytes, source: TerrainSource, undulation: float = 0.0) -> RasterTerrain | None:
    """Parsea un GeoTIFF en memoria a RasterTerrain. Usa rasterio (robusto con
    los muchos sabores de TIFF que sirven los WCS)."""
    try:
        import rasterio
        from rasterio.io import MemoryFile
        import numpy as np
    except ImportError:
        return None
    try:
        with MemoryFile(raw) as mem, mem.open() as ds:
            band = ds.read(1).astype("float64")
            nodata = ds.nodata if ds.nodata is not None else -32768.0
            return RasterTerrain(
                _data=band, _transform=ds.transform, nodata=nodata,
                source=source, undulation=undulation,
            )
    except Exception:
        return None


# ---------------------------------------------------------------------------
# IGN — MDT 5 m (solo España), WCS sin autenticación
# ---------------------------------------------------------------------------

# WCS del IGN (mismo proveedor que la ortofoto PNOA). Cobertura MDT5 en EPSG:4258
# (≈ WGS84 para estos fines). Cota ortométrica (sobre el geoide EGM2008/REDNAP).
_IGN_WCS = "https://servicios.idee.es/wcs-inspire/mdt"
_IGN_COVERAGE = "Elevacion4258_5"


def _fetch_ign(bbox: BBox, timeout: float = 30.0) -> RasterTerrain | None:
    url = (
        f"{_IGN_WCS}?service=WCS&version=2.0.1&request=GetCoverage"
        f"&coverageId={_IGN_COVERAGE}"
        f"&subset=lat({bbox.min_lat},{bbox.max_lat})"
        f"&subset=long({bbox.min_lng},{bbox.max_lng})"
        f"&format=image/tiff"
    )
    try:
        raw = urlopen(url, timeout=timeout).read()
    except (URLError, TimeoutError, OSError):
        return None
    if not raw or len(raw) < 200:
        return None
    # IGN da cota ortométrica; el dron (barométrico anclado en despegue) también
    # mide desde el suelo local -> undulation 0 para la coherencia relativa AGL.
    return _read_geotiff(raw, "ign", undulation=0.0)


def _ign_covers(bbox: BBox) -> bool:
    """España peninsular + Baleares + Canarias, a grandes rasgos (para decidir si
    ni intentar la petición fuera de cobertura)."""
    # peninsular/baleares
    if -9.6 <= bbox.min_lng <= 4.4 and 35.8 <= bbox.min_lat <= 43.9:
        return True
    # canarias
    if -18.3 <= bbox.min_lng <= -13.3 and 27.5 <= bbox.min_lat <= 29.5:
        return True
    return False


# ---------------------------------------------------------------------------
# COP — Copernicus DEM 90 m global (bucket abierto de AWS, sin login).
# Implementación aislada en terrain_cop (lectura de COG por ventana con vsicurl).
# ---------------------------------------------------------------------------

def _fetch_cop(bbox: BBox, timeout: float = 40.0) -> RasterTerrain | None:
    try:
        from . import terrain_cop
    except ImportError:
        return None
    return terrain_cop.fetch(bbox, timeout=timeout)


# ---------------------------------------------------------------------------
# Fábrica
# ---------------------------------------------------------------------------

def load_terrain(
    source: TerrainSource,
    bbox: BBox,
    ground_msl: float,
) -> tuple[TerrainModel, TerrainSource]:
    """Crea el modelo de terreno pedido para el bbox del vuelo.

    Devuelve (modelo, fuente_efectiva). La fuente efectiva puede diferir de la
    pedida si hubo que degradar: p.ej. pides 'ign' fuera de España, o 'srtm'
    falla la red -> se cae a 'flat'. El front debe mostrar la fuente EFECTIVA.
    """
    flat = FlatTerrain(ground_msl=ground_msl)

    if source == "flat":
        return flat, "flat"

    if source == "ign":
        if not _ign_covers(bbox):
            return flat, "flat"
        model = _fetch_ign(bbox.padded())
        return (model, "ign") if model else (flat, "flat")

    if source == "cop":
        model = _fetch_cop(bbox.padded())
        return (model, "cop") if model else (flat, "flat")

    return flat, "flat"
