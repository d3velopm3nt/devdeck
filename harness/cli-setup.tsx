import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { CliConnections } from '../src/components/aiw/CliConnections'
import { SEED } from './seed'
import type { CliStatus, CliTool } from '../src/lib/cliSetup'
import { CoreSetup } from '../src/components/setup/CoreSetup'
import { Settings } from '../src/components/aiw/Settings'

const scenario = new URLSearchParams(location.search).get('scenario')
const calls: { command: string; args?: Record<string, unknown> }[] = []
Object.assign(window, { __cliSetupCalls: calls })
const f = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const states: Record<CliTool, CliStatus> = {
  'claude-code': { tool: 'claude-code', installed: false, version: '', auth: 'signed-out', detail: 'CLI not installed or could not be started', setup_supported: true },
  codex: { tool: 'codex', installed: false, version: '', auth: 'signed-out', detail: 'CLI not installed or could not be started', setup_supported: true },
}
if (scenario === 'api') {
  states.codex = { ...states.codex, installed: true, version: 'codex 1.0', auth: 'api', detail: 'API billing is active. Sign in with your subscription to use your plan.' }
}
if (scenario === 'unsupported') Object.values(states).forEach(s => { s.setup_supported = false })
f.cli_setup_status = args => ({ ...states[args?.tool as CliTool] })
f.cli_setup_plan = args => {
  calls.push({ command: 'plan', args })
  if (scenario === 'failure') throw Error('Fixture CLI installer unavailable')
  return { title: 'Fixture CLI setup', shell: 'powershell.exe', cwd: 'C:/Users/Fixture', command: `fixture ${args?.tool} ${args?.action}` }
}
f.pty_create = args => { calls.push({ command: 'terminal', args }); return { id: 901, title: 'Fixture CLI setup', shell: 'powershell.exe', cwd: 'C:/Users/Fixture', alive: true } }
f.pty_list = () => []
f.pty_write = args => {
  calls.push({ command: 'write', args })
  const data = String(args?.data)
  const tool: CliTool = data.includes('claude-code') ? 'claude-code' : 'codex'
  if (scenario !== 'unfinished') {
    states[tool].installed = true
    states[tool].version = `${tool} fixture-version`
    if (data.includes('sign-in')) states[tool].auth = 'subscription'
  }
}
let connected = false
f.aiw_providers = () => [['mock', 'Mock', { configured: true, ok: true, detail: '' }], ...Object.entries(states).filter(([,s]) => s.auth === 'subscription').map(([tool]) => [tool === 'codex' ? 'chatgpt-subscription' : 'claude-subscription', tool === 'codex' ? 'ChatGPT subscription' : 'Claude subscription', { configured: true, ok: true, detail: 'Subscription' }]), ...(connected ? [['openrouter', 'OpenRouter', { configured: true, ok: true, detail: 'Configured' }]] : [])]

f.aiw_provider_defaults = () => ({ provider: '', model: '', inherited: [] })
f.aiw_provider_setups = () => connected ? [{ id: 'openrouter', name: 'OpenRouter', kind: 'openai-compatible', base_url: 'https://openrouter.ai/api/v1', model: 'fixture-model', has_key: true, headers: [] }] : []
f.aiw_configure_provider = args => { calls.push({ command: 'configure-provider', args: { id: args?.id } }); connected = true }
f.aiw_models = () => ({ models: [{ id: 'fixture-model', name: 'Fixture model' }], live: false, note: 'Fixture' })
f.aiw_model_checks = () => []
f.aiw_model_check = args => { calls.push({ command: 'model-check', args }); return { ok: true, detail: 'Verified' } }
f.aiw_default_provider_set = args => { calls.push({ command: 'default-provider', args }) }
f.aiw_agents = () => []
createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-app p-8 text-ink" data-theme="dark">
    <h1 className="mb-4 text-xl font-semibold">Settings / Providers</h1>
    {scenario === 'core' ? <CoreSetup /> : scenario === 'settings' ? <Settings /> : <CliConnections />}
  </main>,
)
