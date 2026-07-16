import { create } from 'zustand'
import {
  api,
  type LogPreview,
  type VideoInfo,
  type Position,
  type Footprint,
  type NadirThresholds,
  type AngleTuning,
  type SyncMethod,
} from './api'
import {
  decompose,
  frameIndex,
  loadCampaign,
  saveCampaign,
  clearCampaign,
  pointLabel,
  type GcpCampaign,
  type GcpPoint,
  type LngLat,
} from './sampler/gcp'

interface Params {
  fps: number
  quality: number
  min_alt_rel: number
  crs: string
  include_orientation: boolean
  prefix: string
}

interface State {
  sourceId: string | null
  log: LogPreview | null
  video: VideoInfo | null
  loading: boolean
  error: string | null

  // sincronización
  syncMethod: SyncMethod
  manualOffset: number // s
  currentTv: number // instante actual del vídeo
  duration: number // duración del vídeo (s), para topar los seeks
  videoPlaying: boolean // ¿está reproduciéndose? (para el botón play/pausa)
  videoEl: HTMLVideoElement | null // el <video> real, pilotable desde cualquier panel
  position: Position | null // dónde está el dron en currentTv

  // proyección del frame en el mapa
  projectFrame: boolean // pintar la IMAGEN del frame (solo si es cenital)
  showOutline: boolean // pintar el CONTORNO del footprint (independiente)
  obliqueProject: boolean // deformar la foto a la silueta real (trapecio)
  swapView: boolean // intercambiar grande<->pequeño (mapa/vídeo)
  followDrone: boolean // centrar el mapa en el dron y seguirlo
  measureMode: boolean // herramienta de medir distancias en el mapa
  measureDecompose: boolean // descomponer el último tramo en catetos X (E-O) e Y (N-S)
  measurePoints: [number, number][] // vértices [lng,lat] de la línea de medida
  markMode: boolean // modo 'marcar punto': click en el vídeo -> punto en el mapa
  markedPoint: { lat: number; lng: number } | null // último punto marcado
  // píxel exacto del último click en el VÍDEO (resolución nativa) — lo usa el
  // muestreo para el paper: distancia en píxeles desde el centro de la imagen.
  markedPixel: { px: number; py: number; imgW: number; imgH: number } | null
  mapHandle: import('maplibre-gl').Map | null // el mapa real, para capturas del muestreador
  footprint: Footprint | null

  // --- puntos de control (GCP) para el paper ---
  gcpMode: boolean // modo toma de puntos: foto y mapa lado a lado
  gcpCampaign: GcpCampaign // frames + puntos acumulados (persistida en localStorage)
  // Click pendiente en la FOTO, esperando su pareja en el MAPA. Lleva SU PROPIO
  // tv: el píxel pertenece al instante en que se clicó, no al que haya cuando se
  // cierre el punto. Sin esto, un vídeo en marcha o un seek entre los dos clicks
  // emparejaría el píxel con la telemetría de otro instante — y el error medido
  // sería el del desfase, no el del método.
  gcpPendingPixel: { px: number; py: number; tv: number } | null
  gcpStorageFull: boolean // localStorage lleno: la campaña ya NO se respalda
  gcpSelected: { frameId: string; pointId: string } | null // punto resaltado en foto+mapa
  gcpBusy: boolean // proyectando en el backend
  nadirThr: NadirThresholds // umbrales para decidir si proyectar (cenital)
  tuning: AngleTuning // ajuste fino manual: FOV (gran angular) y deltas de ángulos

  params: Params

  // job en curso
  jobId: string | null
  jobStatus: import('./api').JobStatus | null

  // acciones
  registerSource: (bin: string, video: string) => Promise<void>
  uploadSource: (bin: File, video: File) => Promise<void>
  setSyncMethod: (m: SyncMethod) => void
  setManualOffset: (o: number) => void
  setCurrentTv: (tv: number) => void
  registerVideoEl: (el: HTMLVideoElement | null) => void
  setDuration: (d: number) => void
  setVideoPlaying: (p: boolean) => void
  videoSeekTo: (t: number) => void // saltar a instante absoluto (s), topado a [0, duration]
  videoSeekBy: (delta: number) => void // adelantar/retroceder delta segundos
  videoTogglePlay: () => void
  refreshPosition: () => Promise<void>
  setProjectFrame: (on: boolean) => void
  setShowOutline: (on: boolean) => void
  setObliqueProject: (on: boolean) => void
  setSwapView: (on: boolean) => void
  setFollowDrone: (on: boolean) => void
  setMeasureMode: (on: boolean) => void
  setMeasureDecompose: (on: boolean) => void
  addMeasurePoint: (lng: number, lat: number) => void
  clearMeasure: () => void
  setMarkMode: (on: boolean) => void
  markPoint: (px: number, py: number, imgW: number, imgH: number) => Promise<void>
  clearMarkedPoint: () => void
  registerMap: (m: import('maplibre-gl').Map | null) => void
  refreshFootprint: () => Promise<void>
  // --- puntos de control ---
  setGcpMode: (on: boolean) => void
  gcpClickPhoto: (px: number, py: number) => void // 1º: click en la foto
  gcpClickMap: (lng: number, lat: number) => Promise<void> // 2º: click en el mapa -> cierra el punto
  gcpCancelPending: () => void
  gcpSelect: (frameId: string, pointId: string) => void
  gcpDeletePoint: (frameId: string, pointId: string) => void
  gcpDeleteFrame: (frameId: string) => void
  gcpResetCampaign: () => void
  setNadirThr: <K extends keyof NadirThresholds>(k: K, v: number) => void
  setTuning: <K extends keyof AngleTuning>(k: K, v: number) => void
  setParam: <K extends keyof Params>(k: K, v: Params[K]) => void
  launchJob: () => Promise<void>
  pollJob: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  sourceId: null,
  log: null,
  video: null,
  loading: false,
  error: null,
  syncMethod: 'takeoff',
  manualOffset: 0,
  currentTv: 0,
  duration: 0,
  videoPlaying: false,
  videoEl: null,
  position: null,
  projectFrame: false,
  showOutline: false,
  obliqueProject: false,
  swapView: false,
  followDrone: false,
  measureMode: false,
  measureDecompose: false,
  measurePoints: [],
  markMode: false,
  markedPoint: null,
  markedPixel: null,
  mapHandle: null,
  footprint: null,
  gcpMode: false,
  gcpCampaign: loadCampaign() ?? { started_at: new Date().toISOString(), source_id: null, frames: [] },
  gcpPendingPixel: null,
  gcpSelected: null,
  gcpBusy: false,
  gcpStorageFull: false,
  nadirThr: { max_pitch_dev: 15, max_roll_dev: 10, min_agl: 20 },
  tuning: { fov_scale: 1.0, d_pitch: 0, d_roll: 0 },
  params: {
    fps: 2,
    quality: 2,
    min_alt_rel: 20,
    crs: 'EPSG:4326',
    include_orientation: true,
    prefix: 'frame',
  },
  jobId: null,
  jobStatus: null,

  async registerSource(bin, video) {
    set({ loading: true, error: null })
    try {
      const { id } = await api.registerSource(bin, video)
      await loadSource(set, get, id)
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async uploadSource(bin, video) {
    set({ loading: true, error: null })
    try {
      const { id } = await api.uploadSource(bin, video)
      await loadSource(set, get, id)
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  setSyncMethod(m) {
    // al elegir despegue/creation_time, precargamos el offset sugerido cuando llegue la posición
    set({ syncMethod: m })
    get().refreshPosition()
  },

  setManualOffset(o) {
    set({ manualOffset: o })
    if (get().syncMethod === 'manual') {
      get().refreshPosition()
      if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
    }
  },

  setCurrentTv(tv) {
    set({ currentTv: tv })
    get().refreshPosition()
    if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
  },

  registerVideoEl(el) {
    set({ videoEl: el })
  },

  setDuration(d) {
    set({ duration: d })
  },

  setVideoPlaying(p) {
    set({ videoPlaying: p })
  },

  videoSeekTo(t) {
    const { videoEl, duration } = get()
    if (!videoEl) return
    const max = duration || videoEl.duration || 0
    videoEl.currentTime = Math.min(Math.max(t, 0), max || t)
    // el listener 'seeked' del VideoPanel actualizará currentTv
  },

  videoSeekBy(delta) {
    const { videoEl } = get()
    if (!videoEl) return
    get().videoSeekTo(videoEl.currentTime + delta)
  },

  videoTogglePlay() {
    const { videoEl } = get()
    if (!videoEl) return
    if (videoEl.paused) videoEl.play()
    else videoEl.pause()
  },

  async refreshPosition() {
    const { sourceId, currentTv, syncMethod, manualOffset } = get()
    if (!sourceId) return
    try {
      const pos = await api.position(sourceId, currentTv, syncMethod, manualOffset)
      set({ position: pos })
      // si el método es automático y el usuario aún no tocó el manual, sincronizamos
      // el valor del slider manual con el offset calculado (para poder afinar desde ahí)
      if (syncMethod !== 'manual') {
        set({ manualOffset: pos.video_start_trel })
      }
    } catch (e) {
      set({ error: String(e) })
    }
  },

  setProjectFrame(on) {
    set({ projectFrame: on })
    // el footprint hace falta si CUALQUIER capa de proyección está activa
    if (on || get().showOutline || get().obliqueProject) get().refreshFootprint()
    else set({ footprint: null })
  },

  setShowOutline(on) {
    set({ showOutline: on })
    if (on || get().projectFrame || get().obliqueProject) get().refreshFootprint()
    else set({ footprint: null })
  },

  setObliqueProject(on) {
    set({ obliqueProject: on })
    if (on || get().projectFrame || get().showOutline) get().refreshFootprint()
    else set({ footprint: null })
  },

  setSwapView(on) {
    // al pasar a vídeo grande (mapa pequeño), seguir al dron automáticamente
    set({ swapView: on, ...(on ? { followDrone: true } : {}) })
  },

  setFollowDrone(on) {
    set({ followDrone: on })
  },

  setMeasureMode(on) {
    set({ measureMode: on, ...(on ? {} : { measurePoints: [] }) })
  },

  setMeasureDecompose(on) {
    set({ measureDecompose: on })
  },

  addMeasurePoint(lng, lat) {
    set({ measurePoints: [...get().measurePoints, [lng, lat]] })
  },

  clearMeasure() {
    set({ measurePoints: [] })
  },

  setMarkMode(on) {
    set({ markMode: on })
    if (!on) set({ markedPoint: null })
  },

  async markPoint(px, py, imgW, imgH) {
    const { sourceId, currentTv, syncMethod, manualOffset, tuning } = get()
    if (!sourceId) return
    try {
      const r = await api.projectPoint(
        sourceId, currentTv, px, py, imgW, imgH, syncMethod, manualOffset, tuning,
      )
      // guardamos también el píxel del click (para el muestreo del paper),
      // incluso si el backend no pudo proyectar: el offset en píxeles es válido igual.
      set({ markedPixel: { px, py, imgW, imgH } })
      if (r.valid) set({ markedPoint: { lat: r.lat, lng: r.lng } })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  clearMarkedPoint() {
    set({ markedPoint: null, markedPixel: null })
  },

  registerMap(m) {
    set({ mapHandle: m })
  },

  async refreshFootprint() {
    const { sourceId, currentTv, syncMethod, manualOffset, nadirThr, tuning } = get()
    if (!sourceId) return
    try {
      const fp = await api.footprint(sourceId, currentTv, syncMethod, manualOffset, nadirThr, tuning)
      set({ footprint: fp })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  // ---------- puntos de control (GCP) ----------

  setGcpMode(on) {
    // el footprint es imprescindible: de ahí salen los ángulos y el AGL que
    // acompañan a cada punto.
    set({ gcpMode: on, gcpPendingPixel: null, gcpSelected: null })
    if (on && !get().footprint) get().refreshFootprint()
  },

  gcpClickPhoto(px, py) {
    const { videoEl, currentTv } = get()
    // Congelamos el instrumento: el vídeo se para y el píxel queda atado al
    // instante EXACTO del elemento <video> (currentTv va throttled a 150 ms y
    // puede ir por detrás de lo que se ve en pantalla).
    videoEl?.pause()
    const tv = videoEl ? videoEl.currentTime : currentTv
    set({ gcpPendingPixel: { px, py, tv }, gcpSelected: null })
  },

  gcpCancelPending() {
    set({ gcpPendingPixel: null })
  },

  async gcpClickMap(lng, lat) {
    const s = get()
    const pending = s.gcpPendingPixel
    if (!pending || !s.sourceId) return
    const video = s.video
    if (!video) {
      set({ error: 'Sin información del vídeo: no se puede tomar el punto.' })
      return
    }
    // el vídeo no puede haberse movido desde que se marcó el píxel
    const now = s.videoEl?.currentTime ?? pending.tv
    if (Math.abs(now - pending.tv) > 1e-3) {
      set({
        error: `El vídeo se movió (${pending.tv.toFixed(3)}s → ${now.toFixed(3)}s): punto descartado. Vuelve a marcarlo.`,
        gcpPendingPixel: null,
      })
      return
    }

    set({ gcpBusy: true })
    try {
      const { px, py, tv } = pending
      const imgW = video.width
      const imgH = video.height
      // TODO para el MISMO tv anclado, en una sola tanda: la telemetría se pide
      // aquí en vez de leerla del store porque el store sólo refresca el
      // footprint si hay capas de proyección activas (en modo GCP están
      // apagadas), y porque position/footprint pueden venir de instantes
      // distintos si el usuario ha estado moviendo el vídeo.
      const [pos, fp, orthoR, attR] = await Promise.all([
        api.position(s.sourceId, tv, s.syncMethod, s.manualOffset),
        api.footprint(s.sourceId, tv, s.syncMethod, s.manualOffset, s.nadirThr, s.tuning),
        api.projectPoint(s.sourceId, tv, px, py, imgW, imgH, s.syncMethod, s.manualOffset, s.tuning, true),
        api.projectPoint(s.sourceId, tv, px, py, imgW, imgH, s.syncMethod, s.manualOffset, s.tuning, false),
      ])
      const ortho: LngLat | null = orthoR.valid ? { lng: orthoR.lng, lat: orthoR.lat } : null
      const attitude: LngLat | null = attR.valid ? { lng: attR.lng, lat: attR.lat } : null

      const truth: LngLat = { lng, lat }
      const nadir: LngLat = { lng: pos.lng, lat: pos.lat }
      const map = s.mapHandle

      const point: GcpPoint = {
        id: '', // se asigna al insertar, según cuántos haya ya en el frame
        px,
        py,
        offset_px: { x: px - imgW / 2, y: py - imgH / 2, norm: Math.hypot(px - imgW / 2, py - imgH / 2) },
        truth,
        map_zoom: map ? map.getZoom() : 0,
        ortho,
        attitude,
        // el error es proyección -> verdad: hacia dónde y cuánto se equivoca
        err_ortho: ortho ? decompose(ortho, truth) : null,
        err_attitude: attitude ? decompose(attitude, truth) : null,
        truth_from_nadir: decompose(nadir, truth),
      }

      // Un frame por FOTOGRAMA (índice), no por marca de tiempo: a 30 fps un
      // fotograma dura 33 ms, así que dos clicks sobre la MISMA imagen pueden
      // dar tv distintos y partirían el frame en dos.
      const campaign = { ...s.gcpCampaign, source_id: s.sourceId }
      const frames = [...campaign.frames]
      const fi = frameIndex(tv, video.fps)
      let idx = frames.findIndex((f) => f.telemetry.frame_index === fi)
      if (idx < 0) {
        frames.push({
          frame_id: `f${fi}`, // estable: no colisiona al borrar frames
          telemetry: {
            tv,
            frame_index: fi,
            imgW,
            imgH,
            drone: nadir,
            alt_msl: pos.alt,
            agl: fp.agl,
            pitch: fp.pitch,
            roll: fp.roll,
            yaw: fp.yaw,
            drone_pitch: fp.drone_pitch,
            flight_direction_deg: pos.yaw,
            has_gimbal: fp.has_gimbal,
            nadir_ok: fp.nadir_ok,
            reason: fp.reason,
            fov_scale: s.tuning.fov_scale,
            d_pitch: s.tuning.d_pitch,
            d_roll: s.tuning.d_roll,
            sync_method: s.syncMethod,
            sync_offset: s.manualOffset,
          },
          points: [],
        })
        idx = frames.length - 1
      }
      const frame = frames[idx]
      point.id = pointLabel(frame.points.length)
      frames[idx] = { ...frame, points: [...frame.points, point] }

      const next = { ...campaign, frames }
      set({
        gcpCampaign: next,
        gcpPendingPixel: null,
        gcpSelected: { frameId: frames[idx].frame_id, pointId: point.id },
        gcpStorageFull: !saveCampaign(next),
      })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ gcpBusy: false })
    }
  },

  gcpSelect(frameId, pointId) {
    set({ gcpSelected: { frameId, pointId } })
  },

  gcpDeletePoint(frameId, pointId) {
    const c = get().gcpCampaign
    const frames = c.frames
      .map((f) =>
        f.frame_id === frameId ? { ...f, points: f.points.filter((p) => p.id !== pointId) } : f,
      )
      .filter((f) => f.points.length > 0) // un frame sin puntos no aporta nada
    const next = { ...c, frames }
    const sel = get().gcpSelected
    set({
      gcpCampaign: next,
      gcpSelected: sel && sel.frameId === frameId && sel.pointId === pointId ? null : sel,
      gcpStorageFull: !saveCampaign(next),
    })
  },

  gcpDeleteFrame(frameId) {
    const c = get().gcpCampaign
    const next = { ...c, frames: c.frames.filter((f) => f.frame_id !== frameId) }
    const sel = get().gcpSelected
    set({
      gcpCampaign: next,
      gcpSelected: sel?.frameId === frameId ? null : sel,
      gcpStorageFull: !saveCampaign(next),
    })
  },

  gcpResetCampaign() {
    clearCampaign()
    set({
      gcpCampaign: { started_at: new Date().toISOString(), source_id: get().sourceId, frames: [] },
      gcpPendingPixel: null,
      gcpSelected: null,
      gcpStorageFull: false,
    })
  },

  setNadirThr(k, v) {
    set({ nadirThr: { ...get().nadirThr, [k]: v } })
    if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
  },

  setTuning(k, v) {
    set({ tuning: { ...get().tuning, [k]: v } })
    if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
  },

  setParam(k, v) {
    set({ params: { ...get().params, [k]: v } })
  },

  async launchJob() {
    const { sourceId, params, syncMethod, manualOffset } = get()
    if (!sourceId) return
    set({ error: null })
    try {
      const { job_id } = await api.createJob({
        source_id: sourceId,
        ...params,
        sync_method: syncMethod,
        manual_offset_s: manualOffset,
      })
      set({ jobId: job_id, jobStatus: null })
      get().pollJob()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  async pollJob() {
    const { jobId } = get()
    if (!jobId) return
    const status = await api.job(jobId)
    set({ jobStatus: status })
    if (status.status === 'running' || status.status === 'pending') {
      setTimeout(() => get().pollJob(), 800)
    }
  },
}))

async function loadSource(
  set: (partial: Partial<State>) => void,
  get: () => State,
  id: string,
) {
  const [log, video] = await Promise.all([api.log(id), api.videoInfo(id)])
  set({ sourceId: id, log, video, loading: false, currentTv: 0 })
  // método por defecto: creation_time si el vídeo lo tiene y no está recodificado; si no, takeoff
  const method: SyncMethod =
    video.creation_time && !video.is_reencoded ? 'creation_time' : 'takeoff'
  set({ syncMethod: method })
  await get().refreshPosition()
}
