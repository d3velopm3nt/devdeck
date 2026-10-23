import { PageHeader } from '../ui/DesignSystem'
import { FilterTabs } from '../ui/DesignSystem'
// Assistant settings.
//
// Everything you configure once lives here, so the rail's sidebar stays a list
// of things you *watch* rather than a mix of surfaces and forms. Three
// sections, in the order you actually need them: connect a model, point an
// agent at it, then decide what that agent may touch.

import { CAPTURE_SETTINGS_TAB } from '../../lib/devCapture'
import { Grants } from './Grants'
import { useCallback, useEffect, useState } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw, type AgentDef, type ModelCheck, type ProviderHealth } from '../../lib/aiw'
import { invoke } from '@tauri-apps/api/core'
import { DefaultProvider, type ProviderDefaults } from './DefaultProvider'
import { ProviderCards } from './ProviderCards'
import { ModelPicker } from './ModelPicker'

type Tab = 'providers' | 'agents' | 'tools'

const TABS: Array<{ id: Tab; icon: IconName; label: string; blurb: string }> = [
  { id: 'providers', icon: 'ai', label: 'Providers', blurb: 'Connect an AI service' },
  { id: 'agents', icon: 'agent', label: 'Agents', blurb: 'Who uses which model' },
  { id: 'tools', icon: 'tool', label: 'Tools', blurb: 'What each agent is allowed to do' },
]

// ---------------------------------------------------------------------------
// Agents — the switch that makes a configured provider do anything
// ---------------------------------------------------------------------------

function AgentProviders() {
  const a = useAiw()
  const [inherited, setInherited] = useState<string[]>([])
  const [providers, setProviders] = useState<[string, string, ProviderHealth][]>([])
  const [drafts, setDrafts] = useState<Record<string, { provider: string; model: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /// What each agent's model said the last time it was called, reported up by
  /// its picker so the row can show it across its full width.
  const [verdicts, setVerdicts] = useState<
    Record<string, { verdict: ModelCheck | undefined; retry: () => void }>
  >({})

  const [loadingProviders, setLoadingProviders] = useState(false)
  const reloadProviders = useCallback(async () => {
    setLoadingProviders(true)
    try {
      const list = await aiw.providers()
      setProviders(list.filter(([id]) => id !== 'mock'))
      setError(null)
    } catch (e) { setError(String(e)) }
    finally { setLoadingProviders(false) }
  }, [])
  useEffect(() => {
    void invoke<ProviderDefaults>('aiw_provider_defaults').then(d => setInherited(d.inherited)).catch(e => setError(String(e)))
    void reloadProviders()
    const refresh = () => { void reloadProviders() }
    window.addEventListener('focus', refresh)
    window.addEventListener('devdeck:capabilities-changed', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('devdeck:capabilities-changed', refresh) }
  }, [reloadProviders])

  const draftFor = (ag: AgentDef) =>
    drafts[ag.id] ?? { provider: ag.provider === 'mock' ? '' : ag.provider, model: ag.provider === 'mock' ? '' : ag.model }

  const apply = async (ag: AgentDef) => {
    const d = draftFor(ag)
    setSaving(ag.id)
    setError(null)
    try {
      const check = await aiw.modelCheck(d.provider, d.model)
      if (!check.ok) throw new Error(check.detail)
      await aiw.setAgentProvider(ag.id, d.provider, d.model)
      // The agent list, not the project refresh: that one is per-project and
      // never reloaded agents, so the row kept showing the old value with
      // Apply still lit — which looks exactly like a save that failed.
      await a.reloadAgents()
      setDrafts({ ...drafts, [ag.id]: d })
      setInherited(ids => ids.filter(id => id !== ag.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  const realCount = a.agents.filter((x) => x.provider && x.provider !== 'mock').length

  return (
    <>
      <div className="mb-3 flex items-start gap-2.5 rounded-md border border-line bg-raise px-3.5 py-3">
        <Icon name="info" size={13} className="mt-px shrink-0 text-accent" />
        <div className="text-[11.5px] leading-[1.6] text-dim">
          Choose the default model once in Providers. Assistant-backed agents inherit it,
          and explicit choices here override it. Coding workers use their CLI connection.
          {realCount > 0 && (
            <span className="ml-1 text-ok">
              {realCount} of {a.agents.length} are using a real model.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] text-err">
          {error}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted" role="status">{loadingProviders ? 'Loading providers…' : `${providers.filter(([, , health]) => health.configured).length} connected providers`}</span>
        <button className="btn-ghost" disabled={loadingProviders} onClick={() => void reloadProviders()}>Refresh providers</button>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-raise">
        <div className="grid grid-cols-[minmax(0,1fr)_170px_minmax(0,220px)_88px] border-b border-line bg-soft">
          {['Agent', 'Provider', 'Model', ''].map((h, i) => (
            <div key={i} className="px-3 py-2 text-[10.5px] font-semibold text-muted">
              {h}
            </div>
          ))}
        </div>

        {a.agents.map((ag) => {
          const d = draftFor(ag)
          const dirty = d.provider !== (ag.provider === 'mock' ? '' : ag.provider) || d.model !== (ag.provider === 'mock' ? '' : ag.model)
          const isMock = !ag.provider || ag.provider === 'mock'
          return (
            <div key={ag.id} className="border-b border-line last:border-0">
              <div className="grid grid-cols-[minmax(0,1fr)_170px_minmax(0,220px)_88px] items-center">
              <div className="min-w-0 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] text-ink">{ag.name}</span>{inherited.includes(ag.id) && <span className="text-xs text-muted">Uses shared settings</span>}
                  {ag.id !== 'assistant' && !inherited.includes(ag.id) && <button className="btn-ghost text-xs" disabled={saving !== null} onClick={() => {
                    setSaving(ag.id); setError(null)
                    void invoke('aiw_agent_use_default', {agentId: ag.id}).then(async () => { await a.reloadAgents(); setInherited(ids => [...new Set([...ids, ag.id])]); setDrafts(ds => { const next = {...ds}; delete next[ag.id]; return next }) }).catch(e => setError(String(e))).finally(() => setSaving(null))
                  }}>Use shared settings</button>}

                  {!isMock && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                </div>
                <div className="mt-0.5 truncate text-[10.5px] text-muted">{ag.role}</div>
              </div>

              <div className="px-3 py-2.5">
                <select
                  className="input w-full text-[11.5px]"
                  aria-label={`${ag.name} provider`}
                  value={d.provider}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [ag.id]: { ...d, provider: e.target.value, model: '' } })
                  }
                >
                  <option value="">{loadingProviders ? 'Loading providers…' : 'Choose a provider'}</option>
                  {d.provider && !providers.some(([id]) => id === d.provider) && <option value={d.provider} disabled>{d.provider === 'chatgpt-subscription' ? 'ChatGPT subscription' : d.provider === 'claude-subscription' ? 'Claude subscription' : d.provider} — {loadingProviders ? 'checking connection' : 'connection unavailable'}</option>}
                  {providers.map(([id, label, health]) => (
                    <option key={id} value={id} disabled={!health.configured && id !== 'mock'}>
                      {label}
                      {!health.configured && id !== 'mock' ? ' — not set up' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="px-3 py-2.5">
                {/* Keyed on the provider so switching one resets the list —
                    otherwise you keep an OpenRouter id after moving the agent
                    to Anthropic, and it fails on the first turn. */}
                {d.provider ? <ModelPicker
                  key={`${ag.id}:${d.provider}`}
                  compact
                  providerId={d.provider}
                  value={d.model}
                  onChange={(model) => setDrafts({ ...drafts, [ag.id]: { ...d, model } })}
                  // The refusal belongs to the agent, so the row prints it
                  // across its own width rather than into the Model column.
                  onVerdict={(verdict, retry) =>
                    setVerdicts((prev) =>
                      prev[ag.id]?.verdict === verdict ? prev : { ...prev, [ag.id]: { verdict, retry } },
                    )
                  }
                /> : <span className="text-xs text-muted">Select a provider first</span>}
              </div>

              <div className="px-3 py-2.5">
                {dirty ? (
                  <button
                    className="btn-primary w-full text-[11px]"
                    disabled={saving !== null || !d.provider || !d.model}
                    onClick={() => void apply(ag)}
                  >
                    {saving === ag.id ? 'Verifying…' : 'Verify & save'}
                  </button>
                ) : (
                  <span className="block text-center text-[10.5px] text-faint">
                    {isMock || !ag.provider ? 'Set up' : 'Configured'}
                  </span>
                )}
                </div>
              </div>

              {/* Across the row, under the agent it is about. A model that
                  refuses is the reason this agent will fail on its first turn,
                  which is worth a sentence someone can read rather than a
                  tooltip in a narrow column. */}
              {verdicts[ag.id]?.verdict && !verdicts[ag.id].verdict!.ok && (
                <div className="flex items-start gap-2 border-t border-red-500/20 bg-red-500/[0.05] px-3 py-2">
                  <Icon name="alert" size={12} className="mt-px shrink-0 text-err" />
                  <div className="min-w-0 flex-1 text-[11px] leading-[1.55] text-err">
                    {verdicts[ag.id].verdict!.detail.replace(/\s+/g, ' ').trim()}
                  </div>
                  <button
                    className="btn-ghost shrink-0 text-[10.5px] text-muted"
                    onClick={() => verdicts[ag.id].retry()}
                  >
                    Check again
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 text-[11px] leading-[1.55] text-muted">
        Providers you haven&rsquo;t set up yet are shown but can&rsquo;t be chosen. Set one up
        under Providers first, or the agent will stop halfway through its first job.
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Tools — the permission matrix
// ---------------------------------------------------------------------------

const PERMISSION_LABELS: Array<[string, string]> = [
  ['full', 'Allowed'],
  ['read', 'Look only'],
  ['approval', 'Ask first'],
  ['none', 'Off'],
]

function ToolPermissions() {
  const a = useAiw()
  return (
    <>
      <div className="mb-3 flex items-start gap-2.5 rounded-md border border-line bg-raise px-3.5 py-3">
        <Icon name="info" size={13} className="mt-px shrink-0 text-accent" />
        <div className="text-[11.5px] leading-[1.6] text-dim">
          Tools are the only way an agent can touch your machine, and anything not granted here is
          refused. <span className="text-ink">Full</span> lets it go ahead,{' '}
          <span className="text-ink">Read</span> lets it look but not change anything,{' '}
          <span className="text-ink">Ask</span> stops the agent and checks with you first, and{' '}
          <span className="text-ink">None</span> hides the tool completely.{' '}
          <span className="text-ink">Ask</span> refuses when nobody answers, so being away is a no —
          unless you gave a standing grant for that exact call, which is the list below.
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-raise">
        <div
          className="grid border-b border-line bg-soft"
          style={{ gridTemplateColumns: `150px repeat(${a.agents.length}, minmax(0,1fr))` }}
        >
          <div className="px-3 py-2" />
          {a.agents.map((ag) => (
            <div key={ag.id} className="px-2.5 py-2 text-[10.5px] font-semibold text-dim">
              {ag.name}
            </div>
          ))}
        </div>

        {a.permissions.map((row) => {
          const tool = a.tools.find((t) => t.id === row.tool)
          return (
            <div
              key={row.tool}
              className="grid items-center border-b border-line last:border-0"
              style={{ gridTemplateColumns: `150px repeat(${a.agents.length}, minmax(0,1fr))` }}
            >
              <div className="px-3 py-2">
                <div className="text-[12px] text-body">{tool?.name ?? row.tool}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted" title={tool?.description}>
                  {tool?.description}
                </div>
              </div>
              {row.grants.map(([agentId, perm]) => (
                <div key={agentId} className="px-2.5 py-2">
                  <select
                    className="input w-full text-[10.5px]"
                    value={perm.toLowerCase()}
                    onChange={(e) => void a.setPermission(agentId, row.tool, e.target.value)}
                  >
                    {/* The stored values stay as they are; only the labels are
                        in plain English. `approval` reading as "Ask first" is
                        the difference between a setting you understand and one
                        you leave alone. */}
                    {PERMISSION_LABELS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 text-[11px] leading-[1.55] text-muted">
        Agents are only shown the tools they can actually use, so they don&rsquo;t waste a turn
        asking for something that was always going to be refused. Anything set to{' '}
        <span className="text-dim">Ask</span> is offered, and the agent is told it may have to wait
        for you.
      </div>

      {/* The other half of the same question: not what an agent may ask about,
          but what it no longer has to. */}
      <div className="mt-5 border-t border-line pt-4">
        <Grants />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

export function Settings() {
  const a = useAiw()
  const [tab, setTab] = useState<Tab>((CAPTURE_SETTINGS_TAB as Tab) || 'providers')
  const [providerGeneration, setProviderGeneration] = useState(0)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 pt-3.5">
        <PageHeader className="mb-3" title="Settings" description="Which AI services you use, who uses them, and what they’re allowed to do."/>
<div className="ds-view-switch"><FilterTabs label="Assistant settings" value={tab} onChange={setTab} options={TABS.map(t=>({...t,description:t.blurb}))}/></div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {tab === 'providers' && <div className="space-y-5"><ProviderCards onChanged={() => { setProviderGeneration(g => g + 1); void a.refresh() }} /><DefaultProvider key={providerGeneration} /></div>}
        {tab === 'agents' && <AgentProviders />}
        {tab === 'tools' && <ToolPermissions />}
      </div>
    </div>
  )
}
