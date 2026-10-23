import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { ProviderCards } from '../aiw/ProviderCards'
import { DefaultProvider } from '../aiw/DefaultProvider'
import { GitHubConnection } from '../GitHubConnection'
import { Icon } from '../../lib/icons'
import { Frame } from './LearnStep'
import type { SetupNav } from './steps'
export function CoreSetup({ onDone, onClose, nav }: { onDone?: () => void; onClose?: () => void; nav?: SetupNav }) {
  const [root, setRoot] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => { void ipc.vaultRoot().then(setRoot).catch(() => setRoot(null)) }, [])
  const content = <div className={`w-full space-y-5 ${onDone ? 'mx-auto max-w-6xl' : 'max-w-2xl px-7 py-6'}`}>
    <h1 className="flex items-center gap-2 text-[20px] font-semibold text-ink"><Icon name="settings" size={20} />Core setup</h1>
    <p className="text-[12px] leading-relaxed text-dim">Spaces, projects, stash, connections and your local terminal work without GitHub or AI. Configure each optional capability when you need it.</p>
    <section className="rounded-lg border border-line bg-panel px-4 py-3"><h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Icon name="folder" size={15} />State storage</h2><p className="my-2 break-all text-[12px] text-muted">{root || 'No state folder configured'}</p><button className="btn-ghost" onClick={() => { useApp.getState().setSettingsTab('vault'); useApp.getState().setRailView('settings') }}><Icon name="settings" size={13} />Manage state storage</button></section>
    <details open className="rounded-lg border border-line bg-panel px-4 py-3"><summary className="cursor-pointer text-[13px] font-semibold text-ink"><span className="ml-1 inline-flex items-center gap-2"><Icon name="ai" size={15} />AI chat and agents — optional</span></summary><div className="mt-4"><ProviderCards onChanged={() => setGeneration(g => g + 1)} /></div></details>
    <DefaultProvider key={generation} />
    <p className="text-sm text-dim">GitHub — optional. Connect for issues and pull requests; AI setup is independent.</p>
    <GitHubConnection />
    {onDone && <button className="btn-primary" onClick={onDone}><Icon name="arrow-right" size={14} />Continue setup</button>}
  </div>
  return onDone ? <Frame step="core" wide nav={nav} onClose={onClose}>{content}</Frame> : content
}

