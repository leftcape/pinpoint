import { useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import { useT } from './i18n'
import { MapView } from './components/MapView'
import { VideoPanel } from './components/VideoPanel'
import { SyncPanel } from './components/SyncPanel'
import { LocationPanel } from './components/LocationPanel'
import { GcpPanel } from './components/GcpPanel'
import { SourcePicker } from './components/SourcePicker'
import { ProjectPicker } from './components/ProjectPicker'
import { LangSwitch } from './components/LangSwitch'

type Tab = 'flight' | 'location' | 'gcp'

export function App() {
  const t = useT()
  const sourceId = useStore((s) => s.sourceId)
  const video = useStore((s) => s.video)
  const swapView = useStore((s) => s.swapView)
  const gcpMode = useStore((s) => s.gcpMode)
  const fovPairMode = useStore((s) => s.fovPairMode)
  const locked = useStore((s) => s.gcpCampaign.config.locked)
  const saveState = useStore((s) => s.gcpSaveState)
  const projectId = useStore((s) => s.projectId)
  const projectName = useStore((s) => s.projectName)
  const projectProtected = useStore((s) => s.projectProtected)
  const projectPassword = useStore((s) => s.projectPassword)
  const setProjectPassword = useStore((s) => s.setProjectPassword)
  const [tab, setTab] = useState<Tab>('flight')
  // Modo lectura: se ha decidido mirar sin contraseña. Solo afecta al aviso.
  const [readOnly, setReadOnly] = useState(false)

  if (!sourceId) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 relative">
        <div className="absolute top-3 right-3">
          <LangSwitch />
        </div>
        {/* Proyectos primero: es la vía normal. Cargar un vuelo suelto sigue
            disponible debajo para casos puntuales. */}
        <div className="flex flex-col gap-6 py-8 overflow-y-auto max-h-full">
          <ProjectPicker />
          <details className="max-w-xl">
            <summary className="text-sm text-gray-500 cursor-pointer">
              {t('proj.orLoadLoose')}
            </summary>
            <div className="mt-3">
              <SourcePicker />
            </div>
          </details>
        </div>
      </div>
    )
  }

  // MapView and VideoPanel are each mounted EXACTLY ONCE and never change
  // position in the React tree, so the video never restarts on swap. We only
  // change their CSS (big background vs small floating PiP) based on swapView.
  const bigStyle = 'absolute inset-0'
  // bottom offset lifts the PiP clear of the video's control bar
  const pipStyle =
    'absolute bottom-[85px] left-3 w-64 h-40 z-10 rounded-lg overflow-hidden border-2 border-white shadow-lg'
  // Modo pares (GCP o FOV por pares): foto y mapa LADO A LADO al mismo tamaño —
  // se clica el mismo rasgo en cada uno, así que ninguno puede ser el pequeño.
  const split = gcpMode || fovPairMode
  const splitLeft = 'absolute inset-y-0 left-0 w-1/2 border-r-2 border-gray-700'
  const splitRight = 'absolute inset-y-0 right-0 w-1/2'
  const videoCls = split ? splitLeft : swapView ? bigStyle : pipStyle
  const mapCls = split ? splitRight : swapView ? pipStyle : bigStyle

  const saveLabel =
    saveState === 'saved' ? t('app.saved')
      : saveState === 'saving' ? t('app.saving')
      : saveState === 'readonly' ? t('app.readonly')
      : saveState === 'badpass' ? t('app.badpass')
      : saveState === 'error' ? t('app.noServer') : ''

  // Proyecto protegido y sin contraseña en esta pestaña: avisar ANTES de marcar,
  // no cuando falle el primer guardado y ya se hayan perdido puntos.
  const necesitaClave = !!projectId && projectProtected && !projectPassword

  return (
    <div className="h-full flex flex-col">
      {necesitaClave && !readOnly && (
        <BarraClave
          projectId={projectId!}
          onOk={(p) => setProjectPassword(p)}
          onSoloLeer={() => setReadOnly(true)}
        />
      )}
      {necesitaClave && readOnly && (
        <div className="bg-gray-100 text-gray-600 px-4 py-1.5 text-xs flex items-center gap-3">
          <span className="flex-1">👁 {t('proj.readOnly')}</span>
          <button onClick={() => setReadOnly(false)} className="underline">
            {t('proj.enterPassword')}
          </button>
        </div>
      )}
      <header className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold">PinPoint</h1>
          {projectName && (
            <span className="text-sm text-gray-300 truncate max-w-[24ch]" title={projectName}>
              · {projectName}{projectProtected && ' 🔒'}
            </span>
          )}
          <LangSwitch dark />
        </div>
        <div className="text-xs text-gray-300 font-mono flex items-center gap-3">
          {video && (
            <span>
              {video.width}×{video.height} @ {video.fps.toFixed(0)}fps · {video.duration_s.toFixed(0)}s
              {video.is_reencoded && ` · ${t('app.reencoded')}`}
            </span>
          )}
          <span title={t('app.campaignState')}>
            {locked ? '🔒' : '🔓'} {saveLabel}
          </span>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 relative bg-black overflow-hidden">
          <div className={mapCls}>
            <MapView />
          </div>
          <div className={videoCls}>
            <VideoPanel large />
          </div>
        </div>

        {/* Control panel with tabs */}
        <aside className="w-96 border-l bg-white flex flex-col min-h-0">
          <div className="flex border-b shrink-0">
            <TabButton active={tab === 'flight'} onClick={() => setTab('flight')}>
              {t('tab.flight')}
            </TabButton>
            <TabButton active={tab === 'location'} onClick={() => setTab('location')}>
              {t('tab.location')}
            </TabButton>
            <TabButton active={tab === 'gcp'} onClick={() => setTab('gcp')}>
              {t('tab.gcp')}
            </TabButton>
          </div>

          {/* All tabs stay mounted; inactive ones hidden to preserve state. */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className={tab === 'flight' ? 'block' : 'hidden'}>
              <SyncPanel />
            </div>
            <div className={tab === 'location' ? 'block' : 'hidden'}>
              <LocationPanel />
            </div>
            <div className={tab === 'gcp' ? 'block' : 'hidden'}>
              <GcpPanel />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${
        active ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// Barra de contraseña. Valida CONTRA EL SERVIDOR al enviarla: si no, el usuario
// no se entera de que se equivocó hasta el primer guardado —que puede ser mucho
// después— y mientras cree que está guardando.
function BarraClave({ projectId, onOk, onSoloLeer }: {
  projectId: string
  onOk: (password: string) => void
  onSoloLeer: () => void
}) {
  const t = useT()
  const [valor, setValor] = useState('')
  const [estado, setEstado] = useState<'idle' | 'comprobando' | 'mal'>('idle')

  async function comprobar() {
    if (!valor) return
    setEstado('comprobando')
    try {
      const r = await api.projectVerify(projectId, valor)
      if (r.ok) onOk(valor)          // correcta: el aviso desaparece solo
      else setEstado('mal')
    } catch {
      setEstado('mal')
    }
  }

  const mal = estado === 'mal'
  return (
    <div className={`px-4 py-2 text-sm flex items-center gap-3 flex-wrap ${
      mal ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>
      <span className="flex-1 min-w-[16rem]">
        {mal ? t('proj.wrongPassword') : t('proj.askPassword')}
      </span>
      <input
        type="password" autoFocus value={valor}
        onChange={(e) => { setValor(e.target.value); if (mal) setEstado('idle') }}
        onKeyDown={(e) => { if (e.key === 'Enter') comprobar() }}
        className={`border rounded px-2 py-1 text-sm text-gray-900 ${
          mal ? 'border-red-400' : 'border-amber-300'}`}
      />
      <button
        onClick={comprobar} disabled={!valor || estado === 'comprobando'}
        className="text-xs px-2 py-1 rounded bg-gray-800 text-white disabled:opacity-50"
      >
        {estado === 'comprobando' ? '…' : t('proj.usePassword')}
      </button>
      <button onClick={onSoloLeer} className="text-xs underline">
        {t('proj.justRead')}
      </button>
    </div>
  )
}
