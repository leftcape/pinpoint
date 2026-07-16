"""
Copernicus DEM 90 m — fuente de terreno MUNDIAL, sin login.

Bucket público de AWS (`copernicus-dem-90m`), un GeoTIFF Cloud-Optimized (COG)
por tesela de 1°×1°. Se lee solo la VENTANA del bbox del vuelo con `/vsicurl`
(range reads), sin descargar la tesela entera. Datum EGM2008 (ortométrico), misma
familia que el GPS.Alt de ArduPilot y el MDT del IGN -> AGL sin geoide.

Verificado (2026-07-16): la tesela de Madrid da 651.99 m en el centro (~650 m
reales). Cobertura global; no necesita clave ni cuenta.

Se aísla aquí para no cargar rasterio/GDAL en el import de terrain.py si no se usa.
"""

from __future__ import annotations

import math

_BUCKET = "https://copernicus-dem-90m.s3.amazonaws.com"


def _tile_stem(lat_floor: int, lng_floor: int) -> str:
    ns = f"N{lat_floor:02d}" if lat_floor >= 0 else f"S{abs(lat_floor):02d}"
    ew = f"E{lng_floor:03d}" if lng_floor >= 0 else f"W{abs(lng_floor):03d}"
    return f"Copernicus_DSM_COG_30_{ns}_00_{ew}_00_DEM"


def _tile_url(lat_floor: int, lng_floor: int) -> str:
    stem = _tile_stem(lat_floor, lng_floor)
    return f"/vsicurl/{_BUCKET}/{stem}/{stem}.tif"


def fetch(bbox, timeout: float = 40.0):
    """Descarga la ventana del bbox y la devuelve como RasterTerrain, o None.

    Un bbox de un vuelo (unos km) casi siempre cae en UNA tesela de 1°. Si cruza
    un meridiano/paralelo entero, se leen las teselas implicadas y se mosaica la
    ventana. Se ignoran teselas que no existan (mar, sin cobertura)."""
    try:
        import rasterio
        from rasterio.windows import from_bounds
        from rasterio.transform import from_origin
        import numpy as np
    except ImportError:
        return None

    from .terrain import RasterTerrain

    # timeout y reintentos de red para GDAL/vsicurl
    import os
    os.environ.setdefault("GDAL_HTTP_TIMEOUT", str(int(timeout)))
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "2")
    os.environ.setdefault("CPL_VSIL_CURL_USE_HEAD", "NO")

    lat0 = math.floor(bbox.min_lat)
    lat1 = math.floor(bbox.max_lat)
    lng0 = math.floor(bbox.min_lng)
    lng1 = math.floor(bbox.max_lng)

    windows: list[tuple] = []  # (array, transform)
    for la in range(lat0, lat1 + 1):
        for lo in range(lng0, lng1 + 1):
            url = _tile_url(la, lo)
            try:
                with rasterio.open(url) as ds:
                    # recortamos a la intersección del bbox con esta tesela
                    win = from_bounds(
                        max(bbox.min_lng, lo), max(bbox.min_lat, la),
                        min(bbox.max_lng, lo + 1), min(bbox.max_lat, la + 1),
                        ds.transform,
                    )
                    arr = ds.read(1, window=win).astype("float64")
                    if arr.size == 0:
                        continue
                    tr = ds.window_transform(win)
                    nodata = ds.nodata if ds.nodata is not None else -32768.0
                    windows.append((arr, tr, nodata))
            except Exception:
                continue  # tesela inexistente (mar) o fallo de red: se salta

    if not windows:
        return None
    if len(windows) == 1:
        arr, tr, nodata = windows[0]
        return RasterTerrain(_data=arr, _transform=tr, nodata=nodata, source="cop")

    # Varias teselas: mosaico a una rejilla común. Todas comparten resolución
    # (0.000833°); construimos un lienzo que cubra la unión y las volcamos.
    res = abs(windows[0][1].a)  # tamaño de píxel en grados
    ys = [tr.f for _, tr, _ in windows]                       # lat del borde sup
    xs = [tr.c for _, tr, _ in windows]                       # lng del borde izq
    y_top = max(ys)
    x_left = min(xs)
    y_bot = min(tr.f - arr.shape[0] * res for arr, tr, _ in windows)
    x_right = max(tr.c + arr.shape[1] * res for arr, tr, _ in windows)
    H = int(round((y_top - y_bot) / res))
    W = int(round((x_right - x_left) / res))
    canvas = np.full((H, W), -32768.0)
    for arr, tr, _ in windows:
        r0 = int(round((y_top - tr.f) / res))
        c0 = int(round((tr.c - x_left) / res))
        h, w = arr.shape
        canvas[r0:r0 + h, c0:c0 + w] = arr
    full_tr = from_origin(x_left, y_top, res, res)
    return RasterTerrain(_data=canvas, _transform=full_tr, nodata=-32768.0, source="cop")
