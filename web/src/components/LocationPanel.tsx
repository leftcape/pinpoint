import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { activeFov } from '../sampler/gcp'
import { BAND_COLOR, BAND_RANGE, type BandCode, type LocatedPoint } from '../sampler/located'
import { exportLocatedCsv, exportLocatedGeoJson, exportLocatedZip } from '../sampler/exportLocated'

// Localizar: la vertiente OPERATIVA de PinPoint. Con el vuelo ya sincronizado
// y el FOV fijado (pestaña Vuelo), el operador señala en la foto lo que ve y
// obtiene la coordenada al instante, con su fiabilidad: ángulo de visión,
// banda A/B/C y margen esperable. Los puntos se acumulan, se guardan con la
// campaña del vuelo (sin fotograma: se regenera al exportar) y se exportan en
// CSV, GeoJSON o ZIP con los fotogramas señalados.
// (La calibración vive en Vuelo; los puntos de control, en su pestaña.)
export function LocationPanel() {
  const t = useT()
  const cfg = useStore((s) => s.gcpCampaign.config)
  const located = useStore((s) => s.gcpCampaign.located)
  const locSelected = useStore((s) => s.locSelected)
  const locSelect = useStore((s) => s.locSelect)
  const locRename = useStore((s) => s.locRename)
  const locDelete = useStore((s) => s.locDelete)
  const locClear = useStore((s) => s.locClear)
  const locBusy = useStore((s) => s.locBusy)
  const markMode = useStore((s) => s.markMode)
  const setMarkMode = useStore((s) => s.setMarkMode)
  const readOnly = useStore((s) => s.readOnly)
  const syncMethod = useStore((s) => s.syncMethod)
  const manualOffset = useStore((s) => s.manualOffset)
  const terrain = useStore((s) => s.terrain)
  const terrainEffective = useStore((s) => s.terrainEffective)
  const swapView = useStore((s) => s.swapView)
  const setSwapView = useStore((s) => s.setSwapView)
  const followDrone = useStore((s) => s.followDrone)
  const setFollowDrone = useStore((s) => s.setFollowDrone)
  const measureMode = useStore((s) => s.measureMode)
  const setMeasureMode = useStore((s) => s.setMeasureMode)
  const measureDecompose = useStore((s) => s.measureDecompose)
  const setMeasureDecompose = useStore((s) => s.setMeasureDecompose)
  const measurePoints = useStore((s) => s.measurePoints)
  const clearMeasure = useStore((s) => s.clearMeasure)

  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const sel = located.find((p) => p.id === locSelected) ?? null

  const doExport = async (kind: 'csv' | 'geojson' | 'zip') => {
    setExporting(true)
    setExportMsg(null)
    try {
      let f: string
      if (kind === 'csv') f = exportLocatedCsv()
      else if (kind === 'geojson') f = exportLocatedGeoJson()
      else f = (await exportLocatedZip((i, n) => setExportMsg(t('loc.exporting', { i, n })))).filename
      setExportMsg(t('loc.exportDone', { f }))
    } catch (e) {
      setExportMsg(String(e instanceof Error ? e.message : e))
    } finally {
      setExporting(false)
    }
  }

  // distancia total de la línea de medición (Haversine acumulado)
  const distance = (() => {
    const R = 6371000
    const toRad = (d: number) => (d * Math.PI) / 180
    let total = 0
    for (let i = 1; i < measurePoints.length; i++) {
      const [lo1, la1] = measurePoints[i - 1]
      const [lo2, la2] = measurePoints[i]
      const dLat = toRad(la2 - la1)
      const dLng = toRad(lo2 - lo1)
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2
      total += 2 * R * Math.asin(Math.sqrt(a))
    }
    return total
  })()
  const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`)

  const terrainLabel = terrainEffective && terrainEffective !== terrain ? `${terrain} → ${terrainEffective}` : terrain

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold text-sm">{t('loc.title')}</h3>

      {/* Con qué se va a calcular. Si la campaña no está bloqueada, avisar:
          la sincronía y el FOV pueden cambiar bajo los pies del operador. */}
      <div className={`text-xs rounded border p-2 ${cfg.locked ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="font-semibold mb-1">{t('loc.calib')}</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 font-mono">
          <span className="text-gray-500">{t('loc.sync')}</span>
          <span>{syncMethod}{syncMethod === 'manual' ? ` (${manualOffset.toFixed(2)} s)` : ''}</span>
          <span className="text-gray-500">{t('loc.fov')}</span>
          <span>{cfg.fov.active} · {activeFov(cfg).toFixed(1)}°</span>
          <span className="text-gray-500">{t('loc.terrain')}</span>
          <span>{terrainLabel}</span>
        </div>
        <div className="mt-1">{cfg.locked ? `🔒 ${t('loc.locked')}` : `⚠ ${t('loc.unlocked')}`}</div>
      </div>

      {/* Localizar */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setMarkMode(!markMode)}
          className={`px-3 py-2 rounded text-sm font-semibold text-white ${markMode ? 'bg-blue-600' : 'bg-gray-800'}`}
        >
          {markMode ? `■ ${t('loc.stop')}` : `⌖ ${t('loc.start')}`}
        </button>
        {markMode && <div className="text-xs text-gray-500">{t('loc.markHelp')}</div>}
        {locBusy && <div className="text-xs text-blue-600">{t('loc.busy')}</div>}
        {readOnly && <div className="text-xs text-amber-700">{t('loc.readOnlyNote')}</div>}
      </div>

      {/* Ficha del punto seleccionado */}
      {sel && <Ficha p={sel} onClose={() => locSelect(null)} />}

      {/* Lista */}
      <div className="flex flex-col gap-1 border-t pt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">{t('loc.list', { n: located.length })}</span>
          {located.length > 0 && !readOnly && (
            <button
              onClick={() => { if (window.confirm(t('loc.confirmClear', { n: located.length }))) locClear() }}
              className="text-gray-500 underline"
            >
              {t('loc.clearAll')}
            </button>
          )}
        </div>
        {located.length === 0 && <div className="text-xs text-gray-400">{t('loc.noPoints')}</div>}
        {located.map((p) => {
          const on = p.id === locSelected
          return (
            <div
              key={p.id}
              onClick={() => locSelect(p.id)}
              className={`flex items-center gap-2 text-xs rounded px-1.5 py-1 cursor-pointer border ${on ? 'bg-yellow-50 border-yellow-300' : 'border-transparent hover:bg-gray-50'}`}
            >
              <BandChip band={p.band} />
              <input
                value={p.label}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => locRename(p.id, e.target.value)}
                disabled={readOnly}
                className="w-20 border-b border-transparent focus:border-gray-400 bg-transparent font-semibold outline-none"
                title={t('loc.renameTitle')}
              />
              <span className="font-mono text-gray-600 truncate flex-1">
                {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
              </span>
              <span className="text-gray-400">±{p.margin_p90_m.toFixed(0)} m</span>
              {!readOnly && (
                <button
                  onClick={(e) => { e.stopPropagation(); locDelete(p.id) }}
                  className="text-gray-400 hover:text-red-600"
                  title={t('loc.delete')}
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Exportar */}
      <div className="flex flex-col gap-1 border-t pt-2">
        <div className="text-xs font-semibold">{t('loc.export')}</div>
        <div className="flex gap-2">
          {(['csv', 'geojson', 'zip'] as const).map((k) => (
            <button
              key={k}
              onClick={() => void doExport(k)}
              disabled={exporting || located.length === 0}
              className="flex-1 text-xs px-2 py-1.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
            >
              {k === 'csv' ? t('loc.exportCsv') : k === 'geojson' ? t('loc.exportGeo') : t('loc.exportZip')}
            </button>
          ))}
        </div>
        {exportMsg && <div className="text-xs text-gray-600">{exportMsg}</div>}
      </div>

      {/* Leyenda: de dónde salen las bandas. No es decoración: es lo que hace
          honesta la cifra que se entrega. */}
      <div className="text-[11px] text-gray-500 border-t pt-2">
        <div className="flex gap-3 mb-1">
          {(['A', 'B', 'C'] as BandCode[]).map((b) => (
            <span key={b} className="flex items-center gap-1">
              <BandChip band={b} /> {BAND_RANGE[b]}
            </span>
          ))}
        </div>
        {t('loc.bandsSource')}
      </div>

      {/* Vista */}
      <details className="border-t pt-2">
        <summary className="text-xs font-semibold cursor-pointer">{t('loc.view')}</summary>
        <div className="flex flex-col gap-2 mt-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={swapView} onChange={(e) => setSwapView(e.target.checked)} />
            {t('loc.swap')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={followDrone} onChange={(e) => setFollowDrone(e.target.checked)} />
            {t('loc.follow')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={measureMode} onChange={(e) => setMeasureMode(e.target.checked)} />
            {t('loc.measure')}
          </label>
          {measureMode && (
            <>
              <div className="text-xs text-gray-500">{t('loc.measureHelp')}</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={measureDecompose} onChange={(e) => setMeasureDecompose(e.target.checked)} />
                {t('loc.decompose')}
              </label>
            </>
          )}
          {measurePoints.length > 0 && (
            <div className="text-xs bg-red-50 rounded p-2 border flex items-center justify-between">
              <span className="font-mono text-red-800">
                {measurePoints.length} {t('loc.pts')} · {fmtDist(distance)}
              </span>
              <button onClick={clearMeasure} className="text-gray-500 underline ml-2">
                {t('loc.clear')}
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

function BandChip({ band }: { band: BandCode }) {
  return (
    <span
      className="inline-block rounded-full text-white font-bold text-center"
      style={{ background: BAND_COLOR[band], width: 18, height: 18, fontSize: 10, lineHeight: '18px' }}
    >
      {band}
    </span>
  )
}

// La coordenada tal como se entrega: dónde, con qué margen, y por qué ese margen.
function Ficha({ p, onClose }: { p: LocatedPoint; onClose: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const coords = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coords)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* sin portapapeles: el texto sigue seleccionable */
    }
  }
  const bandName = t(`loc.band${p.band}` as 'loc.bandA' | 'loc.bandB' | 'loc.bandC')
  return (
    <div className="text-xs rounded border p-2 flex flex-col gap-1" style={{ borderColor: BAND_COLOR[p.band] }}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{p.label}</span>
        <button onClick={onClose} className="text-gray-400">✕</button>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-base select-all">{coords}</span>
        <button onClick={() => void copy()} className="text-blue-600 underline">
          {copied ? t('loc.copied') : t('loc.copy')}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <BandChip band={p.band} />
        <span className="font-semibold" style={{ color: BAND_COLOR[p.band] }}>{bandName}</span>
        <span className="text-gray-600">· {t('loc.margin')}: <b>±{p.margin_p90_m.toFixed(0)} m</b></span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 font-mono text-gray-600">
        <span>θ</span><span>{p.theta_deg.toFixed(1)}° ({t('loc.theta')}, {BAND_RANGE[p.band]})</span>
        <span>d</span><span>{p.d_nadir_m.toFixed(0)} m {t('loc.fromNadir')}</span>
        <span>AGL</span><span>{p.agl_m.toFixed(0)} m</span>
        <span>t</span><span>{p.tv.toFixed(2)} s · f{p.frame_index}</span>
        {p.model_err_m != null && (
          <>
            <span>ε</span><span>{p.model_err_m.toFixed(1)} m ({t('loc.model')})</span>
          </>
        )}
      </div>
      {!p.nadir_ok && <div className="text-amber-700">{t('loc.frameNotNadir', { reason: p.reason })}</div>}
      {p.clipped && <div className="text-red-700">{t('loc.clipped')}</div>}
    </div>
  )
}
