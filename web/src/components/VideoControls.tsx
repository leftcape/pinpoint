import { useStore } from '../store'
import { useT } from '../i18n'

// Control fino del vídeo para la pestaña Vuelo: play/pausa, saltos de ±5 s y
// colocación exacta en un instante con precisión de décimas de segundo. Pilota
// el mismo <video> que vive en VideoPanel a través del store (videoEl).
export function VideoControls() {
  const t = useT()
  const currentTv = useStore((s) => s.currentTv)
  const duration = useStore((s) => s.duration)
  const playing = useStore((s) => s.videoPlaying)
  const videoEl = useStore((s) => s.videoEl)
  const seekTo = useStore((s) => s.videoSeekTo)
  const seekBy = useStore((s) => s.videoSeekBy)
  const togglePlay = useStore((s) => s.videoTogglePlay)

  const disabled = !videoEl

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-sm">{t('vc.title')}</h3>

      {/* Transporte: −5s, play/pausa, +5s */}
      <div className="flex items-center gap-1">
        <button onClick={() => seekBy(-5)} disabled={disabled} title={t('vc.back5')} className="flex-1 px-2 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40">
          ⏪ 5s
        </button>
        <button onClick={togglePlay} disabled={disabled} title={playing ? t('vc.pause') : t('vc.play')} className="flex-1 px-2 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40">
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => seekBy(5)} disabled={disabled} title={t('vc.fwd5')} className="flex-1 px-2 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40">
          5s ⏩
        </button>
      </div>

      {/* Colocación exacta: número (décimas) + slider fino */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">{t('vc.goto')}</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTv, duration || currentTv)}
            disabled={disabled}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            min={0}
            max={duration || undefined}
            step={0.1}
            value={currentTv.toFixed(1)}
            disabled={disabled}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v)) seekTo(v)
            }}
            className="w-20 text-xs border rounded px-1 py-0.5 font-mono"
          />
          <span className="text-xs text-gray-400 font-mono">/ {(duration || 0).toFixed(1)}s</span>
        </div>
      </div>
    </div>
  )
}
