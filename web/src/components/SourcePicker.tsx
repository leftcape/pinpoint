import { useState } from 'react'
import { useStore } from '../store'

// Registrar por ruta del servidor o subir ficheros. Dos modos para cubrir
// tanto "los ficheros ya están en el servidor" como "los subo desde el navegador".
export function SourcePicker() {
  const [mode, setMode] = useState<'path' | 'upload'>('path')
  // rutas por defecto del vuelo de prueba en el servidor (editables)
  const [binPath, setBinPath] = useState(
    '/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico/00000064.BIN',
  )
  const [videoPath, setVideoPath] = useState(
    '/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico/recording_96_visible.mkv',
  )
  const [binFile, setBinFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)

  const registerSource = useStore((s) => s.registerSource)
  const uploadSource = useStore((s) => s.uploadSource)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)

  return (
    <div className="flex flex-col gap-3 max-w-md">
      <h2 className="text-lg font-semibold">Load flight</h2>
      <div className="flex gap-1">
        <TabBtn active={mode === 'path'} onClick={() => setMode('path')}>
          Server path
        </TabBtn>
        <TabBtn active={mode === 'upload'} onClick={() => setMode('upload')}>
          Upload files
        </TabBtn>
      </div>

      {mode === 'path' ? (
        <>
          <input
            placeholder="/path/to/log.bin"
            value={binPath}
            onChange={(e) => setBinPath(e.target.value)}
            className="border rounded px-2 py-1 text-sm font-mono"
          />
          <input
            placeholder="/path/to/video.mkv"
            value={videoPath}
            onChange={(e) => setVideoPath(e.target.value)}
            className="border rounded px-2 py-1 text-sm font-mono"
          />
          <button
            onClick={() => registerSource(binPath, videoPath)}
            disabled={loading || !binPath || !videoPath}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load'}
          </button>
        </>
      ) : (
        <>
          <label className="text-xs text-gray-500">Log .bin</label>
          <input type="file" accept=".bin,.BIN" onChange={(e) => setBinFile(e.target.files?.[0] ?? null)} />
          <label className="text-xs text-gray-500">Video (.mkv recommended)</label>
          <input
            type="file"
            accept="video/*,.mkv"
            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => binFile && videoFile && uploadSource(binFile, videoFile)}
            disabled={loading || !binFile || !videoFile}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {loading ? 'Uploading…' : 'Upload and load'}
          </button>
        </>
      )}

      {error && <div className="text-red-600 text-xs">{error}</div>}
      <p className="text-xs text-gray-400">
        Tip: use the original .mkv (it keeps creation_time). A re-encoded .mp4 usually
        loses it and you can only sync by takeoff or manually.
      </p>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm rounded ${active ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}
    >
      {children}
    </button>
  )
}
