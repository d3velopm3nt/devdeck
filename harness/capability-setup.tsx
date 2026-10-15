import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SetupBanner } from '../src/components/setup/SetupBanner'
import { DefaultProvider } from '../src/components/aiw/DefaultProvider'
import { Settings } from '../src/components/aiw/Settings'
import { useAiw } from '../src/lib/aiwStore'
import { useApp } from '../src/store'
import { SEED } from './seed'
const fixture = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const fail = new URLSearchParams(location.search).has('fail')
const calls: string[] = []
Object.assign(window, { __setupCalls: calls, __setupApp: useApp })
let agent = { id: 'assistant', name: 'Assistant', provider: 'mock', model: 'mock-1', role: 'orchestrator', skills: [], permissions: {}, system: '' }
fixture.setting_get = args => localStorage.getItem(String(args?.key))
fixture.setting_set = args => { localStorage.setItem(String(args?.key), String(args?.value)); return null }
fixture.github_state_repos = () => ({ signed_in: false, repos: [], login: '' })
fixture.aiw_agents = () => [agent]
fixture.aiw_permissions = () => []
fixture.aiw_providers = () => [['chatgpt-subscription', 'ChatGPT subscription', { configured: true, ok: true, detail: 'Test fixture' }]]
fixture.aiw_provider_defaults = () => ({ provider: agent.provider, model: agent.model, inherited: [] })
fixture.aiw_models = () => ({ models: [{ id: 'default', name: 'CLI default' }], live: false, note: 'Test fixture' })
fixture.aiw_model_checks = () => []
fixture.aiw_model_check = () => { calls.push('verify'); return { ok: !fail, provider: 'chatgpt-subscription', model: 'default', at: Date.now(), detail: fail ? 'Verification failed: test fixture' : 'Model answered: test fixture' } }
fixture.aiw_default_provider_set = args => { calls.push('save'); agent = { ...agent, provider: String(args?.provider), model: String(args?.model) }; return null }
useAiw.setState({ agents: [agent] })
createRoot(document.getElementById('root')!).render(<div className="min-h-screen bg-app text-body"><SetupBanner /><main className="mx-auto max-w-3xl p-4"><p>Local projects and terminal remain available</p><DefaultProvider /><Settings /></main></div>)
