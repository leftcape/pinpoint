// Puntos LOCALIZADOS: la vertiente OPERATIVA de PinPoint.
//
// Un punto localizado es un click en la foto convertido en coordenada, junto
// con su FIABILIDAD: el ángulo de visión theta bajo el que la cámara lo vio,
// la banda A/B/C y el margen esperable (P90). Es lo que un operador entrega a
// un equipo: "id aquí, con ± tantos metros".
//
// A diferencia de los puntos de control (GCP), aquí NO hay verdad-terreno: no
// se mide el error, se ESTIMA a partir de la geometría de observación, con las
// bandas que el artículo obtuvo de la campaña (ver pinpoint_core/reliability.py).
//
// Se guardan en la campaña del vuelo (campaign.json, clave `located`) SIN el
// fotograma: se regenera del vídeo al exportar, y así no ocupan espacio.
import type { LngLat } from './gcp'

export type BandCode = 'A' | 'B' | 'C'

export interface LocatedPoint {
  id: string // identificador estable (no cambia al borrar otros)
  label: string // editable: "L1", "foco 2", "vehículo"…
  created_at: string
  // dónde se clicó
  tv: number
  frame_index: number
  px: number
  py: number
  imgW: number
  imgH: number
  // resultado
  lat: number
  lng: number
  clipped: boolean // el rayo se recortó (cámara al horizonte): coordenada poco fiable
  drone: LngLat // vertical de la aeronave en ese instante
  agl_m: number
  theta_deg: number // ángulo de visión = arctan(d_nadir / AGL)
  d_nadir_m: number
  band: BandCode
  margin_p90_m: number // margen esperable: P90 de la banda (campaña del artículo)
  model_err_m: number | null // eps0/cos²theta, informativo
  // contexto del fotograma
  nadir_ok: boolean
  reason: string
  // con qué se calculó (reproducibilidad: sin esto la coordenada no se puede rehacer)
  sync_method: string
  sync_offset: number
  fov_kind: string
  fov_h: number
  d_pitch: number
  d_roll: number
  terrain_source: string
}

export const BAND_COLOR: Record<BandCode, string> = { A: '#16a34a', B: '#d97706', C: '#dc2626' }
export const BAND_RANGE: Record<BandCode, string> = { A: '0–15°', B: '15–45°', C: '45–90°' }

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// Siguiente etiqueta libre "L<n>": el máximo n existente + 1, para que borrar
// un punto no haga que el siguiente repita etiqueta.
export function nextLabel(pts: LocatedPoint[]): string {
  let max = 0
  for (const p of pts) {
    const m = /^L(\d+)$/.exec(p.label.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `L${max + 1}`
}

// Círculo de radio `radiusM` metros alrededor de (lng, lat), como anillo
// [lng, lat] cerrado. Proyección plana local: sobra para decenas de metros.
export function circlePolygon(lng: number, lat: number, radiusM: number, n = 48): [number, number][] {
  const mLat = 111320.0
  const mLng = 111320.0 * Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI
    ring.push([lng + (radiusM * Math.cos(a)) / mLng, lat + (radiusM * Math.sin(a)) / mLat])
  }
  return ring
}

// ---------- exportación ----------

const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`
const n = (v: number | null | undefined, d: number) => (v == null || Number.isNaN(v) ? '' : v.toFixed(d))

export const LOCATED_CSV_COLUMNS = [
  'id', 'label', 'created_at', 'lat', 'lng', 'band', 'margin_p90_m', 'theta_deg', 'd_nadir_m', 'agl_m',
  'model_err_m', 'tv', 'frame_index', 'px', 'py', 'img_w', 'img_h', 'drone_lat', 'drone_lng',
  'nadir_ok', 'reason', 'clipped', 'sync_method', 'sync_offset', 'fov_kind', 'fov_h', 'd_pitch', 'd_roll',
  'terrain_source',
]

export function locatedToCsv(pts: LocatedPoint[]): string {
  const rows = [LOCATED_CSV_COLUMNS.join(',')]
  for (const p of pts) {
    rows.push(
      [
        q(p.id), q(p.label), q(p.created_at), n(p.lat, 8), n(p.lng, 8), q(p.band), n(p.margin_p90_m, 1),
        n(p.theta_deg, 2), n(p.d_nadir_m, 2), n(p.agl_m, 2), n(p.model_err_m, 2), n(p.tv, 3), p.frame_index,
        n(p.px, 1), n(p.py, 1), p.imgW, p.imgH, n(p.drone.lat, 8), n(p.drone.lng, 8),
        p.nadir_ok ? '1' : '0', q(p.reason), p.clipped ? '1' : '0', q(p.sync_method), n(p.sync_offset, 3),
        q(p.fov_kind), n(p.fov_h, 3), n(p.d_pitch, 3), n(p.d_roll, 3), q(p.terrain_source),
      ].join(','),
    )
  }
  return rows.join('\n') + '\n'
}

// GeoJSON: un Point por punto con todas sus propiedades. El margen va como
// propiedad (radio en metros) y no como polígono: así se abre limpio en
// cualquier SIG y quien quiera el círculo lo genera con un buffer.
export function locatedToGeoJson(pts: LocatedPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pts.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        label: p.label,
        created_at: p.created_at,
        band: p.band,
        margin_p90_m: p.margin_p90_m,
        theta_deg: Math.round(p.theta_deg * 100) / 100,
        d_nadir_m: Math.round(p.d_nadir_m * 100) / 100,
        agl_m: Math.round(p.agl_m * 100) / 100,
        model_err_m: p.model_err_m == null ? null : Math.round(p.model_err_m * 100) / 100,
        tv: p.tv,
        frame_index: p.frame_index,
        nadir_ok: p.nadir_ok,
        reason: p.reason,
        clipped: p.clipped,
        sync_method: p.sync_method,
        sync_offset: p.sync_offset,
        fov_kind: p.fov_kind,
        fov_h: p.fov_h,
        terrain_source: p.terrain_source,
      },
    })),
  }
}
