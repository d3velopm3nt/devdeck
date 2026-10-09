// Production onboarding with a fake native boundary; no credentials or network.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
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
function Harness() {
  const [done, setDone] = useState(false)
  return done ? <p role="status">State connected</p> : <VaultSetup onDone={() => setDone(true)} />
}
createRoot(document.getElementById('root')!).render(<Harness />)
