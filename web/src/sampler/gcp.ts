// Puntos de control (GCP) para validar la georreferenciación — instrumento de
// medida del paper.
//
// MODELO: una CAMPAÑA agrupa varios FRAMES; cada frame tiene N puntos. Un punto
// = un click en la foto (píxel) + un click en el mapa (verdad-terreno), más las
// dos proyecciones calculadas por el backend para ese píxel:
//   - ortho    : pinhole nadir puro, sin actitud (línea base)
//   - attitude : con la actitud completa del dron (el método a validar)
// El ERROR de cada proyección = su distancia a la verdad-terreno. Es la variable
// dependiente del estudio.
//
// La campaña se persiste en localStorage según se va tomando: una sesión de
// muestreo son horas de trabajo y un F5 no puede tirarla.

export interface LngLat {
  lng: number
  lat: number
}

// Descomposición E-O (x) / N-S (y) + distancia directa, en metros.
export interface Decomp {
  x: number
  y: number
  direct: number
}

// Telemetría del frame en el instante tv. Todo lo que gobierna la proyección:
// sin esto no se puede acotar el dominio de validez del método.
export interface FrameTelemetry {
  tv: number
  frame_index: number // identidad del fotograma: round(tv·fps). Ver frameIndex().
  imgW: number
  imgH: number
  drone: LngLat
  alt_msl: number
  agl: number
  // ángulos (grados). pitch = gimbal (marco terrestre); roll = dron (la cámara
  // no lo compensa); drone_pitch = cabeceo del cuerpo (entra en la geometría).
  pitch: number
  roll: number
  yaw: number
  drone_pitch: number
  flight_direction_deg: number
  has_gimbal: boolean
  nadir_ok: boolean
  reason: string
  // parámetros con los que se calculó la proyección: sin esto los datos no son
  // reproducibles si mañana se recalibra.
  fov_scale: number
  d_pitch: number
  d_roll: number
  sync_method: string
  sync_offset: number
  terrain_source: string // modelo del terreno usado para el AGL: flat | ign | cop
}

export interface GcpPoint {
  id: string // A, B, C… dentro del frame
  // click en la FOTO, en píxeles de la imagen nativa (origen arriba-izquierda)
  px: number
  py: number
  // offset desde el centro de la imagen (px). Propiedad del punto, no de cada
  // proyección: es la variable independiente del estudio.
  offset_px: { x: number; y: number; norm: number }
  // click en el MAPA: verdad-terreno
  truth: LngLat
  // zoom del mapa al clicar — acota la incertidumbre del propio instrumento
  map_zoom: number
  // proyecciones del píxel (null si el backend no pudo)
  ortho: LngLat | null
  attitude: LngLat | null
  // errores = proyección vs verdad-terreno
  err_ortho: Decomp | null
  err_attitude: Decomp | null
  // posición de cada punto respecto al nadir (contexto geométrico)
  truth_from_nadir: Decomp
}

export interface GcpFrame {
  frame_id: string // f1, f2…
  telemetry: FrameTelemetry
  points: GcpPoint[]
}

export interface GcpCampaign {
  started_at: string
  source_id: string | null
  frames: GcpFrame[]
}

// ---------- identidad del fotograma ----------

// Un frame se identifica por su ÍNDICE, no por su marca de tiempo: a 30 fps un
// fotograma dura 33 ms, y `currentTime` da valores distintos dentro del mismo
// fotograma. Comparar timestamps partiría en dos frames lo que es una sola
// imagen. Redondear a fps lo cuantiza a la rejilla real del vídeo.
export function frameIndex(tv: number, fps: number): number {
  return Math.round(tv * (fps > 0 ? fps : 30))
}

// ---------- geometría ----------

const R_EARTH = 6371000

export function haversine(lo1: number, la1: number, lo2: number, la2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(la2 - la1)
  const dLng = toRad(lo2 - lo1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(a))
}

// Descomposición E-O (x) / N-S (y) en metros de `from` a `to`.
export function decompose(from: LngLat, to: LngLat): Decomp {
  const x = haversine(from.lng, from.lat, to.lng, from.lat) * (to.lng >= from.lng ? 1 : -1)
  const y = haversine(from.lng, from.lat, from.lng, to.lat) * (to.lat >= from.lat ? 1 : -1)
  return { x, y, direct: haversine(from.lng, from.lat, to.lng, to.lat) }
}

// ---------- persistencia ----------

const KEY = 'pinpoint.gcp.campaign'

export function loadCampaign(): GcpCampaign | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as GcpCampaign) : null
  } catch {
    return null
  }
}

// false = no se pudo respaldar (cuota llena). Hay que AVISAR: la campaña sigue
// en memoria, pero un F5 se la lleva por delante y son horas de trabajo.
export function saveCampaign(c: GcpCampaign): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
    return true
  } catch {
    return false
  }
}

export function clearCampaign(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nada que hacer */
  }
}

// ---------- etiquetas ----------

// A, B, … Z, AA, AB… — identificador del punto dentro de su frame.
export function pointLabel(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

// ---------- CSV de campaña ----------

const CSV_COLUMNS = [
  'frame_id', 'point_id', 'tv_s', 'frame_index',
  'img_w', 'img_h', 'off_x_px', 'off_y_px', 'off_norm_px',
  'drone_lat', 'drone_lng', 'alt_msl_m', 'agl_m',
  'pitch_deg', 'roll_deg', 'yaw_deg', 'drone_pitch_deg', 'flight_dir_deg',
  'truth_lat', 'truth_lng', 'truth_dx_m', 'truth_dy_m', 'truth_dist_m',
  'ortho_lat', 'ortho_lng', 'err_ortho_x_m', 'err_ortho_y_m', 'err_ortho_m',
  'att_lat', 'att_lng', 'err_att_x_m', 'err_att_y_m', 'err_att_m',
  'fov_scale', 'd_pitch', 'd_roll', 'map_zoom',
  'has_gimbal', 'nadir_ok', 'reason', 'sync_method', 'sync_offset_s', 'terrain_source',
]

const n = (v: number | undefined | null, d = 6): string =>
  v === undefined || v === null || Number.isNaN(v) ? '' : v.toFixed(d)

// entrecomilla si el texto lleva coma/comilla/salto: una coma suelta desplazaría
// todas las columnas siguientes.
const q = (s: string): string =>
  /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s

// Una fila por punto, todos los frames juntos: es la tabla que se abre
// directamente para sacar el scatter error-vs-distancia-al-centro del paper.
export function campaignToCsv(c: GcpCampaign): string {
  const rows: string[] = [CSV_COLUMNS.join(',')]
  for (const f of c.frames) {
    const t = f.telemetry
    for (const p of f.points) {
      rows.push([
        q(f.frame_id), q(p.id), n(t.tv, 3), t.frame_index,
        t.imgW, t.imgH, n(p.offset_px.x, 2), n(p.offset_px.y, 2), n(p.offset_px.norm, 2),
        n(t.drone.lat, 8), n(t.drone.lng, 8), n(t.alt_msl, 2), n(t.agl, 2),
        n(t.pitch, 3), n(t.roll, 3), n(t.yaw, 3), n(t.drone_pitch, 3), n(t.flight_direction_deg, 3),
        n(p.truth.lat, 8), n(p.truth.lng, 8),
        n(p.truth_from_nadir.x, 3), n(p.truth_from_nadir.y, 3), n(p.truth_from_nadir.direct, 3),
        n(p.ortho?.lat, 8), n(p.ortho?.lng, 8),
        n(p.err_ortho?.x, 3), n(p.err_ortho?.y, 3), n(p.err_ortho?.direct, 3),
        n(p.attitude?.lat, 8), n(p.attitude?.lng, 8),
        n(p.err_attitude?.x, 3), n(p.err_attitude?.y, 3), n(p.err_attitude?.direct, 3),
        n(t.fov_scale, 4), n(t.d_pitch, 3), n(t.d_roll, 3), n(p.map_zoom, 2),
        t.has_gimbal ? '1' : '0', t.nadir_ok ? '1' : '0', q(t.reason), q(t.sync_method), n(t.sync_offset, 3), q(t.terrain_source || 'flat'),
      ].join(','))
    }
  }
  return rows.join('\n') + '\n'
}

// ---------- estimación de fov_scale ----------

export interface FovEstimate {
  scale: number
  rmse_before: number
  rmse_after: number
  n_points: number
}

// La FOV es un factor de ESCALA: mueve cada punto radialmente desde el nadir en
// proporción a su distancia. El roll, en cambio, mete un sesgo direccional. Con
// puntos a distintas distancias del centro ambos se separan.
//
// Estimador: el `s` que minimiza Σ|s·proj − truth|² sobre los vectores desde el
// nadir es la proyección escalar Σ(p·t)/Σ(p·p). Ojo: es una aproximación de
// primer orden — el fov_scale real actúa en espacio tangente (fov' =
// 2·atan(s·tan(fov/2))), no sobre la distancia en suelo. Cerca del centro
// coinciden; en los bordes, no. Sirve como PUNTO DE PARTIDA para el slider, no
// como calibración definitiva: para eso hay que barrer contra el backend.
export function estimateFovScale(
  frames: GcpFrame[],
  which: 'ortho' | 'attitude' = 'ortho',
): FovEstimate | null {
  let num = 0
  let den = 0
  let count = 0
  const pairs: { p: Decomp; t: Decomp }[] = []

  for (const f of frames) {
    const nadir = f.telemetry.drone
    for (const pt of f.points) {
      const proj = which === 'ortho' ? pt.ortho : pt.attitude
      if (!proj) continue
      const p = decompose(nadir, proj)
      const t = pt.truth_from_nadir
      if (p.direct < 1e-6) continue
      num += p.x * t.x + p.y * t.y
      den += p.x * p.x + p.y * p.y
      pairs.push({ p, t })
      count++
    }
  }
  if (count < 2 || den < 1e-9) return null

  const scale = num / den
  const rmse = (s: number) =>
    Math.sqrt(
      pairs.reduce((acc, { p, t }) => acc + (s * p.x - t.x) ** 2 + (s * p.y - t.y) ** 2, 0) /
        pairs.length,
    )
  return { scale, rmse_before: rmse(1), rmse_after: rmse(scale), n_points: count }
}
