import { useStore } from '../store'
import { fovVerticalFrom, FOV_H_DEFAULT } from '../api'

// PASO 0 — Fijar el FOV de la cámara por ESCALA, antes de tomar GCP.
//
// Sin un FOV bien fijado, la huella está mal de escala y los GCP medirían el
// error de calibración, no el del método. Aquí se ajusta con UN grado de
// libertad: el FOV horizontal, un dato de la cámara que NO se conoce a priori.
// La huella nadir queda clavada bajo el dron y solo crece/encoge; la foto se
// pinta encima del plano (proyección del frame) y se ajusta el FOV a ojo hasta
// que casa en escala con la ortofoto/MDT de fondo.
//
// Matemática: en nadir sobre suelo plano, medio-ancho_suelo = AGL·tan(FOV/2). El
// FOV vertical NO se toca: sale del aspect ratio del sensor (inferido del vídeo,
// editable) -> fov_v = 2·atan(tan(fov_h/2)/aspect).
//
// Condiciones: frame casi-nadir (pitch≈−90, roll≈0), suelo plano y MDT cargado
// para la cota. Fuera de nadir la proyección plana no es fiable y se avisa.

export function FovCalibPanel() {
  const active = useStore((s) => s.fovCalibMode)
  const setActive = useStore((s) => s.setFovCalibMode)
  const tuning = useStore((s) => s.tuning)
  const setTuning = useStore((s) => s.setTuning)
  const terrain = useStore((s) => s.terrain)
  const setTerrain = useStore((s) => s.setTerrain)
  const terrainEffective = useStore((s) => s.terrainEffective)
  const footprint = useStore((s) => s.footprint)
  const video = useStore((s) => s.video)
  const gcpMode = useStore((s) => s.gcpMode)

  const { fov_h, aspect } = tuning
  const fovV = fovVerticalFrom(fov_h, aspect)
  const videoAspect = video && video.height ? video.width / video.height : null

  const flat = terrain === 'flat'
  const nadirOk = footprint?.valid && footprint.nadir_ok

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          disabled={gcpMode}
        />
        Calibrar FOV por escala (paso 0)
      </label>

      {gcpMode && !active && (
        <div className="text-[11px] text-gray-400 italic">
          Sal del modo GCP para calibrar el FOV.
        </div>
      )}

      {active && (
        <>
          <div className="text-xs rounded p-2 border bg-gray-50 text-gray-600">
            Frame nadir sobre suelo plano. Ajusta el FOV hasta que la foto
            proyectada encaje en escala con el mapa de fondo. Es el paso previo a
            los GCP: fija aquí el FOV y luego mídelo con los puntos de control.
          </div>

          {/* modelo del terreno: hace falta la cota para el AGL */}
          <div className="flex flex-col gap-1 rounded p-2 border bg-slate-50">
            <div className="text-xs font-semibold text-slate-600">
              Modelo del terreno (para la cota / AGL)
            </div>
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
            {flat && (
              <div className="text-[11px] text-amber-600">
                ⚠ Terreno plano: la cota es la del despegue. Para calibrar bien,
                carga un MDT (IGN o Copernicus) si el suelo del frame no está a esa
                cota.
              </div>
            )}
            {!flat && terrainEffective && terrainEffective !== terrain && (
              <div className="text-[11px] text-amber-600">
                ⚠ Fuera de cobertura: se está usando “{terrainEffective}”.
              </div>
            )}
          </div>

          {/* estado del frame: nadir o no */}
          {footprint && footprint.valid ? (
            <div className="text-xs bg-gray-50 rounded p-2 border">
              <div className="text-gray-600">
                pitch {footprint.pitch.toFixed(0)}° · roll {footprint.roll.toFixed(0)}° · AGL{' '}
                {footprint.agl.toFixed(0)} m
              </div>
              {nadirOk ? (
                <div className="text-green-700">✓ nadir — la escala es fiable</div>
              ) : (
                <div className="text-amber-600">
                  ⚠ fuera de nadir ({reasonLabel(footprint.reason)}) — la escala NO es
                  fiable aquí; busca un frame más cenital
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-amber-600">
              Sin footprint en este frame (dron a nivel del suelo o sin sincronizar).
            </div>
          )}

          {/* --- FOV horizontal: el dato, directo en grados (se ajusta a ojo) --- */}
          <div className="flex flex-col gap-1 rounded p-2 border bg-indigo-50">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-indigo-800">FOV horizontal</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number(fov_h.toFixed(2))}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v)) setTuning('fov_h', v)
                  }}
                  className="w-24 text-sm border rounded px-1.5 py-1 font-mono text-right"
                />
                <span className="text-indigo-700 text-sm">°</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-indigo-600">
              <span>
                FOV vertical <b className="font-mono">{fovV.toFixed(1)}°</b> (del aspect)
              </span>
              <button
                onClick={() => setTuning('fov_h', FOV_H_DEFAULT)}
                className="underline text-indigo-400 hover:text-indigo-600"
                title={`Volver al valor por defecto (${FOV_H_DEFAULT}°, estimación de OpenSFM)`}
              >
                reset {FOV_H_DEFAULT}°
              </button>
            </div>
          </div>

          {/* --- Aspect ratio: inferido del vídeo, editable --- */}
          <div className="flex flex-col gap-1 rounded p-2 border bg-slate-50">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">Aspect ratio (ancho/alto)</span>
              <input
                type="number"
                min={0.5}
                max={4}
                step={0.001}
                value={Number(aspect.toFixed(4))}
                onChange={(e) => setTuning('aspect', clamp(parseFloat(e.target.value), 0.5, 4))}
                className="w-24 text-xs border rounded px-1 py-0.5 font-mono text-right"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                {videoAspect
                  ? `Vídeo: ${video!.width}×${video!.height} → ${videoAspect.toFixed(3)}`
                  : 'sin vídeo'}
              </span>
              {videoAspect && Math.abs(videoAspect - aspect) > 1e-3 && (
                <button
                  onClick={() => setTuning('aspect', videoAspect)}
                  className="underline text-slate-400 hover:text-slate-600"
                >
                  usar el del vídeo
                </button>
              )}
            </div>
          </div>

          <div className="text-[11px] text-gray-500">
            El centro de la huella queda clavado bajo el dron; el FOV solo cambia la
            escala. Si el centro cuadra pero los bordes no, ese desajuste es la
            distorsión gran angular (modelo de Brown) — es un resultado, no un fallo.
          </div>

          <button
            onClick={() => setActive(false)}
            className="px-2 py-1.5 text-sm rounded border bg-emerald-600 text-white hover:bg-emerald-700"
          >
            ✓ Fijar este FOV y salir
          </button>
          <div className="text-[11px] text-gray-400">
            El FOV queda fijado para toda la campaña (se guarda con cada punto).
            Ahora activa “Ground control points” para medir el error con este FOV.
          </div>
        </>
      )}
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

function reasonLabel(reason: string): string {
  return (
    { pitch: 'pitch fuera de rango', roll: 'roll fuera de rango', agl: 'poca altura' }[
      reason
    ] ?? reason
  )
}
