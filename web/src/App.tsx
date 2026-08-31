import { useState } from 'react'
import { useStore } from './store'
import { useT } from './i18n'
import { MapView } from './components/MapView'
import { VideoPanel } from './components/VideoPanel'
import { SyncPanel } from './components/SyncPanel'
import { LocationPanel } from './components/LocationPanel'
import { GcpPanel } from './components/GcpPanel'
import { SourcePicker } from './components/SourcePicker'
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
  const [tab, setTab] = useState<Tab>('flight')

  if (!sourceId) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 relative">
        <div className="absolute top-3 right-3">
          <LangSwitch />
        </div>
        <SourcePicker />
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
    saveState === 'saved' ? t('app.saved') : saveState === 'saving' ? t('app.saving') : saveState === 'error' ? t('app.noServer') : ''

  return (
    <div className="h-full flex flex-col">
      <header className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold">PinPoint</h1>
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
