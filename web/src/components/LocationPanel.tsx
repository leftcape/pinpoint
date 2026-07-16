import { useStore } from '../store'
import { FovCalibPanel } from './FovCalibPanel'
import { GcpPanel } from './GcpPanel'

// Location tools: swap video/map, follow the drone, and mark a point on the
// photo to read its ground coordinates.
export function LocationPanel() {
  const swapView = useStore((s) => s.swapView)
  const setSwapView = useStore((s) => s.setSwapView)
  const followDrone = useStore((s) => s.followDrone)
  const setFollowDrone = useStore((s) => s.setFollowDrone)
  const markMode = useStore((s) => s.markMode)
  const setMarkMode = useStore((s) => s.setMarkMode)
  const markedPoint = useStore((s) => s.markedPoint)
  const clearMarkedPoint = useStore((s) => s.clearMarkedPoint)
  const measureMode = useStore((s) => s.measureMode)
  const setMeasureMode = useStore((s) => s.setMeasureMode)
  const measureDecompose = useStore((s) => s.measureDecompose)
  const setMeasureDecompose = useStore((s) => s.setMeasureDecompose)
  const measurePoints = useStore((s) => s.measurePoints)
  const clearMeasure = useStore((s) => s.clearMeasure)

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
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2
      total += 2 * R * Math.asin(Math.sqrt(a))
    }
    return total
  })()
  const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`)

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold text-sm">Location</h3>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={swapView}
            onChange={(e) => setSwapView(e.target.checked)}
          />
          Swap video / map (big ↔ small)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={followDrone}
            onChange={(e) => setFollowDrone(e.target.checked)}
          />
          Follow the drone (keep it centered)
        </label>
      </div>

      {/* Mark a point on the photo -> project it to the map */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={markMode}
            onChange={(e) => setMarkMode(e.target.checked)}
          />
          Mark a point on the photo
        </label>
        {markMode && (
          <div className="text-xs text-gray-500">
            Click on the video to project that pixel to the ground. Tip: enable
            “Swap video / map” to click on the big video.
          </div>
        )}
        {markedPoint && (
          <div className="text-xs bg-blue-50 rounded p-2 border flex items-center justify-between">
            <span className="font-mono text-blue-800">
              {markedPoint.lat.toFixed(6)}, {markedPoint.lng.toFixed(6)}
            </span>
            <button onClick={clearMarkedPoint} className="text-gray-500 underline ml-2">
              clear
            </button>
          </div>
        )}
      </div>

      {/* Measure distance on the map */}
      <div className="flex flex-col gap-2 border-t pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={measureMode}
            onChange={(e) => setMeasureMode(e.target.checked)}
          />
          Measure distance
        </label>
        {measureMode && (
          <>
            <div className="text-xs text-gray-500">
              Click on the map to add points. The running distance is shown below.
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={measureDecompose}
                onChange={(e) => setMeasureDecompose(e.target.checked)}
              />
              Decompose last leg (X/Y on map)
            </label>
          </>
        )}
        {measurePoints.length > 0 && (
          <div className="text-xs bg-red-50 rounded p-2 border flex items-center justify-between">
            <span className="font-mono text-red-800">
              {measurePoints.length} pt{measurePoints.length > 1 ? 's' : ''} · {fmtDist(distance)}
            </span>
            <button onClick={clearMeasure} className="text-gray-500 underline ml-2">
              clear
            </button>
          </div>
        )}
      </div>

      <FovCalibPanel />

      <GcpPanel />
    </div>
  )
}
