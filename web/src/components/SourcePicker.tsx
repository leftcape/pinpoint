import { useEffect, useState } from 'react'
import { api, type Library, type LibraryFile } from '../api'
import { useStore } from '../store'
import { useT } from '../i18n'

type Known = { id: string; key: string; label: string; bin_path: string; video_path: string; has_campaign: boolean }

// Pantalla inicial. Tres modos:
//  - biblioteca: dos desplegables con lo que hay en la carpeta de vuelos del
//    servidor (vídeos y logs, por separado y sin emparejar) + subida a esa
//    misma carpeta, con cuota.
//  - ruta: escribir rutas absolutas a mano (sigue valiendo para ficheros de fuera).
//  - subir: subir el par bin+vídeo a la carpeta de trabajo de la app.
export function SourcePicker() {
  const t = useT()
  const [mode, setMode] = useState<'library' | 'path' | 'upload'>('library')
  const [binPath, setBinPath] = useState('')
  const [videoPath, setVideoPath] = useState('')
  const [binFile, setBinFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)

  // biblioteca
  const [lib, setLib] = useState<Library | null>(null)
  const [libVideo, setLibVideo] = useState('')
  const [libLog, setLibLog] = useState('')
  const [subiendo, setSubiendo] = useState<{ pct: number; nombre: string } | null>(null)
  const [libError, setLibError] = useState('')

  const registerSource = useStore((s) => s.registerSource)
  const uploadSource = useStore((s) => s.uploadSource)
  const openSource = useStore((s) => s.openSource)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const [known, setKnown] = useState<Known[]>([])

  const recargarBiblioteca = () =>
    api.library().then(setLib).catch(() => setLib(null))

  useEffect(() => {
    api.listSources().then(setKnown).catch(() => setKnown([]))
    recargarBiblioteca()
  }, [])

  async function subir(file: File, kind: 'video' | 'log') {
    setLibError('')
    setSubiendo({ pct: 0, nombre: file.name })
    try {
      const r = await api.libraryUpload(file, kind, (pct) => setSubiendo({ pct, nombre: file.name }))
      await recargarBiblioteca()
      // dejarlo ya seleccionado: es lo que el usuario va a querer abrir
      if (kind === 'video') setLibVideo(r.path)
      else setLibLog(r.path)
    } catch (e: any) {
      setLibError(e?.message ?? String(e))
    } finally {
      setSubiendo(null)
    }
  }

  const q = lib?.quota
  const lleno = q ? q.free <= 0 : false

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
        <TabBtn active={mode === 'library'} onClick={() => setMode('library')}>
          {t('src.library')}
        </TabBtn>
        <TabBtn active={mode === 'path'} onClick={() => setMode('path')}>
          {t('src.serverPath')}
        </TabBtn>
        <TabBtn active={mode === 'upload'} onClick={() => setMode('upload')}>
          {t('src.upload')}
        </TabBtn>
      </div>

      {mode === 'library' && (
        <>
          {!lib?.exists && (
            <div className="text-xs text-red-600">
              {t('src.libMissing')} <span className="font-mono">{lib?.dir}</span>
            </div>
          )}

          <label className="text-xs text-gray-500">{t('src.videoLabel')}</label>
          <select
            value={libVideo}
            onChange={(e) => setLibVideo(e.target.value)}
            className="border rounded px-2 py-1 text-sm font-mono"
          >
            <option value="">{t('src.choose')}</option>
            {lib?.videos.map((f) => (
              <option key={f.path} value={f.path}>{opcion(f)}</option>
            ))}
          </select>

          <label className="text-xs text-gray-500">{t('src.binLabel')}</label>
          <select
            value={libLog}
            onChange={(e) => setLibLog(e.target.value)}
            className="border rounded px-2 py-1 text-sm font-mono"
          >
            <option value="">{t('src.choose')}</option>
            {lib?.logs.map((f) => (
              <option key={f.path} value={f.path}>{opcion(f)}</option>
            ))}
          </select>

          <button
            onClick={() => registerSource(libLog, libVideo)}
            disabled={loading || !libLog || !libVideo}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {loading ? t('src.loading') : t('src.load')}
          </button>

          {/* subida a la misma carpeta */}
          <div className="rounded border bg-gray-50 p-2 flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-600">{t('src.addFiles')}</div>
            {lib && !lib.writable ? (
              <div className="text-xs text-amber-700">{t('src.readOnly')}</div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">
                  {t('src.addVideo')}
                  <input
                    type="file" accept="video/*,.mkv,.mp4,.mov,.avi"
                    disabled={!!subiendo || lleno}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f, 'video'); e.target.value = '' }}
                    className="block w-full text-xs mt-0.5"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  {t('src.addLog')}
                  <input
                    type="file" accept=".bin,.BIN,.log,.tlog,.ulg"
                    disabled={!!subiendo || lleno}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f, 'log'); e.target.value = '' }}
                    className="block w-full text-xs mt-0.5"
                  />
                </label>
              </div>
            )}

            {subiendo && (
              <div className="text-xs text-gray-600">
                <div className="truncate">{subiendo.nombre} — {subiendo.pct}%</div>
                <div className="h-1.5 bg-gray-200 rounded overflow-hidden mt-0.5">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${subiendo.pct}%` }} />
                </div>
              </div>
            )}

            {q && (
              <div className="text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>{t('src.quota')}</span>
                  <span className={lleno ? 'text-red-600 font-semibold' : q.pct >= 80 ? 'text-amber-700' : ''}>
                    {gb(q.used)} / {gb(q.limit)} GB ({q.pct}%)
                  </span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded overflow-hidden mt-0.5">
                  <div
                    className={`h-full ${lleno ? 'bg-red-600' : q.pct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'}`}
                    style={{ width: `${Math.min(100, q.pct)}%` }}
                  />
                </div>
                {lleno && <div className="text-red-600 mt-0.5">{t('src.quotaFull')}</div>}
              </div>
            )}

            {libError && <div className="text-red-600 text-xs">{libError}</div>}
          </div>
        </>
      )}

      {mode === 'path' && (
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
      )}

      {mode === 'upload' && (
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

const gb = (b: number) => (b / 1024 ** 3).toFixed(1)

// "carpeta/fichero.mkv — 3.2 GB": el tamaño ayuda a distinguir vuelos
function opcion(f: LibraryFile) {
  const mb = f.size / 1024 ** 2
  return `${f.name} — ${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`}`
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1 text-sm rounded ${active ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}>
      {children}
    </button>
  )
}
