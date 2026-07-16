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

> **Estado: v0.2.0 — con modelo del terreno (MDT).** El AGL se corrige con la
> cota real del terreno bajo el dron: **IGN 5 m** para España, **Copernicus DEM
> 90 m** para el resto del mundo, o **plano** (cota del despegue) como en v0.1.0.
> Elegible en la interfaz para comparar. Ver [Modelo del terreno](#modelo-del-terreno).

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

> **Terreno.** Con el MDT activado (IGN o Copernicus), el AGL usa la cota real
> del terreno, así que el error radial ya no mezcla la lente con el desnivel y
> puedes calibrar en cualquier frame. Con `flat` (v0.1.0) calibra solo sobre
> tramos llanos. Ver abajo.

---

## Modelo del terreno

La proyección necesita el AGL (altura del dron sobre el suelo). Tres modelos,
elegibles en el panel de puntos de control para **comparar**:

| Modelo | Cobertura | Resolución | Fuente |
|--------|-----------|-----------|--------|
| **Plano** | universal | — | cota del despegue (asume terreno llano) |
| **IGN 5m** | España | 5 m | MDT del IGN (WCS, sin login) |
| **Copernicus 90m** | mundial | 90 m | Copernicus DEM (bucket abierto de AWS, sin login) |

El ráster se descarga **una vez** para el bounding box del vuelo y se cachea; los
puntos se muestrean en memoria. Si la fuente no cubre la zona o falla la red, se
degrada a plano automáticamente y el panel muestra la fuente **efectiva**.

Datum: todas las fuentes y el `GPS.Alt` de ArduPilot son ortométricas (sobre el
nivel del mar), así que `AGL = altitud_dron − cota` directamente, **sin
corrección de geoide** (el receptor GNSS ya la aplica; se verificó que el desfase
observado no era del geoide).

Limitación conocida (v0.2.0): se usa la cota **bajo el dron**, no bajo el píxel
proyectado. Corrige el grueso del sesgo por relieve; el ray-cast contra terreno
inclinado (para píxeles muy oblicuos sobre pendientes) queda pendiente.

---

## Hoja de ruta

- **v0.1.0** — proyección con terreno plano. Herramienta de puntos de control y
  exportación de campaña. Validado end-to-end.
- **v0.2.0 (actual)** — modelo del terreno: IGN 5 m (España) y Copernicus DEM
  90 m (mundial), elegibles para comparar, con degradación a plano. AGL real bajo
  el dron; sin corrección de geoide (todo ortométrico). `terrain_source` en el CSV.
- **Siguiente** — ray-cast del píxel contra el terreno inclinado (cota bajo el
  punto, no bajo el dron); dataset de ejemplo citable (DOI) y redacción del paper.

---

## Licencia y créditos

- **Código** (`pinpoint_core/`, `server/`, `web/`): PolyForm Noncommercial 1.0.0
  — libre para cualquier uso **no comercial** (investigación, educación, uso
  personal). Ver [LICENSE](LICENSE).
- **Documentación, figuras y datos**: CC BY-NC 4.0. Ver [LICENSE-docs](LICENSE-docs).
- Desarrollado con la ayuda de **LeftCape**, que puso los medios; los derechos de
  explotación pertenecen a LeftCape. Ver [NOTICE](NOTICE).

Para citar el software, ver [CITATION.cff](CITATION.cff).
