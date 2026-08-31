import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { useT } from '../i18n'

type Known = { id: string; key: string; label: string; bin_path: string; video_path: string; has_campaign: boolean }

// Registrar por ruta del servidor o subir ficheros. Dos modos para cubrir
// tanto "los ficheros ya están en el servidor" como "los subo desde el navegador".
export function SourcePicker() {
  const t = useT()
  const [mode, setMode] = useState<'path' | 'upload'>('path')
  // rutas por defecto del vuelo de prueba en el servidor (editables)
  const [binPath, setBinPath] = useState('/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico/00000064.BIN')
  const [videoPath, setVideoPath] = useState('/mnt/data/srv/carto_private/08_TEST/vueloFotogrametrico/recording_96_visible.mkv')
  const [binFile, setBinFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)

  const registerSource = useStore((s) => s.registerSource)
  const uploadSource = useStore((s) => s.uploadSource)
  const openSource = useStore((s) => s.openSource)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const [known, setKnown] = useState<Known[]>([])
  useEffect(() => {
    api.listSources().then(setKnown).catch(() => setKnown([]))
  }, [])

  return (
    <div className="flex flex-col gap-3 max-w-md">
      <h2 className="text-lg font-semibold">{t('src.title')}</h2>

      {known.length > 0 && (
        <div className="flex flex-col gap-1 rounded border bg-white p-2">
          <div className="text-xs font-semibold text-gray-600">{t('src.known')}</div>
          {known.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono truncate" title={`${k.bin_path}\n${k.video_path}`}>
                {k.label} <span className="text-gray-400">[{k.key.slice(0, 8)}]</span>
                {k.has_campaign && <span className="ml-1 text-emerald-700">· {t('src.hasCampaign')}</span>}
              </span>
              <button onClick={() => openSource(k.id)} disabled={loading} className="px-2 py-0.5 rounded border bg-gray-800 text-white disabled:opacity-50">
                {t('src.open')}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <TabBtn active={mode === 'path'} onClick={() => setMode('path')}>
          {t('src.serverPath')}
        </TabBtn>
        <TabBtn active={mode === 'upload'} onClick={() => setMode('upload')}>
          {t('src.upload')}
        </TabBtn>
      </div>

      {mode === 'path' ? (
        <>
          <input placeholder={t('src.binPlaceholder')} value={binPath} onChange={(e) => setBinPath(e.target.value)} className="border rounded px-2 py-1 text-sm font-mono" />
          <input placeholder={t('src.videoPlaceholder')} value={videoPath} onChange={(e) => setVideoPath(e.target.value)} className="border rounded px-2 py-1 text-sm font-mono" />
          <button
            onClick={() => registerSource(binPath, videoPath)}
            disabled={loading || !binPath || !videoPath}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {loading ? t('src.loading') : t('src.load')}
          </button>
        </>
      ) : (
        <>
          <label className="text-xs text-gray-500">{t('src.binLabel')}</label>
          <input type="file" accept=".bin,.BIN" onChange={(e) => setBinFile(e.target.files?.[0] ?? null)} />
          <label className="text-xs text-gray-500">{t('src.videoLabel')}</label>
          <input type="file" accept="video/*,.mkv" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => binFile && videoFile && uploadSource(binFile, videoFile)}
            disabled={loading || !binFile || !videoFile}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {loading ? t('src.uploading') : t('src.uploadLoad')}
          </button>
        </>
      )}

      {error && <div className="text-red-600 text-xs">{error}</div>}
      <p className="text-xs text-gray-400">{t('src.tip')}</p>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1 text-sm rounded ${active ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}>
      {children}
    </button>
  )
}
