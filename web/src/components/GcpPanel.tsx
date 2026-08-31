import { useRef, useState } from 'react'
import { api, type Candidate } from '../api'
import { useStore } from '../store'
import { useT } from '../i18n'
import { alongCross, errStats, frameIndex, type Decomp, type GcpFrame, type GcpPoint } from '../sampler/gcp'
import { exportCampaign } from '../sampler/exportCampaign'
import { TerrainPicker } from './TerrainPicker'

// Pestaña Puntos de control: configuración de la campaña (con candado), toma de
// puntos foto↔mapa, ficha del punto con el error descompuesto, estadísticas en
// vivo, export/import.
export function GcpPanel() {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold text-sm">{t('gcp.title')}</h3>
      <CampaignConfig />
      <Taking />
      <Candidates />
      <Stats />
      <PointCard />
      <FrameList />
      <Files />
    </div>
  )
}

// ---------------------------------------------------------------- configuración

function CampaignConfig() {
  const t = useT()
  const c = useStore((s) => s.gcpCampaign)
  const setLocked = useStore((s) => s.setLocked)
  const saveState = useStore((s) => s.gcpSaveState)
  const storageFull = useStore((s) => s.gcpStorageFull)
  const cfg = c.config
  const fovActive = cfg.fov.active === 'visual' && cfg.fov.visual ? cfg.fov.visual.fov_h_deg : cfg.fov.sfm.fov_h_deg
  const fovOther = cfg.fov.active === 'visual' ? cfg.fov.sfm.fov_h_deg : cfg.fov.visual?.fov_h_deg

  const save =
    saveState === 'saved'
      ? [t('gcp.savedServer'), 'text-green-700']
      : saveState === 'saving'
        ? [t('gcp.saving'), 'text-gray-500']
        : saveState === 'error'
          ? [t('gcp.saveError'), 'text-red-600']
          : saveState === 'local-only'
            ? [t('gcp.localOnly'), 'text-amber-600']
            : ['', 'text-gray-400']

  return (
    <div className={`rounded border p-2 flex flex-col gap-1 text-xs ${cfg.locked ? 'bg-amber-50 border-amber-300' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-700">
          {t('gcp.config')} {cfg.locked ? '🔒' : '🔓'}
        </span>
        <button
          onClick={() => setLocked(!cfg.locked)}
          className={`px-2 py-0.5 rounded border text-[11px] ${cfg.locked ? 'bg-white text-amber-800' : 'bg-amber-500 text-white border-amber-500'}`}
          title={t('gcp.lockHint')}
        >
          {cfg.locked ? t('gcp.unlock') : t('gcp.lock')}
        </button>
      </div>
      <div className="font-mono text-gray-700 grid grid-cols-[auto_1fr] gap-x-2">
        <span className="text-gray-400">{t('gcp.flight')}</span>
        <span className="truncate" title={c.source_key ?? ''}>
          {c.source_label ?? '—'} {c.source_key && <span className="text-gray-400">[{c.source_key.slice(0, 8)}]</span>}
        </span>
        <span className="text-gray-400">{t('gcp.sync')}</span>
        <span>
          {cfg.sync.method} · {t('gcp.offset')} {cfg.sync.offset_s.toFixed(2)} s
        </span>
        <span className="text-gray-400">{t('gcp.fov')}</span>
        <span>
          <b>{cfg.fov.active}</b> {fovActive.toFixed(2)}°
          {fovOther !== undefined && (
            <span className="text-gray-400">
              {' '}· {t('gcp.other')} {fovOther.toFixed(2)}°
            </span>
          )}
          {cfg.fov.active === 'sfm' && !cfg.fov.visual && <span className="text-amber-600"> · {t('gcp.noVisual')}</span>}
        </span>
        <span className="text-gray-400">{t('gcp.terrain')}</span>
        <span>
          {cfg.terrain} · Δpitch {cfg.d_pitch}° · Δroll {cfg.d_roll}°
        </span>
      </div>
      {!cfg.locked && <TerrainPicker compact />}
      <div className="flex items-center justify-between text-[11px]">
        <span className={save[1]}>{save[0]}</span>
        {storageFull && <span className="text-red-700 font-semibold">{t('gcp.storageFull')}</span>}
      </div>
      {!cfg.locked && <div className="text-[11px] text-amber-700">{t('gcp.beforeMarking')}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- toma de puntos

function Taking() {
  const t = useT()
  const gcpMode = useStore((s) => s.gcpMode)
  const setGcpMode = useStore((s) => s.setGcpMode)
  const marking = useStore((s) => s.gcpMarking)
  const startMarking = useStore((s) => s.gcpStartMarking)
  const stopMarking = useStore((s) => s.gcpStopMarking)
  const pending = useStore((s) => s.gcpPendingPixel)
  const busy = useStore((s) => s.gcpBusy)
  const cancelPending = useStore((s) => s.gcpCancelPending)
  const footprint = useStore((s) => s.footprint)

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={gcpMode} onChange={(e) => setGcpMode(e.target.checked)} />
        {t('gcp.take')}
      </label>
      {gcpMode && (
        <>
          {footprint && footprint.valid && (
            <div className="text-[11px] font-mono text-gray-600">
              pitch {footprint.pitch.toFixed(0)}° · roll {footprint.roll.toFixed(0)}° · AGL {footprint.agl.toFixed(0)} m ·{' '}
              {footprint.nadir_ok ? <span className="text-green-700">{t('fov.nadir')}</span> : <span className="text-amber-600">{t('gcp.offNadirMark')}</span>}
            </div>
          )}
          {!marking ? (
            <div className="flex flex-col gap-2">
              <div className="text-xs rounded p-2 border bg-gray-50 text-gray-600">{t('gcp.freeVideo')}</div>
              <button onClick={startMarking} className="px-2 py-1.5 text-sm rounded border bg-emerald-600 text-white hover:bg-emerald-700">
                {t('gcp.startMarking')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className={`text-xs rounded p-2 border ${pending ? 'bg-orange-50 border-orange-300 text-orange-800' : 'bg-gray-50 text-gray-600'}`}>
                {busy ? t('gcp.projecting') : pending ? t('gcp.step2') : t('gcp.step1')}
                {pending && !busy && (
                  <button onClick={cancelPending} className="ml-2 underline text-gray-500">
                    {t('gcp.cancel')}
                  </button>
                )}
              </div>
              <button onClick={stopMarking} className="px-2 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                {t('gcp.stopMarking')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- candidatos

function Candidates() {
  const t = useT()
  const sourceId = useStore((s) => s.sourceId)
  const syncMethod = useStore((s) => s.syncMethod)
  const manualOffset = useStore((s) => s.manualOffset)
  const videoSeekTo = useStore((s) => s.videoSeekTo)
  const frames = useStore((s) => s.gcpCampaign.frames)
  const [mode, setMode] = useState<'straight' | 'turns'>('straight')
  const [n, setN] = useState(25)
  const [maxRoll, setMaxRoll] = useState(3)
  const [list, setList] = useState<Candidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const load = async () => {
    if (!sourceId) return
    setBusy(true)
    try {
      const r = await api.candidates(sourceId, mode, syncMethod, manualOffset, n, maxRoll)
      setList(r.candidates)
    } catch {
      setList([])
    } finally {
      setBusy(false)
    }
  }
  const marked = (tv: number) => frames.some((f) => Math.abs(f.telemetry.tv - tv) < 0.75)

  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <button onClick={() => setOpen(!open)} className="text-left text-sm font-semibold">
        {open ? '▾' : '▸'} {t('cand.title')}
      </button>
      {open && (
        <>
          <div className="text-[11px] text-gray-500">{t('cand.help')}</div>
          <div className="flex items-center gap-1 text-xs">
            {(['straight', 'turns'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded border ${mode === m ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}
              >
                {t(m === 'straight' ? 'cand.straight' : 'cand.turns')}
              </button>
            ))}
            {mode === 'straight' && (
              <>
                <label className="ml-1 text-gray-500">{t('cand.n')}</label>
                <input type="number" min={1} max={200} value={n} onChange={(e) => setN(parseInt(e.target.value) || 25)} className="w-14 border rounded px-1 py-0.5 font-mono" />
                <label className="text-gray-500">{t('cand.maxRoll')}</label>
                <input type="number" min={0.5} step={0.5} value={maxRoll} onChange={(e) => setMaxRoll(parseFloat(e.target.value) || 3)} className="w-14 border rounded px-1 py-0.5 font-mono" />
              </>
            )}
            <button onClick={() => void load()} disabled={busy || !sourceId} className="ml-auto px-2 py-0.5 rounded border bg-indigo-600 text-white disabled:opacity-50">
              {t('cand.propose')}
            </button>
          </div>
          {list && list.length === 0 && <div className="text-[11px] text-gray-400 italic">{t('cand.none')}</div>}
          {list && list.length > 0 && (
            <div className="max-h-48 overflow-y-auto text-[11px] font-mono flex flex-col">
              {list.map((c) => (
                <div key={`${c.kind}-${c.tv}`} className={`flex items-center justify-between border-t py-0.5 ${marked(c.tv) ? 'text-emerald-700' : ''}`}>
                  <span>
                    tv {c.tv.toFixed(1)}s · roll {c.roll >= 0 ? '+' : ''}{c.roll.toFixed(1)}° · pitch {c.pitch.toFixed(0)}° · AGL {c.agl.toFixed(0)} m
                    <span className="text-gray-400"> · {c.bin}</span>
                    {marked(c.tv) && ` ${t('cand.marked')}`}
                  </span>
                  <button onClick={() => videoSeekTo(c.tv)} className="px-1.5 rounded border hover:bg-gray-50">
                    {t('cand.go')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- estadísticas

function Stats() {
  const t = useT()
  const frames = useStore((s) => s.gcpCampaign.frames)
  const total = frames.reduce((a, f) => a + f.points.length, 0)
  if (total === 0) return null

  const nadir = frames.filter((f) => f.telemetry.nadir_ok)
  const pick = (fs: GcpFrame[], get: (p: GcpPoint) => number | undefined) =>
    fs.flatMap((f) => f.points.map(get)).filter((v): v is number => typeof v === 'number')

  const altKind = nadir.find((f) => f.points.some((p) => p.alt))?.points.find((p) => p.alt)?.alt?.fov_kind ?? 'alt'
  const rows: { label: string; s: ReturnType<typeof errStats> }[] = [
    { label: t('gcp.attitude'), s: errStats(pick(nadir, (p) => p.err_attitude?.direct)) },
    { label: t('gcp.ortho'), s: errStats(pick(nadir, (p) => p.err_ortho?.direct)) },
    { label: t('gcp.attitudeFov', { k: altKind }), s: errStats(pick(nadir, (p) => p.alt?.err_attitude?.direct)) },
  ]
  const f1 = (v: number) => v.toFixed(1)

  return (
    <div className="rounded border p-2 text-xs flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="font-semibold text-gray-700">{t('gcp.campaign')}</span>
        <span className="font-mono text-gray-600">{t('gcp.statsHeader', { f: frames.length, p: total, n: nadir.length })}</span>
      </div>
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-gray-400">
            <th className="text-left font-normal">{t('gcp.errNadir')}</th>
            <th className="text-right font-normal">{t('gcp.n')}</th>
            <th className="text-right font-normal">{t('gcp.rmse')}</th>
            <th className="text-right font-normal">{t('gcp.median')}</th>
            <th className="text-right font-normal">{t('gcp.p90')}</th>
            <th className="text-right font-normal">{t('gcp.max')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.s ? (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="text-right">{r.s.n}</td>
                <td className="text-right">{f1(r.s.rmse)}</td>
                <td className="text-right">{f1(r.s.median)}</td>
                <td className="text-right">{f1(r.s.p90)}</td>
                <td className="text-right">{f1(r.s.max)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- ficha del punto

function PointCard() {
  const t = useT()
  const sel = useStore((s) => s.gcpSelected)
  const frames = useStore((s) => s.gcpCampaign.frames)
  if (!sel) return null
  const f = frames.find((x) => x.frame_id === sel.frameId)
  const p = f?.points.find((x) => x.id === sel.pointId)
  if (!f || !p) return null
  const tm = f.telemetry
  const pctX = (100 * p.offset_px.x) / (tm.imgW / 2)
  const pctY = (100 * p.offset_px.y) / (tm.imgH / 2)
  const sgn = (v: number, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d)

  const row = (label: string, e: Decomp | null, cls: string) => {
    if (!e) return null
    const ac = alongCross(e, tm.yaw)
    return (
      <tr key={label} className={cls}>
        <td>{label}</td>
        <td className="text-right">{sgn(e.x)}</td>
        <td className="text-right">{sgn(e.y)}</td>
        <td className="text-right">{sgn(ac.along)}</td>
        <td className="text-right">{sgn(ac.cross)}</td>
        <td className="text-right font-bold">{e.direct.toFixed(1)}</td>
      </tr>
    )
  }

  return (
    <div className="rounded border p-2 text-xs flex flex-col gap-1 bg-yellow-50 border-yellow-300">
      <div className="flex justify-between font-mono">
        <span>
          <b>
            {f.frame_id} · {p.id}
          </b>{' '}
          · tv {tm.tv.toFixed(2)} s
        </span>
        <span className="text-gray-600">
          pitch {tm.pitch.toFixed(0)}° · roll {tm.roll.toFixed(0)}° · AGL {tm.agl.toFixed(0)} m
        </span>
      </div>
      <div className="font-mono text-gray-700">
        {t('gcp.pixelLine', {
          x: sgn(p.offset_px.x, 0),
          y: sgn(p.offset_px.y, 0),
          px: sgn(pctX, 0),
          py: sgn(pctY, 0),
          r: p.offset_px.norm.toFixed(0),
          d: p.truth_from_nadir.direct.toFixed(1),
        })}
      </div>
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-gray-400">
            <th className="text-left font-normal">{t('gcp.errM')}</th>
            <th className="text-right font-normal">E</th>
            <th className="text-right font-normal">N</th>
            <th className="text-right font-normal">along</th>
            <th className="text-right font-normal">cross</th>
            <th className="text-right font-normal">{t('gcp.total')}</th>
          </tr>
        </thead>
        <tbody>
          {row(`${t('gcp.attitude')} · ${tm.fov_kind} ${tm.fov_h.toFixed(1)}°`, p.err_attitude, 'text-red-700')}
          {row(`${t('gcp.ortho')} · ${tm.fov_kind}`, p.err_ortho, 'text-blue-700')}
          {p.alt && row(`${t('gcp.attitude')} · ${p.alt.fov_kind} ${p.alt.fov_h.toFixed(1)}°`, p.alt.err_attitude, 'text-red-500')}
          {p.alt && row(`${t('gcp.ortho')} · ${p.alt.fov_kind}`, p.alt.err_ortho, 'text-blue-500')}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-500">{t('gcp.axesNote', { yaw: tm.yaw.toFixed(0) })}</div>
    </div>
  )
}

// ---------------------------------------------------------------- lista

function FrameList() {
  const t = useT()
  const campaign = useStore((s) => s.gcpCampaign)
  const selected = useStore((s) => s.gcpSelected)
  const select = useStore((s) => s.gcpSelect)
  const deletePoint = useStore((s) => s.gcpDeletePoint)
  const deleteFrame = useStore((s) => s.gcpDeleteFrame)
  const videoSeekTo = useStore((s) => s.videoSeekTo)
  const currentTv = useStore((s) => s.currentTv)
  const video = useStore((s) => s.video)
  const curFi = video ? frameIndex(currentTv, video.fps) : -1
  const sgn = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(0)

  if (campaign.frames.length === 0) return <div className="text-xs text-gray-400 italic">{t('gcp.noPoints')}</div>

  return (
    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
      {campaign.frames.map((f) => {
        const here = f.telemetry.frame_index === curFi
        return (
          <div key={f.frame_id} className="border rounded">
            <div className={`flex items-center justify-between px-2 py-1 text-xs font-semibold ${here ? 'bg-blue-50 text-blue-800' : 'bg-gray-50 text-gray-600'}`}>
              <button onClick={() => videoSeekTo(f.telemetry.tv)} className="hover:underline" title={t('gcp.gotoFrame')}>
                {f.frame_id} · tv={f.telemetry.tv.toFixed(1)}s · roll {f.telemetry.roll.toFixed(0)}° · {f.points.length} pt
                {!f.telemetry.nadir_ok && ' ⚠'}
              </button>
              <button onClick={() => deleteFrame(f.frame_id)} className="text-gray-400 hover:text-red-600" title={t('gcp.deleteFrame')}>
                ✕
              </button>
            </div>
            {f.points.map((p) => {
              const on = selected?.frameId === f.frame_id && selected?.pointId === p.id
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    if (!here) videoSeekTo(f.telemetry.tv)
                    select(f.frame_id, p.id)
                  }}
                  className={`flex items-center justify-between px-2 py-1 text-[11px] cursor-pointer border-t font-mono ${on ? 'bg-yellow-100' : 'hover:bg-gray-50'}`}
                >
                  <span>
                    <b>{p.id}</b>
                    <span className="text-gray-400">
                      {' '}
                      {sgn(p.offset_px.x)}/{sgn(p.offset_px.y)}px
                    </span>
                  </span>
                  <span>
                    <span className="text-blue-600" title={t('gcp.orthoTitle')}>
                      {p.err_ortho ? `${sgn(p.err_ortho.x)}/${sgn(p.err_ortho.y)} ${p.err_ortho.direct.toFixed(1)}m` : '—'}
                    </span>
                    <span className="text-gray-300"> · </span>
                    <span className="text-red-600" title={t('gcp.attTitle')}>
                      {p.err_attitude ? `${sgn(p.err_attitude.x)}/${sgn(p.err_attitude.y)} ${p.err_attitude.direct.toFixed(1)}m` : '—'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deletePoint(f.frame_id, p.id)
                      }}
                      className="ml-2 text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- ficheros

function Files() {
  const t = useT()
  const campaign = useStore((s) => s.gcpCampaign)
  const resetPoints = useStore((s) => s.gcpResetPoints)
  const gcpImport = useStore((s) => s.gcpImport)
  const saveNow = useStore((s) => s.gcpSaveNow)
  const [note, setNote] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const total = campaign.frames.reduce((a, f) => a + f.points.length, 0)

  const doExport = async () => {
    setExporting(true)
    setNote(t('gcp.generatingShots'))
    try {
      const { filename, frames } = await exportCampaign()
      setNote(t('gcp.exportNote', { f: filename, n: frames, p: total }))
    } catch (e) {
      setNote(t('gcp.error', { e: String(e) }))
    } finally {
      setExporting(false)
    }
  }

  const onFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text())
      const merge = campaign.frames.length > 0 && confirm(t('gcp.mergeConfirm'))
      setNote(gcpImport(raw, merge ? 'merge' : 'replace'))
    } catch (e) {
      setNote(t('gcp.importFail', { e: String(e) }))
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <div className="flex gap-2">
        <button
          onClick={doExport}
          disabled={exporting || total === 0}
          className="flex-1 px-2 py-1.5 text-sm rounded border bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {exporting ? t('gcp.generating') : t('gcp.export', { n: total })}
        </button>
        <button onClick={() => fileRef.current?.click()} className="px-2 py-1.5 text-sm rounded border text-gray-700 hover:bg-gray-50" title={t('gcp.importTitle')}>
          {t('gcp.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => {
            if (confirm(t('gcp.resetConfirm', { n: total }))) {
              resetPoints()
              setNote(null)
            }
          }}
          disabled={total === 0}
          className="px-2 py-1.5 text-sm rounded border text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          title={t('gcp.resetTitle')}
        >
          🗑
        </button>
      </div>
      <button onClick={() => void saveNow()} className="text-[11px] underline text-gray-400 hover:text-gray-600 self-start">
        {t('gcp.saveNow')}
      </button>
      {note && <div className="text-[11px] text-gray-500">{note}</div>}
    </div>
  )
}
