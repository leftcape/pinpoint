import { useStore } from '../store'
import { fovVerticalFrom } from '../api'
import { useT } from '../i18n'
import { TerrainPicker } from './TerrainPicker'

// Campo de visión de la cámara — pestaña Vuelo, después de la sincronía.
//
// Hay DOS valores y se guardan los dos en la campaña:
//   sfm    : autocalibración fotogramétrica (OpenSfM/ODM) de la misma cámara.
//            Describe bien el centro de la imagen (focal pinhole).
//   visual : el nuestro, contra la ortofoto. O "a ojo" (la huella nadir queda
//            clavada bajo el dron y el FOV sólo la escala hasta que la foto
//            encaja), o "por pares": 2+ rasgos marcados en foto y mapa; la
//            escala (GSD) sale de las DISTANCIAS entre pares, así que no depende
//            del offset de sincronía ni del yaw. fov = 2·atan(W·GSD / (2·AGL)).
// La diferencia entre ambos es la distorsión de gran angular: un resultado.
// Cada punto de control se proyecta con el activo Y con el otro.
export function FovPanel() {
  const t = useT()
  const cfg = useStore((s) => s.gcpCampaign.config)
  // En modo lectura vale lo mismo que bloqueado: no se puede escribir.
  const readOnly = useStore((s) => s.readOnly)
  const locked = cfg.locked || readOnly
  const tuning = useStore((s) => s.tuning)
  const setTuning = useStore((s) => s.setTuning)
  const video = useStore((s) => s.video)
  const footprint = useStore((s) => s.footprint)
  const setFovActive = useStore((s) => s.setFovActive)
  const setFovSfm = useStore((s) => s.setFovSfm)
  const setFovVisualSlider = useStore((s) => s.setFovVisualSlider)
  const clearFovVisual = useStore((s) => s.clearFovVisual)
  const calibMode = useStore((s) => s.fovCalibMode)
  const setCalibMode = useStore((s) => s.setFovCalibMode)
  const pairMode = useStore((s) => s.fovPairMode)
  const setPairMode = useStore((s) => s.setFovPairMode)
  const pairs = useStore((s) => s.fovPairs)
  const pairPending = useStore((s) => s.fovPairPending)
  const pairTv = useStore((s) => s.fovPairTv)
  const pairResult = useStore((s) => s.fovPairResult)
  const pairRemove = useStore((s) => s.fovPairRemove)
  const pairClear = useStore((s) => s.fovPairClear)
  const pairSolve = useStore((s) => s.fovPairSolve)
  const pairApply = useStore((s) => s.fovPairApply)
  const pairCancel = useStore((s) => s.fovPairCancelPending)
  const gcpMode = useStore((s) => s.gcpMode)

  const { sfm, visual, active, aspect } = cfg.fov
  const fovV = fovVerticalFrom(tuning.fov_h, aspect)
  const videoAspect = video && video.height ? video.width / video.height : null
  const nadirOk = footprint?.valid && footprint.nadir_ok

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t('fov.title')}</h3>
        <span className="text-[11px] text-gray-500 font-mono">
          {t('fov.active')} {tuning.fov_h.toFixed(2)}° × {fovV.toFixed(2)}°
        </span>
      </div>
      {locked && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">{t('fov.lockedNote')}</div>}

      {/* ---- SfM ---- */}
      <div className={`rounded border p-2 flex flex-col gap-1 ${active === 'sfm' ? 'bg-indigo-50 border-indigo-300' : 'bg-white'}`}>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="radio" name="fov-active" checked={active === 'sfm'} disabled={locked} onChange={() => setFovActive('sfm')} />
          {t('fov.sfm')}
          <input
            type="number"
            step={0.01}
            min={1}
            value={Number(sfm.fov_h_deg.toFixed(2))}
            disabled={locked}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v) && v > 0) setFovSfm(v, sfm.focal_norm, sfm.source)
            }}
            className="ml-auto w-20 text-sm border rounded px-1.5 py-0.5 font-mono text-right"
          />
          <span className="text-gray-500">°</span>
        </label>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span>{t('fov.focal')}</span>
          <input
            type="number"
            step={0.0001}
            value={sfm.focal_norm ?? ''}
            disabled={locked}
            placeholder="—"
            onChange={(e) => {
              const f = parseFloat(e.target.value)
              if (Number.isNaN(f) || f <= 0) return
              // fov = 2·atan(0.5 / f)  (focal como fracción de max(W,H))
              const fov = (2 * Math.atan(0.5 / f) * 180) / Math.PI
              setFovSfm(fov, f, sfm.source)
            }}
            className="w-20 text-[11px] border rounded px-1 py-0.5 font-mono text-right"
          />
          <span className="truncate" title={sfm.source}>
            {sfm.source}
          </span>
        </div>
      </div>

      {/* ---- Visual ---- */}
      <div className={`rounded border p-2 flex flex-col gap-1 ${active === 'visual' ? 'bg-indigo-50 border-indigo-300' : 'bg-white'}`}>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="radio" name="fov-active" checked={active === 'visual'} disabled={locked || !visual} onChange={() => setFovActive('visual')} />
          {t('fov.visual')}
          <span className="ml-auto font-mono">{visual ? `${visual.fov_h_deg.toFixed(2)}°` : '—'}</span>
        </label>
        {visual ? (
          <div className="text-[11px] text-gray-500 flex flex-col">
            <span>
              {visual.method === 'pairs'
                ? t('fov.byPairs', { n: visual.pairs.length, gsd: visual.gsd_m_px?.toFixed(3) ?? '—', pct: visual.residual_pct?.toFixed(1) ?? '—' })
                : t('fov.byEye')}
              {visual.frame_tv !== null && ` · ${t('fov.frame')} tv=${visual.frame_tv.toFixed(1)}s`}
              {visual.agl_m !== null && ` · AGL ${visual.agl_m.toFixed(0)} m`}
              {visual.terrain_source && ` · ${t('fov.terrain')} ${visual.terrain_source}`}
            </span>
            <span>
              {new Date(visual.date).toLocaleString()} · {t('fov.deltaSfm')} <b className="font-mono">{(visual.fov_h_deg - sfm.fov_h_deg).toFixed(2)}°</b>
              {!locked && (
                <button onClick={clearFovVisual} className="ml-2 underline text-gray-400 hover:text-red-600">
                  {t('fov.delete')}
                </button>
              )}
            </span>
            {visual.note && <span className="italic">{visual.note}</span>}
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 italic">{t('fov.notCalibrated')}</div>
        )}

        {!locked && (
          <div className="flex gap-1 mt-1">
            <button
              onClick={() => setCalibMode(!calibMode)}
              disabled={gcpMode}
              className={`flex-1 px-2 py-1 text-xs rounded border ${calibMode ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {calibMode ? t('fov.eyeDone') : t('fov.eyeBtn')}
            </button>
            <button
              onClick={() => setPairMode(!pairMode)}
              disabled={gcpMode}
              className={`flex-1 px-2 py-1 text-xs rounded border ${pairMode ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {pairMode ? t('fov.pairsDone') : t('fov.pairsBtn')}
            </button>
          </div>
        )}

        {/* --- modo a ojo --- */}
        {calibMode && (
          <div className="flex flex-col gap-1 rounded p-2 border bg-white mt-1">
            <div className="text-[11px] text-gray-600">{t('fov.eyeHelp')}</div>
            <FrameStatus />
            <div className="flex items-center gap-2">
              <input type="range" min={40} max={120} step={0.1} value={tuning.fov_h} onChange={(e) => setFovVisualSlider(parseFloat(e.target.value))} className="flex-1" />
              <input
                type="number"
                step={0.1}
                value={Number(tuning.fov_h.toFixed(2))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!Number.isNaN(v) && v > 0) setFovVisualSlider(v)
                }}
                className="w-20 text-sm border rounded px-1.5 py-0.5 font-mono text-right"
              />
              <span className="text-sm">°</span>
            </div>
            <TerrainPicker compact />
          </div>
        )}

        {/* --- modo por pares --- */}
        {pairMode && (
          <div className="flex flex-col gap-1 rounded p-2 border bg-white mt-1">
            <div className="text-[11px] text-gray-600">{t('fov.pairsHelp')}</div>
            <FrameStatus />
            <div className={`text-xs rounded p-1.5 border ${pairPending ? 'bg-orange-50 border-orange-300 text-orange-800' : 'bg-gray-50 text-gray-600'}`}>
              {pairPending ? t('fov.step2') : t('fov.step1')}
              {pairPending && (
                <button onClick={pairCancel} className="ml-2 underline text-gray-500">
                  {t('fov.cancel')}
                </button>
              )}
            </div>
            {pairs.length > 0 && (
              <div className="text-xs font-mono flex flex-col gap-0.5">
                {pairs.map((p) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <span>
                      <b>{p.id}</b> px ({p.px.toFixed(0)}, {p.py.toFixed(0)}) → {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
                    </span>
                    <button onClick={() => pairRemove(p.id)} className="text-gray-400 hover:text-red-600">
                      ✕
                    </button>
                  </div>
                ))}
                {pairTv !== null && (
                  <div className="text-gray-400">
                    {t('fov.frame')} tv={pairTv.toFixed(2)}s
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => void pairSolve()}
                disabled={pairs.length < 2}
                className="flex-1 px-2 py-1 text-xs rounded border bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('fov.solve', { n: pairs.length })}
              </button>
              <button onClick={pairClear} disabled={pairs.length === 0} className="px-2 py-1 text-xs rounded border text-gray-600 disabled:opacity-50">
                {t('fov.clear')}
              </button>
            </div>
            {pairResult && (
              <div className="text-xs rounded p-2 border bg-indigo-50 flex flex-col gap-1">
                <div className="font-mono">
                  {t('fov.result', {
                    fov: pairResult.fov_h_deg.toFixed(2),
                    gsd: pairResult.gsd.toFixed(4),
                    agl: pairResult.agl.toFixed(1),
                    terrain: pairResult.terrain_source,
                  })}
                </div>
                <div className="text-gray-600">
                  {t('fov.resultDetail', { n: pairResult.n_dist, pct: pairResult.residual_pct.toFixed(1) })}
                  {pairResult.residual_pct > 3 && t('fov.highSpread')}
                  {!pairResult.nadir_ok && t('fov.offNadirScale')}
                </div>
                <button onClick={pairApply} className="px-2 py-1 text-xs rounded border bg-emerald-600 text-white hover:bg-emerald-700">
                  {t('fov.apply')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- aspect ratio ---- */}
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {t('fov.aspect')}{' '}
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.001}
            value={Number(aspect.toFixed(4))}
            disabled={locked}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v) && v >= 0.5 && v <= 4) setTuning('aspect', v)
            }}
            className="w-20 text-[11px] border rounded px-1 py-0.5 font-mono text-right"
          />
        </span>
        {videoAspect && Math.abs(videoAspect - aspect) > 1e-3 && !locked && (
          <button onClick={() => setTuning('aspect', videoAspect)} className="underline text-gray-400 hover:text-gray-600">
            {t('fov.useVideo', { v: videoAspect.toFixed(3) })}
          </button>
        )}
      </div>
      {(calibMode || pairMode) && !nadirOk && footprint?.valid && <div className="text-[11px] text-amber-600">{t('fov.offNadirWarn')}</div>}
    </div>
  )
}

function FrameStatus() {
  const t = useT()
  const footprint = useStore((s) => s.footprint)
  if (!footprint || !footprint.valid) {
    return <div className="text-[11px] text-amber-600">{t('fov.noFootprint')}</div>
  }
  return (
    <div className="text-[11px] text-gray-600 font-mono">
      pitch {footprint.pitch.toFixed(0)}° · roll {footprint.roll.toFixed(0)}° · AGL {footprint.agl.toFixed(0)} m ·{' '}
      {footprint.nadir_ok ? <span className="text-green-700">{t('fov.nadir')}</span> : <span className="text-amber-600">{t('fov.offNadirShort')}</span>}
    </div>
  )
}
