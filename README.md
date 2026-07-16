# PinPoint

**Georreferencia al instante un punto que ves en el vídeo de un dron, usando solo
el vídeo y su log de vuelo — sin procesar nada.**

En una emergencia (un incendio, una inundación, un rescate) despliegas un dron y
grabas vídeo. Ves algo en la imagen — una persona, un foco, un vehículo — y
necesitas sus coordenadas **ya**, no dentro de una hora tras un procesado
fotogramétrico. PinPoint hace justo eso: señalas el punto en el fotograma y te
da su posición sobre el terreno en segundos, reconstruyendo dónde estaba el dron
y hacia dónde miraba a partir del log de ArduPilot (`.bin`).

Este repositorio acompaña un artículo que **valida el método y acota su error**
en función de la distancia al centro de la imagen y las condiciones de vuelo.

> **Estado: v0.1.0 — versión sin modelo del terreno (MDT).** La proyección asume
> terreno plano a la cota del despegue. La siguiente versión incorporará el
> modelo digital del terreno (IGN para España, SRTM para el resto del mundo) para
> corregir el desnivel. Ver [Hoja de ruta](#hoja-de-ruta).

---

## Qué hace, en concreto

1. Cargas un vuelo: el log `.bin` de ArduPilot y el vídeo del dron.
2. PinPoint **sincroniza** el tiempo del vídeo con el tiempo del vuelo (por
   despegue, por hora de creación del vídeo, o a mano).
3. En cualquier instante, **proyecta** un píxel de la imagen al terreno usando la
   posición GPS, la altura, y la actitud (cabeceo/alabeo/rumbo del dron + cabeceo
   del gimbal) que lee del log.
4. Con la herramienta de **puntos de control** mides el error real del método
   contra verdad-terreno marcada a mano, y exportas una campaña (CSV + figuras)
   para el análisis del paper.

Dos formas de proyectar el mismo píxel, para poder comparar:

- **con actitud** — la proyección real, con roll/pitch/yaw completos.
- **ortogonal** — pinhole nadir puro, sin actitud (línea base).

---

## Arquitectura

Por capas, a propósito: el núcleo es Python puro y no depende del navegador.

```
pinpoint_core/     núcleo de proyección (Python puro, solo pymavlink)
  binlog.py          parseo del .bin (GPS, ATT, MNT/gimbal)
  sync.py            sincronización vídeo ↔ vuelo
  footprint.py       proyección: footprint + project_pixel (actitud / ortogonal)
  video.py           sondeo del vídeo + extracción de un fotograma
server/
  app.py             FastAPI fino que expone el núcleo por HTTP
web/                 front React/Vite/Tailwind/MapLibre/Zustand
docs/                artículo y material de investigación
data/                dataset de ejemplo (enlace externo, ver data/README.md)
```

El núcleo procede del proyecto interno `geosync` y está **congelado** aquí; ver
[FROZEN.md](FROZEN.md). PinPoint es, a partir de ahora, la fuente de verdad de
ese código.

---

## Cómo ejecutarlo

### Desarrollo local (dos procesos)

```bash
# 1) backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PINPOINT_DATA=./pinpoint-data uvicorn server.app:app --reload --port 8000

# 2) front (otra terminal) — el proxy de Vite apunta a :8000
cd web && npm install && npm run dev
```

Necesitas `ffmpeg`/`ffprobe` en el sistema (el núcleo los usa para el vídeo).

### Docker

```bash
cp .env.example .env      # ajusta puerto y rutas
docker compose up -d --build
# -> http://localhost:${PINPOINT_PORT}   (8096 por defecto)
```

---

## Cómo se usa (flujo del paper)

1. **Carga el vuelo** (`.bin` + vídeo) en la pantalla inicial.
2. **Sincroniza** en la pestaña *Flight*. Para el vuelo de referencia, usa
   sincronía **manual con offset ≈ 1,4 s** (la detección por despegue falla en
   este VTOL: detecta la transición, no el despegue).
3. Pestaña *Location* → casilla **Ground control points (paper)**: foto y mapa
   lado a lado. Marca un rasgo en la foto, márcalo en el mapa, y PinPoint calcula
   el error de las dos proyecciones contra tu verdad-terreno.
4. Repite en varios frames; la campaña se acumula y se guarda sola.
5. **Export campaign** → un ZIP con `points.csv` (una fila por punto, todas las
   condiciones de vuelo), un JSON, y por cada frame la foto + dos figuras del
   mapa con los errores dibujados.

El CSV es la tabla de análisis directa: error radial vs distancia al centro, AGL,
roll, etc.

---

## Calibración del FOV

La lente real es más ancha que la que asume el código por defecto (72,3°). Antes
de recoger una campaña seria hay que **calibrar el `fov_scale`**: la propia
herramienta lo sugiere a partir de los puntos tomados. Toma primero unos puntos
en un frame con **roll bajo** (|roll| < 0,5°) para aislar el FOV.

> **Ojo con el terreno.** En la v0.1.0 (sin MDT) el error radial mezcla la lente
> con el desnivel del terreno, porque el AGL se calcula con la cota del despegue.
> Calibra sobre tramos donde el terreno esté a esa cota. La v0.2.0 (MDT) elimina
> esta limitación.

---

## Hoja de ruta

- **v0.1.0 (actual)** — proyección con terreno plano. Herramienta de puntos de
  control y exportación de campaña. Validado end-to-end.
- **v0.2.0 — modelo del terreno (MDT).** AGL real por punto: IGN (5 m) para
  España, SRTM (30 m) para el resto del mundo, plano como último recurso. Incluye
  la corrección geoide→elipsoide de SRTM (EGM96 vs WGS84). Separa la distorsión de
  la lente del desnivel del terreno; permite calibrar y tomar puntos en cualquier
  frame.
- **Paper** — redacción en `docs/`, con dataset de ejemplo citable (DOI).

---

## Licencia y créditos

- **Código** (`pinpoint_core/`, `server/`, `web/`): PolyForm Noncommercial 1.0.0
  — libre para cualquier uso **no comercial** (investigación, educación, uso
  personal). Ver [LICENSE](LICENSE).
- **Documentación, figuras y datos**: CC BY-NC 4.0. Ver [LICENSE-docs](LICENSE-docs).
- Desarrollado con la ayuda de **LeftCape**, que puso los medios; los derechos de
  explotación pertenecen a LeftCape. Ver [NOTICE](NOTICE).

Para citar el software, ver [CITATION.cff](CITATION.cff).
