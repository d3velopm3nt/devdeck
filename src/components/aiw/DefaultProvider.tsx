import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { aiw, type ProviderHealth } from '../../lib/aiw'
import { useAiw } from '../../lib/aiwStore'
import { ModelPicker } from './ModelPicker'
import { DEFS } from './providerDefs'
export interface ProviderDefaults { provider: string; model: string; inherited: string[] }
export function DefaultProvider() {
  const [providers, setProviders] = useState<[string, string, ProviderHealth][]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const choices = providers.filter(([id]) => !['mock', 'claude-code', 'codex', 'codex-cli'].includes(id))
  for (const def of DEFS) {
    if (!def.custom && !def.unavailable && !choices.some(([id]) => id === def.id)) {
      choices.push([def.id, def.name, { configured: false, ok: false, detail: 'Connect this provider first' }])
    }
  }
  if (provider && provider !== 'mock' && !choices.some(([id]) => id === provider)) {
    choices.push([provider, `${provider} (saved, unavailable)`, { configured: false, ok: false, detail: '' }])
  }
  const ready = choices.some(([, , health]) => health.configured)
  const selectedReady = choices.some(([id,, health]) => id === provider && health.configured)
  useEffect(() => {
    void aiw.providers().then(setProviders).catch(e => setMessage(String(e)))
    void invoke<ProviderDefaults>('aiw_provider_defaults').then(d => { setProvider(d.provider); setModel(d.model) }).catch(e => setMessage(String(e)))
  }, [])
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      const check = await aiw.modelCheck(provider, model)
      if (!check.ok) throw Error(check.detail)
      await invoke('aiw_default_provider_set', { provider, model })
      await useAiw.getState().reloadAgents()
      setMessage('Verified and saved. Agents using the default inherit this model; existing overrides are kept.')
    } catch (e) { setMessage(String(e)) } finally { setBusy(false) }
  }
  return <section className="rounded-xl border border-line bg-panel p-4">
    <h2 className="font-semibold text-ink">Default assistant provider</h2>
    <p className="my-2 text-sm text-muted">The main assistant and agents using the default share this model. Coding workers use a compatible CLI runtime configured on their own card. Verification makes a small model call.</p>
    {!ready && <p role="status" className="my-3 rounded-md border border-line bg-raise p-3 text-sm text-dim">No assistant provider is connected yet. Sign in with a subscription or connect an API or local provider above, then choose it here.</p>}
    <label className="block text-sm text-muted">Provider<select aria-label="Default provider" className="input my-2 w-full" value={provider === 'mock' ? '' : provider} onChange={e => { setProvider(e.target.value); setModel('') }}><option value="">{ready ? 'Choose a connected provider' : 'Connect a provider above first'}</option>{choices.map(([id,label,health]) => <option key={id} value={id} disabled={!health.configured}>{label}{!health.configured ? ' — connect first' : ''}</option>)}</select></label>
    {provider && provider !== 'mock' && choices.some(([id,, health]) => id === provider && health.configured) && <ModelPicker key={provider} providerId={provider} value={model} onChange={setModel} />}
    <button className="btn-primary mt-3" disabled={busy || !selectedReady || !model} onClick={() => void save()}>{busy ? 'Verifying…' : 'Verify & use as default'}</button>
    {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
  </section>
}
