import { useStore } from '../store'
import { FOV_BASE, fovEffective, fovScaleForEffective } from '../api'

// PASO 0 — Calibrar el FOV por ESCALA, antes de tomar GCP.
//
// Sin un FOV bien fijado, la huella está mal de escala y los GCP medirían el
// error de calibración, no el del método. Aquí se calibra con UN solo grado de
// libertad: el FOV. La huella nadir queda clavada al punto bajo el dron y solo
// crece/encoge con el slider; la foto se pinta encima del plano (proyección del
// frame) y se ajusta hasta que casa en escala con la ortofoto/MDT de fondo.
//
// Matemática: en nadir sobre suelo plano, medio-ancho_suelo = AGL·tan(FOV/2).
// El slider mueve los GRADOS efectivos; por debajo se guarda como fov_scale
// (factor sobre tan(FOV/2), que es donde vive la distorsión de la lente):
//   fov_scale = tan(FOV_eff/2) / tan(FOV_nominal/2)
//
// Condiciones: frame casi-nadir (pitch≈−90, roll≈0), suelo plano y MDT cargado
// para la cota. Fuera de nadir la proyección plana no es fiable y se avisa.

// límites del slider en grados efectivos (H). Con FOV_BASE.h=72.3 esto cubre
// desde algo más estrecho que el nominal hasta un gran angular marcado.
const FOV_MIN_DEG = 60
const FOV_MAX_DEG = 105

export function FovCalibPanel() {
  const active = useStore((s) => s.fovCalibMode)
  const setActive = useStore((s) => s.setFovCalibMode)
  const fovScale = useStore((s) => s.tuning.fov_scale)
  const setTuning = useStore((s) => s.setTuning)
  const terrain = useStore((s) => s.terrain)
  const setTerrain = useStore((s) => s.setTerrain)
  const terrainEffective = useStore((s) => s.terrainEffective)
  const footprint = useStore((s) => s.footprint)
  const gcpMode = useStore((s) => s.gcpMode)

  // grados efectivos actuales, derivados del fov_scale guardado
  const fovH = fovEffective(FOV_BASE.h, fovScale)
  const fovV = fovEffective(FOV_BASE.v, fovScale)

  // el slider trabaja en grados H; al mover, se convierte a fov_scale
  const onFov = (fovEffH: number) => {
    setTuning('fov_scale', Number(fovScaleForEffective(FOV_BASE.h, fovEffH).toFixed(4)))
  }

  // ¿el frame actual sirve para calibrar? (nadir + plano no exigido pero avisado)
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

          {/* el slider: FOV en GRADOS (guardado como fov_scale por debajo) */}
          <div className="flex flex-col gap-1 rounded p-2 border bg-indigo-50">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-indigo-800">
                FOV efectivo (horizontal)
              </span>
              <span className="font-mono text-indigo-900">
                {fovH.toFixed(1)}° <span className="text-indigo-400">× {fovV.toFixed(1)}° V</span>
              </span>
            </div>
            <input
              type="range"
              min={FOV_MIN_DEG}
              max={FOV_MAX_DEG}
              step={0.1}
              value={Math.min(FOV_MAX_DEG, Math.max(FOV_MIN_DEG, fovH))}
              onChange={(e) => onFov(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex items-center justify-between text-[11px] text-indigo-500">
              <span>{FOV_MIN_DEG}°</span>
              <span>
                fov_scale = <b className="font-mono">{fovScale.toFixed(3)}</b>
                <span className="text-indigo-400"> (nominal {FOV_BASE.h}°)</span>
              </span>
              <span>{FOV_MAX_DEG}°</span>
            </div>
          </div>

          <div className="text-[11px] text-gray-500">
            El centro de la huella queda clavado bajo el dron; el slider solo cambia
            la escala. Si el centro cuadra pero los bordes no, ese desajuste es la
            distorsión gran angular (modelo de Brown) — es un resultado, no un fallo.
          </div>

          <button
            onClick={() => setActive(false)}
            className="px-2 py-1.5 text-sm rounded border bg-emerald-600 text-white hover:bg-emerald-700"
          >
            ✓ Fijar este FOV y salir
          </button>
          <div className="text-[11px] text-gray-400">
            El fov_scale queda fijado para toda la campaña. Ahora activa “Ground
            control points” para medir el error con este FOV.
          </div>
        </>
      )}
    </div>
  )
}

function reasonLabel(reason: string): string {
  return (
    { pitch: 'pitch fuera de rango', roll: 'roll fuera de rango', agl: 'poca altura' }[
      reason
    ] ?? reason
  )
}
