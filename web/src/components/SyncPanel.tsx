import { useStore } from '../store'
import type { SyncMethod } from '../api'
import { useT, type Key } from '../i18n'
import { VideoControls } from './VideoControls'
import { FovPanel } from './FovPanel'

const METHODS: { value: SyncMethod; label: Key; hint: Key }[] = [
  { value: 'takeoff', label: 'sync.takeoff', hint: 'sync.takeoffHint' },
  { value: 'creation_time', label: 'sync.creation', hint: 'sync.creationHint' },
  { value: 'manual', label: 'sync.manual', hint: 'sync.manualHint' },
]

export function SyncPanel() {
  const t = useT()
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
  const locked = useStore((s) => s.gcpCampaign.config.locked)

  const reasonLabel = (reason: string) =>
    ({ pitch: t('sync.reasonPitch'), roll: t('sync.reasonRoll'), agl: t('sync.reasonAgl') })[reason] ?? reason

  return (
    <div className="flex flex-col gap-3">
      <VideoControls />

      <h3 className="font-semibold text-sm border-t pt-3">
        {t('sync.title')}
        {locked && <span className="ml-2 text-amber-700 font-normal text-xs">{t('sync.locked')}</span>}
      </h3>

      <div className="flex gap-1">
        {METHODS.map((m) => (
          <button
            key={m.value}
            onClick={() => setSyncMethod(m.value)}
            title={t(m.hint)}
            disabled={locked}
            className={`px-2 py-1 text-xs rounded border disabled:opacity-60 ${
              syncMethod === m.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'
            }`}
          >
            {t(m.label)}
          </button>
        ))}
      </div>

      {/* Offset: siempre visible; en manual gobierna la sync, en automático muestra el sugerido */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">
          {t('sync.offset')}
          {syncMethod !== 'manual' && t('sync.offsetComputed')}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={-60}
            max={(log?.duration_s ?? 120) - 1}
            step={0.1}
            value={manualOffset}
            disabled={syncMethod !== 'manual' || locked}
            onChange={(e) => setManualOffset(parseFloat(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            step={0.1}
            value={manualOffset.toFixed(1)}
            disabled={syncMethod !== 'manual' || locked}
            onChange={(e) => setManualOffset(parseFloat(e.target.value))}
            className="w-20 text-xs border rounded px-1 py-0.5 font-mono"
          />
        </div>
      </div>

      {/* Proyección en el mapa: casillas independientes */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={projectFrame} onChange={(e) => setProjectFrame(e.target.checked)} />
          {t('sync.projectFrame')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showOutline} onChange={(e) => setShowOutline(e.target.checked)} />
          {t('sync.showOutline')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={obliqueProject} onChange={(e) => setObliqueProject(e.target.checked)} />
          {t('sync.projectOblique')}
        </label>
        {obliqueProject && footprint?.clipped && <div className="text-xs text-amber-600">{t('sync.horizon')}</div>}
      </div>

      <FovPanel />

      {/* Ajuste fino: deltas manuales para calibrar contra la ortofoto */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <div className="text-xs text-gray-500">{t('sync.fineTune')}</div>
        <TuneSlider label={`Δ pitch: ${tuning.d_pitch.toFixed(1)}°`} min={-20} max={20} step={0.5} value={tuning.d_pitch} disabled={locked} onChange={(v) => setTuning('d_pitch', v)} />
        <TuneSlider label={`Δ roll: ${tuning.d_roll.toFixed(1)}°`} min={-20} max={20} step={0.5} value={tuning.d_roll} disabled={locked} onChange={(v) => setTuning('d_roll', v)} />
      </div>

      {/* Umbrales cenitales: fuera de ellos la imagen NO se proyecta */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <div className="text-xs text-gray-500">{t('sync.gateTitle')}</div>
        <div className="grid grid-cols-3 gap-2">
          <ThrField label={t('sync.maxPitch')} value={nadirThr.max_pitch_dev} onChange={(v) => setNadirThr('max_pitch_dev', v)} />
          <ThrField label={t('sync.maxRoll')} value={nadirThr.max_roll_dev} onChange={(v) => setNadirThr('max_roll_dev', v)} />
          <ThrField label={t('sync.minAlt')} value={nadirThr.min_agl} onChange={(v) => setNadirThr('min_agl', v)} />
        </div>

        {footprint && footprint.valid && (
          <div className="text-xs bg-gray-50 rounded p-2 border">
            <div className="text-gray-600">
              pitch {footprint.pitch.toFixed(0)}° · roll {footprint.roll.toFixed(0)}° · AGL {footprint.agl.toFixed(0)}m · {footprint.has_gimbal ? t('sync.gimbal') : t('sync.noGimbal')}
            </div>
            {footprint.nadir_ok ? (
              <div className="text-green-700">{t('sync.nadirOk')}</div>
            ) : (
              <div className="text-amber-600">{t('sync.offNadir', { reason: reasonLabel(footprint.reason) })}</div>
            )}
          </div>
        )}
        {footprint && !footprint.valid && <div className="text-xs text-amber-600">{t('sync.noFootprint')}</div>}
      </div>

      {position && (
        <div className="text-xs bg-gray-50 rounded p-2 border">
          <div className="font-mono text-gray-700">{t('sync.droneAt', { tv: position.tv.toFixed(1), lat: position.lat.toFixed(6), lng: position.lng.toFixed(6) })}</div>
          <div className="text-gray-500">
            {t('sync.altYaw', { alt: position.alt_rel.toFixed(0), yaw: position.yaw.toFixed(0) })}
            {position.tz_offset_hours !== 0 && ` · TZ ${position.tz_offset_hours > 0 ? '+' : ''}${position.tz_offset_hours}h`}
          </div>
          <div className="text-gray-400 mt-1">{position.detail}</div>
        </div>
      )}
    </div>
  )
}

function ThrField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-400">{label}</label>
      <input type="number" min={0} step={1} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full border rounded px-1 py-0.5 text-xs" />
    </div>
  )
}

function TuneSlider({
  label, min, max, step, value, disabled = false, onChange,
}: {
  label: string; min: number; max: number; step: number; value: number; disabled?: boolean; onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-400">{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full" />
    </div>
  )
}
