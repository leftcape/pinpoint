// Exportación de la campaña de puntos de control -> ZIP para el paper.
//
// CONTENIDO:
//   points.csv          una fila por punto, TODOS los frames juntos. Es la tabla
//                       de análisis: error vs distancia al centro, AGL, roll…
//   campaign.json       lo mismo en estructura anidada, sin pérdida.
//   README.txt          qué es cada cosa y qué significan las columnas.
//   frames/<id>/…       por frame: el fotograma crudo y DOS capturas del mapa
//                       (ortogonal y actitud) con TODOS sus puntos dibujados.
//
// Las capturas son POR FRAME, no por punto: una figura con los puntos A,B,C y
// sus catetos se lee mejor que N figuras de un punto, y cuesta 1/N.

import type { StoreApi } from 'zustand'
import maplibregl from 'maplibre-gl'
import { useStore } from '../store'
import { buildZip, textEntry, bytesEntry, dataUrlToBytes } from './zip'
import { campaignToCsv, type GcpFrame } from './gcp'
import { t } from '../i18n'

type Store = ReturnType<typeof useStore.getState>

const ORTHO = '#2563eb'
const ATT = '#dc2626'
const TRUTH = '#22c55e'

function mapIdle(map: maplibregl.Map, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    map.once('idle', finish)
    setTimeout(finish, timeoutMs)
  })
}

// Espera a que el vídeo esté parado en `tv` y con el fotograma ya presentado:
// sin esto la captura puede coger el frame anterior.
function seekVideo(v: HTMLVideoElement, tv: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - tv) < 0.005 && v.readyState >= 2) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      v.removeEventListener('seeked', finish)
      resolve()
    }
    v.addEventListener('seeked', finish)
    v.currentTime = tv
    setTimeout(finish, 3000)
  })
}

// Capas de MapView que hay que APAGAR durante la captura: pintan las DOS
// proyecciones a la vez y contaminarían cada figura con la otra.
const MAPVIEW_GCP_LAYERS = [
  'gcp-legs-ortho-l', 'gcp-legs-att-l', 'gcp-truth-l', 'gcp-ortho-l', 'gcp-att-l',
]
// la trayectoria también estorba: es una línea azul que compite con los puntos
const NOISE_LAYERS = [...MAPVIEW_GCP_LAYERS, 'track-line', 'frame-proj-layer', 'frame-proj-outline']

function setLayersVisible(map: maplibregl.Map, ids: string[], visible: boolean) {
  for (const id of ids) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }
}

// Capas temporales con la figura de UN frame: verdad-terreno + una proyección,
// unidas por sus catetos X/Y en discontinua. Las etiquetas van aparte (ver
// composeFigure).
const IDS = ['xp-legs', 'xp-proj', 'xp-truth']

function clearFigure(map: maplibregl.Map) {
  for (const id of IDS) {
    if (map.getLayer(`${id}-l`)) map.removeLayer(`${id}-l`)
    if (map.getSource(id)) map.removeSource(id)
  }
}

function drawFigure(map: maplibregl.Map, frame: GcpFrame, which: 'ortho' | 'attitude') {
  clearFigure(map)
  const color = which === 'ortho' ? ORTHO : ATT
  const legs: GeoJSON.Feature[] = []
  const projPts: GeoJSON.Feature[] = []
  const truthPts: GeoJSON.Feature[] = []

  for (const p of frame.points) {
    const proj = which === 'ortho' ? p.ortho : p.attitude
    truthPts.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.truth.lng, p.truth.lat] },
    })
    if (!proj) continue
    projPts.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [proj.lng, proj.lat] },
    })
    // catetos: proyección -> esquina -> verdad-terreno
    const corner: [number, number] = [p.truth.lng, proj.lat]
    legs.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[proj.lng, proj.lat], corner] },
    })
    legs.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [corner, [p.truth.lng, p.truth.lat]] },
    })
  }

  map.addSource('xp-legs', { type: 'geojson', data: { type: 'FeatureCollection', features: legs } })
  map.addLayer({
    id: 'xp-legs-l',
    type: 'line',
    source: 'xp-legs',
    paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  })
  map.addSource('xp-proj', { type: 'geojson', data: { type: 'FeatureCollection', features: projPts } })
  map.addLayer({
    id: 'xp-proj-l',
    type: 'circle',
    source: 'xp-proj',
    paint: { 'circle-radius': 5, 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
  })
  map.addSource('xp-truth', { type: 'geojson', data: { type: 'FeatureCollection', features: truthPts } })
  map.addLayer({
    id: 'xp-truth-l',
    type: 'circle',
    source: 'xp-truth',
    paint: { 'circle-radius': 5, 'circle-color': TRUTH, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
  })

}

// Las etiquetas NO se pueden hacer con una capa `symbol`: el estilo es raster
// puro y no declara `glyphs`, así que MapLibre no tendría fuentes con las que
// dibujar texto (y añadir un servidor de glyphs metería una dependencia de red
// en un instrumento de medida). Tampoco valen los Marker: son HTML del DOM y no
// entran en el canvas WebGL, así que toDataURL no los captura.
// Solución: componer el PNG nosotros = canvas del mapa + texto encima con 2D.
function composeFigure(map: maplibregl.Map, frame: GcpFrame, which: 'ortho' | 'attitude'): string {
  const src = map.getCanvas()
  const cv = document.createElement('canvas')
  cv.width = src.width
  cv.height = src.height
  const ctx = cv.getContext('2d')
  if (!ctx) return src.toDataURL('image/png')
  ctx.drawImage(src, 0, 0)

  // el canvas WebGL puede tener más resolución que el CSS (retina): las
  // coordenadas de map.project() vienen en px CSS, hay que escalarlas.
  const dpr = src.width / map.getContainer().clientWidth
  const color = which === 'ortho' ? ORTHO : ATT
  ctx.font = `bold ${13 * dpr}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'

  const draw = (text: string, at: [number, number], col: string) => {
    const q = map.project(at)
    const x = q.x * dpr
    const y = q.y * dpr - 14 * dpr
    ctx.lineWidth = 3.5 * dpr
    ctx.strokeStyle = '#fff' // halo: legible sobre la ortofoto
    ctx.strokeText(text, x, y)
    ctx.fillStyle = col
    ctx.fillText(text, x, y)
  }

  for (const p of frame.points) {
    const proj = which === 'ortho' ? p.ortho : p.attitude
    const err = which === 'ortho' ? p.err_ortho : p.err_attitude
    draw(p.id, [p.truth.lng, p.truth.lat], '#111827')
    if (!proj || !err) continue
    draw(`X=${err.x.toFixed(1)}m`, [(proj.lng + p.truth.lng) / 2, proj.lat], color)
    draw(`Y=${err.y.toFixed(1)}m`, [p.truth.lng, (proj.lat + p.truth.lat) / 2], color)
  }
  return cv.toDataURL('image/png')
}

// Encuadra el mapa sobre los puntos del frame para que la figura salga centrada.
function fitToFrame(map: maplibregl.Map, frame: GcpFrame) {
  const b = new maplibregl.LngLatBounds()
  for (const p of frame.points) {
    b.extend([p.truth.lng, p.truth.lat])
    if (p.ortho) b.extend([p.ortho.lng, p.ortho.lat])
    if (p.attitude) b.extend([p.attitude.lng, p.attitude.lat])
  }
  if (b.isEmpty()) return
  map.fitBounds(b, { padding: 90, duration: 0, maxZoom: 21 })
}

function grabVideoFrame(v: HTMLVideoElement): string | null {
  if (!v.videoWidth) return null
  const cv = document.createElement('canvas')
  cv.width = v.videoWidth
  cv.height = v.videoHeight
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(v, 0, 0)
  return cv.toDataURL('image/jpeg', 0.92)
}

export interface ExportResult {
  filename: string
  frames: number
}

export async function exportCampaign(): Promise<ExportResult> {
  const store = useStore as unknown as StoreApi<Store>
  const s0 = store.getState()
  const campaign = s0.gcpCampaign
  const map = s0.mapHandle
  const video = s0.videoEl

  if (!campaign.frames.length) throw new Error(t('exp.noPoints'))
  if (!map) throw new Error(t('exp.noMap'))

  // estado que hay que devolver tal cual al terminar
  const saved = {
    tv: s0.currentTv,
    frame: s0.projectFrame,
    outline: s0.showOutline,
    oblique: s0.obliqueProject,
    follow: s0.followDrone,
    center: map.getCenter(),
    zoom: map.getZoom(),
    // la capa base la fijamos a ortofoto durante la exportación: las figuras del
    // paper deben salir todas sobre el mismo fondo, no sobre el que tocara.
    base: map.getLayoutProperty('osm', 'visibility') === 'visible' ? 'osm' : 'pnoa',
  }

  const files: { name: string; data: Uint8Array }[] = []

  try {
    // durante la exportación el mapa lo encuadramos nosotros
    store.getState().setFollowDrone(false)
    store.getState().setProjectFrame(false)
    store.getState().setShowOutline(false)
    store.getState().setObliqueProject(false)
    map.setLayoutProperty('pnoa', 'visibility', 'visible')
    map.setLayoutProperty('osm', 'visibility', 'none')
    // fuera todo lo que no sea la figura: las capas GCP de MapView pintan LAS
    // DOS proyecciones a la vez, y la traza compite con los puntos.
    setLayersVisible(map, NOISE_LAYERS, false)

    for (const frame of campaign.frames) {
      const dir = `frames/${frame.frame_id}`
      // el fotograma crudo, en su instante
      if (video) {
        await seekVideo(video, frame.telemetry.tv)
        const jpg = grabVideoFrame(video)
        if (jpg) files.push({ name: `${dir}/photo.jpg`, data: dataUrlToBytes(jpg) })
      }

      fitToFrame(map, frame)
      await mapIdle(map)

      for (const which of ['ortho', 'attitude'] as const) {
        // El efecto de MapView puede haber re-creado sus capas GCP (visibles por
        // defecto) al reaccionar al seek; hay que volver a apagarlas antes de
        // cada captura, no basta con hacerlo una vez al principio.
        setLayersVisible(map, NOISE_LAYERS, false)
        drawFigure(map, frame, which)
        await mapIdle(map)
        files.push({
          name: `${dir}/map_${which}.png`,
          data: dataUrlToBytes(composeFigure(map, frame, which)),
        })
      }
      clearFigure(map)
    }
  } finally {
    clearFigure(map)
    setLayersVisible(map, NOISE_LAYERS, true)
    store.getState().setProjectFrame(saved.frame)
    store.getState().setShowOutline(saved.outline)
    store.getState().setObliqueProject(saved.oblique)
    store.getState().setFollowDrone(saved.follow)
    map.setLayoutProperty('pnoa', 'visibility', saved.base === 'pnoa' ? 'visible' : 'none')
    map.setLayoutProperty('osm', 'visibility', saved.base === 'osm' ? 'visible' : 'none')
    map.easeTo({ center: saved.center, zoom: saved.zoom, duration: 0 })
    if (video) await seekVideo(video, saved.tv)
  }

  const total = campaign.frames.reduce((a, f) => a + f.points.length, 0)

  files.push({ name: 'points.csv', data: new TextEncoder().encode(campaignToCsv(campaign)) })
  files.push({
    name: 'campaign.json',
    data: new TextEncoder().encode(
      JSON.stringify({ ...campaign, exported_at: new Date().toISOString() }, null, 2),
    ),
  })

  const entries = files.map((f) => bytesEntry(f.name, f.data))
  entries.push(
    textEntry(
      'README.txt',
      t('readme', { frames: campaign.frames.length, points: total, date: new Date().toISOString() }),
    ),
  )

  const blob = buildZip(entries)
  const url = URL.createObjectURL(blob)
  const filename = `gcp_campaign_${total}pts.zip`
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return { filename, frames: campaign.frames.length }
}
