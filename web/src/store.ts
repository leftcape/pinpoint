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
  type TerrainSource,
} from './api'
import {
  activeFov,
  altFov,
  decompose,
  defaultConfig,
  frameIndex,
  loadCampaign,
  migrateCampaign,
  newCampaign,
  pointLabel,
  saveCampaign,
  solveFovFromPairs,
  type AltProjection,
  type CampaignConfig,
  type FovKind,
  type FovPair,
  type GcpCampaign,
  type GcpFrame,
  type GcpPoint,
  type LngLat,
} from './sampler/gcp'
import { t } from './i18n'

export type SaveState = 'idle' | 'saving' | 'saved' | 'local-only' | 'error'

export interface FovPairResult {
  fov_h_deg: number
  gsd: number
  residual_pct: number
  n_dist: number
  tv: number
  agl: number
  nadir_ok: boolean
  terrain_source: string
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

  // --- FOV visual ---
  // Modo "a ojo": la huella queda clavada al nadir y sólo escala con el FOV; la
  // foto se pinta encima del plano y se ajusta hasta que casa con la ortofoto.
  fovCalibMode: boolean
  // Modo "por pares": foto y mapa lado a lado; cada par foto↔mapa es un rasgo
  // reconocible; el FOV se RESUELVE de las distancias entre pares.
  fovPairMode: boolean
  fovPairPending: { px: number; py: number; tv: number } | null
  fovPairs: FovPair[]
  fovPairTv: number | null // frame al que pertenecen los pares (todos en el mismo)
  fovPairResult: FovPairResult | null

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
  markedPixel: { px: number; py: number; imgW: number; imgH: number } | null
  mapHandle: import('maplibre-gl').Map | null // el mapa real, para capturas del muestreador
  footprint: Footprint | null

  // --- puntos de control (GCP) para el paper ---
  gcpMode: boolean // modo toma de puntos: foto y mapa lado a lado
  // Dentro del modo GCP: ¿estamos MARCANDO en este frame? Si true, el overlay
  // captura los clicks del vídeo (no se puede mover). Si false, el vídeo es
  // libre (mover la barra, saltar de frame). Se cierra con "terminar frame".
  gcpMarking: boolean
  gcpCampaign: GcpCampaign // config + frames + puntos (localStorage + servidor)
  // Click pendiente en la FOTO, esperando su pareja en el MAPA. Lleva SU PROPIO
  // tv: el píxel pertenece al instante en que se clicó, no al que haya cuando se
  // cierre el punto.
  gcpPendingPixel: { px: number; py: number; tv: number } | null
  gcpStorageFull: boolean // localStorage lleno: la campaña ya NO se respalda en local
  gcpSaveState: SaveState // estado del respaldo en el servidor
  gcpSelected: { frameId: string; pointId: string } | null // punto resaltado en foto+mapa
  gcpBusy: boolean // proyectando en el backend
  nadirThr: NadirThresholds // umbrales para decidir si proyectar (cenital)
  // Parámetros EFECTIVOS de proyección. fov_h es el FOV ACTIVO de la campaña
  // (sfm o visual); se mantiene sincronizado con gcpCampaign.config.
  tuning: AngleTuning
  terrain: TerrainSource // modelo del terreno para el AGL: flat | ign | cop
  terrainEffective: TerrainSource | null // la fuente que el backend usó de verdad

  // acciones
  registerSource: (bin: string, video: string) => Promise<void>
  uploadSource: (bin: File, video: File) => Promise<void>
  openSource: (id: string) => Promise<void> // un vuelo ya registrado en el servidor
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
  // --- configuración de campaña / FOV ---
  setLocked: (on: boolean) => void
  setFovActive: (k: FovKind) => void
  setFovSfm: (fov_h: number, focal_norm: number | null, source: string) => void
  setFovVisualSlider: (fov_h: number) => void // a ojo, en el frame actual
  clearFovVisual: () => void
  setFovCalibMode: (on: boolean) => void
  setFovPairMode: (on: boolean) => void
  fovPairClickPhoto: (px: number, py: number) => void
  fovPairClickMap: (lng: number, lat: number) => void
  fovPairCancelPending: () => void
  fovPairRemove: (id: string) => void
  fovPairClear: () => void
  fovPairSolve: () => Promise<void>
  fovPairApply: () => void
  // --- puntos de control ---
  setGcpMode: (on: boolean) => void
  gcpStartMarking: () => void // empezar a marcar en el frame actual (activa el overlay)
  gcpStopMarking: () => void // terminar este frame (libera el vídeo para moverse)
  gcpClickPhoto: (px: number, py: number) => void // 1º: click en la foto
  gcpClickMap: (lng: number, lat: number) => Promise<void> // 2º: click en el mapa -> cierra el punto
  gcpCancelPending: () => void
  gcpSelect: (frameId: string, pointId: string) => void
  gcpDeletePoint: (frameId: string, pointId: string) => void
  gcpDeleteFrame: (frameId: string) => void
  gcpResetPoints: () => void // borra los puntos, conserva la configuración
  gcpImport: (raw: unknown, mode: 'replace' | 'merge') => string // devuelve un resumen
  gcpSaveNow: () => Promise<void>
  setNadirThr: <K extends keyof NadirThresholds>(k: K, v: number) => void
  setTuning: <K extends keyof AngleTuning>(k: K, v: number) => void
  setTerrain: (t: TerrainSource) => void
}

// Respaldo en el servidor con retardo: cada click no puede ser un PUT.
let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => {
  // ---- helpers internos (no forman parte del State) ----

  // Persiste la campaña: estado + localStorage ahora, servidor con retardo.
  const persist = (next: GcpCampaign) => {
    const stamped = { ...next, updated_at: new Date().toISOString() }
    set({ gcpCampaign: stamped, gcpStorageFull: !saveCampaign(stamped) })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void get().gcpSaveNow(), 800)
  }

  // Vuelca los parámetros de la configuración al estado efectivo de la app.
  const applyConfig = (cfg: CampaignConfig) => {
    set({
      syncMethod: cfg.sync.method,
      manualOffset: cfg.sync.offset_s,
      tuning: { fov_h: activeFov(cfg), aspect: cfg.fov.aspect, d_pitch: cfg.d_pitch, d_roll: cfg.d_roll },
      terrain: cfg.terrain,
    })
  }

  // Copia el estado efectivo (sync, deltas, terreno) a la configuración y guarda.
  // El FOV va aparte (setFov*), porque son dos valores y no uno.
  const syncConfigFromState = () => {
    const s = get()
    const c = s.gcpCampaign
    if (c.config.locked) return
    const cfg: CampaignConfig = {
      ...c.config,
      sync: { method: s.syncMethod, offset_s: s.manualOffset },
      terrain: s.terrain,
      d_pitch: s.tuning.d_pitch,
      d_roll: s.tuning.d_roll,
      fov: { ...c.config.fov, aspect: s.tuning.aspect },
    }
    persist({ ...c, config: cfg })
  }

  const updateFov = (mut: (f: CampaignConfig['fov']) => CampaignConfig['fov']) => {
    const c = get().gcpCampaign
    const cfg = { ...c.config, fov: mut(c.config.fov) }
    persist({ ...c, config: cfg })
    set({ tuning: { ...get().tuning, fov_h: activeFov(cfg) } })
    if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
  }

  return {
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
    fovCalibMode: false,
    fovPairMode: false,
    fovPairPending: null,
    fovPairs: [],
    fovPairTv: null,
    fovPairResult: null,
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
    gcpMarking: false,
    gcpCampaign: loadCampaign() ?? newCampaign(null, null, null, defaultConfig()),
    gcpPendingPixel: null,
    gcpStorageFull: false,
    gcpSaveState: 'idle',
    gcpSelected: null,
    gcpBusy: false,
    nadirThr: { max_pitch_dev: 15, max_roll_dev: 10, min_agl: 20 },
    tuning: { fov_h: defaultConfig().fov.sfm.fov_h_deg, aspect: 16 / 9, d_pitch: 0, d_roll: 0 },
    terrain: 'flat',
    terrainEffective: null,

    async registerSource(bin, video) {
      set({ loading: true, error: null })
      try {
        const { id } = await api.registerSource(bin, video)
        await loadSource(set, get, applyConfig, id)
      } catch (e) {
        set({ error: String(e), loading: false })
      }
    },

    async uploadSource(bin, video) {
      set({ loading: true, error: null })
      try {
        const { id } = await api.uploadSource(bin, video)
        await loadSource(set, get, applyConfig, id)
      } catch (e) {
        set({ error: String(e), loading: false })
      }
    },

    async openSource(id) {
      set({ loading: true, error: null })
      try {
        await loadSource(set, get, applyConfig, id)
      } catch (e) {
        set({ error: String(e), loading: false })
      }
    },

    setSyncMethod(m) {
      if (get().gcpCampaign.config.locked) return
      // al elegir despegue/creation_time, precargamos el offset sugerido cuando llegue la posición
      set({ syncMethod: m })
      get().refreshPosition()
      syncConfigFromState()
    },

    setManualOffset(o) {
      if (get().gcpCampaign.config.locked) return
      set({ manualOffset: o })
      if (get().syncMethod === 'manual') {
        get().refreshPosition()
        if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
      }
      syncConfigFromState()
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
        // si el método es automático, el slider manual sigue al offset calculado
        // (para poder afinar desde ahí) y la configuración lo registra.
        if (syncMethod !== 'manual' && Math.abs(get().manualOffset - pos.video_start_trel) > 1e-6) {
          set({ manualOffset: pos.video_start_trel })
          syncConfigFromState()
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
      const { sourceId, currentTv, syncMethod, manualOffset, tuning, terrain } = get()
      if (!sourceId) return
      try {
        const r = await api.projectPoint(
          sourceId, currentTv, px, py, imgW, imgH, syncMethod, manualOffset, tuning, false, terrain,
        )
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
      const { sourceId, currentTv, syncMethod, manualOffset, nadirThr, tuning, terrain } = get()
      if (!sourceId) return
      try {
        const fp = await api.footprint(sourceId, currentTv, syncMethod, manualOffset, nadirThr, tuning, terrain)
        set({ footprint: fp, terrainEffective: (fp.terrain_source as TerrainSource) ?? null })
      } catch (e) {
        set({ error: String(e) })
      }
    },

    // ---------- configuración de campaña / FOV ----------

    setLocked(on) {
      const c = get().gcpCampaign
      persist({ ...c, config: { ...c.config, locked: on } })
    },

    setFovActive(k) {
      if (get().gcpCampaign.config.locked) return
      updateFov((f) => (k === 'visual' && !f.visual ? f : { ...f, active: k }))
    },

    setFovSfm(fov_h, focal_norm, source) {
      if (get().gcpCampaign.config.locked) return
      updateFov((f) => ({ ...f, sfm: { fov_h_deg: fov_h, focal_norm, source } }))
    },

    setFovVisualSlider(fov_h) {
      if (get().gcpCampaign.config.locked) return
      const s = get()
      updateFov((f) => ({
        ...f,
        active: 'visual',
        visual: {
          fov_h_deg: fov_h,
          method: 'slider',
          frame_tv: s.currentTv,
          agl_m: s.footprint?.agl ?? null,
          terrain_source: s.terrainEffective ?? s.terrain,
          pairs: [],
          gsd_m_px: null,
          residual_pct: null,
          date: new Date().toISOString(),
          note: t('fov.noteSlider'),
        },
      }))
    },

    clearFovVisual() {
      if (get().gcpCampaign.config.locked) return
      updateFov((f) => ({ ...f, active: 'sfm', visual: null }))
    },

    setFovCalibMode(on) {
      if (on) {
        // a ojo: mapa grande (para ver el encaje), foto proyectada encima del
        // plano, vídeo pausado en el frame que se calibra. La huella nadir escala
        // con tuning.fov_h, así que ajustar el FOV mueve la escala de la huella.
        get().videoEl?.pause()
        set({ fovCalibMode: true, fovPairMode: false, projectFrame: true, obliqueProject: false, swapView: false })
        get().refreshFootprint()
      } else {
        set({ fovCalibMode: false, projectFrame: false })
        if (!get().showOutline && !get().obliqueProject) set({ footprint: null })
      }
    },

    setFovPairMode(on) {
      get().videoEl?.pause()
      set({
        fovPairMode: on,
        fovCalibMode: false,
        fovPairPending: null,
        ...(on ? {} : { fovPairs: [], fovPairTv: null, fovPairResult: null }),
      })
      if (on && !get().footprint) get().refreshFootprint()
    },

    fovPairClickPhoto(px, py) {
      const { videoEl, currentTv, fovPairs, fovPairTv } = get()
      videoEl?.pause()
      const tv = videoEl ? videoEl.currentTime : currentTv
      // todos los pares de una resolución van en el MISMO frame
      if (fovPairs.length > 0 && fovPairTv !== null && Math.abs(tv - fovPairTv) > 1e-3) {
        set({ error: t('err.pairsSameFrame') })
        return
      }
      set({ fovPairPending: { px, py, tv } })
    },

    fovPairClickMap(lng, lat) {
      const { fovPairPending, fovPairs } = get()
      if (!fovPairPending) return
      const pair: FovPair = { id: pointLabel(fovPairs.length), px: fovPairPending.px, py: fovPairPending.py, lng, lat }
      set({ fovPairs: [...fovPairs, pair], fovPairTv: fovPairPending.tv, fovPairPending: null, fovPairResult: null })
    },

    fovPairCancelPending() {
      set({ fovPairPending: null })
    },

    fovPairRemove(id) {
      const rest = get().fovPairs.filter((p) => p.id !== id).map((p, i) => ({ ...p, id: pointLabel(i) }))
      set({ fovPairs: rest, fovPairResult: null, ...(rest.length ? {} : { fovPairTv: null }) })
    },

    fovPairClear() {
      set({ fovPairs: [], fovPairTv: null, fovPairPending: null, fovPairResult: null })
    },

    async fovPairSolve() {
      const s = get()
      if (!s.sourceId || !s.video || s.fovPairTv === null || s.fovPairs.length < 2) return
      try {
        // AGL del frame con el terreno elegido: es el otro dato de la ecuación
        const fp = await api.footprint(s.sourceId, s.fovPairTv, s.syncMethod, s.manualOffset, s.nadirThr, s.tuning, s.terrain)
        const r = solveFovFromPairs(s.fovPairs, s.video.width, fp.agl)
        if (!r) {
          set({ error: t('err.fovSolve') })
          return
        }
        set({
          fovPairResult: {
            ...r,
            tv: s.fovPairTv,
            agl: fp.agl,
            nadir_ok: fp.nadir_ok,
            terrain_source: (fp.terrain_source as string) ?? 'flat',
          },
        })
      } catch (e) {
        set({ error: String(e) })
      }
    },

    fovPairApply() {
      const { fovPairResult: r, fovPairs } = get()
      if (!r || get().gcpCampaign.config.locked) return
      updateFov((f) => ({
        ...f,
        active: 'visual',
        visual: {
          fov_h_deg: r.fov_h_deg,
          method: 'pairs',
          frame_tv: r.tv,
          agl_m: r.agl,
          terrain_source: r.terrain_source,
          pairs: fovPairs,
          gsd_m_px: r.gsd,
          residual_pct: r.residual_pct,
          date: new Date().toISOString(),
          note: t('fov.notePairs', { n: fovPairs.length, d: r.n_dist }) + (r.nadir_ok ? '' : t('fov.notePairsOff')),
        },
      }))
    },

    // ---------- puntos de control (GCP) ----------

    setGcpMode(on) {
      // el footprint es imprescindible: de ahí salen los ángulos y el AGL que
      // acompañan a cada punto.
      set({ gcpMode: on, gcpMarking: false, gcpPendingPixel: null, gcpSelected: null, fovPairMode: false, fovCalibMode: false })
      if (on && !get().footprint) get().refreshFootprint()
    },

    gcpStartMarking() {
      // pausar el vídeo al empezar: el frame que se marca es el que se ve.
      get().videoEl?.pause()
      set({ gcpMarking: true, gcpSelected: null })
    },

    gcpStopMarking() {
      set({ gcpMarking: false, gcpPendingPixel: null })
    },

    gcpClickPhoto(px, py) {
      const { videoEl, currentTv } = get()
      // Congelamos el instrumento: el vídeo se para y el píxel queda atado al
      // instante EXACTO del elemento <video> (currentTv va throttled a 150 ms).
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
        set({ error: t('err.noVideoInfo') })
        return
      }
      // el vídeo no puede haberse movido desde que se marcó el píxel
      const now = s.videoEl?.currentTime ?? pending.tv
      if (Math.abs(now - pending.tv) > 1e-3) {
        set({
          error: t('err.videoMoved', { a: pending.tv.toFixed(3), b: now.toFixed(3) }),
          gcpPendingPixel: null,
        })
        return
      }

      set({ gcpBusy: true })
      try {
        const { px, py, tv } = pending
        const imgW = video.width
        const imgH = video.height
        const cfg = s.gcpCampaign.config
        const alt = altFov(cfg)
        const altTuning: AngleTuning | null = alt ? { ...s.tuning, fov_h: alt.fov_h } : null
        const proj = (t: AngleTuning, ortho: boolean) =>
          api.projectPoint(s.sourceId!, tv, px, py, imgW, imgH, s.syncMethod, s.manualOffset, t, ortho, s.terrain)
        // Todo para el MISMO tv anclado, en una sola tanda.
        const [pos, fp, orthoR, attR, altOrthoR, altAttR] = await Promise.all([
          api.position(s.sourceId, tv, s.syncMethod, s.manualOffset),
          api.footprint(s.sourceId, tv, s.syncMethod, s.manualOffset, s.nadirThr, s.tuning, s.terrain),
          proj(s.tuning, true),
          proj(s.tuning, false),
          altTuning ? proj(altTuning, true) : Promise.resolve(null),
          altTuning ? proj(altTuning, false) : Promise.resolve(null),
        ])
        const toLL = (r: { valid: boolean; lat: number; lng: number } | null): LngLat | null =>
          r && r.valid ? { lng: r.lng, lat: r.lat } : null
        const ortho = toLL(orthoR)
        const attitude = toLL(attR)
        const truth: LngLat = { lng, lat }
        const nadir: LngLat = { lng: pos.lng, lat: pos.lat }
        const map = s.mapHandle

        let altProj: AltProjection | null = null
        if (alt) {
          const ao = toLL(altOrthoR)
          const aa = toLL(altAttR)
          altProj = {
            fov_kind: alt.kind,
            fov_h: alt.fov_h,
            ortho: ao,
            attitude: aa,
            err_ortho: ao ? decompose(ao, truth) : null,
            err_attitude: aa ? decompose(aa, truth) : null,
          }
        }

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
          alt: altProj,
        }

        // Un frame por FOTOGRAMA (índice), no por marca de tiempo.
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
              fov_kind: cfg.fov.active,
              fov_h: s.tuning.fov_h,
              aspect: s.tuning.aspect,
              d_pitch: s.tuning.d_pitch,
              d_roll: s.tuning.d_roll,
              sync_method: s.syncMethod,
              sync_offset: s.manualOffset,
              terrain_source: (fp.terrain_source as string) ?? 'flat',
            },
            points: [],
          })
          idx = frames.length - 1
        }
        const frame = frames[idx]
        point.id = pointLabel(frame.points.length)
        frames[idx] = { ...frame, points: [...frame.points, point] }

        persist({ ...campaign, frames })
        set({
          gcpPendingPixel: null,
          gcpSelected: { frameId: frames[idx].frame_id, pointId: point.id },
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
      const sel = get().gcpSelected
      persist({ ...c, frames })
      set({ gcpSelected: sel && sel.frameId === frameId && sel.pointId === pointId ? null : sel })
    },

    gcpDeleteFrame(frameId) {
      const c = get().gcpCampaign
      const sel = get().gcpSelected
      persist({ ...c, frames: c.frames.filter((f) => f.frame_id !== frameId) })
      set({ gcpSelected: sel?.frameId === frameId ? null : sel })
    },

    gcpResetPoints() {
      const c = get().gcpCampaign
      persist({ ...c, frames: [], started_at: new Date().toISOString() })
      set({ gcpPendingPixel: null, gcpSelected: null })
    },

    gcpImport(raw, mode) {
      const inc = migrateCampaign(raw)
      if (!inc) return t('imp.notCampaign')
      const cur = get().gcpCampaign
      const warn =
        inc.source_key && cur.source_key && inc.source_key !== cur.source_key
          ? t('imp.otherFlight')
          : ''
      let next: GcpCampaign
      if (mode === 'replace' || cur.frames.length === 0) {
        next = { ...inc, source_id: cur.source_id, source_key: cur.source_key ?? inc.source_key, source_label: cur.source_label ?? inc.source_label }
        applyConfig(next.config)
      } else {
        // fusionar por fotograma: los frames nuevos se añaden; los que ya existen
        // se conservan (no se duplican puntos). La configuración actual manda.
        const have = new Set(cur.frames.map((f) => f.telemetry.frame_index))
        const add: GcpFrame[] = inc.frames.filter((f) => !have.has(f.telemetry.frame_index))
        next = { ...cur, frames: [...cur.frames, ...add] }
      }
      persist(next)
      set({ gcpSelected: null, gcpPendingPixel: null })
      const pts = next.frames.reduce((a, f) => a + f.points.length, 0)
      return t('imp.summary', { f: next.frames.length, p: pts }) + warn
    },

    async gcpSaveNow() {
      const { sourceId, gcpCampaign } = get()
      if (!sourceId) {
        set({ gcpSaveState: 'local-only' })
        return
      }
      set({ gcpSaveState: 'saving' })
      try {
        await api.campaignPut(sourceId, gcpCampaign)
        set({ gcpSaveState: 'saved' })
      } catch {
        set({ gcpSaveState: 'error' })
      }
    },

    setNadirThr(k, v) {
      set({ nadirThr: { ...get().nadirThr, [k]: v } })
      if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
    },

    setTuning(k, v) {
      if (get().gcpCampaign.config.locked) return
      // fov_h NO se toca por aquí: es el activo de la campaña (setFov*).
      if (k === 'fov_h') return
      set({ tuning: { ...get().tuning, [k]: v } })
      if (get().projectFrame || get().showOutline || get().obliqueProject) get().refreshFootprint()
      syncConfigFromState()
    },

    setTerrain(t) {
      if (get().gcpCampaign.config.locked) return
      set({ terrain: t })
      // refrescar el footprint para que el AGL (y la fuente efectiva) se actualicen
      if (get().sourceId) get().refreshFootprint()
      syncConfigFromState()
    },
  }
})

async function loadSource(
  set: (partial: Partial<State>) => void,
  get: () => State,
  applyConfig: (cfg: CampaignConfig) => void,
  id: string,
) {
  const [log, video] = await Promise.all([api.log(id), api.videoInfo(id)])
  set({ sourceId: id, log, video, loading: false, currentTv: 0 })

  const aspect = video.width && video.height ? video.width / video.height : 16 / 9
  // método por defecto: creation_time si el vídeo lo tiene y no está recodificado; si no, takeoff
  const method: SyncMethod =
    video.creation_time && !video.is_reencoded ? 'creation_time' : 'takeoff'
  const key = log.source_key ?? null
  const label = log.source_label ?? null

  // La campaña de ESTE vuelo: primero la del servidor (respaldo compartido),
  // si no, la local si es del mismo vuelo; si no, una nueva.
  let campaign: GcpCampaign | null = null
  try {
    const remote = await api.campaignGet(id)
    if (remote) campaign = migrateCampaign(remote)
  } catch {
    /* sin servidor de campañas: seguimos con la local */
  }
  if (!campaign) {
    const local = loadCampaign()
    if (local && (local.source_key === key || (!local.source_key && local.frames.length > 0))) campaign = local
  }
  if (!campaign) campaign = newCampaign(id, key, label, defaultConfig(aspect, method))
  campaign = { ...campaign, source_id: id, source_key: key, source_label: label }
  if (!campaign.config.fov.aspect) campaign.config.fov.aspect = aspect

  set({ gcpCampaign: campaign, gcpStorageFull: !saveCampaign(campaign), gcpSelected: null })
  applyConfig(campaign.config)
  await get().refreshPosition()
  void get().gcpSaveNow()
}
