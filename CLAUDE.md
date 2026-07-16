# PinPoint — contexto para Claude Code

Este fichero se carga solo al abrir una sesión desde este repo. Es la memoria del
proyecto: léelo antes de nada. PinPoint es **autónomo** — todo lo que hace falta
saber está aquí y en el código, no dependas de ningún otro repo.

## Qué es PinPoint

Georreferencia **al instante** un punto que se ve en el vídeo de un dron, usando
solo el vídeo + su log de vuelo de ArduPilot (`.bin`), **sin procesar nada**.
Pensado para **respuesta rápida en desastre**: ves algo en la imagen (una persona,
un foco, un vehículo) y necesitas sus coordenadas en segundos, no tras una hora de
fotogrametría. Este repo acompaña un **paper** que valida el método y acota su error.

## La filosofía del paper (no perderla de vista)

La tesis **NO es "esto es preciso"** — es **"esto es inmediato, con el error
acotado"**. El valor es la rapidez en campo con incertidumbre conocida, no competir
en precisión con la fotogrametría. Todo lo construido sirve a eso: la herramienta
de puntos de control existe para **medir hasta dónde puedes confiar**, que es lo que
un revisor pedirá. Si dudas de una decisión de diseño, pregúntate si ayuda a esa
tesis.

## Lo crítico ANTES de recoger datos en serio

1. **Calibra el FOV primero.** La lente real es más ancha que los 72.3° que asume
   el código por defecto. Sin calibrar, el paper mediría tu error de calibración,
   no el del método. Toma unos puntos en un frame de **roll bajo** (|roll|<0.5°),
   mira el `fov_scale` sugerido en el panel, aplícalo, y ENTONCES recoge.
2. **La distorsión de gran angular es un RESULTADO, no un fallo.** Ningún `fov_scale`
   único deja todos los puntos a cero. Eso es lo publicable: "hasta X px del centro
   el pinhole vale; más allá hace falta el modelo de Brown". No lo escondas.
3. **Sincronía manual, offset ≈ 1.4 s** para el vuelo de referencia. `takeoff` se
   equivoca ~20 s en este VTOL (detecta la transición, no el despegue).
4. **Fija UNA fuente de terreno y UN fov_scale** para toda la campaña; no los
   cambies a mitad. El CSV guarda con qué se midió cada punto, pero mezclar
   configuraciones ensucia el análisis.

## Honestidad que debe ir en el paper

- **Limitación del terreno**: el MDT usa la cota bajo el DRON, no bajo el píxel.
  Corrige el grueso del relieve, no el ray-cast contra pendientes. Decláralo.
- **El MDT como variable**: puedes reportar cómo cambia el error según la fuente
  (plano / IGN / Copernicus). Eso FORTALECE el paper.

## Cómo funciona (para el usuario)

1. Carga un vuelo (`.bin` + vídeo) en la pantalla inicial: "Ruta en servidor"
   (fichero ya en disco) o "Subir ficheros" (arrastra desde el navegador).
2. Sincroniza en la pestaña **Flight**.
3. Pestaña **Location** → casilla **"Ground control points (paper)"**:
   - Selecciona el **Modelo del terreno** (Plano / IGN 5m / Copernicus 90m).
   - **"Empezar a marcar este frame"** (pausa el vídeo, activa el overlay de clicks);
     marca un rasgo en la FOTO → el mismo rasgo en el MAPA (verdad-terreno).
   - **"Terminar este frame"** libera el vídeo para moverte a otro fotograma.
   - Con MDT activo: botón **⛰ MDT** pinta el terreno coloreado; el ratón muestra
     la altura abajo-izquierda.
4. **Export campaign** → ZIP con `points.csv` (una fila por punto, todas las
   condiciones), `campaign.json`, y por frame la foto + 2 figuras del mapa.

## Arquitectura

Por capas (el núcleo es Python puro, sin navegador):
```
pinpoint_core/   binlog, sync, footprint, video, terrain, terrain_cop  (Python puro)
server/app.py    FastAPI fino que expone el núcleo por HTTP (SIN jobs de WebODM)
web/             front React/Vite/Tailwind/MapLibre/Zustand
docs/  data/     paper + dataset (enlace externo)
```
El núcleo es copia **congelada** del proyecto `geosync`; ver `FROZEN.md`. PinPoint
es la fuente de verdad de ese código. Se dejó fuera lo de WebODM (extracción de
frames, geo.txt, jobs, pestaña Extraction).

## Decisiones ya tomadas (no revisar sin motivo)

- **Copernicus DEM 90 m** como fuente mundial de terreno, NO SRTM (SRTM necesita
  login de NASA; Copernicus está en bucket abierto de AWS, sin auth).
- **Sin corrección de geoide**: GPS.Alt de ArduPilot es ortométrico como IGN y
  Copernicus, así que AGL = alt − cota directo. Verificado.
- **3D descartado** (no aporta a la tesis, que se valida en 2D).
- **Paquete Python** = `pinpoint_core` (no `geosync`).

## Cómo ejecutarlo

Desarrollo local (dos procesos): backend `uvicorn server.app:app --reload
--port 8000` (con `PINPOINT_DATA=./pinpoint-data`), front `cd web && npm run dev`
(proxy a :8000). Necesita ffmpeg/ffprobe. Docker: `cp .env.example .env && docker
compose up -d --build`.

**Despliegue en staging** (192.168.1.200, misma máquina que hive-gis): el `.env`
del repo apunta a puerto 8095. `REMOTE_USER=luis REMOTE_HOST=192.168.1.200
REMOTE_DIR=/home/luis/docker/pinpoint ./deploy.sh` (anuncia + smoke-test; el user
tiene autonomía de deploy en staging). Datos en /mnt/datos1/docker-data/pinpoint.
El vuelo de referencia en disco del servidor:
/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico/ (00000064.BIN +
recording_96_visible.mkv).

## Estado (2026-07-16) y pendientes

- **App corriendo**: http://192.168.1.200:8095 (v0.2.0, con capa MDT).
- **GitHub PRIVADO**: `leftcape/pinpoint` (cuenta `elgeografo`, SSH). `git push`.
- **Licencias con titularidad**: autor Luis Izquierdo Mesa, explotación LeftCape
  (PolyForm-NC código, CC BY-NC docs). El usuario asume el riesgo legal sin abogado.
- **PENDIENTE**: dataset de ejemplo (enlace externo, Zenodo por DOI) para el paper;
  revisión legal SOLO antes de hacer el repo público.
