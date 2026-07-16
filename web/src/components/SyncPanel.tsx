import { useStore } from '../store'
import type { SyncMethod } from '../api'
import { applyFovScale, fovVerticalFrom } from '../api'
import { VideoControls } from './VideoControls'

const METHODS: { value: SyncMethod; label: string; hint: string }[] = [
  { value: 'takeoff', label: 'Takeoff', hint: 'Anchor frame 0 to the takeoff detected in the log' },
  {
    value: 'creation_time',
    label: 'creation_time',
    hint: "Use the video's creation time and correct the timezone against the GPS clock",
  },
  { value: 'manual', label: 'Manual', hint: 'Set the offset yourself (fine tuning)' },
]

export function SyncPanel() {
  const syncMethod = useStore((s) => s.syncMethod)
  const setSyncMethod = useStore((s) => s.setSyncMethod)
  const manualOffset = useStore((s) => s.manualOffset)
  const setManualOffset = useStore((s) => s.setManualOffset)
  const position = useStore((s) => s.position)
  const log = useStore((s) => s.log)
  const projectFrame = useStore((s) => s.projectFrame)
  const setProjectFrame = useStore((s) => s.setProjectFrame)
  const showOutline = useStore((s) => s.showOutline)
  const setShowOutline = useStore((s) => s.setShowOutline)
  const obliqueProject = useStore((s) => s.obliqueProject)
  const setObliqueProject = useStore((s) => s.setObliqueProject)
  const footprint = useStore((s) => s.footprint)
  const nadirThr = useStore((s) => s.nadirThr)
  const setNadirThr = useStore((s) => s.setNadirThr)
  const tuning = useStore((s) => s.tuning)
  const setTuning = useStore((s) => s.setTuning)

  return (
    <div className="flex flex-col gap-3">
      <VideoControls />

      <h3 className="font-semibold text-sm border-t pt-3">Log ↔ video sync</h3>

      <div className="flex gap-1">
        {METHODS.map((m) => (
          <button
            key={m.value}
            onClick={() => setSyncMethod(m.value)}
            title={m.hint}
            className={`px-2 py-1 text-xs rounded border ${
              syncMethod === m.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Offset: always editable; in manual it drives the sync, in auto it shows the suggestion */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">
          Offset (s into the log where the video starts)
          {syncMethod !== 'manual' && ' — computed, switch to Manual to fine-tune'}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={-60}
            max={(log?.duration_s ?? 120) - 1}
            step={0.1}
            value={manualOffset}
            disabled={syncMethod !== 'manual'}
            onChange={(e) => setManualOffset(parseFloat(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            step={0.1}
            value={manualOffset.toFixed(1)}
            disabled={syncMethod !== 'manual'}
            onChange={(e) => setManualOffset(parseFloat(e.target.value))}
            className="w-20 text-xs border rounded px-1 py-0.5 font-mono"
          />
        </div>
      </div>

      {/* Map projection: independent checkboxes */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={projectFrame}
            onChange={(e) => setProjectFrame(e.target.checked)}
          />
          Project the frame image
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showOutline}
            onChange={(e) => setShowOutline(e.target.checked)}
          />
          Show the footprint outline
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={obliqueProject}
            onChange={(e) => setObliqueProject(e.target.checked)}
          />
          Project the photo onto the footprint
        </label>
        {obliqueProject && footprint?.clipped && (
          <div className="text-xs text-amber-600">
            Horizon in frame — this frame cannot be projected onto the ground.
          </div>
        )}
      </div>

      {/* Fine tuning: manual deltas to calibrate against the orthophoto */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <div className="text-xs text-gray-500">
          Fine tuning (optics / attitude) — calibrate against the orthophoto. Set
          the FOV itself in “Calibrar FOV por escala” (Location):
        </div>
        <div className="text-[11px] text-gray-500">
          FOV{' '}
          <b className="font-mono">
            {applyFovScale(tuning.fov_h, tuning.fov_scale).toFixed(1)}° ×{' '}
            {applyFovScale(fovVerticalFrom(tuning.fov_h, tuning.aspect), tuning.fov_scale).toFixed(1)}°
          </b>{' '}
          (nominal {tuning.fov_h.toFixed(1)}° · aspect {tuning.aspect.toFixed(3)})
        </div>
        <TuneSlider
          label={`FOV fine scale × ${tuning.fov_scale.toFixed(2)}`}
          min={0.8}
          max={1.3}
          step={0.005}
          value={tuning.fov_scale}
          onChange={(v) => setTuning('fov_scale', v)}
        />
        <TuneSlider
          label={`Δ pitch: ${tuning.d_pitch.toFixed(1)}°`}
          min={-20}
          max={20}
          step={0.5}
          value={tuning.d_pitch}
          onChange={(v) => setTuning('d_pitch', v)}
        />
        <TuneSlider
          label={`Δ roll: ${tuning.d_roll.toFixed(1)}°`}
          min={-20}
          max={20}
          step={0.5}
          value={tuning.d_roll}
          onChange={(v) => setTuning('d_roll', v)}
        />
      </div>

      {/* Cenital thresholds: outside them the image is NOT projected */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <div className="text-xs text-gray-500">
          Don't project the image if the camera leaves nadir (nadir = pitch −90°):
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ThrField
            label="Max pitch dev (°)"
            value={nadirThr.max_pitch_dev}
            onChange={(v) => setNadirThr('max_pitch_dev', v)}
          />
          <ThrField
            label="Max roll dev (°)"
            value={nadirThr.max_roll_dev}
            onChange={(v) => setNadirThr('max_roll_dev', v)}
          />
          <ThrField
            label="Min altitude (m)"
            value={nadirThr.min_agl}
            onChange={(v) => setNadirThr('min_agl', v)}
          />
        </div>

        {/* current footprint status */}
        {footprint && footprint.valid && (
          <div className="text-xs bg-gray-50 rounded p-2 border">
            <div className="text-gray-600">
              pitch {footprint.pitch.toFixed(0)}° · roll {footprint.roll.toFixed(0)}° · AGL{' '}
              {footprint.agl.toFixed(0)}m {footprint.has_gimbal ? '· gimbal' : '· no gimbal'}
            </div>
            {footprint.nadir_ok ? (
              <div className="text-green-700">✓ nadir — image reliable</div>
            ) : (
              <div className="text-amber-600">
                ⚠ off-nadir ({footprintReason(footprint.reason)}) — image hidden
              </div>
            )}
            <div className="text-amber-600 mt-1">Note: flat altitude; DSM coming later.</div>
          </div>
        )}
        {footprint && !footprint.valid && (
          <div className="text-xs text-amber-600">No footprint: drone at ground level.</div>
        )}
      </div>

      {position && (
        <div className="text-xs bg-gray-50 rounded p-2 border">
          <div className="font-mono text-gray-700">
            drone @ tv={position.tv.toFixed(1)}s: {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
          </div>
          <div className="text-gray-500">
            alt {position.alt_rel.toFixed(0)}m AGL · yaw {position.yaw.toFixed(0)}°
            {position.tz_offset_hours !== 0 && ` · TZ ${position.tz_offset_hours > 0 ? '+' : ''}${position.tz_offset_hours}h`}
          </div>
          <div className="text-gray-400 mt-1">{position.detail}</div>
        </div>
      )}
    </div>
  )
}

function ThrField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-400">{label}</label>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full border rounded px-1 py-0.5 text-xs"
      />
    </div>
  )
}

function TuneSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-400">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

function footprintReason(reason: string): string {
  return { pitch: 'pitch out of range', roll: 'roll out of range', agl: 'low altitude' }[reason] ?? reason
}
