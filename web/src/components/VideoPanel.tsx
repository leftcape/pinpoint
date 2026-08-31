import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { frameIndex } from '../sampler/gcp'
import { useT } from '../i18n'

// Video preview + scrubber. Moving the video updates currentTv in the store, so
// the map moves the drone marker. When markMode is on, clicking the video
// projects that pixel to the ground and drops a point on the map.
// It always fills its parent (used both as big background and small PiP).
export function VideoPanel({ large: _large = false }: { large?: boolean }) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const sourceId = useStore((s) => s.sourceId)
  const setCurrentTv = useStore((s) => s.setCurrentTv)
  const registerVideoEl = useStore((s) => s.registerVideoEl)
  const setDuration = useStore((s) => s.setDuration)
  const setVideoPlaying = useStore((s) => s.setVideoPlaying)
  const markMode = useStore((s) => s.markMode)
  const markPoint = useStore((s) => s.markPoint)
  const gcpMode = useStore((s) => s.gcpMode)
  const gcpMarking = useStore((s) => s.gcpMarking)
  const gcpClickPhoto = useStore((s) => s.gcpClickPhoto)
  const gcpPendingPixel = useStore((s) => s.gcpPendingPixel)
  const gcpCampaign = useStore((s) => s.gcpCampaign)
  const gcpSelected = useStore((s) => s.gcpSelected)
  const currentTv = useStore((s) => s.currentTv)
  const video = useStore((s) => s.video)
  const fovPairMode = useStore((s) => s.fovPairMode)
  const fovPairClickPhoto = useStore((s) => s.fovPairClickPhoto)
  const fovPairPending = useStore((s) => s.fovPairPending)
  const fovPairs = useStore((s) => s.fovPairs)

  const lastSent = useRef(0)
  // lupa: posición del cursor sobre la imagen mostrada, en px de pantalla
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    // exponer el <video> al store para que la pestaña Flight lo pueda pilotar
    registerVideoEl(v)
    const onTime = () => {
      const now = performance.now()
      if (now - lastSent.current > 150) {
        lastSent.current = now
        setCurrentTv(v.currentTime)
      }
    }
    const onSeeked = () => setCurrentTv(v.currentTime)
    const onMeta = () => setDuration(v.duration || 0)
    const onPlay = () => setVideoPlaying(true)
    const onPause = () => setVideoPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    if (v.readyState >= 1) setDuration(v.duration || 0) // ya cargado
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      registerVideoEl(null)
    }
  }, [setCurrentTv, registerVideoEl, setDuration, setVideoPlaying])

  if (!sourceId) return null

  // Caja real de la imagen dentro del elemento (object-contain deja bandas) y
  // conversión pantalla <-> píxel nativo. Base de los clicks y de los overlays.
  const imageBox = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const rect = v.getBoundingClientRect()
    const scale = Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight)
    const dispW = v.videoWidth * scale
    const dispH = v.videoHeight * scale
    return {
      rect,
      dispW,
      dispH,
      offX: (rect.width - dispW) / 2,
      offY: (rect.height - dispH) / 2,
      vw: v.videoWidth,
      vh: v.videoHeight,
    }
  }

  // click de pantalla -> píxel nativo (null si cae fuera de la imagen)
  const toNativePixel = (e: React.MouseEvent<HTMLDivElement>) => {
    const b = imageBox()
    if (!b) return null
    const cx = e.clientX - b.rect.left - b.offX
    const cy = e.clientY - b.rect.top - b.offY
    if (cx < 0 || cy < 0 || cx > b.dispW || cy > b.dispH) return null
    return { px: (cx / b.dispW) * b.vw, py: (cy / b.dispH) * b.vh, cx, cy }
  }

  // píxel nativo -> posición en pantalla dentro del contenedor (para los puntos ya tomados)
  const toScreen = (px: number, py: number) => {
    const b = imageBox()
    if (!b) return null
    return { x: b.offX + (px / b.vw) * b.dispW, y: b.offY + (py / b.vh) * b.dispH }
  }

  // click on the overlay -> pixel in the video's native resolution -> ground.
  // The overlay only exists in markMode, so it captures the click BEFORE the
  // <video> would toggle play/pause (React onClick fires too late for that).
  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = toNativePixel(e)
    const v = videoRef.current
    if (!p || !v) return
    markPoint(p.px, p.py, v.videoWidth, v.videoHeight)
  }

  // modo GCP: primer click del par (el segundo va en el mapa)
  const onGcpClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = toNativePixel(e)
    if (p) gcpClickPhoto(p.px, p.py)
  }

  // modo FOV por pares: mismo gesto que los GCP
  const onFovPairClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = toNativePixel(e)
    if (p) fovPairClickPhoto(p.px, p.py)
  }

  // puntos ya tomados en ESTE fotograma: se dibujan sobre la foto
  const frameHere = video
    ? gcpCampaign.frames.find(
        (f) => f.telemetry.frame_index === frameIndex(currentTv, video.fps),
      )
    : undefined

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        src={api.videoStreamUrl(sourceId)}
        controls
        className="w-full h-full bg-black"
        style={{ objectFit: 'contain' }}
      />
      {/* In markMode: transparent overlay swallows clicks so the video does not
          play/pause; it only marks a point. It covers the whole area EXCEPT a
          bottom strip, so the native controls (scrubber, play) stay usable. */}
      {markMode && !gcpMode && (
        <div
          onClick={onOverlayClick}
          className="absolute inset-x-0 top-0 bottom-10 cursor-crosshair"
          title={t('vp.markTitle')}
        />
      )}

      {/* Modo GCP: mismo truco de overlay. Con lupa, porque a 100 m de altura un
          píxel es ~12 cm: un temblor de 3 px mete 36 cm de ruido en una medida
          donde se discuten metros. */}
      {((gcpMode && gcpMarking) || fovPairMode) && (
        <div
          onClick={fovPairMode ? onFovPairClick : onGcpClick}
          onMouseMove={(e) => {
            const b = imageBox()
            if (!b) return
            setLens({ x: e.clientX - b.rect.left, y: e.clientY - b.rect.top })
          }}
          onMouseLeave={() => setLens(null)}
          className="absolute inset-x-0 top-0 bottom-14 cursor-crosshair"
          title={t('vp.pairTitle')}
        >
          {/* retícula fina de precisión */}
          {lens && (
            <>
              <div
                className="absolute pointer-events-none bg-cyan-400/70"
                style={{ left: lens.x, top: 0, bottom: 0, width: 1 }}
              />
              <div
                className="absolute pointer-events-none bg-cyan-400/70"
                style={{ top: lens.y, left: 0, right: 0, height: 1 }}
              />
            </>
          )}
        </div>
      )}

      {/* pares de FOV sobre la foto */}
      {fovPairMode && (
        <div className="absolute inset-0 pointer-events-none">
          {fovPairs.map((p) => {
            const s = toScreen(p.px, p.py)
            if (!s) return null
            return (
              <div
                key={p.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full font-bold"
                style={{ left: s.x, top: s.y, width: 16, height: 16, fontSize: 9, background: '#a855f7', color: '#fff', border: '2px solid #fff', boxShadow: '0 0 3px rgba(0,0,0,.8)' }}
              >
                {p.id}
              </div>
            )
          })}
          {fovPairPending &&
            (() => {
              const s = toScreen(fovPairPending.px, fovPairPending.py)
              if (!s) return null
              return (
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full animate-pulse"
                  style={{ left: s.x, top: s.y, width: 18, height: 18, background: '#f97316', border: '2px solid #fff', boxShadow: '0 0 4px rgba(0,0,0,.8)' }}
                />
              )
            })()}
        </div>
      )}

      {/* marcadores GCP sobre la foto: los ya tomados + el pendiente */}
      {gcpMode && (
        <div className="absolute inset-0 pointer-events-none">
          {frameHere?.points.map((p) => {
            const s = toScreen(p.px, p.py)
            if (!s) return null
            const on = gcpSelected?.frameId === frameHere.frame_id && gcpSelected?.pointId === p.id
            return (
              <div
                key={p.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full font-bold"
                style={{
                  left: s.x,
                  top: s.y,
                  width: on ? 22 : 16,
                  height: on ? 22 : 16,
                  fontSize: on ? 12 : 9,
                  background: on ? '#facc15' : '#22c55e',
                  color: on ? '#000' : '#fff',
                  border: '2px solid #fff',
                  boxShadow: '0 0 3px rgba(0,0,0,.8)',
                }}
              >
                {p.id}
              </div>
            )
          })}
          {gcpPendingPixel &&
            (() => {
              const s = toScreen(gcpPendingPixel.px, gcpPendingPixel.py)
              if (!s) return null
              return (
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full animate-pulse"
                  style={{
                    left: s.x,
                    top: s.y,
                    width: 18,
                    height: 18,
                    background: '#f97316',
                    border: '2px solid #fff',
                    boxShadow: '0 0 4px rgba(0,0,0,.8)',
                  }}
                />
              )
            })()}
        </div>
      )}
    </div>
  )
}
