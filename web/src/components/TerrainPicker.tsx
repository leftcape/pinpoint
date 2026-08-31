import { useStore } from '../store'
import { useT } from '../i18n'

// Selector del modelo del terreno para el AGL. Es parte de la configuración de
// la campaña: bloqueado con ella.
export function TerrainPicker({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const terrain = useStore((s) => s.terrain)
  const setTerrain = useStore((s) => s.setTerrain)
  const terrainEffective = useStore((s) => s.terrainEffective)
  const locked = useStore((s) => s.gcpCampaign.config.locked)

  const help =
    terrain === 'flat'
      ? t('terrain.flatHelp')
      : terrainEffective && terrainEffective !== terrain
        ? t('terrain.fallback', { eff: terrainEffective })
        : terrain === 'ign'
          ? t('terrain.ignHelp')
          : t('terrain.copHelp')

  return (
    <div className={`flex flex-col gap-1 rounded border bg-slate-50 ${compact ? 'p-1.5' : 'p-2'}`}>
      <div className="text-xs font-semibold text-slate-600">{t('terrain.title')}</div>
      <div className="flex gap-1">
        {(
          [
            ['flat', t('terrain.flat')],
            ['ign', t('terrain.ign')],
            ['cop', t('terrain.cop')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTerrain(key)}
            disabled={locked}
            className={`flex-1 px-1.5 py-1 text-xs rounded border ${
              terrain === key ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 hover:bg-slate-100'
            } disabled:opacity-60`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-slate-500">{help}</div>
    </div>
  )
}
