import { useStore } from '../store'

// Parametrización de la extracción + botón de lanzar job + progreso.
export function ParamsPanel() {
  const params = useStore((s) => s.params)
  const setParam = useStore((s) => s.setParam)
  const launchJob = useStore((s) => s.launchJob)
  const jobStatus = useStore((s) => s.jobStatus)
  const jobId = useStore((s) => s.jobId)
  const video = useStore((s) => s.video)
  const sourceId = useStore((s) => s.sourceId)
  const currentTv = useStore((s) => s.currentTv)

  const estFrames = video ? Math.round(video.duration_s * params.fps) : 0

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold text-sm">Extraction parameters</h3>

      <Field label={`fps (${estFrames} frames approx.)`}>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={params.fps}
          onChange={(e) => setParam('fps', parseFloat(e.target.value))}
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </Field>

      {sourceId && (
        <OverlapPreview sid={sourceId} tv={currentTv} fps={params.fps} dur={video?.duration_s ?? 0} />
      )}

      <Field label="JPEG quality (qscale 2=high, 31=low)">
        <input
          type="number"
          min={2}
          max={31}
          value={params.quality}
          onChange={(e) => setParam('quality', parseInt(e.target.value))}
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </Field>

      <Field label="Min altitude above takeoff (m) — drops takeoff/landing">
        <input
          type="number"
          min={0}
          value={params.min_alt_rel}
          onChange={(e) => setParam('min_alt_rel', parseFloat(e.target.value))}
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </Field>

      <Field label="geo.txt CRS">
        <input
          type="text"
          value={params.crs}
          onChange={(e) => setParam('crs', e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm font-mono"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={params.include_orientation}
          onChange={(e) => setParam('include_orientation', e.target.checked)}
        />
        Include orientation (yaw) in geo.txt
      </label>

      <button
        onClick={launchJob}
        disabled={!!jobStatus && jobStatus.status === 'running'}
        className="mt-2 bg-green-600 text-white rounded px-3 py-2 text-sm font-semibold disabled:opacity-50"
      >
        Generate frames + geo.txt
      </button>

      {jobStatus && (
        <div className="text-xs border rounded p-2 bg-gray-50">
          <div className="flex justify-between mb-1">
            <span className="font-mono">{jobStatus.stage}</span>
            <span>{(jobStatus.pct * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded overflow-hidden">
            <div className="h-full bg-green-600" style={{ width: `${jobStatus.pct * 100}%` }} />
          </div>
          <div className="text-gray-500 mt-1">{jobStatus.msg}</div>
          {jobStatus.status === 'done' && jobStatus.result && (
            <div className="mt-2 text-green-700">
              ✓ {String((jobStatus.result as Record<string, unknown>).frames_kept)} usable frames.{' '}
              <a
                href={`/api/jobs/${jobId}/download`}
                className="underline text-blue-600"
              >
                Download ZIP
              </a>
            </div>
          )}
          {jobStatus.status === 'error' && (
            <div className="mt-2 text-red-600">Error: {jobStatus.error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  )
}

// Previsualizador de solape: dos frames consecutivos según el fps elegido.
// Frame de arriba = instante actual del vídeo; abajo = el siguiente (tv + 1/fps).
// Comparándolos a ojo se decide si el fps da suficiente solape.
function OverlapPreview({
  sid,
  tv,
  fps,
  dur,
}: {
  sid: string
  tv: number
  fps: number
  dur: number
}) {
  const dt = fps > 0 ? 1 / fps : 1
  const tvNext = tv + dt
  const outOfRange = tvNext > dur
  const url = (t: number) =>
    `/api/sources/${sid}/frame?tv=${t.toFixed(3)}`

  return (
    <div className="flex flex-col gap-1 border rounded p-2 bg-gray-50">
      <div className="text-xs text-gray-500">
        Overlap between consecutive frames (Δt = {dt.toFixed(2)}s at {fps} fps). Scrub the
        video to check the overlap at different points of the flight.
      </div>
      <FramePair label={`current · tv=${tv.toFixed(1)}s`} src={url(tv)} />
      {outOfRange ? (
        <div className="text-xs text-amber-600">
          The next frame (tv={tvNext.toFixed(1)}s) is past the end of the video.
        </div>
      ) : (
        <FramePair label={`next · tv=${tvNext.toFixed(1)}s`} src={url(tvNext)} />
      )}
    </div>
  )
}

function FramePair({ label, src }: { label: string; src: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-400 font-mono">{label}</span>
      <img
        src={src}
        alt={label}
        loading="lazy"
        className="w-full rounded border bg-black"
        style={{ maxHeight: 140, objectFit: 'contain' }}
      />
    </div>
  )
}
