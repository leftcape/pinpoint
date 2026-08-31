// Campaña de puntos de control (GCP) — el instrumento de medida del paper.
//
// MODELO (v2): una CAMPAÑA por vuelo = CONFIGURACIÓN + FRAMES.
//   - config : con qué se mide. Sincronía (método+offset), FOV (los DOS valores:
//              el de autocalibración SfM y el visual nuestro, y cuál está activo),
//              aspect, terreno, deltas de actitud, y el candado. Sin esto los
//              puntos no son reproducibles ni comparables entre sesiones.
//   - frames : cada frame tiene N puntos. Un punto = un click en la foto (píxel)
//              + un click en el mapa (verdad-terreno), más las proyecciones que
//              calcula el backend para ese píxel:
//                 ortho    : pinhole nadir puro, sin actitud (línea base)
//                 attitude : con la actitud completa del dron (el método)
//              y, si hay dos FOV definidos, las MISMAS dos proyecciones con el
//              otro FOV (`alt`), para poder comparar sfm/visual sin reproyectar.
//   El ERROR de cada proyección = su distancia a la verdad-terreno.
//
// La campaña se persiste en localStorage según se toma (un F5 no puede tirar
// horas de trabajo) y en el servidor, junto al vuelo, por su clave estable.

import type { SyncMethod, TerrainSource } from '../api'

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

// ---------- configuración de la campaña ----------

export type FovKind = 'sfm' | 'visual'

// Un par foto↔mapa usado para RESOLVER el FOV visual (distancias entre pares).
export interface FovPair {
  id: string
  px: number
  py: number
  lng: number
  lat: number
}

export interface FovSfm {
  fov_h_deg: number
  focal_norm: number | null // focal normalizado de OpenSfM (fracción de max(W,H))
  source: string // de dónde sale (p.ej. "OpenSfM, autocalibración del vuelo de referencia")
}

export interface FovVisual {
  fov_h_deg: number
  method: 'slider' | 'pairs' // a ojo (escala de la huella) o resuelto por pares
  frame_tv: number | null // frame sobre el que se calibró
  agl_m: number | null
  terrain_source: string | null
  pairs: FovPair[] // los pares usados (vacío si fue a ojo)
  gsd_m_px: number | null // GSD medio resultante (m/px)
  residual_pct: number | null // dispersión de las estimaciones de GSD entre pares (%)
  date: string
  note: string
}

export interface CampaignConfig {
  sync: { method: SyncMethod; offset_s: number }
  fov: {
    active: FovKind
    sfm: FovSfm
    visual: FovVisual | null
    aspect: number // ancho/alto del sensor; deriva el FOV vertical
  }
  terrain: TerrainSource
  d_pitch: number
  d_roll: number
  // Candado: con la campaña bloqueada no se cambia ni sync, ni FOV, ni terreno.
  // Mezclar configuraciones a mitad de campaña ensucia el análisis.
  locked: boolean
}

// ---------- frames y puntos ----------

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
  fov_kind: string // 'sfm' | 'visual' (o 'unknown' en campañas antiguas)
  fov_h: number // FOV horizontal (grados) con el que se proyectó
  aspect: number
  d_pitch: number
  d_roll: number
  sync_method: string
  sync_offset: number
  terrain_source: string // modelo del terreno usado para el AGL: flat | ign | cop
}

// Las mismas dos proyecciones del píxel, hechas con el OTRO FOV.
export interface AltProjection {
  fov_kind: string
  fov_h: number
  ortho: LngLat | null
  attitude: LngLat | null
  err_ortho: Decomp | null
  err_attitude: Decomp | null
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
  // proyecciones del píxel con el FOV ACTIVO (null si el backend no pudo)
  ortho: LngLat | null
  attitude: LngLat | null
  // errores = proyección vs verdad-terreno
  err_ortho: Decomp | null
  err_attitude: Decomp | null
  // posición de cada punto respecto al nadir (contexto geométrico)
  truth_from_nadir: Decomp
  // proyecciones con el otro FOV (null si solo hay uno definido)
  alt: AltProjection | null
}

export interface GcpFrame {
  frame_id: string // f<frame_index>
  telemetry: FrameTelemetry
  points: GcpPoint[]
}

export interface GcpCampaign {
  version: 2
  started_at: string
  updated_at: string
  source_id: string | null // id de sesión del servidor (cambia al reiniciar)
  source_key: string | null // clave ESTABLE del vuelo (hash de las rutas bin+vídeo)
  source_label: string | null // nombre legible (fichero del vídeo)
  config: CampaignConfig
  frames: GcpFrame[]
}

// ---------- defaults / migración ----------

export const FOV_SFM_DEFAULT: FovSfm = {
  fov_h_deg: 72.3,
  focal_norm: 0.6849,
  source: 'OpenSfM (ODM): autocalibración del vuelo de referencia, focal_x=0.6849 normalizado',
}

export function defaultConfig(aspect = 16 / 9, method: SyncMethod = 'takeoff'): CampaignConfig {
  return {
    sync: { method, offset_s: 0 },
    fov: { active: 'sfm', sfm: { ...FOV_SFM_DEFAULT }, visual: null, aspect },
    terrain: 'flat',
    d_pitch: 0,
    d_roll: 0,
    locked: false,
  }
}

export function newCampaign(
  sourceId: string | null,
  sourceKey: string | null,
  sourceLabel: string | null,
  config: CampaignConfig,
): GcpCampaign {
  const now = new Date().toISOString()
  return {
    version: 2,
    started_at: now,
    updated_at: now,
    source_id: sourceId,
    source_key: sourceKey,
    source_label: sourceLabel,
    config,
    frames: [],
  }
}

// FOV activo en grados, según la configuración.
export function activeFov(cfg: CampaignConfig): number {
  return cfg.fov.active === 'visual' && cfg.fov.visual
    ? cfg.fov.visual.fov_h_deg
    : cfg.fov.sfm.fov_h_deg
}

// El OTRO FOV (para las proyecciones `alt`), o null si no está definido.
export function altFov(cfg: CampaignConfig): { kind: FovKind; fov_h: number } | null {
  if (cfg.fov.active === 'visual') return { kind: 'sfm', fov_h: cfg.fov.sfm.fov_h_deg }
  return cfg.fov.visual ? { kind: 'visual', fov_h: cfg.fov.visual.fov_h_deg } : null
}

// Acepta una campaña v1 (sin config) o v2 y devuelve siempre v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateCampaign(raw: any): GcpCampaign | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.frames)) return null
  if (raw.version === 2 && raw.config) return raw as GcpCampaign
  // v1: la configuración se reconstruye de lo que llevaba cada frame
  const f0 = raw.frames[0]?.telemetry
  const cfg = defaultConfig(f0?.aspect ?? 16 / 9, (f0?.sync_method as SyncMethod) ?? 'takeoff')
  if (f0) {
    cfg.sync.offset_s = f0.sync_offset ?? 0
    cfg.terrain = (f0.terrain_source as TerrainSource) ?? 'flat'
    cfg.d_pitch = f0.d_pitch ?? 0
    cfg.d_roll = f0.d_roll ?? 0
    if (typeof f0.fov_h === 'number' && Math.abs(f0.fov_h - cfg.fov.sfm.fov_h_deg) > 1e-6) {
      cfg.fov.visual = {
        fov_h_deg: f0.fov_h,
        method: 'slider',
        frame_tv: null,
        agl_m: null,
        terrain_source: null,
        pairs: [],
        gsd_m_px: null,
        residual_pct: null,
        date: raw.started_at ?? new Date().toISOString(),
        note: 'migrado de una campaña v1 (valor que llevaban los puntos)',
      }
      cfg.fov.active = 'visual'
    }
  }
  const frames: GcpFrame[] = raw.frames.map((f: GcpFrame) => ({
    ...f,
    telemetry: { ...f.telemetry, fov_kind: f.telemetry.fov_kind ?? 'unknown' },
    points: f.points.map((p: GcpPoint) => ({ ...p, alt: p.alt ?? null })),
  }))
  return {
    version: 2,
    started_at: raw.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_id: raw.source_id ?? null,
    source_key: raw.source_key ?? null,
    source_label: raw.source_label ?? null,
    config: cfg,
    frames,
  }
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

// El mismo error, en EJES DE LA IMAGEN: `along` = a lo largo de la traza (eje
// vertical de la foto, + hacia delante), `cross` = transversal (+ a la derecha
// del sentido de vuelo). Separa causas: un desfase de sincronía se ve en
// `along`; FOV, roll y distorsión se ven en `cross` (y radialmente).
// heading = rumbo en grados desde el norte, horario.
export function alongCross(e: Decomp, headingDeg: number): { along: number; cross: number } {
  const h = (headingDeg * Math.PI) / 180
  return {
    along: e.x * Math.sin(h) + e.y * Math.cos(h),
    cross: e.x * Math.cos(h) - e.y * Math.sin(h),
  }
}

// FOV horizontal a partir de pares foto↔mapa en un frame nadir: la escala
// (GSD, m/px) sale de la distancia entre pares en el suelo dividida por la
// distancia entre esos mismos pares en píxeles. Al usar DISTANCIAS, la
// solución es independiente del offset de sincronía y del yaw (que sólo
// trasladan/rotan): mide únicamente la escala. Luego fov = 2·atan(W·GSD/(2·AGL)).
export function solveFovFromPairs(
  pairs: FovPair[],
  imgW: number,
  agl: number,
): { fov_h_deg: number; gsd: number; residual_pct: number; n_dist: number } | null {
  const gsds: number[] = []
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const a = pairs[i]
      const b = pairs[j]
      const dpx = Math.hypot(a.px - b.px, a.py - b.py)
      if (dpx < 20) continue // pares demasiado juntos: la escala sale ruidosa
      const dm = haversine(a.lng, a.lat, b.lng, b.lat)
      gsds.push(dm / dpx)
    }
  }
  if (gsds.length === 0 || !(agl > 0)) return null
  const mean = gsds.reduce((s, v) => s + v, 0) / gsds.length
  const sd =
    gsds.length > 1 ? Math.sqrt(gsds.reduce((s, v) => s + (v - mean) ** 2, 0) / (gsds.length - 1)) : 0
  const fov = (2 * Math.atan((imgW * mean) / (2 * agl)) * 180) / Math.PI
  return { fov_h_deg: fov, gsd: mean, residual_pct: (sd / mean) * 100, n_dist: gsds.length }
}

// ---------- estadísticas de la campaña ----------

export interface ErrStats {
  n: number
  rmse: number
  median: number
  p90: number
  max: number
}

export function errStats(values: number[]): ErrStats | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))]
  return {
    n: v.length,
    rmse: Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length),
    median: q(0.5),
    p90: q(0.9),
    max: v[v.length - 1],
  }
}

// ---------- persistencia local ----------

const KEY = 'pinpoint.gcp.campaign'

export function loadCampaign(): GcpCampaign | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? migrateCampaign(JSON.parse(raw)) : null
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
  'img_w', 'img_h', 'off_x_px', 'off_y_px', 'off_norm_px', 'off_x_pct', 'off_y_pct',
  'drone_lat', 'drone_lng', 'alt_msl_m', 'agl_m',
  'pitch_deg', 'roll_deg', 'yaw_deg', 'drone_pitch_deg', 'flight_dir_deg',
  'truth_lat', 'truth_lng', 'truth_dx_m', 'truth_dy_m', 'truth_dist_m',
  'ortho_lat', 'ortho_lng', 'err_ortho_x_m', 'err_ortho_y_m', 'err_ortho_along_m', 'err_ortho_cross_m', 'err_ortho_m',
  'att_lat', 'att_lng', 'err_att_x_m', 'err_att_y_m', 'err_att_along_m', 'err_att_cross_m', 'err_att_m',
  'fov_kind', 'fov_h_deg', 'aspect', 'd_pitch', 'd_roll', 'map_zoom',
  'has_gimbal', 'nadir_ok', 'reason', 'sync_method', 'sync_offset_s', 'terrain_source',
  'alt_fov_kind', 'alt_fov_h_deg',
  'alt_ortho_lat', 'alt_ortho_lng', 'alt_err_ortho_x_m', 'alt_err_ortho_y_m', 'alt_err_ortho_m',
  'alt_att_lat', 'alt_att_lng', 'alt_err_att_x_m', 'alt_err_att_y_m', 'alt_err_att_m',
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
      const ac = (e: Decomp | null) => (e ? alongCross(e, t.yaw) : null)
      const eo = ac(p.err_ortho)
      const ea = ac(p.err_attitude)
      rows.push([
        q(f.frame_id), q(p.id), n(t.tv, 3), t.frame_index,
        t.imgW, t.imgH, n(p.offset_px.x, 2), n(p.offset_px.y, 2), n(p.offset_px.norm, 2),
        n((100 * p.offset_px.x) / (t.imgW / 2), 1), n((100 * p.offset_px.y) / (t.imgH / 2), 1),
        n(t.drone.lat, 8), n(t.drone.lng, 8), n(t.alt_msl, 2), n(t.agl, 2),
        n(t.pitch, 3), n(t.roll, 3), n(t.yaw, 3), n(t.drone_pitch, 3), n(t.flight_direction_deg, 3),
        n(p.truth.lat, 8), n(p.truth.lng, 8),
        n(p.truth_from_nadir.x, 3), n(p.truth_from_nadir.y, 3), n(p.truth_from_nadir.direct, 3),
        n(p.ortho?.lat, 8), n(p.ortho?.lng, 8),
        n(p.err_ortho?.x, 3), n(p.err_ortho?.y, 3), n(eo?.along, 3), n(eo?.cross, 3), n(p.err_ortho?.direct, 3),
        n(p.attitude?.lat, 8), n(p.attitude?.lng, 8),
        n(p.err_attitude?.x, 3), n(p.err_attitude?.y, 3), n(ea?.along, 3), n(ea?.cross, 3), n(p.err_attitude?.direct, 3),
        q(t.fov_kind ?? 'unknown'), n(t.fov_h, 3), n(t.aspect, 5), n(t.d_pitch, 3), n(t.d_roll, 3), n(p.map_zoom, 2),
        t.has_gimbal ? '1' : '0', t.nadir_ok ? '1' : '0', q(t.reason), q(t.sync_method), n(t.sync_offset, 3), q(t.terrain_source || 'flat'),
        q(p.alt?.fov_kind ?? ''), n(p.alt?.fov_h, 3),
        n(p.alt?.ortho?.lat, 8), n(p.alt?.ortho?.lng, 8),
        n(p.alt?.err_ortho?.x, 3), n(p.alt?.err_ortho?.y, 3), n(p.alt?.err_ortho?.direct, 3),
        n(p.alt?.attitude?.lat, 8), n(p.alt?.attitude?.lng, 8),
        n(p.alt?.err_attitude?.x, 3), n(p.alt?.err_attitude?.y, 3), n(p.alt?.err_attitude?.direct, 3),
      ].join(','))
    }
  }
  return rows.join('\n') + '\n'
}
