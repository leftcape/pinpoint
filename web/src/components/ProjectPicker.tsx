import { useEffect, useState } from 'react'
import { api, type Project, type Library, type LibraryFile } from '../api'
import { useStore } from '../store'
import { useT } from '../i18n'

// Lista de proyectos y alta de uno nuevo. Un proyecto agrupa vídeo, log,
// configuración, puntos y metadatos con identidad propia: mover o renombrar los
// ficheros ya no desvincula la campaña (que es lo que pasaba antes).
export function ProjectPicker() {
  const t = useT()
  const [proyectos, setProyectos] = useState<Project[]>([])
  const [lib, setLib] = useState<Library | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [error, setError] = useState('')

  // formulario de alta
  const [nombre, setNombre] = useState('')
  const [video, setVideo] = useState('')
  const [log, setLog] = useState('')
  const [pass, setPass] = useState('')

  const openProject = useStore((s) => s.openProject)
  const loading = useStore((s) => s.loading)

  const recargar = () => api.projectsList().then(setProyectos).catch(() => setProyectos([]))

  useEffect(() => {
    recargar()
    api.library().then(setLib).catch(() => setLib(null))
  }, [])

  async function crear() {
    setError('')
    try {
      const p = await api.projectCreate({
        name: nombre.trim(), bin_path: log, video_path: video, password: pass,
      })
      setNuevo(false); setNombre(''); setVideo(''); setLog(''); setPass('')
      await recargar()
      if (p.bin_path && p.video_path) openProject(p.id)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('proj.title')}</h2>
        <button onClick={() => setNuevo((v) => !v)} className="text-sm px-3 py-1 rounded border bg-gray-800 text-white">
          {nuevo ? t('proj.cancel') : t('proj.new')}
        </button>
      </div>

      {nuevo && (
        <div className="rounded border bg-white p-3 flex flex-col gap-2">
          <label className="text-xs text-gray-500">{t('proj.name')}</label>
          <input
            value={nombre} onChange={(e) => setNombre(e.target.value)}
            placeholder={t('proj.namePlaceholder')}
            className="border rounded px-2 py-1 text-sm"
          />

          <label className="text-xs text-gray-500">{t('src.videoLabel')}</label>
          <select value={video} onChange={(e) => setVideo(e.target.value)} className="border rounded px-2 py-1 text-sm font-mono">
            <option value="">{t('src.choose')}</option>
            {lib?.videos.map((f) => <option key={f.path} value={f.path}>{op(f)}</option>)}
          </select>

          <label className="text-xs text-gray-500">{t('src.binLabel')}</label>
          <select value={log} onChange={(e) => setLog(e.target.value)} className="border rounded px-2 py-1 text-sm font-mono">
            <option value="">{t('src.choose')}</option>
            {lib?.logs.map((f) => <option key={f.path} value={f.path}>{op(f)}</option>)}
          </select>

          <label className="text-xs text-gray-500">{t('proj.password')}</label>
          <input
            type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder={t('proj.passwordPlaceholder')}
            className="border rounded px-2 py-1 text-sm"
          />
          <p className="text-xs text-gray-400">{t('proj.passwordHelp')}</p>

          <button
            onClick={crear} disabled={!nombre.trim() || loading}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {t('proj.create')}
          </button>
          {error && <div className="text-red-600 text-xs">{error}</div>}
        </div>
      )}

      {proyectos.length === 0 && !nuevo && (
        <p className="text-sm text-gray-500">{t('proj.empty')}</p>
      )}

      <div className="flex flex-col gap-1">
        {proyectos.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {p.name}
                {p.protected && <span className="ml-1 text-gray-400" title={t('proj.isProtected')}>🔒</span>}
              </div>
              <div className="text-xs text-gray-500 truncate" title={`${p.bin_path}\n${p.video_path}`}>
                {p.points ? `${p.points} ${t('proj.points')}` : t('proj.noPoints')}
                {p.video_path && ` · ${p.video_path.split('/').pop()}`}
              </div>
            </div>
            <button
              onClick={() => openProject(p.id)} disabled={loading || !p.bin_path || !p.video_path}
              className="px-3 py-1 text-sm rounded border bg-gray-800 text-white disabled:opacity-50 shrink-0"
            >
              {t('src.open')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function op(f: LibraryFile) {
  const mb = f.size / 1024 ** 2
  return `${f.name} — ${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`}`
}
