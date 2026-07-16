# Congelación y origen del código

## La regla

**A partir del 2026-07-16, este repositorio (`pinpoint`) es la fuente de verdad
del núcleo de proyección. El proyecto original `geosync` queda CONGELADO y no se
vuelve a tocar.**

Si hay que corregir o mejorar algo del núcleo (parseo del `.bin`, sincronía,
proyección del footprint), se hace **aquí**, en `pinpoint_core/`. No se toca el
`geosync` original ni se intenta mantener las dos copias en paralelo.

## Por qué existe esta regla

El núcleo de PinPoint (`pinpoint_core/`) es una **copia congelada** del paquete
`geosync`, que vive en otro repositorio:

    hive-gis/dockers/ODM/app/geosync/

Ese `geosync` seguirá existiendo porque es parte de un trabajo distinto (extraer
frames georreferenciados para reconstrucción fotogramétrica con WebODM/ODM), del
que se hará su propio paper más adelante. Al copiar el núcleo aquí, durante un
tiempo hay **dos copias del mismo código** en disco. Sin una regla clara, dentro
de unos meses nadie sabría cuál es el bueno. Esta es la regla: **pinpoint manda;
geosync está congelado.**

## Qué se copió y qué NO

Copiado a `pinpoint_core/` (2026-07-16):

- `binlog.py`  — parseo del `.bin` de ArduPilot (GPS, ATT, MNT/gimbal).
- `sync.py`    — sincronización vídeo ↔ vuelo (takeoff / creation_time / manual).
- `footprint.py` — proyección: footprint del frame + `project_pixel`
  (con actitud y ortogonal), y el reporte de `drone_pitch`.
- `video.py`   — `probe` (ffprobe) + `extract_single_frame` (ffmpeg).

Dejado FUERA a propósito (era específico de la reconstrucción con WebODM, no de
PinPoint):

- `cli.py`, `geotxt.py`, `pipeline.py` — pipeline de extracción de todos los
  frames de un vuelo + generación del `geo.txt` de ODM.
- `extract_frames()` de `video.py` — extracción masiva de frames.
- Los endpoints `/api/jobs*` del servidor — lanzaban ese pipeline.

PinPoint solo proyecta puntos al instante; no genera datasets para fotogrametría.

## Cambios respecto al geosync original

- El paquete se renombró `geosync` → `pinpoint_core` (imports internos ya eran
  relativos, así que el renombrado fue solo del nombre del paquete).
- El servidor pasó de `server.py` a `server/app.py`, sin los jobs.
- Variables de entorno `GEOSYNC_*` → `PINPOINT_*`.
- Clave de `localStorage` del front: `geosync.gcp.campaign` → `pinpoint.gcp.campaign`.
- La marca del front: "geosync" → "PinPoint".

El resto de la lógica (la matemática de proyección, la sincronía, el parseo) es
idéntica y ya estaba validada en geosync.
