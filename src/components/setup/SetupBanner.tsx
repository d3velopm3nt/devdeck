import { useEffect, useState } from 'react'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'
import * as ipc from '../../lib/ipc'

const HIDDEN = 'setup.capabilities.banner.hidden'
export function SetupBanner() {
  const agents = useAiw(s => s.agents)
  const [hidden, setHidden] = useState(true)
  const [github, setGithub] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void ipc.settingGet(HIDDEN).then(v => { if (active) setHidden(v === 'true') }).catch(() => { if (active) setHidden(false) })
    const refresh = () => {
      void ipc.githubStateRepos().then(v => { if (active) setGithub(v.signed_in) }).catch(() => { if (active) setGithub(null) })
      void useAiw.getState().reloadAgents()
    }
    const connected = () => { if (active) setGithub(true) }
    window.addEventListener('devdeck:github-connected', connected)
    refresh()
    window.addEventListener('devdeck:capabilities-changed', refresh)
    return () => { active = false; window.removeEventListener('devdeck:github-connected', connected); window.removeEventListener('devdeck:capabilities-changed', refresh) }
  }, [])
  const assistant = agents.find(a => a.id === 'assistant')
  const configured = !!assistant?.provider && assistant.provider !== 'mock' && !!assistant.model
  if (hidden || (configured && github === true)) return null
  const dismiss = async () => {
    try { await ipc.settingSet(HIDDEN, 'true'); setHidden(true) }
    catch (e) { setError(`Could not save preference: ${String(e)}`) }
  }
  return <aside aria-label="Optional setup" className="shrink-0 border-b border-line bg-raise px-4 py-2 text-xs text-body">
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex-1">Your local workspace is ready. {configured ? '' : 'Set up an agent for AI chat. '}{github === false ? 'Connect GitHub for issues and PRs.' : github === null ? 'GitHub connection status unavailable.' : ''}</span>
      <button className="btn-primary" onClick={() => { useApp.getState().setSettingsTab('core'); useApp.getState().setRailView('settings') }}>Set up</button>
      <button className="btn-ghost" onClick={() => setHidden(true)}>Not now</button>
      <button className="btn-ghost" onClick={() => void dismiss()}>Don’t show again</button>
    </div>
    {error && <p role="alert" className="mt-1 text-err">{error}</p>}
  </aside>
}
