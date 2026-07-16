"""
pinpoint_core — núcleo de proyección de PinPoint.

Dado un vídeo de dron + su log de ArduPilot (.bin), reconstruye la posición y la
actitud de la cámara en cualquier instante del vídeo y proyecta un píxel de la
imagen al terreno (lat/lng). Es lógica pura, sin dependencias web: se usa desde
el servidor FastAPI de PinPoint o desde cualquier script.

Módulos:
  binlog     parseo del .bin de ArduPilot (GPS, ATT, MNT/gimbal).
  sync       sincronización vídeo-tiempo ↔ tiempo-de-vuelo (takeoff / creation_time / manual).
  footprint  proyección: footprint del frame + project_pixel (con actitud y ortogonal).
  video      sondeo del vídeo (ffprobe) y extracción de un fotograma suelto (ffmpeg).

ORIGEN Y CONGELACIÓN
--------------------
Este núcleo procede del proyecto `geosync` (hive-gis/dockers/ODM/app/geosync),
copiado y congelado el 2026-07-16. A partir de ese corte, PinPoint es la fuente
de verdad de este código; el geosync original queda congelado y no se vuelve a
tocar. Ver FROZEN.md en la raíz del repo.

Se dejó FUERA a propósito lo que era específico de la reconstrucción con WebODM
(cli.py, geotxt.py, pipeline.py, y extract_frames en video.py): PinPoint solo
proyecta puntos al instante, no genera datasets de frames para fotogrametría.
"""

__version__ = "0.2.0"
