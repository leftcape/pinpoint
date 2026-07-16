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

// Modelo del terreno para el AGL. 'flat' = cota del despegue (v0.1.0);
// 'ign' = MDT 5m España; 'cop' = Copernicus DEM 90m mundial.
export type TerrainSource = 'flat' | 'ign' | 'cop'


async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

export const api = {
  async registerSource(bin_path: string, video_path: string) {
    return j<{ id: string }>(
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
    return j<{ id: string }>(await fetch('/api/sources/upload', { method: 'POST', body: fd }))
  },

  async log(sid: string) {
    return j<LogPreview>(await fetch(`/api/sources/${sid}/log`))
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
