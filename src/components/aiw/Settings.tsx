// AI Workspace settings.
//
// Everything you configure once lives here, so the rail's sidebar stays a list
// of things you *watch* rather than a mix of surfaces and forms. Three
// sections, in the order you actually need them: connect a model, point an
// agent at it, then decide what that agent may touch.

import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw, type AgentDef, type ProviderHealth } from '../../lib/aiw'
import { ProviderCards } from './ProviderCards'

type Tab = 'providers' | 'agents' | 'tools'

const TABS: Array<{ id: Tab; icon: IconName; label: string; blurb: string }> = [
  { id: 'providers', icon: 'ai', label: 'Providers', blurb: 'Connect a model' },
  { id: 'agents', icon: 'agent', label: 'Agents', blurb: 'Who runs on what' },
  { id: 'tools', icon: 'tool', label: 'Tools', blurb: 'What each agent may touch' },
]

// ---------------------------------------------------------------------------
// Agents — the switch that makes a configured provider do anything
// ---------------------------------------------------------------------------

function AgentProviders() {
  const a = useAiw()
  const [providers, setProviders] = useState<[string, string, ProviderHealth][]>([])
  const [drafts, setDrafts] = useState<Record<string, { provider: string; model: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    aiw.providers().then(setProviders).catch(() => setProviders([]))
  }, [])

  const draftFor = (ag: AgentDef) =>
    drafts[ag.id] ?? { provider: ag.provider, model: ag.model }

  const apply = async (ag: AgentDef) => {
    const d = draftFor(ag)
    setSaving(ag.id)
    setError(null)
    try {
      await aiw.setAgentProvider(ag.id, d.provider, d.model)
      await a.refresh()
      setDrafts({ ...drafts, [ag.id]: d })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  const realCount = a.agents.filter((x) => x.provider !== 'mock').length

  return (
    <>
      <div className="mb-3 flex items-start gap-2.5 rounded-md border border-line bg-raise px-3.5 py-3">
        <Icon name="info" size={13} className="mt-px shrink-0 text-indigo-400" />
        <div className="text-[11.5px] leading-[1.6] text-dim">
          Connecting a provider changes nothing on its own — this is where it takes effect. An agent
          stays on <span className="text-ink">Mock</span> until you point it somewhere else, so you
          can move one agent to a real model and leave the rest deterministic.
          {realCount > 0 && (
            <span className="ml-1 text-ok">
              {realCount} of {a.agents.length} are on a real provider.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] text-err">
          {error}
        </div>
      )}

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
          const dirty = d.provider !== ag.provider || d.model !== ag.model
          const isMock = ag.provider === 'mock'
          return (
            <div
              key={ag.id}
              className="grid grid-cols-[minmax(0,1fr)_170px_minmax(0,220px)_88px] items-center border-b border-line last:border-0"
            >
              <div className="min-w-0 px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px] text-ink">{ag.name}</span>
                  {!isMock && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                </div>
                <div className="mt-0.5 truncate text-[10.5px] text-muted">{ag.role}</div>
              </div>

              <div className="px-3 py-2.5">
                <select
                  className="input w-full text-[11.5px]"
                  value={d.provider}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [ag.id]: { ...d, provider: e.target.value } })
                  }
                >
                  {providers.map(([id, label, health]) => (
                    <option key={id} value={id} disabled={!health.configured && id !== 'mock'}>
                      {label}
                      {!health.configured && id !== 'mock' ? ' — not set up' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="px-3 py-2.5">
                <input
                  className="input w-full font-mono text-[11px]"
                  value={d.model}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [ag.id]: { ...d, model: e.target.value } })
                  }
                />
              </div>

              <div className="px-3 py-2.5">
                {dirty ? (
                  <button
                    className="btn-primary w-full text-[11px]"
                    disabled={saving === ag.id}
                    onClick={() => void apply(ag)}
                  >
                    {saving === ag.id ? '…' : 'Apply'}
                  </button>
                ) : (
                  <span className="block text-center text-[10.5px] text-faint">
                    {isMock ? 'mock' : 'live'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 text-[11px] leading-[1.55] text-muted">
        A provider that isn&rsquo;t set up is listed but not selectable — an agent pointed at
        nothing fails mid-run, which is the least useful moment to find out.
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Tools — the permission matrix
// ---------------------------------------------------------------------------

function ToolPermissions() {
  const a = useAiw()
  return (
    <>
      <div className="mb-3 flex items-start gap-2.5 rounded-md border border-line bg-raise px-3.5 py-3">
        <Icon name="info" size={13} className="mt-px shrink-0 text-indigo-400" />
        <div className="text-[11.5px] leading-[1.6] text-dim">
          Tools are the only way an agent reaches the machine. Permissions fail closed: an unknown
          agent gets nothing, <span className="text-ink">Read</span> refuses writes, and{' '}
          <span className="text-ink">Approval</span> is not a silent yes — it refuses until an
          approval flow exists, and the refusal is recorded as{' '}
          <span className="font-mono text-[11px]">tool.failed</span>.
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
                    {['full', 'read', 'approval', 'none'].map((p) => (
                      <option key={p} value={p}>
                        {p}
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
        A refused action is left out of what the model is offered entirely, rather than advertised
        and then denied — offering a read-only agent a write it can never call wastes a turn.
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

export function Settings() {
  const a = useAiw()
  const [tab, setTab] = useState<Tab>('providers')

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 pt-3.5">
        <div className="mb-3">
          <div className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Settings</div>
          <div className="mt-0.5 text-[12px] text-dim">
            How the AI Workspace is wired up — models, who uses them, and what they may touch.
          </div>
        </div>
        <div className="flex gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-[12px] ${
                tab === t.id
                  ? 'font-semibold text-ink shadow-[inset_0_-2px_0_theme(colors.indigo.500)]'
                  : 'text-muted hover:text-ink'
              }`}
              onClick={() => setTab(t.id)}
              title={t.blurb}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {tab === 'providers' && <ProviderCards onChanged={() => void a.refresh()} />}
        {tab === 'agents' && <AgentProviders />}
        {tab === 'tools' && <ToolPermissions />}
      </div>
    </div>
  )
}
