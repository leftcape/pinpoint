import { useState } from 'react'
import { useStore } from '../store'
import { frameIndex } from '../sampler/gcp'
import { exportCampaign } from '../sampler/exportCampaign'

// Toma de puntos de control: foto y mapa lado a lado, click-click por punto,
// lista de lo tomado y exportación de la campaña completa.
export function GcpPanel() {
  const gcpMode = useStore((s) => s.gcpMode)
  const setGcpMode = useStore((s) => s.setGcpMode)
  const fovCalibMode = useStore((s) => s.fovCalibMode)
  const marking = useStore((s) => s.gcpMarking)
  const startMarking = useStore((s) => s.gcpStartMarking)
  const stopMarking = useStore((s) => s.gcpStopMarking)
  const terrain = useStore((s) => s.terrain)
  const terrainEffective = useStore((s) => s.terrainEffective)
  const setTerrain = useStore((s) => s.setTerrain)
  const campaign = useStore((s) => s.gcpCampaign)
  const pending = useStore((s) => s.gcpPendingPixel)
  const busy = useStore((s) => s.gcpBusy)
  const selected = useStore((s) => s.gcpSelected)
  const select = useStore((s) => s.gcpSelect)
  const deletePoint = useStore((s) => s.gcpDeletePoint)
  const deleteFrame = useStore((s) => s.gcpDeleteFrame)
  const resetCampaign = useStore((s) => s.gcpResetCampaign)
  const cancelPending = useStore((s) => s.gcpCancelPending)
  const videoSeekTo = useStore((s) => s.videoSeekTo)
  const currentTv = useStore((s) => s.currentTv)
  const video = useStore((s) => s.video)
  const storageFull = useStore((s) => s.gcpStorageFull)
  const [note, setNote] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const total = campaign.frames.reduce((a, f) => a + f.points.length, 0)
  const curFi = video ? frameIndex(currentTv, video.fps) : -1

  const doExport = async () => {
    setExporting(true)
    setNote('Generando capturas…')
    try {
      const { filename, frames } = await exportCampaign()
      setNote(`Guardado ${filename} · ${frames} frame(s), ${total} punto(s)`)
    } catch (e) {
      setNote(`Error: ${String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={gcpMode}
          onChange={(e) => setGcpMode(e.target.checked)}
          disabled={fovCalibMode}
        />
        Ground control points (paper)
      </label>
      {fovCalibMode && !gcpMode && (
        <div className="text-[11px] text-gray-400 italic">
          Fija primero el FOV (paso 0) y sal de la calibración.
        </div>
      )}

      {gcpMode && (
        <>
          {/* modelo del terreno para el AGL — se puede cambiar para comparar */}
          <div className="flex flex-col gap-1 rounded p-2 border bg-slate-50">
            <div className="text-xs font-semibold text-slate-600">Modelo del terreno (AGL)</div>
            <div className="flex gap-1">
              {(
                [
                  ['flat', 'Plano'],
                  ['ign', 'IGN 5m'],
                  ['cop', 'Copernicus 90m'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTerrain(key)}
                  className={`flex-1 px-1.5 py-1 text-xs rounded border ${
                    terrain === key
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-500">
              {terrain === 'flat'
                ? 'Terreno plano a la cota del despegue (sin corregir el relieve).'
                : terrainEffective && terrainEffective !== terrain
                  ? `⚠ Fuera de cobertura: se está usando "${terrainEffective}".`
                  : terrain === 'ign'
                    ? 'MDT 5 m del IGN (solo España).'
                    : 'Copernicus DEM 90 m (mundial, sin login).'}
            </div>
          </div>

          {!marking ? (
            <div className="flex flex-col gap-2">
              <div className="text-xs rounded p-2 border bg-gray-50 text-gray-600">
                Vídeo libre: muévete al fotograma que quieras (barra o flechas) y pulsa
                “Empezar a marcar”. Al terminar un frame, vuelve aquí y salta a otro.
              </div>
              <button
                onClick={startMarking}
                className="px-2 py-1.5 text-sm rounded border bg-emerald-600 text-white hover:bg-emerald-700"
              >
                🎯 Empezar a marcar este frame
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div
                className={`text-xs rounded p-2 border ${
                  pending ? 'bg-orange-50 border-orange-300 text-orange-800' : 'bg-gray-50 text-gray-600'
                }`}
              >
                {busy
                  ? 'Proyectando…'
                  : pending
                    ? '2/2 → ahora haz click en el MAPA, en ese mismo punto.'
                    : '1/2 → haz click en la FOTO, en un punto reconocible.'}
                {pending && !busy && (
                  <button onClick={cancelPending} className="ml-2 underline text-gray-500">
                    cancelar
                  </button>
                )}
              </div>
              <button
                onClick={stopMarking}
                className="px-2 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                ✓ Terminar este frame (mover el vídeo)
              </button>
            </div>
          )}

          {/* lista de frames y sus puntos */}
          {campaign.frames.length === 0 ? (
            <div className="text-xs text-gray-400 italic">Sin puntos todavía.</div>
          ) : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {campaign.frames.map((f) => {
                const here = f.telemetry.frame_index === curFi
                return (
                  <div key={f.frame_id} className="border rounded">
                    <div
                      className={`flex items-center justify-between px-2 py-1 text-xs font-semibold ${
                        here ? 'bg-blue-50 text-blue-800' : 'bg-gray-50 text-gray-600'
                      }`}
                    >
                      <button
                        onClick={() => videoSeekTo(f.telemetry.tv)}
                        className="hover:underline"
                        title="Ir a este frame"
                      >
                        {f.frame_id} · tv={f.telemetry.tv.toFixed(1)}s · {f.points.length} pt
                        {!f.telemetry.nadir_ok && ' ⚠'}
                      </button>
                      <button
                        onClick={() => deleteFrame(f.frame_id)}
                        className="text-gray-400 hover:text-red-600"
                        title="Borrar el frame entero"
                      >
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
                          className={`flex items-center justify-between px-2 py-1 text-xs cursor-pointer border-t ${
                            on ? 'bg-yellow-100' : 'hover:bg-gray-50'
                          }`}
                        >
                          <span className="font-mono">
                            <b>{p.id}</b>
                            <span className="text-gray-400"> · {p.offset_px.norm.toFixed(0)}px</span>
                          </span>
                          <span className="font-mono">
                            <span className="text-blue-600" title="error de la ortogonal">
                              {p.err_ortho ? `${p.err_ortho.direct.toFixed(1)}m` : '—'}
                            </span>
                            <span className="text-gray-300"> / </span>
                            <span className="text-red-600" title="error con actitud">
                              {p.err_attitude ? `${p.err_attitude.direct.toFixed(1)}m` : '—'}
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
          )}

          {storageFull && (
            <div className="text-[11px] bg-red-100 border border-red-300 rounded p-2 text-red-800 font-semibold">
              ⚠ La campaña ya NO se está guardando (almacenamiento lleno). Exporta AHORA: si
              recargas, se pierde.
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={doExport}
              disabled={exporting || total === 0}
              className="flex-1 px-2 py-1.5 text-sm rounded border bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {exporting ? 'Generando…' : `📦 Export campaign (${total} pt)`}
            </button>
            <button
              onClick={() => {
                if (confirm(`¿Borrar la campaña entera (${total} puntos)? No se puede deshacer.`)) {
                  resetCampaign()
                  setNote(null)
                }
              }}
              disabled={total === 0}
              className="px-2 py-1.5 text-sm rounded border text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              title="Borrar todos los puntos"
            >
              🗑
            </button>
          </div>
          {note && <div className="text-[11px] text-gray-500">{note}</div>}
        </>
      )}
    </div>
  )
}
