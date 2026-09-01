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

## Idioma

La interfaz está en **español e inglés**. Por defecto usa el idioma del navegador;
el selector ES/EN de la cabecera lo cambia y la elección se recuerda en el
navegador. Los textos viven en `web/src/i18n.ts` (un diccionario por idioma; las
claves son las mismas). El `README.txt` del ZIP exportado sale en el idioma activo.

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
web/                 front React/Vite/Tailwind/MapLibre/Zustand (i18n ES/EN en src/i18n.ts)
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

### Despliegue en un servidor

`deploy.sh` tiene dos modos. Por defecto **git**: el servidor hace `git pull` y
construye, así lo desplegado es exactamente lo que hay en GitHub.

```bash
REMOTE_USER=usuario REMOTE_HOST=servidor ./deploy.sh              # git pull de main
REMOTE_USER=usuario REMOTE_HOST=servidor MODE=rsync ./deploy.sh   # copia local sin publicar
```

En modo git el servidor necesita poder leer el repo (deploy key en GitHub si es
privado). El `.env` **no viaja** (ni por git ni por rsync): si el servidor no
tiene uno, el script lo siembra desde `.env.example`.

---

## Proyectos

Un **proyecto** agrupa todo lo de un vuelo — vídeo, log, configuración, puntos
de control y metadatos — bajo una identidad propia.

Por qué existe: antes la campaña se guardaba indexada por un hash de las *rutas*
del `.bin` y del vídeo, así que **renombrar un fichero la dejaba huérfana**
(pasó de verdad: 100 puntos marcados dejaron de aparecer al renombrar los
vuelos). El id de un proyecto no depende de dónde estén los ficheros ni de cómo
se llamen: se pueden mover o reemplazar sin perder el trabajo.

En la pantalla inicial se listan los proyectos y se crea uno nuevo eligiendo
vídeo y log de los desplegables. Cargar un vuelo suelto sin proyecto sigue
siendo posible (plegado bajo "o cargar un vuelo suelto").

### Lectura pública, escritura protegida

Cada proyecto puede tener una **contraseña de escritura**:

- **Leer es siempre público**: cualquiera puede abrir el proyecto y ver los puntos.
- **Guardar** exige la contraseña, si el proyecto la tiene. Sin contraseña
  definida, el proyecto es abierto (útil en una instancia en red privada).
- Se guarda **hasheada** (PBKDF2-SHA256 con sal, 200 000 iteraciones). El texto
  no se guarda nunca, y **ni el hash ni la sal salen por la API**: si salieran,
  la protección sería decorativa, porque el proyecto es público en lectura.
- Si se pierde, **no se puede recuperar**: hay que quitarla editando el
  `project.json` del servidor.
- La contraseña vive solo en la memoria de la pestaña, y viaja en una cabecera
  (`X-Pinpoint-Password`), no en la URL, para que no acabe en los logs de acceso.

Ojo con el alcance: esto protege del accidente y del curioso. Sobre HTTP en
claro y sin sesiones, no es una defensa contra alguien decidido — no confíes al
servidor nada que no pueda ser público.

### Copias de seguridad

Guardar una campaña la reemplaza entera, y son horas de marcado. Por eso
**antes de cada guardado se hace una copia** en `projects/<id>/backups/` (se
conservan las 10 últimas). Si el número de puntos cae a menos de la mitad, la
respuesta lo avisa y la interfaz lo muestra.

```
GET  /api/projects/<id>/backups                      lista de copias
POST /api/projects/<id>/backups/<nombre>/restore     recuperar una
```

### Migración automática

Al arrancar, las campañas del esquema anterior (`campaigns/<hash>.json`) se
convierten en proyectos. Los ficheros originales **no se borran**. Si la misma
campaña estaba guardada bajo dos claves (por ejemplo tras renombrar y copiar),
se detecta por el contenido y se crea **un solo proyecto**, con las rutas que
existen de verdad.

---

## La carpeta de vuelos y su cuota

PinPoint lee los vuelos de **una carpeta del servidor** y la muestra en la
pantalla inicial como **dos desplegables independientes**: uno con los vídeos y
otro con los logs. Se elige uno de cada uno; no se emparejan solos, porque el
vídeo y el log de un mismo vuelo no siempre comparten nombre.

- Se recorren **subcarpetas**, así que se puede tener una por vuelo. En la lista
  se ve el nombre relativo y el tamaño, que es lo que permite distinguirlos.
- Extensiones reconocidas: vídeo `.mkv .mp4 .mov .avi .m4v .ts .webm`;
  log `.bin .log .tlog .px4log .ulg`.
- **Subir ficheros** desde el navegador los deja en esa misma carpeta, así que
  aparecen en el desplegable al terminar. Se sube de uno en uno, con barra de
  progreso, y el que acaba de subirse queda ya seleccionado.

### Cuota

| variable | por defecto | qué hace |
|---|---|---|
| `PINPOINT_LIBRARY` | `/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico` | carpeta que se lista y donde aterrizan las subidas |
| `PINPOINT_QUOTA_GB` | `25` | tope de ocupación de esa carpeta |

La ocupación se muestra siempre en la pantalla inicial (verde, ámbar al pasar del
80 %, rojo al llenarse). Al alcanzar el tope **se rechazan las subidas nuevas**;
PinPoint **nunca borra nada** por su cuenta: son datos de campaña, y hacer hueco
es una decisión de la persona. Si una subida fuese a pasarse de cuota, se corta
mientras entra y no deja el fichero a medias.

La carpeta debe estar **dentro de `PINPOINT_SOURCE_MOUNT`** y montada de
lectura-escritura (así viene en `docker-compose.yml`). Si se monta en solo
lectura, los desplegables siguen funcionando pero la subida se desactiva y la
interfaz lo dice.

---

## Cómo se usa (flujo del paper)

1. **Carga el vuelo** en la pantalla inicial: lo normal es elegirlo en los dos
   desplegables de la **carpeta del servidor** (uno de vídeos, otro de logs).
   Ver [La carpeta de vuelos](#la-carpeta-de-vuelos-y-su-cuota).
2. **Sincroniza** en la pestaña *Flight*. Para el vuelo de referencia, usa
   sincronía **manual con offset ≈ 1,4 s** (la detección por despegue falla en
   este VTOL: detecta la transición, no el despegue).
3. Fija el **FOV** en *Flight* (ver abajo) y, en *GCP*, elige el terreno y
   **bloquea** la campaña.
4. Pestaña *GCP* → **Tomar puntos**: foto y mapa lado a lado. Marca un rasgo en
   la foto, márcalo en el mapa, y PinPoint calcula el error de las dos
   proyecciones (ortogonal / con actitud) contra tu verdad-terreno, con los dos
   FOV, y te lo enseña descompuesto: E/N y, en ejes de la imagen, *along* (a lo
   largo de la traza: ahí se ve un desfase de sync) y *cross* (transversal: ahí
   se ven FOV, roll y distorsión), más la distancia del píxel al centro.
5. Repite en varios frames; la campaña se acumula y se guarda sola (servidor +
   navegador). Las estadísticas (RMSE, mediana, P90 sobre frames nadir) se
   actualizan en vivo.
6. **Exportar** → un ZIP con `points.csv` (una fila por punto, todas las
   condiciones de vuelo), `campaign.json`, y por cada frame la foto + dos figuras
   del mapa con los errores dibujados. **Importar** recupera un `campaign.json`.

El CSV es la tabla de análisis directa: error radial vs distancia al centro, AGL,
roll, etc.

---

## El FOV: dos valores, los dos guardados

La proyección necesita el campo de visión horizontal de la cámara, que no se
conoce a priori. PinPoint guarda **dos** valores en la campaña y proyecta cada
punto de control con los dos:

| | de dónde sale | qué describe |
|---|---|---|
| **sfm** | autocalibración fotogramétrica (OpenSfM/ODM) de la misma cámara: focal normalizado `f` → `fov = 2·atan(0.5/f)`. Para el vuelo de referencia `f = 0.6849` → 72.3° | el centro de la imagen (focal pinhole) |
| **visual** | el nuestro, contra la ortofoto, en la pestaña *Flight*: **a ojo** (la huella nadir queda clavada bajo el dron y el FOV sólo la escala hasta que la foto encaja) o **por pares** (2–4 rasgos marcados en foto y mapa; la escala GSD sale de las *distancias* entre pares, así que no depende del offset de sincronía ni del yaw; `fov = 2·atan(W·GSD/(2·AGL))`) | la escala global del frame, bordes incluidos |

La diferencia entre ambos es la distorsión de gran angular: **un resultado, no
un fallo**. Se elige cuál está *activo*; cada punto lleva sus proyecciones con el
activo y, en las columnas `alt_*` del CSV, con el otro.

Flujo: sincronizar (Flight) → FOV (Flight) → bloquear la campaña (GCP) → marcar.

## La campaña: dónde vive

Todo lo que se mide va en **una campaña por vuelo** (`campaign.json`): la
configuración (sync, los dos FOV y cómo se obtuvo el visual, aspect, terreno,
deltas, candado) y los frames con sus puntos. Se guarda:

- en el **servidor**, junto al vuelo, en `$PINPOINT_DATA/campaigns/<clave>.json`
  (la clave es un hash de las rutas del `.bin` y del vídeo: sobrevive a
  reinicios y a re-registrar el vuelo);
- en `localStorage` del navegador (caché; un F5 no tira horas de marcado);
- exportable/importable como fichero desde la pestaña *GCP*.

El **candado** bloquea sync, FOV y terreno: mezclar configuraciones a mitad de
campaña ensucia el análisis. Se desbloquea a propósito, no por accidente.

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
- **v0.3.0 (actual)** — campaña unificada (`campaign.json` con configuración +
  puntos) guardada en servidor por vuelo; dos FOV (sfm / visual) con resolución
  por pares; pestaña GCP con error descompuesto (E/N, along/cross), estadísticas
  en vivo, candado, import/export.
- **v0.3.1** — interfaz ES/EN; registro persistente de vuelos (`registry.json`,
  lista de "vuelos conocidos" al cargar); subida por hash del `.bin` (resubir =
  misma carpeta y misma campaña); **candidatos de frame** desde el log (pestaña
  Puntos de control: rectas para E1, virajes para E3); `scripts/analisis_campana.py`
  (figuras E1–E4 desde `campaign.json` y **reproyección** con otro terreno / FOV /
  desfase de sincronía sin volver a marcar).
- **Siguiente** — ray-cast del píxel contra el terreno inclinado; dataset de
  ejemplo citable (DOI).

---

## Análisis fuera de la web

```bash
# figuras E1–E4 + estadísticas (RMSE, mediana, P90, CE90) desde el ZIP exportado
python scripts/analisis_campana.py figuras --campaign campaign.json --out analisis/
# los MISMOS puntos con otro terreno / FOV / desfase de sync (necesita el .bin)
python scripts/analisis_campana.py reproyectar --campaign campaign.json --bin 00000064.BIN \
    --terrain flat ign --fov 72.26 80 --dt -1 -0.5 -0.2 0 0.2 0.5 1 --out analisis/reproj.csv
```

En el servidor (la imagen no lleva matplotlib; `reproyectar` no lo necesita):
`docker run --rm -v /home/luis/docker/pinpoint:/src -v /mnt/data/srv/carto_private:/mnt/data/srv/carto_private:ro -w /src pinpoint-pinpoint python scripts/analisis_campana.py reproyectar …`

## Licencia y créditos

- **Código** (`pinpoint_core/`, `server/`, `web/`): PolyForm Noncommercial 1.0.0
  — libre para cualquier uso **no comercial** (investigación, educación, uso
  personal). Ver [LICENSE](LICENSE).
- **Documentación, figuras y datos**: CC BY-NC 4.0. Ver [LICENSE-docs](LICENSE-docs).
- Desarrollado con la ayuda de **LeftCape**, que puso los medios; los derechos de
  explotación pertenecen a LeftCape. Ver [NOTICE](NOTICE).

Para citar el software, ver [CITATION.cff](CITATION.cff).
