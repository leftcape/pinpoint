// Idiomas de la interfaz: español e inglés. El idioma por defecto es el del
// navegador; el usuario lo cambia con el selector de la cabecera y la elección
// se recuerda en localStorage.
//
// Uso en componentes: `const t = useT()` → `t('gcp.title')`, `t('x', { n: 3 })`.
// Fuera de React (store, export): `t(...)` directamente.

import { create } from 'zustand'

export type Lang = 'es' | 'en'

const es = {
  'lang.es': 'ES',
  'lang.en': 'EN',
  'lang.title': 'Idioma / Language',

  'app.reencoded': '⚠ recodificado',
  'app.readonly': 'solo lectura',
  'gcp.needPassword': 'Modo lectura: introduce la contraseña del proyecto para poder editar.',
  'app.badpass': '⚠ contraseña incorrecta: NO se está guardando',
  'app.saved': 'guardada',
  'app.saving': 'guardando…',
  'app.noServer': '⚠ sin servidor',
  'app.campaignState': 'estado de la campaña de puntos de control',
  'tab.flight': 'Vuelo',
  'tab.location': 'Localización',
  'tab.gcp': 'Puntos de control',

  'proj.changePassword': 'Contraseña de escritura',
  'proj.currentPassword': 'Contraseña actual',
  'proj.newPassword': 'Contraseña nueva',
  'proj.newPasswordPlaceholder': 'déjalo en blanco para quitarla',
  'proj.savePassword': 'Guardar',
  'proj.willProtect': 'Al guardar, hará falta esta contraseña para editar el proyecto.',
  'proj.willOpen': 'Sin contraseña: cualquiera podrá editar el proyecto.',
  'proj.wrongPassword': 'Contraseña incorrecta.',
  'proj.title': 'Proyectos',
  'proj.new': 'Nuevo proyecto',
  'proj.cancel': 'Cancelar',
  'proj.name': 'Nombre del proyecto',
  'proj.namePlaceholder': 'p. ej. Vuelo 2 — río y colina',
  'proj.password': 'Contraseña de escritura (opcional)',
  'proj.passwordPlaceholder': 'en blanco = cualquiera puede editar',
  'proj.passwordHelp': 'El proyecto se lee siempre; la contraseña solo hace falta para guardar cambios. Se guarda cifrada: si la pierdes, no se puede recuperar.',
  'proj.create': 'Crear proyecto',
  'proj.empty': 'Aún no hay proyectos. Crea uno para empezar a marcar puntos.',
  'proj.points': 'puntos',
  'proj.noPoints': 'sin puntos todavía',
  'proj.isProtected': 'Protegido: pide contraseña para guardar',
  'proj.askPassword': 'Este proyecto pide contraseña para guardar. Puedes verlo sin ella.',
  'proj.justRead': 'solo mirar',
  'proj.usePassword': 'Entrar',
  'proj.readOnly': 'Modo lectura: puedes verlo todo, pero los cambios no se guardarán.',
  'proj.enterPassword': 'introducir contraseña',
  'proj.orLoadLoose': 'o cargar un vuelo suelto (sin proyecto)',
  'src.title': 'Cargar vuelo',
  'src.library': 'Carpeta del servidor',
  'src.choose': '— elegir —',
  'src.libMissing': 'No existe la carpeta de vuelos:',
  'src.addFiles': 'Añadir ficheros a la carpeta',
  'src.addVideo': 'Subir un vídeo',
  'src.addLog': 'Subir un log',
  'src.readOnly': 'La carpeta está montada de solo lectura: no se pueden subir ficheros.',
  'src.quota': 'Ocupación',
  'src.quotaFull': 'Cuota agotada: borra algo en el servidor antes de subir.',
  'src.serverPath': 'Ruta en el servidor',
  'src.upload': 'Subir ficheros',
  'src.binPlaceholder': '/ruta/al/log.bin',
  'src.videoPlaceholder': '/ruta/al/video.mkv',
  'src.load': 'Cargar',
  'src.loading': 'Cargando…',
  'src.binLabel': 'Log .bin',
  'src.videoLabel': 'Vídeo (.mkv recomendado)',
  'src.uploadLoad': 'Subir y cargar',
  'src.uploading': 'Subiendo…',
  'src.known': 'Vuelos conocidos en el servidor',
  'src.hasCampaign': 'con campaña',
  'src.open': 'abrir',
  'src.tip':
    'Consejo: usa el .mkv original (conserva creation_time). Un .mp4 recodificado suele perderlo y solo podrás sincronizar por despegue o a mano.',

  'vc.title': 'Control del vídeo',
  'vc.back5': 'Atrás 5 segundos',
  'vc.fwd5': 'Adelante 5 segundos',
  'vc.play': 'Reproducir',
  'vc.pause': 'Pausa',
  'vc.goto': 'Ir al segundo (precisión 0,1 s)',

  'sync.title': 'Sincronía log ↔ vídeo',
  'sync.locked': '🔒 bloqueado por la campaña',
  'sync.takeoff': 'Despegue',
  'sync.takeoffHint': 'Anclar el frame 0 al despegue detectado en el log',
  'sync.creation': 'creation_time',
  'sync.creationHint': 'Usar la hora de creación del vídeo y corregir la zona horaria con el reloj GPS',
  'sync.manual': 'Manual',
  'sync.manualHint': 'Fijar el offset a mano (ajuste fino)',
  'sync.offset': 'Offset (segundo del log en el que arranca el vídeo)',
  'sync.offsetComputed': ' — calculado; pasa a Manual para afinar',
  'sync.projectFrame': 'Proyectar la imagen del frame',
  'sync.showOutline': 'Mostrar el contorno del footprint',
  'sync.projectOblique': 'Proyectar la foto sobre el footprint',
  'sync.horizon': 'Horizonte en el frame: este fotograma no se puede proyectar al suelo.',
  'sync.fineTune': 'Ajuste fino de actitud (deltas) — calibrar contra la ortofoto:',
  'sync.gateTitle': 'No proyectar la imagen si la cámara sale del nadir (nadir = pitch −90°):',
  'sync.maxPitch': 'Desv. máx. pitch (°)',
  'sync.maxRoll': 'Desv. máx. roll (°)',
  'sync.minAlt': 'Altura mínima (m)',
  'sync.gimbal': 'gimbal',
  'sync.noGimbal': 'sin gimbal',
  'sync.nadirOk': '✓ nadir — imagen fiable',
  'sync.offNadir': '⚠ fuera de nadir ({reason}) — imagen oculta',
  'sync.reasonPitch': 'pitch fuera de rango',
  'sync.reasonRoll': 'roll fuera de rango',
  'sync.reasonAgl': 'poca altura',
  'sync.noFootprint': 'Sin footprint: dron a nivel del suelo.',
  'sync.droneAt': 'dron @ tv={tv}s: {lat}, {lng}',
  'sync.altYaw': 'alt {alt} m AGL · yaw {yaw}°',

  'fov.title': 'Campo de visión (FOV)',
  'fov.active': 'activo',
  'fov.lockedNote': '🔒 Campaña bloqueada: el FOV no se cambia. Desbloquéala en la pestaña Puntos de control.',
  'fov.sfm': 'SfM (autocalibración)',
  'fov.focal': 'focal normalizado',
  'fov.visual': 'Visual (contra la ortofoto)',
  'fov.byPairs': 'por pares ({n}) · GSD {gsd} m/px · dispersión {pct} %',
  'fov.byEye': 'a ojo (escala de la huella)',
  'fov.frame': 'frame',
  'fov.terrain': 'terreno',
  'fov.deltaSfm': 'Δ respecto a SfM',
  'fov.delete': 'borrar',
  'fov.notCalibrated': 'Sin calibrar todavía.',
  'fov.eyeBtn': 'Ajustar a ojo',
  'fov.eyeDone': '✓ Terminar ajuste a ojo',
  'fov.pairsBtn': 'Resolver por pares',
  'fov.pairsDone': '✓ Cerrar pares',
  'fov.eyeHelp':
    'Frame nadir. La huella queda clavada bajo el dron y sólo cambia de escala: mueve el FOV hasta que la foto proyectada encaje con la ortofoto. Si el centro cuadra y los bordes no, eso es la distorsión de gran angular (resultado, no fallo).',
  'fov.pairsHelp':
    'Frame nadir, vídeo parado. Marca un rasgo en la FOTO y el mismo en el MAPA; repite con 2–4 rasgos lo más separados posible (esquinas de parcela, cruces). La escala sale de las distancias entre pares: no depende del offset ni del yaw.',
  'fov.step2': '2/2 → click en el MAPA, en ese mismo rasgo.',
  'fov.step1': '1/2 → click en la FOTO, en un rasgo reconocible.',
  'fov.cancel': 'cancelar',
  'fov.solve': 'Resolver FOV ({n} pares)',
  'fov.clear': 'limpiar',
  'fov.result': 'FOV {fov}° · GSD {gsd} m/px · AGL {agl} m ({terrain})',
  'fov.resultDetail': '{n} distancia(s) · dispersión entre pares {pct} %',
  'fov.highSpread': ' ⚠ alta: ¿pares mal marcados o muy al borde?',
  'fov.offNadirScale': ' ⚠ frame fuera de nadir: la escala no es fiable',
  'fov.apply': '✓ Guardar como FOV visual y activarlo',
  'fov.aspect': 'aspect (ancho/alto)',
  'fov.useVideo': 'usar el del vídeo ({v})',
  'fov.offNadirWarn': '⚠ Este frame está fuera de nadir: busca uno más cenital para calibrar.',
  'fov.noFootprint': 'Sin footprint en este frame (dron en el suelo o sin sincronizar).',
  'fov.nadir': 'nadir ✓',
  'fov.offNadirShort': 'fuera de nadir',
  'fov.noteSlider': 'ajuste visual de la escala de la huella sobre la ortofoto',
  'fov.notePairs': 'resuelto con {n} pares ({d} distancias)',
  'fov.notePairsOff': ' — frame FUERA de nadir',

  'terrain.title': 'Modelo del terreno (AGL)',
  'terrain.flat': 'Plano',
  'terrain.ign': 'IGN 5 m',
  'terrain.cop': 'Copernicus 90 m',
  'terrain.flatHelp': 'Cota del despegue (sin corregir el relieve).',
  'terrain.fallback': '⚠ Fuera de cobertura: se está usando "{eff}".',
  'terrain.ignHelp': 'MDT 5 m del IGN (solo España).',
  'terrain.copHelp': 'Copernicus DEM 90 m (mundial, sin login).',

  'gcp.title': 'Puntos de control (paper)',
  'gcp.config': 'Configuración de campaña',
  'gcp.lock': 'bloquear',
  'gcp.unlock': 'desbloquear',
  'gcp.lockHint':
    'Con la campaña bloqueada no se cambia ni sync, ni FOV, ni terreno: mezclar configuraciones ensucia el análisis.',
  'gcp.flight': 'vuelo',
  'gcp.sync': 'sync',
  'gcp.offset': 'offset',
  'gcp.fov': 'FOV',
  'gcp.other': 'otro',
  'gcp.noVisual': 'sin FOV visual (Vuelo)',
  'gcp.terrain': 'terreno',
  'gcp.savedServer': 'guardada en servidor',
  'gcp.saving': 'guardando…',
  'gcp.saveError': '⚠ sin respaldo en servidor (solo local)',
  'gcp.localOnly': 'solo local',
  'gcp.storageFull': '⚠ localStorage lleno: exporta ahora',
  'gcp.beforeMarking': 'Antes de marcar en serio: fija sync y FOV en Vuelo, elige el terreno, y bloquea.',
  'gcp.take': 'Tomar puntos (foto y mapa lado a lado)',
  'gcp.offNadirMark': 'fuera de nadir (se marca igual: sirve para error vs ángulo)',
  'gcp.freeVideo':
    'Vídeo libre: muévete al fotograma que quieras (barra o flechas) y pulsa “Empezar a marcar”. Al terminar un frame, vuelve aquí y salta a otro.',
  'gcp.startMarking': '🎯 Empezar a marcar este frame',
  'gcp.projecting': 'Proyectando…',
  'gcp.step2': '2/2 → ahora haz click en el MAPA, en ese mismo punto.',
  'gcp.step1': '1/2 → haz click en la FOTO, en un punto reconocible.',
  'gcp.cancel': 'cancelar',
  'gcp.stopMarking': '✓ Terminar este frame (mover el vídeo)',
  'gcp.campaign': 'Campaña',
  'gcp.statsHeader': '{f} frames · {p} pts · {n} nadir',
  'gcp.errNadir': 'error (frames nadir)',
  'gcp.attitude': 'actitud',
  'gcp.ortho': 'ortogonal',
  'gcp.attitudeFov': 'actitud · FOV {k}',
  'gcp.n': 'n',
  'gcp.rmse': 'RMSE',
  'gcp.median': 'med',
  'gcp.p90': 'P90',
  'gcp.max': 'máx',
  'gcp.pixelLine':
    'píxel {x} / {y} px del centro ({px} % / {py} % del semiancho/semialto) · radial {r} px · verdad a {d} m del nadir',
  'gcp.errM': 'error (m)',
  'gcp.total': 'total',
  'gcp.axesNote':
    'E/N = ejes del mapa. along/cross = ejes de la imagen (rumbo {yaw}°): + along = hacia delante (un desfase de sync se ve aquí), + cross = a la derecha (FOV/roll/distorsión se ven aquí). Signo: de la proyección hacia la verdad.',
  'gcp.noPoints': 'Sin puntos todavía.',
  'gcp.gotoFrame': 'Ir a este frame',
  'gcp.deleteFrame': 'Borrar el frame entero',
  'gcp.orthoTitle': 'ortogonal: E / N / total',
  'gcp.attTitle': 'actitud: E / N / total',
  'gcp.export': '📦 Exportar ({n} pt)',
  'gcp.generating': 'Generando…',
  'gcp.import': '📂 Importar',
  'gcp.importTitle': 'Importar campaign.json',
  'gcp.mergeConfirm': '¿Fusionar con los puntos actuales? (Cancelar = reemplazar toda la campaña)',
  'gcp.importFail': 'No se pudo importar: {e}',
  'gcp.resetConfirm': '¿Borrar los {n} puntos? Se conserva la configuración. No se puede deshacer.',
  'gcp.resetTitle': 'Borrar todos los puntos',
  'gcp.saveNow': 'guardar en servidor ahora',
  'gcp.exportNote': 'Guardado {f} · {n} frame(s), {p} punto(s)',
  'gcp.generatingShots': 'Generando capturas…',
  'gcp.error': 'Error: {e}',

  'cand.title': 'Candidatos de frame (desde el log)',
  'cand.help':
    'Instantes que merece la pena mirar, elegidos solo con la telemetría. Rectas: |roll| bajo, gimbal a −90°, repartidos por todo el vuelo (E1). Virajes: alabeo creciente por franjas (E3). Tú decides si el frame vale.',
  'cand.straight': 'Rectas',
  'cand.turns': 'Virajes',
  'cand.n': 'nº',
  'cand.maxRoll': 'roll máx °',
  'cand.propose': 'Proponer',
  'cand.none': 'Sin candidatos con estos criterios.',
  'cand.go': 'ir',
  'cand.marked': '✓ marcado',
  'loc.title': 'Localización',
  'loc.swap': 'Intercambiar vídeo / mapa (grande ↔ pequeño)',
  'loc.follow': 'Seguir al dron (mantenerlo centrado)',
  'loc.mark': 'Marcar un punto en la foto',
  'loc.markHelp':
    'Haz click en el vídeo para proyectar ese píxel al suelo. Consejo: activa “Intercambiar vídeo / mapa” para clicar en el vídeo grande.',
  'loc.pxCenter': 'px del centro',
  'loc.clear': 'borrar',
  'loc.measure': 'Medir distancia',
  'loc.measureHelp': 'Haz click en el mapa para añadir puntos. La distancia acumulada se muestra abajo.',
  'loc.decompose': 'Descomponer el último tramo (X/Y en el mapa)',
  'loc.pts': 'pt(s)',

  'vp.markTitle': 'Click para marcar un punto en el suelo',
  'vp.pairTitle': 'Click en el rasgo en la foto y luego en el mapa',

  'map.demTitle': 'Mostrar/ocultar el modelo del terreno (MDT) coloreado',
  'map.dem': '⛰ MDT',
  'map.baseTitle': 'Alternar entre ortofoto (PNOA) y callejero (OSM)',
  'map.satellite': '🛰 Satélite (PNOA)',
  'map.osm': '🗺 Callejero (OSM)',
  'map.terrainZ': 'terreno',

  'err.noVideoInfo': 'Sin información del vídeo: no se puede tomar el punto.',
  'err.videoMoved': 'El vídeo se movió ({a}s → {b}s): punto descartado. Vuelve a marcarlo.',
  'sync.opacity': 'Transparencia',
  'sync.opacityTitle': 'Opacidad de la foto sobre el mapa: bájala para ver la ortofoto de debajo.',
  'err.noFootprintForMapPick': 'Sin huella proyectada: activa «proyectar la foto» para marcar sobre el plano.',
  'err.outsidePhoto': 'Ese punto del plano cae fuera de la foto: márcalo dentro de la huella.',
  'err.pairsSameFrame': 'Los pares de FOV deben estar en el mismo fotograma. Borra los pares o vuelve a ese frame.',
  'err.fovSolve': 'No se pudo resolver el FOV: pares demasiado juntos o sin AGL.',
  'imp.notCampaign': 'El fichero no es una campaña de PinPoint.',
  'imp.otherFlight': ' ⚠ La campaña importada es de OTRO vuelo (clave distinta).',
  'imp.summary': 'Importado: {f} frame(s), {p} punto(s).',
  'exp.noPoints': 'No hay puntos que exportar.',
  'exp.noMap': 'El mapa no está listo.',

  'readme': `PinPoint — campaña de puntos de control
{frames} frame(s), {points} punto(s). Exportado: {date}

QUÉ ES ESTO
  Cada punto de control es un rasgo del terreno identificado DOS veces: un click
  en la foto aérea (píxel) y un click en el mapa (verdad-terreno). El píxel se
  proyecta al suelo por dos vías y se mide cuánto se aleja cada una de la
  verdad-terreno. Ese es el error.

  El píxel queda atado al instante exacto en que se clicó (el vídeo se pausa) y
  toda la telemetría se pide para ESE instante.

    ortho     proyección ortogonal: pinhole nadir puro, sin actitud del dron.  AZUL
    attitude  proyección con la actitud completa del dron.                    ROJO
    truth     el punto real marcado a mano en el mapa.                        VERDE

FICHEROS
  points.csv        una fila por punto, todos los frames juntos -> tabla de análisis
  campaign.json     lo mismo, anidado y sin pérdida, MÁS la configuración (config:
                    sync, los dos FOV y cómo se obtuvo el visual, terreno, deltas)
  frames/<id>/photo.jpg        fotograma crudo
  frames/<id>/photo_points.jpg el mismo, con los puntos señalados y el centro
  frames/<id>/map_ortho.png    mapa: verdad-terreno vs proyección ortogonal
  frames/<id>/map_attitude.png mapa: verdad-terreno vs proyección con actitud

COLUMNAS DEL CSV (las que importan)
  off_x_px, off_y_px, off_norm_px   distancia del punto al CENTRO de la imagen (variable
  off_x_pct, off_y_pct              independiente); en % del semiancho/semialto.
  err_ortho_m, err_att_m            distancia proyección -> verdad-terreno (variable dependiente).
  err_*_x_m, err_*_y_m              el mismo error descompuesto E-O / N-S.
  err_*_along_m, err_*_cross_m      el mismo error en EJES DE LA IMAGEN (rumbo yaw_deg):
                                    along = a lo largo de la traza (+ hacia delante; aquí
                                    se ve un desfase de sincronía), cross = transversal
                                    (+ a la derecha; aquí se ven FOV, roll y distorsión).
  fov_kind, fov_h_deg               FOV ACTIVO con el que se proyectó: 'sfm' (autocalibración
                                    OpenSfM) o 'visual' (el nuestro contra la ortofoto).
  alt_fov_kind, alt_fov_h_deg,      las MISMAS proyecciones con el OTRO FOV, para comparar
  alt_ortho_*, alt_att_*, alt_err_* sfm vs visual sin reproyectar (vacío si sólo había uno).
  truth_dist_m                      distancia verdad-terreno -> nadir del dron.
  agl_m, pitch_deg, roll_deg,       condiciones de vuelo: acotan el dominio de validez.
  drone_pitch_deg, yaw_deg
  aspect, d_pitch, d_roll           resto de la calibración (aspect deriva el FOV vertical).
  map_zoom                          zoom al clicar: precisión del propio ground-truth.
  nadir_ok, reason                  si el frame estaba fuera del gate cenital.
  frame_index                       identidad del fotograma = round(tv·fps). Agrupa por aquí.

CONVENIOS
  X = Este-Oeste, Y = Norte-Sur, metros. Ángulos en grados.
  pitch = gimbal (marco terrestre, -90 = nadir); roll = del dron (la cámara no
  lo compensa); drone_pitch = cabeceo del cuerpo.
`,
} as const

export type Key = keyof typeof es

const en: Record<Key, string> = {
  'lang.es': 'ES',
  'lang.en': 'EN',
  'lang.title': 'Idioma / Language',

  'app.reencoded': '⚠ re-encoded',
  'app.readonly': 'read-only',
  'gcp.needPassword': 'Read-only: enter the project password to edit.',
  'app.badpass': '⚠ wrong password: NOT saving',
  'app.saved': 'saved',
  'app.saving': 'saving…',
  'app.noServer': '⚠ no server',
  'app.campaignState': 'control-point campaign status',
  'tab.flight': 'Flight',
  'tab.location': 'Location',
  'tab.gcp': 'Control points',

  'proj.changePassword': 'Write password',
  'proj.currentPassword': 'Current password',
  'proj.newPassword': 'New password',
  'proj.newPasswordPlaceholder': 'leave empty to remove it',
  'proj.savePassword': 'Save',
  'proj.willProtect': 'After saving, this password will be required to edit the project.',
  'proj.willOpen': 'No password: anyone will be able to edit the project.',
  'proj.wrongPassword': 'Wrong password.',
  'proj.title': 'Projects',
  'proj.new': 'New project',
  'proj.cancel': 'Cancel',
  'proj.name': 'Project name',
  'proj.namePlaceholder': 'e.g. Flight 2 — river and hill',
  'proj.password': 'Write password (optional)',
  'proj.passwordPlaceholder': 'empty = anyone can edit',
  'proj.passwordHelp': 'The project is always readable; the password is only needed to save changes. It is stored hashed: if you lose it, it cannot be recovered.',
  'proj.create': 'Create project',
  'proj.empty': 'No projects yet. Create one to start marking points.',
  'proj.points': 'points',
  'proj.noPoints': 'no points yet',
  'proj.isProtected': 'Protected: asks for a password to save',
  'proj.askPassword': 'This project needs a password to save. You can view it without one.',
  'proj.justRead': 'just look',
  'proj.usePassword': 'Enter',
  'proj.readOnly': 'Read-only: you can see everything, but changes will not be saved.',
  'proj.enterPassword': 'enter password',
  'proj.orLoadLoose': 'or load a loose flight (no project)',
  'src.title': 'Load flight',
  'src.library': 'Server folder',
  'src.choose': '— choose —',
  'src.libMissing': 'Flight folder not found:',
  'src.addFiles': 'Add files to the folder',
  'src.addVideo': 'Upload a video',
  'src.addLog': 'Upload a log',
  'src.readOnly': 'The folder is mounted read-only: uploads are disabled.',
  'src.quota': 'Usage',
  'src.quotaFull': 'Quota full: delete something on the server before uploading.',
  'src.serverPath': 'Server path',
  'src.upload': 'Upload files',
  'src.binPlaceholder': '/path/to/log.bin',
  'src.videoPlaceholder': '/path/to/video.mkv',
  'src.load': 'Load',
  'src.loading': 'Loading…',
  'src.binLabel': 'Log .bin',
  'src.videoLabel': 'Video (.mkv recommended)',
  'src.uploadLoad': 'Upload and load',
  'src.uploading': 'Uploading…',
  'src.known': 'Known flights on the server',
  'src.hasCampaign': 'has campaign',
  'src.open': 'open',
  'src.tip':
    'Tip: use the original .mkv (it keeps creation_time). A re-encoded .mp4 usually loses it and you can only sync by takeoff or manually.',

  'vc.title': 'Video control',
  'vc.back5': 'Back 5 seconds',
  'vc.fwd5': 'Forward 5 seconds',
  'vc.play': 'Play',
  'vc.pause': 'Pause',
  'vc.goto': 'Go to second (0.1 s precision)',

  'sync.title': 'Log ↔ video sync',
  'sync.locked': '🔒 locked by the campaign',
  'sync.takeoff': 'Takeoff',
  'sync.takeoffHint': 'Anchor frame 0 to the takeoff detected in the log',
  'sync.creation': 'creation_time',
  'sync.creationHint': "Use the video's creation time and correct the timezone against the GPS clock",
  'sync.manual': 'Manual',
  'sync.manualHint': 'Set the offset yourself (fine tuning)',
  'sync.offset': 'Offset (seconds into the log where the video starts)',
  'sync.offsetComputed': ' — computed; switch to Manual to fine-tune',
  'sync.projectFrame': 'Project the frame image',
  'sync.showOutline': 'Show the footprint outline',
  'sync.projectOblique': 'Project the photo onto the footprint',
  'sync.horizon': 'Horizon in frame — this frame cannot be projected onto the ground.',
  'sync.fineTune': 'Attitude fine tuning (deltas) — calibrate against the orthophoto:',
  'sync.gateTitle': "Don't project the image if the camera leaves nadir (nadir = pitch −90°):",
  'sync.maxPitch': 'Max pitch dev (°)',
  'sync.maxRoll': 'Max roll dev (°)',
  'sync.minAlt': 'Min altitude (m)',
  'sync.gimbal': 'gimbal',
  'sync.noGimbal': 'no gimbal',
  'sync.nadirOk': '✓ nadir — image reliable',
  'sync.offNadir': '⚠ off-nadir ({reason}) — image hidden',
  'sync.reasonPitch': 'pitch out of range',
  'sync.reasonRoll': 'roll out of range',
  'sync.reasonAgl': 'low altitude',
  'sync.noFootprint': 'No footprint: drone at ground level.',
  'sync.droneAt': 'drone @ tv={tv}s: {lat}, {lng}',
  'sync.altYaw': 'alt {alt} m AGL · yaw {yaw}°',

  'fov.title': 'Field of view (FOV)',
  'fov.active': 'active',
  'fov.lockedNote': '🔒 Campaign locked: the FOV cannot change. Unlock it in the Control points tab.',
  'fov.sfm': 'SfM (self-calibration)',
  'fov.focal': 'normalized focal',
  'fov.visual': 'Visual (against the orthophoto)',
  'fov.byPairs': 'from pairs ({n}) · GSD {gsd} m/px · spread {pct} %',
  'fov.byEye': 'by eye (footprint scale)',
  'fov.frame': 'frame',
  'fov.terrain': 'terrain',
  'fov.deltaSfm': 'Δ vs SfM',
  'fov.delete': 'delete',
  'fov.notCalibrated': 'Not calibrated yet.',
  'fov.eyeBtn': 'Adjust by eye',
  'fov.eyeDone': '✓ Finish eye adjustment',
  'fov.pairsBtn': 'Solve from pairs',
  'fov.pairsDone': '✓ Close pairs',
  'fov.eyeHelp':
    'Nadir frame. The footprint stays pinned under the drone and only changes scale: move the FOV until the projected photo fits the orthophoto. If the centre fits and the edges do not, that is wide-angle distortion (a result, not a fault).',
  'fov.pairsHelp':
    'Nadir frame, video paused. Mark a feature on the PHOTO and the same one on the MAP; repeat with 2–4 features as far apart as possible (field corners, crossings). The scale comes from the distances between pairs: it does not depend on the offset or the yaw.',
  'fov.step2': '2/2 → click on the MAP, on that same feature.',
  'fov.step1': '1/2 → click on the PHOTO, on a recognisable feature.',
  'fov.cancel': 'cancel',
  'fov.solve': 'Solve FOV ({n} pairs)',
  'fov.clear': 'clear',
  'fov.result': 'FOV {fov}° · GSD {gsd} m/px · AGL {agl} m ({terrain})',
  'fov.resultDetail': '{n} distance(s) · spread between pairs {pct} %',
  'fov.highSpread': ' ⚠ high: badly marked pairs or too close to the edge?',
  'fov.offNadirScale': ' ⚠ frame off-nadir: the scale is not reliable',
  'fov.apply': '✓ Save as visual FOV and activate it',
  'fov.aspect': 'aspect (width/height)',
  'fov.useVideo': "use the video's ({v})",
  'fov.offNadirWarn': '⚠ This frame is off-nadir: find a more vertical one to calibrate.',
  'fov.noFootprint': 'No footprint in this frame (drone on the ground or not synced).',
  'fov.nadir': 'nadir ✓',
  'fov.offNadirShort': 'off-nadir',
  'fov.noteSlider': 'visual adjustment of the footprint scale over the orthophoto',
  'fov.notePairs': 'solved from {n} pairs ({d} distances)',
  'fov.notePairsOff': ' — frame OFF nadir',

  'terrain.title': 'Terrain model (AGL)',
  'terrain.flat': 'Flat',
  'terrain.ign': 'IGN 5 m',
  'terrain.cop': 'Copernicus 90 m',
  'terrain.flatHelp': 'Takeoff elevation (relief not corrected).',
  'terrain.fallback': '⚠ Out of coverage: using "{eff}".',
  'terrain.ignHelp': 'IGN 5 m DTM (Spain only).',
  'terrain.copHelp': 'Copernicus DEM 90 m (worldwide, no login).',

  'gcp.title': 'Control points (paper)',
  'gcp.config': 'Campaign configuration',
  'gcp.lock': 'lock',
  'gcp.unlock': 'unlock',
  'gcp.lockHint':
    'With the campaign locked, sync, FOV and terrain cannot change: mixing configurations spoils the analysis.',
  'gcp.flight': 'flight',
  'gcp.sync': 'sync',
  'gcp.offset': 'offset',
  'gcp.fov': 'FOV',
  'gcp.other': 'other',
  'gcp.noVisual': 'no visual FOV (Flight)',
  'gcp.terrain': 'terrain',
  'gcp.savedServer': 'saved on server',
  'gcp.saving': 'saving…',
  'gcp.saveError': '⚠ no server backup (local only)',
  'gcp.localOnly': 'local only',
  'gcp.storageFull': '⚠ localStorage full: export now',
  'gcp.beforeMarking': 'Before marking for real: set sync and FOV in Flight, choose the terrain, and lock.',
  'gcp.take': 'Take points (photo and map side by side)',
  'gcp.offNadirMark': 'off-nadir (mark anyway: useful for error vs angle)',
  'gcp.freeVideo':
    'Video is free: move to any frame (scrubber or arrows) and press “Start marking”. When a frame is done, come back here and jump to another.',
  'gcp.startMarking': '🎯 Start marking this frame',
  'gcp.projecting': 'Projecting…',
  'gcp.step2': '2/2 → now click on the MAP, on that same point.',
  'gcp.step1': '1/2 → click on the PHOTO, on a recognisable point.',
  'gcp.cancel': 'cancel',
  'gcp.stopMarking': '✓ Finish this frame (move the video)',
  'gcp.campaign': 'Campaign',
  'gcp.statsHeader': '{f} frames · {p} pts · {n} nadir',
  'gcp.errNadir': 'error (nadir frames)',
  'gcp.attitude': 'attitude',
  'gcp.ortho': 'orthogonal',
  'gcp.attitudeFov': 'attitude · FOV {k}',
  'gcp.n': 'n',
  'gcp.rmse': 'RMSE',
  'gcp.median': 'med',
  'gcp.p90': 'P90',
  'gcp.max': 'max',
  'gcp.pixelLine':
    'pixel {x} / {y} px from centre ({px} % / {py} % of half-width/half-height) · radial {r} px · truth {d} m from nadir',
  'gcp.errM': 'error (m)',
  'gcp.total': 'total',
  'gcp.axesNote':
    'E/N = map axes. along/cross = image axes (heading {yaw}°): + along = forward (a sync offset shows here), + cross = to the right (FOV/roll/distortion show here). Sign: from projection towards truth.',
  'gcp.noPoints': 'No points yet.',
  'gcp.gotoFrame': 'Go to this frame',
  'gcp.deleteFrame': 'Delete the whole frame',
  'gcp.orthoTitle': 'orthogonal: E / N / total',
  'gcp.attTitle': 'attitude: E / N / total',
  'gcp.export': '📦 Export ({n} pt)',
  'gcp.generating': 'Generating…',
  'gcp.import': '📂 Import',
  'gcp.importTitle': 'Import campaign.json',
  'gcp.mergeConfirm': 'Merge with the current points? (Cancel = replace the whole campaign)',
  'gcp.importFail': 'Could not import: {e}',
  'gcp.resetConfirm': 'Delete the {n} points? The configuration is kept. This cannot be undone.',
  'gcp.resetTitle': 'Delete all points',
  'gcp.saveNow': 'save to server now',
  'gcp.exportNote': 'Saved {f} · {n} frame(s), {p} point(s)',
  'gcp.generatingShots': 'Generating captures…',
  'gcp.error': 'Error: {e}',

  'cand.title': 'Frame candidates (from the log)',
  'cand.help':
    'Instants worth looking at, chosen from telemetry only. Straight: low |roll|, gimbal at −90°, spread over the whole flight (E1). Turns: increasing bank by bands (E3). You decide whether the frame is usable.',
  'cand.straight': 'Straight',
  'cand.turns': 'Turns',
  'cand.n': 'n',
  'cand.maxRoll': 'max roll °',
  'cand.propose': 'Propose',
  'cand.none': 'No candidates with these criteria.',
  'cand.go': 'go',
  'cand.marked': '✓ marked',
  'loc.title': 'Location',
  'loc.swap': 'Swap video / map (big ↔ small)',
  'loc.follow': 'Follow the drone (keep it centred)',
  'loc.mark': 'Mark a point on the photo',
  'loc.markHelp':
    'Click on the video to project that pixel to the ground. Tip: enable “Swap video / map” to click on the big video.',
  'loc.pxCenter': 'px from centre',
  'loc.clear': 'clear',
  'loc.measure': 'Measure distance',
  'loc.measureHelp': 'Click on the map to add points. The running distance is shown below.',
  'loc.decompose': 'Decompose last leg (X/Y on map)',
  'loc.pts': 'pt(s)',

  'vp.markTitle': 'Click to mark a point on the ground',
  'vp.pairTitle': 'Click the feature on the photo, then on the map',

  'map.demTitle': 'Show/hide the coloured terrain model (DTM)',
  'map.dem': '⛰ DTM',
  'map.baseTitle': 'Toggle between orthophoto (PNOA) and street map (OSM)',
  'map.satellite': '🛰 Satellite (PNOA)',
  'map.osm': '🗺 Street map (OSM)',
  'map.terrainZ': 'terrain',

  'err.noVideoInfo': 'No video information: the point cannot be taken.',
  'err.videoMoved': 'The video moved ({a}s → {b}s): point discarded. Mark it again.',
  'sync.opacity': 'Opacity',
  'sync.opacityTitle': 'Opacity of the photo over the map: lower it to see the orthophoto underneath.',
  'err.noFootprintForMapPick': 'No projected footprint: turn on “project the photo” to mark on the map.',
  'err.outsidePhoto': 'That map point falls outside the photo: mark it inside the footprint.',
  'err.pairsSameFrame': 'FOV pairs must be in the same frame. Clear the pairs or go back to that frame.',
  'err.fovSolve': 'Could not solve the FOV: pairs too close together or no AGL.',
  'imp.notCampaign': 'The file is not a PinPoint campaign.',
  'imp.otherFlight': ' ⚠ The imported campaign belongs to ANOTHER flight (different key).',
  'imp.summary': 'Imported: {f} frame(s), {p} point(s).',
  'exp.noPoints': 'There are no points to export.',
  'exp.noMap': 'The map is not ready.',

  'readme': `PinPoint — control-point campaign
{frames} frame(s), {points} point(s). Exported: {date}

WHAT THIS IS
  Each control point is a ground feature identified TWICE: a click on the aerial
  photo (pixel) and a click on the map (ground truth). The pixel is projected to
  the ground in two ways and the distance of each to the ground truth is
  measured. That is the error.

  The pixel is tied to the exact instant it was clicked (the video is paused) and
  all telemetry is requested for THAT instant.

    ortho     orthogonal projection: pure nadir pinhole, no drone attitude.  BLUE
    attitude  projection with the full drone attitude.                      RED
    truth     the real point marked by hand on the map.                     GREEN

FILES
  points.csv        one row per point, all frames together -> analysis table
  campaign.json     the same, nested and lossless, PLUS the configuration (config:
                    sync, both FOVs and how the visual one was obtained, terrain, deltas)
  frames/<id>/photo.jpg        raw frame
  frames/<id>/photo_points.jpg the same, with points marked and the centre
  frames/<id>/map_ortho.png    map: ground truth vs orthogonal projection
  frames/<id>/map_attitude.png map: ground truth vs attitude projection

CSV COLUMNS (the ones that matter)
  off_x_px, off_y_px, off_norm_px   distance of the point to the image CENTRE (independent
  off_x_pct, off_y_pct              variable); as % of half-width/half-height.
  err_ortho_m, err_att_m            projection -> ground-truth distance (dependent variable).
  err_*_x_m, err_*_y_m              the same error decomposed E-W / N-S.
  err_*_along_m, err_*_cross_m      the same error in IMAGE AXES (heading yaw_deg):
                                    along = along the track (+ forward; a sync offset shows
                                    here), cross = across (+ right; FOV, roll and
                                    distortion show here).
  fov_kind, fov_h_deg               ACTIVE FOV used for the projection: 'sfm' (OpenSfM
                                    self-calibration) or 'visual' (ours, against the orthophoto).
  alt_fov_kind, alt_fov_h_deg,      the SAME projections with the OTHER FOV, to compare
  alt_ortho_*, alt_att_*, alt_err_* sfm vs visual without reprojecting (empty if only one).
  truth_dist_m                      ground truth -> drone nadir distance.
  agl_m, pitch_deg, roll_deg,       flight conditions: bound the validity domain.
  drone_pitch_deg, yaw_deg
  aspect, d_pitch, d_roll           rest of the calibration (aspect derives the vertical FOV).
  map_zoom                          zoom when clicking: precision of the ground truth itself.
  nadir_ok, reason                  whether the frame was outside the nadir gate.
  frame_index                       frame identity = round(tv·fps). Group by this.

CONVENTIONS
  X = East-West, Y = North-South, metres. Angles in degrees.
  pitch = gimbal (earth frame, -90 = nadir); roll = drone's (the camera does not
  compensate it); drone_pitch = body pitch.
`,
}

const DICT: Record<Lang, Record<Key, string>> = { es, en }

const KEY = 'pinpoint.lang'

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'es' || saved === 'en') return saved
  } catch {
    /* sin localStorage */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'es') || 'es'
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en'
}

interface LangState {
  lang: Lang
  setLang: (l: Lang) => void
}

export const useLang = create<LangState>((set) => ({
  lang: detect(),
  setLang(l) {
    try {
      localStorage.setItem(KEY, l)
    } catch {
      /* nada */
    }
    document.documentElement.lang = l
    set({ lang: l })
  },
}))

document.documentElement.lang = useLang.getState().lang

export type Vars = Record<string, string | number>

function fill(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

// Traducción fuera de React (store, exportación): lee el idioma actual.
export function t(key: Key, vars?: Vars): string {
  return fill(DICT[useLang.getState().lang][key] ?? key, vars)
}

// Hook: se re-renderiza al cambiar de idioma.
export function useT(): (key: Key, vars?: Vars) => string {
  const lang = useLang((s) => s.lang)
  return (key, vars) => fill(DICT[lang][key] ?? key, vars)
}
