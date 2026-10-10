import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { ProviderCards } from '../aiw/ProviderCards'
import { DefaultProvider } from '../aiw/DefaultProvider'
import { GitHubConnection } from '../GitHubConnection'
export function CoreSetup({ onDone }: { onDone?: () => void }) {
  const [root, setRoot] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => { void ipc.vaultRoot().then(setRoot).catch(() => setRoot(null)) }, [])
  return <div className="mx-auto max-w-3xl space-y-5 p-6">
    <h1 className="text-xl font-semibold text-ink">Core setup</h1>
    <p className="text-sm text-muted">Choose where your state lives, connect a default AI model, then connect GitHub for product work. You can also use DevDeck manually and return here later.</p>
    <section className="rounded-xl border border-line bg-panel p-4"><h2 className="font-semibold text-ink">State storage</h2><p className="my-2 break-all text-sm text-muted">{root || 'No state folder configured'}</p><button className="btn-ghost" onClick={() => { useApp.getState().setSettingsTab('vault'); useApp.getState().setRailView('settings') }}>Manage state storage</button></section>
    <details className="rounded-xl border border-line bg-panel p-4"><summary className="cursor-pointer font-semibold text-ink">Connect an AI provider</summary><div className="mt-4"><ProviderCards onChanged={() => setGeneration(g => g + 1)} /></div></details>
    <DefaultProvider key={generation} />
    <GitHubConnection />
    {onDone && <button className="btn-primary" onClick={onDone}>Continue setup</button>}
  </div>
}
