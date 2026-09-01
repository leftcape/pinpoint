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

1. **Sincroniza y luego fija el FOV, en ese orden** (pestaña Flight). Hay DOS
   FOV y se guardan los dos en la campaña: `sfm` (autocalibración OpenSfM de la
   misma cámara: f=0.6849 → 72.3°; describe el centro) y `visual` (el nuestro
   contra la ortofoto: a ojo o, mejor, **por pares**, que resuelve la escala de
   las distancias entre rasgos y no depende del offset ni del yaw). Se elige el
   activo; cada punto se proyecta con los dos (`alt_*` en el CSV).
2. **La distorsión de gran angular es un RESULTADO, no un fallo.** La diferencia
   sfm/visual y el crecimiento del error con la distancia al centro son lo
   publicable: "hasta X px del centro el pinhole vale; más allá hace falta el
   modelo de Brown". No lo escondas.
3. **Sincronía manual** para el vuelo de referencia. `takeoff` se equivoca ~20 s
   en este VTOL (detecta la transición, no el despegue). ⚠ Hay dos cifras
   anotadas para el offset fino (1.0 s en el PROCESO del paper, ≈1.4 s aquí):
   reconciliar antes de la campaña y dejar UNA.
4. **Bloquea la campaña** (candado en la pestaña GCP) antes de marcar: congela
   sync, FOV, terreno y deltas. Mezclar configuraciones ensucia el análisis.

## Dónde vive la campaña

`campaign.json` = config (sync, dos FOV y cómo se obtuvo el visual, aspect,
terreno, deltas, candado) + frames + puntos. Se guarda en el servidor por vuelo
(`$PINPOINT_DATA/campaigns/<clave>.json`, clave = hash de rutas bin+vídeo,
estable entre reinicios), en localStorage (caché) y se exporta/importa como
fichero. El `id` de sesión de un vuelo es un uuid en memoria: NO sirve para
indexar nada persistente; usa `source_key`.

## Honestidad que debe ir en el paper

- **Limitación del terreno**: el MDT usa la cota bajo el DRON, no bajo el píxel.
  Corrige el grueso del relieve, no el ray-cast contra pendientes. Decláralo.
- **El MDT como variable**: puedes reportar cómo cambia el error según la fuente
  (plano / IGN / Copernicus). Eso FORTALECE el paper.

## Cómo funciona (para el usuario)

1. Carga un vuelo en la pantalla inicial. Tres modos:
   - **Carpeta del servidor** (lo normal): dos desplegables independientes, uno
     de vídeos y otro de logs, con lo que hay en `PINPOINT_LIBRARY`. Desde ahí
     se suben ficheros a esa misma carpeta, con cuota (`PINPOINT_QUOTA_GB`, 25
     GB por defecto): al llenarse se rechazan subidas, nunca se borra nada solo.
   - **Ruta en servidor**: escribir rutas absolutas (ficheros de fuera de la
     biblioteca).
   - **Subir ficheros**: el par bin+vídeo va a la carpeta de trabajo de la app.
2. Sincroniza y fija el FOV en la pestaña **Flight**.
3. Pestaña **GCP**: modelo del terreno, **bloquear**, y **"Tomar puntos"**:
   - **"Empezar a marcar este frame"** (pausa el vídeo, activa el overlay de clicks);
     marca un rasgo en la FOTO → el mismo rasgo en el MAPA (verdad-terreno).
   - La ficha del punto muestra el error descompuesto (E/N y along/cross) con
     los dos FOV, y el offset del píxel al centro; las estadísticas van en vivo.
   - **"Terminar este frame"** libera el vídeo para moverte a otro fotograma.
   - Con MDT activo: botón **⛰ MDT** pinta el terreno coloreado; el ratón muestra
     la altura abajo-izquierda.
4. **Exportar** → ZIP con `points.csv` (una fila por punto, todas las
   condiciones, columnas `alt_*` con el otro FOV), `campaign.json`, y por frame
   la foto + 2 figuras del mapa. **Importar** recupera un `campaign.json`.

## Arquitectura

Por capas (el núcleo es Python puro, sin navegador):
```
pinpoint_core/   binlog, sync, footprint, video, terrain, terrain_cop  (Python puro)
server/app.py    FastAPI fino que expone el núcleo por HTTP (SIN jobs de WebODM)
web/             front React/Vite/Tailwind/MapLibre/Zustand. TODO texto visible pasa por
                 src/i18n.ts (ES/EN, idioma del navegador por defecto, selector en la
                 cabecera): al añadir un texto, añade la clave en los DOS diccionarios.
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
La carpeta de vuelos del servidor (`PINPOINT_LIBRARY`, la que alimenta los
desplegables y recibe las subidas) y donde está el vuelo de referencia:
/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico/ (00000064.BIN +
recording_96_visible.mkv).

## Estado (2026-08-26) y pendientes

- **App corriendo**: https://pinpoint.leftcape.com (staging 192.168.1.200:8095).
  v0.3.1: campaña unificada en servidor, dos FOV, pestaña GCP, ES/EN, registro
  persistente de vuelos, candidatos de frame, `scripts/analisis_campana.py`.
- Los `id` de sesión siguen siendo uuid, pero `registry.json` los re-registra al
  arrancar; la subida por navegador usa como carpeta el hash del `.bin`.
- **Paper**: `~/repos/upm/papers-26-27/02_fmv/` (bitácora, PROCESO, compendio de
  estudios en `docs/ENFOQUE_2026-08-26.md`). Los estudios E1–E9 salen de
  `points.csv`.
- **GitHub PRIVADO**: `leftcape/pinpoint` (cuenta `elgeografo`, SSH). `git push`.
- **Licencias con titularidad**: autor Luis Izquierdo Mesa, explotación LeftCape
  (PolyForm-NC código, CC BY-NC docs). El usuario asume el riesgo legal sin abogado.
- **PENDIENTE**: dataset de ejemplo (enlace externo, Zenodo por DOI) para el paper;
  revisión legal SOLO antes de hacer el repo público.
