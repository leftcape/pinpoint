import { useStore } from '../store'

// Control fino del vídeo para la pestaña Flight: play/pausa, stop, saltos de
// ±5 s (doble flecha) y colocación exacta en un instante con precisión de
// décimas de segundo. Pilota el mismo <video> que vive en VideoPanel a través
// del store (videoEl), así que no duplica el elemento ni reinicia el vídeo.
export function VideoControls() {
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
      <h3 className="font-semibold text-sm">Video control</h3>

      {/* Transporte: −5s, play/pausa, stop, +5s */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => seekBy(-5)}
          disabled={disabled}
          title="Back 5 seconds"
          className="flex-1 px-2 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40"
        >
          ⏪ 5s
        </button>
        <button
          onClick={togglePlay}
          disabled={disabled}
          title={playing ? 'Pause' : 'Play'}
          className="flex-1 px-2 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => seekBy(5)}
          disabled={disabled}
          title="Forward 5 seconds"
          className="flex-1 px-2 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40"
        >
          5s ⏩
        </button>
      </div>

      {/* Colocación exacta: número (décimas) + slider fino */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">
          Go to second (0.1s precision)
        </label>
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
          <span className="text-xs text-gray-400 font-mono">
            / {(duration || 0).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  )
}
