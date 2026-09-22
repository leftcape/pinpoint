// Exportación de los puntos LOCALIZADOS (modo operativo).
//
//   CSV      una fila por punto, con coordenada, banda, margen y con qué se calculó.
//   GeoJSON  lo mismo como puntos, para abrir en cualquier SIG.
//   ZIP      además, por cada fotograma con puntos, la foto con los puntos
//            señalados y su ficha (coordenada, θ, banda, margen). Los
//            fotogramas NO se guardan con la campaña: se regeneran aquí del
//            vídeo, que para eso está.
import type { StoreApi } from 'zustand'
import { useStore } from '../store'
import { buildZip, textEntry, bytesEntry, dataUrlToBytes } from './zip'
import { seekVideo } from './exportCampaign'
import { BAND_COLOR, locatedToCsv, locatedToGeoJson, type LocatedPoint } from './located'
import { t } from '../i18n'

type Store = ReturnType<typeof useStore.getState>

// AAAAMMDD_HHMM. Sin regex con corchetes: Tailwind escanea el fuente buscando
// clases y una /[...]/ le parece una y rompe el minificado del CSS.
function stamp(): string {
  const d = new Date()
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function points(): LocatedPoint[] {
  const s = (useStore as unknown as StoreApi<Store>).getState()
  return s.gcpCampaign.located
}

export function exportLocatedCsv(): string {
  const pts = points()
  if (!pts.length) throw new Error(t('loc.noPoints'))
  const name = `located_${pts.length}pts_${stamp()}.csv`
  download(name, new Blob([locatedToCsv(pts)], { type: 'text/csv;charset=utf-8' }))
  return name
}

export function exportLocatedGeoJson(): string {
  const pts = points()
  if (!pts.length) throw new Error(t('loc.noPoints'))
  const name = `located_${pts.length}pts_${stamp()}.geojson`
  download(name, new Blob([JSON.stringify(locatedToGeoJson(pts), null, 1)], { type: 'application/geo+json' }))
  return name
}

// El fotograma con sus puntos señalados y, al pie, la ficha de cada uno. Los
// marcadores de pantalla son <div> del DOM y no entran en la captura del
// <video>, así que se redibujan aquí, en la resolución nativa.
function annotateFrame(v: HTMLVideoElement, pts: LocatedPoint[]): string | null {
  if (!v.videoWidth) return null
  const W = v.videoWidth
  const H = v.videoHeight
  const k = Math.max(1, W / 1280)
  const lineH = 22 * k
  const footer = Math.ceil(lineH * pts.length + 14 * k)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H + footer
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(v, 0, 0)

  // cruz del centro óptico: el error crece con el ángulo de visión, y el
  // lector debe poder ver a qué distancia del centro estaba cada punto.
  ctx.strokeStyle = 'rgba(255,255,255,.55)'
  ctx.lineWidth = 1 * k
  ctx.setLineDash([6 * k, 5 * k])
  ctx.beginPath()
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H)
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2)
  ctx.stroke()
  ctx.setLineDash([])

  const r = 10 * k
  ctx.font = `bold ${14 * k}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const p of pts) {
    const c = BAND_COLOR[p.band]
    ctx.beginPath()
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 4 * k
    ctx.stroke()
    ctx.strokeStyle = c
    ctx.lineWidth = 2 * k
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(p.px - r * 1.7, p.py); ctx.lineTo(p.px - r * 0.5, p.py)
    ctx.moveTo(p.px + r * 0.5, p.py); ctx.lineTo(p.px + r * 1.7, p.py)
    ctx.moveTo(p.px, p.py - r * 1.7); ctx.lineTo(p.px, p.py - r * 0.5)
    ctx.moveTo(p.px, p.py + r * 0.5); ctx.lineTo(p.px, p.py + r * 1.7)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 3.5 * k
    ctx.stroke()
    ctx.strokeStyle = c
    ctx.lineWidth = 1.6 * k
    ctx.stroke()
    const lx = p.px
    const ly = p.py - r * 2.3
    ctx.lineWidth = 4 * k
    ctx.strokeStyle = '#000'
    ctx.strokeText(p.label, lx, ly)
    ctx.fillStyle = '#fff'
    ctx.fillText(p.label, lx, ly)
  }

  // ficha al pie: una línea por punto, con el color de su banda
  ctx.fillStyle = '#111'
  ctx.fillRect(0, H, W, footer)
  ctx.textAlign = 'left'
  ctx.font = `${13 * k}px ui-monospace, Menlo, monospace`
  pts.forEach((p, i) => {
    const y = H + 7 * k + lineH * i + lineH / 2
    ctx.fillStyle = BAND_COLOR[p.band]
    ctx.fillRect(10 * k, y - 7 * k, 14 * k, 14 * k)
    ctx.fillStyle = '#eee'
    const txt =
      `${p.label}  ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}  ` +
      `θ ${p.theta_deg.toFixed(0)}°  ${p.band} ±${p.margin_p90_m.toFixed(0)} m (P90)  ` +
      `AGL ${p.agl_m.toFixed(0)} m  t=${p.tv.toFixed(2)} s` +
      (p.nadir_ok ? '' : `  [${t('loc.notNadirShort')}]`)
    ctx.fillText(txt, 32 * k, y)
  })
  return cv.toDataURL('image/jpeg', 0.9)
}

export interface LocatedExportResult {
  filename: string
  frames: number
}

export async function exportLocatedZip(
  onProgress?: (i: number, n: number) => void,
): Promise<LocatedExportResult> {
  const store = useStore as unknown as StoreApi<Store>
  const s0 = store.getState()
  const pts = s0.gcpCampaign.located
  const v = s0.videoEl
  if (!pts.length) throw new Error(t('loc.noPoints'))
  if (!v) throw new Error(t('loc.noVideo'))

  // agrupar por fotograma: una foto por frame con TODOS sus puntos
  const byFrame = new Map<number, LocatedPoint[]>()
  for (const p of pts) byFrame.set(p.frame_index, [...(byFrame.get(p.frame_index) ?? []), p])
  const frames = [...byFrame.entries()].sort((a, b) => a[0] - b[0])

  // estado del vídeo que hay que devolver tal cual al terminar
  const wasPlaying = !v.paused
  const tv0 = v.currentTime
  if (wasPlaying) v.pause()

  const files: { name: string; data: Uint8Array }[] = []
  try {
    let i = 0
    for (const [fi, fpts] of frames) {
      i++
      onProgress?.(i, frames.length)
      await seekVideo(v, fpts[0].tv)
      const jpg = annotateFrame(v, fpts)
      if (jpg) files.push({ name: `frames/f${fi}_${fpts.map((p) => p.label).join('-').replace(/[^\w.-]+/g, '_')}.jpg`, data: dataUrlToBytes(jpg) })
    }
  } finally {
    await seekVideo(v, tv0)
    if (wasPlaying) void v.play()
  }

  files.push({ name: 'located.csv', data: new TextEncoder().encode(locatedToCsv(pts)) })
  files.push({ name: 'located.geojson', data: new TextEncoder().encode(JSON.stringify(locatedToGeoJson(pts), null, 1)) })
  const entries = files.map((f) => bytesEntry(f.name, f.data))
  entries.push(textEntry('README.txt', t('loc.readme', { n: pts.length, f: frames.length, date: new Date().toISOString() })))

  const filename = `located_${pts.length}pts_${stamp()}.zip`
  download(filename, buildZip(entries))
  return { filename, frames: frames.length }
}
