import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { aiw, type ProviderHealth } from '../../lib/aiw'
import { useAiw } from '../../lib/aiwStore'
import { ModelPicker } from './ModelPicker'
export interface ProviderDefaults { provider: string; model: string; inherited: string[] }
export function DefaultProvider() {
  const [providers, setProviders] = useState<[string, string, ProviderHealth][]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
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
    <label className="block text-sm text-muted">Provider<select aria-label="Default provider" className="input my-2 w-full" value={provider} onChange={e => { setProvider(e.target.value); setModel('') }}><option value="">Choose a provider</option>{providers.filter(([id]) => !['mock','claude-code','codex','codex-cli'].includes(id)).map(([id,label,health]) => <option key={id} value={id} disabled={!health.configured}>{label}{!health.configured ? ' — not configured' : ''}</option>)}</select></label>
    <ModelPicker key={provider} providerId={provider} value={model} onChange={setModel} />
    <button className="btn-primary mt-3" disabled={busy || !provider || provider === 'mock' || !model} onClick={() => void save()}>{busy ? 'Verifying…' : 'Verify & use as default'}</button>
    {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
  </section>
}
