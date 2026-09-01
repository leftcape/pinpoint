// Cliente del backend PinPoint. Todo va contra /api (proxy en dev, mismo origen en prod).

export interface LogPreview {
  geojson: GeoJSON.Feature
  profile: [number, number, number][] // [t_rel, alt_rel, spd]
  takeoff_trel: number | null
  duration_s: number
  utc_start: string
  utc_end: string
  bbox: [number, number, number, number] // min_lat,min_lng,max_lat,max_lng
  alt0: number
  source_key?: string // clave ESTABLE del vuelo (hash de rutas): indexa la campaña en el servidor
  source_label?: string // nombre del fichero de vídeo
}

export interface VideoInfo {
  path: string
  duration_s: number
  fps: number
  width: number
  height: number
  nb_frames: number | null
  creation_time: string | null
  is_reencoded: boolean
}

export interface Position {
  tv: number
  lat: number
  lng: number
  alt: number
  yaw: number
  alt_rel: number
  video_start_trel: number
  method: string
  detail: string
  tz_offset_hours: number
}

export interface Footprint {
  tv: number
  valid: boolean
  nadir_ok: boolean // false si la cámara está muy oblicua/baja -> no pintar imagen
  reason: string // "" | "pitch" | "roll" | "agl"
  drone: [number, number] // lat, lng
  agl: number
  yaw: number
  pitch: number
  roll: number // alabeo real de la cámara = alabeo del dron (gimbal de 1 eje, no lo compensa)
  drone_roll: number // igual que roll (se mantiene por compatibilidad)
  drone_pitch: number // cabeceo del DRON (ATT). Interviene en la geometría del contorno.
  clipped: boolean // true si el contorno se recortó (cámara al horizonte)
  corners: [number, number][] // rectángulo nadir (para la imagen) [lng,lat]
  outline_corners: [number, number][] // silueta/trapecio real (para el contorno) [lng,lat]
  has_gimbal: boolean
  terrain_source?: string // fuente de terreno EFECTIVA usada para el AGL
}

export interface NadirThresholds {
  max_pitch_dev: number // desviación máx del pitch vs -90° (grados)
  max_roll_dev: number // |roll| máximo (grados)
  min_agl: number // altura mínima sobre terreno (m)
}

export interface AngleTuning {
  // FOV HORIZONTAL nominal de la cámara (grados). Es el dato PRINCIPAL y editable:
  // no se conoce a priori con precisión, así que se fija a ojo contra verdad-
  // terreno. Defecto 72.3° (la estimación de OpenSFM del vuelo de referencia),
  // sólo un punto de partida.
  fov_h: number
  // relación de aspecto del sensor (ancho/alto). Se infiere de la resolución del
  // vídeo pero es editable (píxel no cuadrado, vídeo estirado). El FOV vertical
  // NO se toca directamente: sale de aquí -> fov_v = 2·atan(tan(fov_h/2)/aspect).
  aspect: number
  d_pitch: number // delta manual de cabeceo (grados)
  d_roll: number // delta manual de alabeo (grados)
}

// FOV vertical derivado del horizontal y el aspect ratio del sensor.
export function fovVerticalFrom(fovHDeg: number, aspect: number): number {
  const t = Math.tan((fovHDeg * Math.PI) / 360) / aspect
  return (2 * Math.atan(t) * 180) / Math.PI
}

// Vuelca el tuning a los query params del backend. Envía el FOV horizontal
// (editable a ojo) y el vertical DERIVADO del aspect ratio.
function setTuningParams(p: URLSearchParams, t: AngleTuning): void {
  p.set('fov_h', String(t.fov_h))
  p.set('fov_v', String(fovVerticalFrom(t.fov_h, t.aspect)))
  p.set('d_pitch', String(t.d_pitch))
  p.set('d_roll', String(t.d_roll))
}

// FOV horizontal nominal por defecto (grados): la estimación de OpenSFM del vuelo
// de referencia (focal_x=0.6849). NO es una calibración de laboratorio — sólo un
// punto de partida; el usuario lo ajusta a ojo contra verdad-terreno.
export const FOV_H_DEFAULT = 72.3

export type SyncMethod = 'takeoff' | 'creation_time' | 'manual'

export interface Candidate {
  tv: number
  roll: number
  pitch: number
  yaw: number
  yaw_rate: number
  agl: number
  kind: 'straight' | 'turns'
  bin: string
}

// Modelo del terreno para el AGL. 'flat' = cota del despegue (v0.1.0);
// 'ign' = MDT 5m España; 'cop' = Copernicus DEM 90m mundial.
export type TerrainSource = 'flat' | 'ign' | 'cop'

// --- carpeta de vuelos del servidor ---
export interface LibraryFile {
  path: string      // ruta absoluta en el servidor (lo que se registra)
  name: string      // relativa a la carpeta: es lo que se muestra
  size: number
  mtime: number
}

export interface Quota {
  used: number
  limit: number
  free: number
  pct: number
}

export interface Library {
  dir: string
  exists: boolean
  writable: boolean   // si es false, la carpeta está montada de solo lectura
  videos: LibraryFile[]
  logs: LibraryFile[]
  quota: Quota
}

// --- proyectos ---
export interface Project {
  id: string
  name: string
  bin_path: string
  video_path: string
  meta: Record<string, unknown>
  created_at: number
  updated_at: number
  /** true = pide contraseña para escribir. La contraseña nunca viaja. */
  protected: boolean
  points?: number
  has_campaign?: boolean
}

export interface Backup {
  name: string
  when: number
  points: number
}

export interface LibraryUploaded {
  name: string
  path: string
  size: number
  kind: 'video' | 'log'
  quota: Omit<Quota, 'pct'>
}


/** Error de la API que conserva el código: permite distinguir un 401
 *  (contraseña incorrecta) de una caída de red, que no son lo mismo. */
export class ApiError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`${status}: ${body}`)
    this.status = status
  }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new ApiError(r.status, await r.text())
  return r.json() as Promise<T>
}

export const api = {
  async registerSource(bin_path: string, video_path: string) {
    return j<{ id: string; key: string; label: string }>(
      await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bin_path, video_path }),
      }),
    )
  },

  async uploadSource(bin: File, video: File) {
    const fd = new FormData()
    fd.append('bin', bin)
    fd.append('video', video)
    return j<{ id: string; key: string; label: string }>(
      await fetch('/api/sources/upload', { method: 'POST', body: fd }),
    )
  },

  async log(sid: string) {
    return j<LogPreview>(await fetch(`/api/sources/${sid}/log`))
  },

  async listSources() {
    return j<{ id: string; key: string; label: string; bin_path: string; video_path: string; has_campaign: boolean }[]>(
      await fetch('/api/sources'),
    )
  },

  // Carpeta de vuelos del servidor: lo que alimenta los dos desplegables de la
  // pantalla inicial, más el estado de la cuota.
  async library() {
    return j<Library>(await fetch('/api/library'))
  },

  // Sube UN fichero a esa carpeta. `kind` decide en qué desplegable aparece.
  async libraryUpload(file: File, kind: 'video' | 'log', onProgress?: (pct: number) => void) {
    // XHR en vez de fetch: es la única forma de tener progreso de subida, y
    // estos ficheros son de GB.
    return new Promise<LibraryUploaded>((resolve, reject) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/library/upload')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((100 * e.loaded) / e.total))
      }
      xhr.onload = () => {
        let body: any = {}
        try { body = JSON.parse(xhr.responseText) } catch { /* respuesta no-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body)
        else reject(new Error(body?.detail || `error ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('fallo de red al subir'))
      xhr.send(fd)
    })
  },

  // candidatos de fotograma desde el log (pasadas rectas / virajes)
  async candidates(sid: string, mode: 'straight' | 'turns', method: SyncMethod, offset: number, n: number, maxRoll: number) {
    const p = new URLSearchParams({ mode, method, offset: String(offset), n: String(n), max_roll: String(maxRoll) })
    return j<{ mode: string; candidates: Candidate[] }>(await fetch(`/api/sources/${sid}/candidates?${p}`))
  },

  // --- campaña de puntos de control guardada junto al vuelo ---
  async campaignGet(sid: string): Promise<unknown | null> {
    const r = await fetch(`/api/sources/${sid}/campaign`)
    if (r.status === 404) return null
    return j<unknown>(r)
  },

  async campaignPut(sid: string, campaign: unknown) {
    return j<{ ok: boolean; key: string; frames: number; points: number }>(
      await fetch(`/api/sources/${sid}/campaign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaign),
      }),
    )
  },

  // --- proyectos ---
  // Un proyecto agrupa vídeo, log, configuración, puntos y metadatos bajo una
  // identidad propia: renombrar los ficheros ya no desvincula la campaña.
  async projectsList() {
    return j<Project[]>(await fetch('/api/projects'))
  },

  async projectCreate(body: {
    name: string; bin_path?: string; video_path?: string
    password?: string; meta?: Record<string, unknown>
  }) {
    return j<Project>(
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  },

  async projectGet(pid: string) {
    return j<Project>(await fetch(`/api/projects/${pid}`))
  },

  async projectUpdate(pid: string, body: Record<string, unknown>) {
    return j<Project>(
      await fetch(`/api/projects/${pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  },

  async projectDelete(pid: string, password = '') {
    return j<{ ok: boolean }>(
      await fetch(`/api/projects/${pid}?password=${encodeURIComponent(password)}`,
        { method: 'DELETE' }),
    )
  },

  // Abre el proyecto: registra su bin+vídeo y devuelve el sid de la sesión.
  async projectOpen(pid: string) {
    return j<{ id: string; key: string; label: string; project: Project }>(
      await fetch(`/api/projects/${pid}/open`, { method: 'POST' }),
    )
  },

  async projectCampaignGet(pid: string): Promise<unknown | null> {
    const r = await fetch(`/api/projects/${pid}/campaign`)
    if (r.status === 404) return null
    return j<unknown>(r)
  },

  // La contraseña va en cabecera, no en la URL: así no acaba escrita en los
  // logs de acceso del servidor.
  async projectCampaignPut(pid: string, campaign: unknown, password = '') {
    return j<{ ok: boolean; frames: number; points: number; warning?: string }>(
      await fetch(`/api/projects/${pid}/campaign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Pinpoint-Password': password },
        body: JSON.stringify(campaign),
      }),
    )
  },

  // ¿Sirve esta contraseña? Se usa al escribirla, para avisar en el momento y
  // no en el primer guardado (que puede ser mucho después).
  async projectVerify(pid: string, password: string) {
    return j<{ ok: boolean; protected: boolean }>(
      await fetch(`/api/projects/${pid}/verify`, {
        method: 'POST',
        headers: { 'X-Pinpoint-Password': password },
      }),
    )
  },

  async projectBackups(pid: string) {
    return j<Backup[]>(await fetch(`/api/projects/${pid}/backups`))
  },

  async projectRestore(pid: string, nombre: string, password = '') {
    return j<{ ok: boolean; frames: number; points: number }>(
      await fetch(`/api/projects/${pid}/backups/${nombre}/restore`, {
        method: 'POST',
        headers: { 'X-Pinpoint-Password': password },
      }),
    )
  },

  async videoInfo(sid: string) {
    return j<VideoInfo>(await fetch(`/api/sources/${sid}/video/info`))
  },

  videoStreamUrl(sid: string) {
    return `/api/sources/${sid}/video/stream`
  },

  // --- capa MDT (terreno visible) ---
  async terrainMeta(sid: string, terrain: TerrainSource) {
    return j<{ available: boolean; terrain_source: string; bounds?: [number, number][] }>(
      await fetch(`/api/sources/${sid}/terrain/meta?terrain=${terrain}`),
    )
  },

  terrainImageUrl(sid: string, terrain: TerrainSource) {
    return `/api/sources/${sid}/terrain/image?terrain=${terrain}`
  },

  async terrainElevation(sid: string, lat: number, lng: number, terrain: TerrainSource) {
    const p = new URLSearchParams({ lat: String(lat), lng: String(lng), terrain })
    return j<{ terrain_source: string; z: number | null }>(
      await fetch(`/api/sources/${sid}/terrain/elevation?${p}`),
    )
  },

  async position(sid: string, tv: number, method: SyncMethod, offset = 0) {
    const p = new URLSearchParams({ tv: String(tv), method, offset: String(offset) })
    return j<Position>(await fetch(`/api/sources/${sid}/position?${p}`))
  },

  async footprint(
    sid: string,
    tv: number,
    method: SyncMethod,
    offset = 0,
    thr?: NadirThresholds,
    tuning?: AngleTuning,
    terrain: TerrainSource = 'flat',
  ) {
    const p = new URLSearchParams({ tv: String(tv), method, offset: String(offset) })
    if (thr) {
      p.set('max_pitch_dev', String(thr.max_pitch_dev))
      p.set('max_roll_dev', String(thr.max_roll_dev))
      p.set('min_agl', String(thr.min_agl))
    }
    if (tuning) setTuningParams(p, tuning)
    p.set('terrain', terrain)
    return j<Footprint>(await fetch(`/api/sources/${sid}/footprint?${p}`))
  },

  async projectPoint(
    sid: string,
    tv: number,
    px: number,
    py: number,
    imgW: number,
    imgH: number,
    method: SyncMethod,
    offset = 0,
    tuning?: AngleTuning,
    ortho = false, // true: pinhole nadir puro (sin actitud) — línea base del muestreo
    terrain: TerrainSource = 'flat',
  ) {
    const p = new URLSearchParams({
      tv: String(tv),
      px: String(px),
      py: String(py),
      img_w: String(imgW),
      img_h: String(imgH),
      method,
      offset: String(offset),
    })
    if (tuning) setTuningParams(p, tuning)
    if (ortho) p.set('ortho', 'true')
    p.set('terrain', terrain)
    return j<{ lat: number; lng: number; clipped: boolean; valid: boolean; terrain_source?: string }>(
      await fetch(`/api/sources/${sid}/project_point?${p}`),
    )
  },
}
