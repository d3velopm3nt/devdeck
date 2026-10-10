// Production onboarding with a fake native boundary; no credentials or network.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { TeamStep } from '../src/components/business/TeamStep'
import type { BusinessView } from '../src/lib/ipc'
import { WorkLifeStep } from '../src/components/setup/WorkLifeStep'
import { useApp } from '../src/store'
import { VaultSetup } from '../src/components/VaultSetup'
import { SEED } from './seed'

const fixture = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const scenario = new URLSearchParams(location.search).get('scenario')
const calls: { command: string; args?: Record<string, unknown> }[] = []
let stored = false
let attempts = 0
Object.assign(window, { __onboardingCalls: calls })
fixture.github_oauth_configured = () => scenario === 'oauth'
fixture.github_token_stored = () => stored
fixture.vault_legacy = () => ({ nodes: 0, commands: 0, services: 0 })
fixture.vault_default_root = () => 'C:/DevDeck'
fixture.github_token_paste = () => {
  stored = true
  return { login: 'fixture-user', gh: false, scopes: ['repo'], missing: [], scopes_known: true }
}
fixture.github_state_repos = () => ({ login: 'fixture-user', repos: [
  { full_name: 'fixture-user/state', clone_url: 'https://github.com/fixture-user/state.git', private: true },
] })
fixture.clone_repo = (args) => {
  calls.push({ command: 'clone', args })
  if (scenario === 'clone-failure') throw new Error('Fixture clone failed')
  return 'C:/DevDeck/state'
}
fixture.vault_set_root = (args) => {
  calls.push({ command: 'select', args })
  if (scenario === 'retry' && attempts++ === 0) throw new Error('Fixture index failed')
  return args?.path
}
if (scenario === 'work-life') {
  useApp.setState({ nodes: [] })
  fixture.business_list = () => []
  fixture.vault_scan = () => useApp.getState().nodes
  fixture.space_starters = () => [{
    id: 'life', name: 'Life — everything outside work', what: 'Everyday life', brings: 'Folders, routines and a manager', label: 'Personal', bot: true,
    folders: ['Family', 'Home', 'Finance', 'Health', 'Routines', 'Knowledge'].map(name => ({ name, why: name })),
    routines: [{ name: 'Life check-in', every: 'daily', at_min: 1080, days: '' }, { name: 'Plan life alongside work', every: 'weekly', at_min: 1080, days: '0' }],
  }]
  fixture.space_create = (args) => {
    calls.push({ command: 'create-space', args })
    useApp.setState({ nodes: [{ id: 90, parent_id: null, kind: 'workspace', name: String(args?.name), label: String(args?.label), path: 'C:/DevDeck/Life', rel_path: '', sort: 0, color: null }] })
    return { node_id: 90, name: args?.name, folders: (args?.folders as {name:string}[]).map(f => f.name), routines: ['Life check-in', 'Plan life alongside work'], bot: true, problems: [] }
  }
}
const business: BusinessView = {
  node_id: 91, meta: { name: 'Second company', website: '', directors: [], items: [], site_how: '', site_read_at: '', site_chars: 0, site_pages: [], step: 'team', made: false },
  folders: [], site: { how: '', chars: 0, pages: [], title: '', excerpt: '', thin: false },
}
if (scenario === 'shared-team') {
  fixture.business_team = () => ({
    roles: [{ id: 'engineering', name: 'Engineering lead', job: 'Development across projects', every: 'weekdays', at_min: 420, days: '', team: [], stop_at: [], rhythm: 'Weekdays', covers: ['Projects'], on: true, why: 'Code projects', made: '' }],
    others: [{ handle: 'shared-engineering', name: 'Engineering lead', role: 'engineering lead', works_for: ['First company'], rhythm: 'Weekdays' }], members: [], directors: ['You'],
  })
  fixture.business_make_team = args => { calls.push({ command: 'team', args }); return { made: [], joined: ['Engineering lead'], problems: [] } }
  fixture.business_get = () => business
}
function Harness() {
  const [done, setDone] = useState(false)
  if (scenario === 'shared-team') return <TeamStep view={business} setView={() => {}} nav={{reached: 'team', onGo: () => {}}} onClose={() => {}} next={() => {}} />
  if (scenario === 'work-life') return done ? <p role="status">Setup complete</p> : <WorkLifeStep onDone={() => setDone(true)} />
  return done ? <p role="status">State connected</p> : <VaultSetup onDone={() => setDone(true)} />
}
createRoot(document.getElementById('root')!).render(<Harness />)
