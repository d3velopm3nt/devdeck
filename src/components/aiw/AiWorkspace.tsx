// The Assistant surface.
//
// Every number on these screens comes from a service call or the event bus —
// there is no display-only data here. Where something failed to load it says so
// rather than rendering an empty state, because "no conflicts" and "the conflict
// query broke" must never look the same.

import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { useAiw, type AiwPage } from '../../lib/aiwStore'
import { Settings } from './Settings'
import { AgentEditor } from './AgentEditor'
import { Skills } from './Skills'
import { Chat } from './Chat'
import { ProjectTag } from './ProjectTag'
import { GitChanges } from './GitChanges'
import { CAPTURE_FEATURE, CAPTURE_PAGE } from '../../lib/devCapture'
import {
  aiw,
  ago,
  contextHealthStyle,
  describeEvent,
  initials,
  inclusionStyle,
  sessionStatusStyle,
  severityStyle,
  type AssembledContext,
  type Conflict,
  type ContextComparison,
  type DecisionRow,
  type DomainEvent,
  type RawContext,
  type Session,
} from '../../lib/aiw'

// The window the budget bar is drawn against. An estimate shown as an
// estimate — it is what makes "2,840 tokens" mean something rather than being
// a number floating on its own.
const CONTEXT_WINDOW = 12_000

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

const Chip = ({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded px-1.5 py-px text-[10.5px] font-semibold ${className}`}
  >
    {children}
  </span>
)

const Avatar = ({ id, size = 20 }: { id: string; size?: number }) => {
  // Stable per-agent tint from the id, so the same agent looks the same
  // everywhere without a hard-coded table that new agents fall out of.
  const tints = [
    'bg-violet-500/18 text-violet-300',
    'bg-sky-500/18 text-sky-300',
    'bg-emerald-500/16 text-emerald-300',
    'bg-amber-500/18 text-amber-300',
    'bg-slate-500/18 text-dim',
  ]
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-bold ${tints[h % tints.length]}`}
      style={{ height: size, width: size, fontSize: size * 0.42 }}
      title={id}
    >
      {initials(id)}
    </span>
  )
}

const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="mb-4">
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <div className="flex-1" />
      {right}
    </div>
    {children}
  </div>
)

const Empty = ({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-soft text-muted">
      <Icon name={icon} size={20} />
    </div>
    <div className="mb-1 text-[14px] font-semibold text-ink">{title}</div>
    <div className="max-w-[360px] text-[12px] leading-5 text-dim">{body}</div>
    {action && <div className="mt-3">{action}</div>}
  </div>
)

/// A load that failed. Deliberately loud, and never mistaken for "nothing here".
const Failure = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <div className="m-4 rounded border border-red-500/30 bg-red-500/5 px-3.5 py-3">
    <div className="mb-1 flex items-center gap-2">
      <Icon name="alert" size={13} className="text-err" />
      <span className="text-[12.5px] font-semibold text-err">Could not load the workspace</span>
    </div>
    <div className="mb-2.5 font-mono text-[11px] leading-5 text-dim">{error}</div>
    <div className="text-[11.5px] text-muted">
      Nothing has been deleted — this is a failed read, not an empty workspace.
    </div>
    <button className="btn-ghost mt-2.5 text-[11.5px]" onClick={onRetry}>
      <Icon name="update" size={11} /> Retry
    </button>
  </div>
)

const PageHead = ({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) => (
  <div className="flex items-end gap-3 border-b border-line px-5 py-3.5">
    <div className="min-w-0">
      <div className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</div>
      <div className="mt-0.5 text-[12px] text-dim">{subtitle}</div>
    </div>
    <div className="flex-1" />
    {right}
  </div>
)

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview() {
  const a = useAiw()
  const active = a.sessions.filter((s) => s.status === 'working' || s.status === 'planning')
  const open = a.conflicts.filter((c) => !c.resolved)
  const stale = a.sessions.filter((s) => s.stale)
  const failed = a.testRuns.filter((r) => !r.passed)

  const attention = [
    ...open.map((c) => ({
      dot: c.severity === 'blocking' ? 'bg-red-400' : c.severity === 'high' ? 'bg-amber-400' : 'bg-slate-400',
      title: `${c.title} — ${c.left.agent_id} vs ${c.right.agent_id}`,
      meta: `${c.feature_id ?? c.project_id} · ${ago(c.detected_at)}`,
    })),
    ...stale.map((s) => ({
      dot: 'bg-amber-400',
      title: `${s.agent_name} is working from an older context`,
      meta: `${s.feature_id} · checkpoint ${s.checkpoint?.commit?.slice(0, 7) ?? '—'}`,
    })),
    ...failed.map((r) => ({
      dot: 'bg-red-400',
      title: `Tests failed — ${r.command}`,
      meta: `${r.agent_id} · ${ago(r.started_at)}`,
    })),
  ]

  const tiles = [
    { label: 'Active projects', value: a.projects.length },
    { label: 'Active features', value: a.features.filter((f) => f.status !== 'completed').length },
    { label: 'Active agents', value: active.length, ok: active.length > 0 },
    { label: 'Open conflicts', value: open.length, warn: open.length > 0 },
    { label: 'Needs attention', value: attention.length },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHead
        title="Assistant"
        subtitle="Shared context and coordination across every project, in every workspace."
        right={
          <button className="btn-ghost text-[11.5px]" onClick={() => void a.refresh()}>
            <Icon name="update" size={11} /> Refresh
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mb-5 grid grid-cols-5 gap-2.5">
          {tiles.map((t) => (
            <div
              key={t.label}
              className={`rounded-md border bg-raise px-3 py-2.5 ${t.warn ? 'border-amber-500/28' : 'border-line'}`}
            >
              <div className="mb-1.5 text-[10.5px] text-muted">{t.label}</div>
              <div className="flex items-center gap-1.5">
                {t.warn && <Icon name="conflict" size={15} className="text-warn" />}
                <span className="text-[23px] font-semibold leading-none text-ink">{t.value}</span>
                {t.ok && (
                  <span className="inline-flex items-center gap-1 self-end pb-0.5 text-[10.5px] text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> working
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_372px] gap-4">
          <div className="min-w-0">
            <Section title="Active work" right={<span className="text-[11px] text-faint">{a.features.length} features</span>}>
              {a.features.length === 0 ? (
                <Empty
                  icon="ai"
                  title="No features yet"
                  body="Run the mock demo to create two fixture projects and watch four agents collaborate through the real runtime."
                  action={
                    <button className="btn-primary text-[12px]" onClick={() => void a.runDemo()}>
                      Run mock demo
                    </button>
                  }
                />
              ) : (
                a.features
                  .filter((f) => f.status !== 'completed')
                  .map((f) => {
                    const fs = a.sessions.filter((s) => s.feature_id === f.id)
                    return (
                      <button
                        key={f.id}
                        className="mb-2.5 block w-full rounded-md border border-line bg-raise p-3.5 text-left hover:border-line2"
                        onClick={() => {
                          void a.selectFeature(f.id)
                          a.setPage('feature')
                        }}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-ink">{f.name}</span>
                          <Chip className="bg-indigo-500/16 text-indigo-300">{f.status}</Chip>
                          <Chip className={contextHealthStyle(f.context_health)}>
                            context {f.context_health}
                          </Chip>
                          {f.conflicts > 0 && (
                            <Chip className="bg-amber-500/14 text-warn">
                              <Icon name="conflict" size={10} /> {f.conflicts}
                            </Chip>
                          )}
                          <div className="flex-1" />
                          <span className="text-[10.5px] text-faint">{ago(f.last_activity)}</span>
                        </div>
                        <div className="mb-2.5 flex min-w-0 items-baseline gap-1 text-[11px] text-muted">
                          <ProjectTag id={a.projectId} />
                          <span className="shrink-0">·</span>
                          <span className="truncate font-mono">
                            {f.areas.join(' · ') || 'no areas declared'}
                          </span>
                        </div>
                        {fs.length === 0 ? (
                          <div className="text-[11.5px] text-muted">No sessions yet.</div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {fs.slice(0, 4).map((s) => (
                              <div key={s.id} className="flex items-center gap-2.5">
                                <Avatar id={s.agent_id} />
                                <span className="w-[70px] shrink-0 truncate text-[12px] text-ink">
                                  {s.agent_name}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">
                                  {s.summary ?? s.transcript[s.transcript.length - 1]?.text ?? '…'}
                                </span>
                                {s.stale && <Chip className="bg-amber-500/14 text-warn">stale</Chip>}
                                <Chip className={sessionStatusStyle(s.status)}>{s.status}</Chip>
                              </div>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })
              )}
            </Section>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Section
              title="Needs attention"
              right={
                attention.length > 0 ? (
                  <span className="rounded-full bg-amber-500/14 px-1.5 py-px text-[10px] font-bold text-warn">
                    {attention.length}
                  </span>
                ) : undefined
              }
            >
              <div className="overflow-hidden rounded-md border border-line bg-raise">
                {attention.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[11.5px] leading-5 text-muted">
                    Nothing needs you. All active work is currently compatible.
                  </div>
                ) : (
                  attention.map((x, i) => (
                    <button
                      key={i}
                      className="flex w-full gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-hover"
                      onClick={() => a.setPage('conflicts')}
                    >
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${x.dot}`} />
                      <div className="min-w-0">
                        <div className="text-[11.5px] leading-[1.4] text-ink">{x.title}</div>
                        <div className="mt-0.5 text-[10.5px] text-muted">{x.meta}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Section>

            <Section
              title="Recent activity"
              right={
                <button className="text-[11px] text-dim hover:text-ink" onClick={() => a.setPage('activity')}>
                  View all
                </button>
              }
            >
              <div className="rounded-md border border-line bg-raise py-1">
                {a.events.slice(0, 12).map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
                {a.events.length === 0 && (
                  <div className="px-3 py-5 text-center text-[11.5px] text-muted">
                    No events yet.
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

const CATEGORY_TINT: Record<string, string> = {
  Agent: 'bg-violet-500/18 text-violet-300',
  Session: 'bg-violet-500/12 text-violet-300',
  Task: 'bg-indigo-500/16 text-indigo-300',
  Tool: 'bg-slate-500/16 text-dim',
  Process: 'bg-slate-500/16 text-dim',
  File: 'bg-slate-500/16 text-body',
  Git: 'bg-slate-500/16 text-body',
  Context: 'bg-sky-500/18 text-sky-300',
  Decision: 'bg-violet-500/14 text-violet-300',
  Conflict: 'bg-amber-500/18 text-warn',
  Test: 'bg-emerald-500/14 text-ok',
  Workspace: 'bg-slate-500/12 text-muted',
}

const CATEGORY_ICON: Record<string, IconName> = {
  Agent: 'agent',
  Session: 'agent',
  Task: 'command',
  Tool: 'tool',
  Process: 'run',
  File: 'code',
  Git: 'commit',
  Context: 'context',
  Decision: 'decision',
  Conflict: 'conflict',
  Test: 'ok',
  Workspace: 'workspace',
}

function EventRow({ e, showMeta = false }: { e: DomainEvent; showMeta?: boolean }) {
  const time = e.timestamp.slice(11, 16)
  return (
    <div className="flex items-start gap-2.5 px-3 py-1.5">
      <span className="w-[34px] shrink-0 pt-0.5 font-mono text-[10.5px] text-faint">{time}</span>
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded ${
          CATEGORY_TINT[e.category] ?? CATEGORY_TINT.Workspace
        }`}
      >
        <Icon name={CATEGORY_ICON[e.category] ?? 'info'} size={10} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] leading-[1.45] text-body">{describeEvent(e)}</div>
        {showMeta && (
          <div className="mt-0.5 font-mono text-[10px] text-faint">
            {e.type}
            {e.feature_id ? ` · ${e.feature_id}` : ''}
            {e.correlation_id ? ` · ${e.correlation_id}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const STATUSES = ['All', 'planned', 'in-progress', 'review', 'blocked', 'completed']

export function Features() {
  const a = useAiw()
  const [filter, setFilter] = useState('All')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const rows = a.features.filter((f) => filter === 'All' || f.status === filter)

  const create = async () => {
    if (!a.projectId || !name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const slug = await aiw.createFeature(a.projectId, name.trim(), goal.trim(), [])
      setCreating(false)
      setName('')
      setGoal('')
      await a.refresh()
      await a.selectFeature(slug)
      a.setPage('feature')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHead
        title="Features"
        subtitle="The collaboration boundary between humans and agents."
        right={
          <button className="btn-primary text-[11.5px]" onClick={() => setCreating((v) => !v)}>
            <Icon name="add" size={11} /> New feature
          </button>
        }
      />

      {creating && (
        <div className="border-b border-line bg-panel px-5 py-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Create a feature
          </div>
          <div className="flex items-start gap-2">
            <input
              className="input w-[260px] text-[12px]"
              placeholder="Feature name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input flex-1 text-[12px]"
              placeholder="Goal — one sentence on what it is for"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <button className="btn-primary text-[12px]" disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button className="btn-ghost text-[12px]" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
          <div className="mt-2 text-[11px] text-muted">
            Writes <span className="font-mono">feature.md</span>, <span className="font-mono">context.md</span>,{' '}
            <span className="font-mono">requirements.md</span> and <span className="font-mono">work.md</span> under{' '}
            <span className="font-mono">.devdeck/features/</span>.
          </div>
          {err && <div className="mt-2 text-[11.5px] text-err">{err}</div>}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-b border-line px-5 py-2">
        <div className="flex gap-px rounded-md border border-line bg-soft p-0.5">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`rounded px-2.5 py-1 text-[11.5px] ${
                filter === s ? 'bg-raise font-semibold text-ink' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setFilter(s)}
            >
              {s}
              <span className="ml-1 text-[10px] text-faint">
                {s === 'All' ? a.features.length : a.features.filter((f) => f.status === s).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {rows.length === 0 ? (
          <Empty icon="list" title="Nothing in this state" body="No features match this filter." />
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-raise">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_150px_110px_100px_96px] border-b border-line bg-soft">
              {['Feature', 'Status', 'Agents', 'Context', 'Conflicts', 'Last activity'].map((h, i) => (
                <div
                  key={h}
                  className={`px-3 py-2 text-[10.5px] font-semibold text-muted ${i === 5 ? 'text-right' : ''}`}
                >
                  {h}
                </div>
              ))}
            </div>
            {rows.map((f) => (
              <button
                key={f.id}
                className="grid w-full grid-cols-[minmax(0,1fr)_120px_150px_110px_100px_96px] items-center border-b border-line text-left last:border-0 hover:bg-hover"
                onClick={() => {
                  void a.selectFeature(f.id)
                  a.setPage('feature')
                }}
              >
                <div className="min-w-0 px-3 py-2.5">
                  <div className="truncate text-[12.5px] text-ink">{f.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted">
                    {f.areas.join(' · ') || f.id}
                  </div>
                </div>
                <div className="px-3 py-2.5">
                  <Chip className="bg-indigo-500/16 text-indigo-300">{f.status}</Chip>
                </div>
                <div className="flex items-center gap-1 px-3 py-2.5">
                  {f.agents.length === 0 ? (
                    <span className="text-[10.5px] text-faint">none</span>
                  ) : (
                    f.agents.slice(0, 4).map((n) => <Avatar key={n} id={n} size={19} />)
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <Chip className={contextHealthStyle(f.context_health)}>{f.context_health}</Chip>
                </div>
                <div className="px-3 py-2.5">
                  {f.conflicts > 0 ? (
                    <span className="text-[11px] font-semibold text-warn">{f.conflicts} open</span>
                  ) : (
                    <span className="text-[11px] text-faint">—</span>
                  )}
                </div>
                <div className="px-3 py-2.5 text-right text-[10.5px] text-faint">{ago(f.last_activity)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feature detail
// ---------------------------------------------------------------------------

const FEATURE_TABS = ['Overview', 'Work', 'Context', 'Activity', 'Decisions', 'Conflicts', 'Git'] as const
type FeatureTab = (typeof FEATURE_TABS)[number]

function FeatureDetail() {
  const a = useAiw()
  const [tab, setTab] = useState<FeatureTab>('Overview')
  const [starting, setStarting] = useState<string | null>(null)

  const f = a.features.find((x) => x.id === a.featureId)
  if (!f) {
    return <Empty icon="list" title="No feature selected" body="Pick one from the Features list." />
  }

  const sessions = a.sessions.filter((s) => s.feature_id === f.id)
  const conflicts = a.conflicts.filter((c) => c.feature_id === f.id && !c.resolved)
  const events = a.events.filter((e) => e.feature_id === f.id)
  const decisions = a.decisions.filter((d) => !d.feature || d.feature === f.id)

  const start = async (agentId: string) => {
    setStarting(agentId)
    const item = a.workItems.find((w) => w.status === 'unclaimed')
    await a.startAgent(agentId, {
      workItemId: item?.id,
      intent: item?.title,
      areas: item?.areas ?? f.areas,
      dependsOn: agentId === 'dev-b' ? ['SyncResult'] : [],
    })
    setStarting(null)
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line px-5 pt-3.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted">
            <button className="hover:text-ink" onClick={() => a.setPage('features')}>
              Features
            </button>
            <Icon name="chevron-right" size={11} />
            <span className="text-dim">{f.name}</span>
          </div>

          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{f.name}</span>
            <Chip className="bg-indigo-500/16 text-indigo-300">{f.status}</Chip>
            <Chip className={contextHealthStyle(f.context_health)}>context {f.context_health}</Chip>
            {a.context?.commit && (
              <Chip className="bg-slate-500/14 font-mono font-normal text-dim">
                {a.context.commit.slice(0, 7)}
              </Chip>
            )}
            <div className="flex-1" />
            <span className="text-[11px] text-muted">{sessions.filter((s) => s.status === 'working').length} active</span>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {a.agents.map((ag) => (
              <button
                key={ag.id}
                className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]"
                disabled={starting !== null}
                onClick={() => void start(ag.id)}
                title={ag.system}
              >
                {starting === ag.id ? (
                  <Icon name="spinner" size={11} className="animate-spin" />
                ) : (
                  <Icon name="run" size={10} />
                )}
                {ag.name}
              </button>
            ))}
            <button className="btn-ghost text-[11.5px]" onClick={() => a.setPage('context')}>
              <Icon name="context" size={11} /> Context Inspector
            </button>
          </div>

          <div className="flex gap-0.5">
            {FEATURE_TABS.map((t) => {
              const badge =
                t === 'Work' ? a.workItems.length
                : t === 'Decisions' ? decisions.length
                : t === 'Conflicts' ? conflicts.length
                : 0
              return (
                <button
                  key={t}
                  className={`relative whitespace-nowrap px-2.5 py-1.5 text-[12px] ${
                    tab === t
                      ? 'font-semibold text-ink shadow-[inset_0_-2px_0_theme(colors.indigo.500)]'
                      : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setTab(t)}
                >
                  {t}
                  {badge > 0 && (
                    <span className={`ml-1 text-[10px] ${t === 'Conflicts' ? 'font-bold text-warn' : 'text-faint'}`}>
                      {badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {tab === 'Overview' && (
            <>
              <Section title="Goal">
                <div className="max-w-[760px] text-[12.5px] leading-6 text-body">
                  {f.goal ?? 'No goal recorded for this feature.'}
                </div>
              </Section>
              <Section title="Related areas">
                <div className="flex flex-wrap gap-1.5 rounded-md border border-line bg-raise p-3">
                  {f.areas.length === 0 ? (
                    <span className="text-[11.5px] text-muted">No areas declared.</span>
                  ) : (
                    f.areas.map((x) => (
                      <Chip key={x} className="bg-soft font-mono font-normal text-dim">
                        {x}
                      </Chip>
                    ))
                  )}
                </div>
              </Section>
              <Section title="Sessions">
                {sessions.length === 0 ? (
                  <Empty
                    icon="agent"
                    title="No agents have worked here"
                    body="Start one above and DevDeck keeps its context synchronised with everyone else."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {sessions.map((s) => (
                      <SessionCard key={s.id} s={s} />
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}

          {tab === 'Work' && (
            <div className="overflow-hidden rounded-md border border-line bg-raise">
              {a.workItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted">
                  No work items in <span className="font-mono">work.md</span>.
                </div>
              ) : (
                a.workItems.map((w) => (
                  <div key={w.id} className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-0">
                    {w.assignee ? <Avatar id={w.assignee} /> : <span className="h-5 w-5 rounded bg-soft" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-ink">{w.title}</div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-muted">
                        {w.areas.join(' · ') || w.id}
                      </div>
                    </div>
                    <Chip
                      className={
                        w.status === 'done'
                          ? 'bg-emerald-500/12 text-ok'
                          : w.status === 'in-progress'
                            ? 'bg-indigo-500/16 text-indigo-300'
                            : 'bg-slate-500/14 text-dim'
                      }
                    >
                      {w.status}
                    </Chip>
                    <span className="w-[80px] text-right text-[10.5px] text-faint">
                      {w.assignee ?? 'unassigned'}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Context' && <ContextSummary />}

          {tab === 'Activity' && (
            <div className="rounded-md border border-line bg-raise py-1">
              {events.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted">No events for this feature.</div>
              ) : (
                events.map((e) => <EventRow key={e.id} e={e} showMeta />)
              )}
            </div>
          )}

          {tab === 'Decisions' && <DecisionList rows={decisions} />}

          {tab === 'Conflicts' && (
            <ConflictList conflicts={conflicts} onResolve={(id) => void a.resolveConflict(id)} />
          )}

          {tab === 'Git' && <GitList />}
        </div>
      </div>

      <div className="flex w-[330px] shrink-0 flex-col border-l border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="h-[7px] w-[7px] rounded-full bg-emerald-400" />
          <span className="text-[12.5px] font-semibold text-ink">Live</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Agents on this feature
          </div>
          {sessions.length === 0 && (
            <div className="rounded border border-dashed border-line2 px-3 py-4 text-center text-[11.5px] text-muted">
              No agents here yet.
            </div>
          )}
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} compact />
          ))}

          {a.context && (
            <>
              <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">
                Context
              </div>
              <ContextBudget ctx={a.context} onOpen={() => a.setPage('context')} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionCard({ s, compact = false }: { s: Session; compact?: boolean }) {
  return (
    <div className={`mb-2 rounded-md border bg-raise p-2.5 ${s.stale ? 'border-amber-500/28' : 'border-line'}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Avatar id={s.agent_id} size={21} />
        <span className="text-[12px] font-semibold text-ink">{s.agent_name}</span>
        <Chip className={sessionStatusStyle(s.status)}>{s.status}</Chip>
        {s.stale && <Chip className="bg-amber-500/14 text-warn">stale</Chip>}
      </div>
      <div className="mb-2 text-[11px] leading-[1.5] text-dim">{s.summary ?? 'Working…'}</div>
      <div className="flex flex-wrap gap-2.5 text-[10.5px] text-muted">
        <span>{s.turns} turns</span>
        <span>{s.files_touched.length} files</span>
        <span>{s.context_tokens.toLocaleString()} tok</span>
        {s.checkpoint?.commit && <span className="font-mono">{s.checkpoint.commit.slice(0, 7)}</span>}
      </div>
      {!compact && s.transcript.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          {s.transcript.slice(-4).map((t, i) => (
            <div key={i} className="flex gap-2 py-0.5 text-[10.5px]">
              <span className={t.kind === 'tool-error' ? 'text-err' : 'text-faint'}>{t.kind}</span>
              <span className="min-w-0 flex-1 truncate text-dim">{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ContextBudget({ ctx, onOpen }: { ctx: AssembledContext; onOpen: () => void }) {
  const included = ctx.sections.filter((s) => s.inclusion !== 'excluded')
  const colors = ['bg-indigo-400', 'bg-sky-400', 'bg-violet-400', 'bg-emerald-400', 'bg-slate-400']
  return (
    <div className="rounded-md border border-line bg-raise p-3">
      <div className="mb-2 flex items-center gap-2">
        <Chip className="bg-emerald-500/12 text-ok">
          <Icon name="check" size={10} /> assembled
        </Chip>
        {ctx.commit && <span className="font-mono text-[11px] text-muted">{ctx.commit.slice(0, 7)}</span>}
        <div className="flex-1" />
        <span className="text-[11px] text-dim">{ctx.total_tokens.toLocaleString()} tok</span>
      </div>
      <div className="mb-2 flex h-[5px] gap-0.5 overflow-hidden rounded-sm">
        {included.map((s, i) => (
          <div
            key={s.key}
            className={colors[i % colors.length]}
            style={{ width: `${Math.max(1, (s.tokens / CONTEXT_WINDOW) * 100)}%` }}
            title={`${s.title}: ${s.tokens} tokens`}
          />
        ))}
        <div className="flex-1 bg-line2" />
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10.5px] text-muted">
        {included.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-sm ${colors[i % colors.length]}`} />
            {s.title} {s.tokens}
          </span>
        ))}
      </div>
      <button className="btn-ghost mt-2.5 w-full justify-center text-[11.5px]" onClick={onOpen}>
        Open Context Inspector
      </button>
    </div>
  )
}

function ContextSummary() {
  const a = useAiw()
  if (!a.context) return <div className="text-[12px] text-muted">No context assembled.</div>
  return (
    <>
      <div className="mb-3 flex items-center gap-4 rounded-md border border-line bg-raise px-4 py-3">
        <Meta label="Context commit" value={a.context.commit?.slice(0, 7) ?? '—'} mono />
        <Divider />
        <Meta label="Estimated size" value={`${a.context.total_tokens.toLocaleString()} tokens`} />
        <Divider />
        <Meta label="Withheld" value={`${a.context.excluded_tokens.toLocaleString()} tokens`} />
        <div className="flex-1" />
        <button className="btn-ghost text-[11.5px]" onClick={() => a.setPage('context')}>
          Open inspector
        </button>
      </div>
      <div className="max-w-[720px] text-[11.5px] leading-6 text-dim">
        This is the summary. The full breakdown — every section, its token cost, and whether it is
        included, inherited, generated or deliberately excluded — is in the Context Inspector.
      </div>
    </>
  )
}

const Meta = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <div>
    <div className="text-[10.5px] text-muted">{label}</div>
    <div className={`mt-0.5 text-[12.5px] text-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
  </div>
)
const Divider = () => <div className="h-7 w-px bg-line" />

// ---------------------------------------------------------------------------
// Context Inspector
// ---------------------------------------------------------------------------

export function ContextInspector() {
  const a = useAiw()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [raw, setRaw] = useState<RawContext | null>(null)
  const [view, setView] = useState<'Raw' | 'Rendered'>('Raw')
  const [cmp, setCmp] = useState<ContextComparison | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!a.projectId || !a.featureId) return
    setRaw(null)
    setErr(null)
    aiw
      .contextRaw(a.projectId, a.featureId)
      .then(setRaw)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [a.projectId, a.featureId])

  const [exportTo, setExportTo] = useState('CLAUDE.md')
  const [exported, setExported] = useState<{ ok: boolean; text: string } | null>(null)

  const doExport = async () => {
    if (!a.projectId || !a.featureId) return
    setExported(null)
    try {
      const path = await aiw.exportContext(a.projectId, a.featureId, exportTo)
      setExported({ ok: true, text: `Written to ${path}` })
    } catch (e) {
      setExported({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  const compare = async () => {
    if (!a.projectId || !a.featureId) return
    const base = a.commits[a.commits.length - 1]
    if (!base) return
    try {
      setCmp(await aiw.contextCompare(a.projectId, a.featureId, base.sha))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  // Reached from the sidebar there is no feature yet, and the inspector is
  // meaningless without one. Rather than dead-ending, open on the first
  // feature — the picker in the header is how you move between them.
  useEffect(() => {
    if (!a.featureId && a.features.length > 0) void a.selectFeature(a.features[0].id)
  }, [a.featureId, a.features])

  if (!a.context) {
    return (
      <Empty
        icon="context"
        title={a.features.length === 0 ? 'No features yet' : 'Assembling context…'}
        body={
          a.features.length === 0
            ? 'The inspector shows exactly what an agent receives for a feature. Create one, or run the mock demo.'
            : 'Reading .devdeck and working out what this feature’s agents should be given.'
        }
      />
    )
  }
  const ctx = a.context

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHead
        title="Context Inspector"
        subtitle="Exactly what an agent receives when it starts work on this feature."
        right={
          <>
            <div
              className="flex items-center gap-1 rounded border border-line2 bg-soft px-1 py-0.5"
              title="Write this feature's context into a file other agent tools already read"
            >
              <select
                className="border-none bg-transparent px-1 py-0.5 text-[11px] text-body outline-none"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
              >
                {['CLAUDE.md', 'AGENTS.md', '.cursorrules'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button
                className="rounded px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-ink"
                onClick={() => void doExport()}
              >
                Export
              </button>
            </div>
            <select
              className="input text-[11.5px]"
              value={a.featureId ?? ''}
              onChange={(e) => void a.selectFeature(e.target.value)}
              title="Which feature's context to inspect"
            >
              {a.features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button className="btn-ghost text-[11.5px]" onClick={() => void compare()}>
              <Icon name="commit" size={11} /> Compare context
            </button>
            <button className="btn-ghost text-[11.5px]" onClick={() => void a.refreshContext()}>
              <Icon name="update" size={11} /> Reassemble
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-5">
          {exported && (
            <div
              className={`mb-3 rounded border px-3 py-2 text-[11.5px] leading-5 ${
                exported.ok
                  ? 'border-emerald-500/28 bg-emerald-500/6 text-ok'
                  : 'border-red-500/30 bg-red-500/5 text-err'
              }`}
            >
              {exported.text}
              {exported.ok && (
                <span className="ml-1 text-dim">
                  — only the DevDeck block was replaced; anything else in that file is untouched.
                </span>
              )}
            </div>
          )}

          <div className="mb-4 rounded-md border border-line bg-raise px-4 py-3">
            <div className="mb-3 flex items-center gap-4">
              <Meta label="Feature" value={ctx.feature_id} />
              <Divider />
              <Meta label="Context commit" value={ctx.commit?.slice(0, 7) ?? '—'} mono />
              <Divider />
              <Meta label="Assembled" value={ago(ctx.assembled_at)} />
              <Divider />
              <Meta label="Estimated size" value={`${ctx.total_tokens.toLocaleString()} tokens`} />
              <div className="flex-1" />
              <Chip className="bg-emerald-500/12 text-ok">
                <Icon name="check" size={10} /> fresh
              </Chip>
            </div>
            {/* The budget bar. Seeing the included sections against the whole
                window is the point of the screen: a context that is mostly
                empty space is a different problem from one that is nearly
                full, and a table of numbers hides which. */}
            {(() => {
              const included = ctx.sections.filter((s) => s.inclusion !== 'excluded')
              const colors = [
                'bg-indigo-400',
                'bg-sky-400',
                'bg-violet-400',
                'bg-emerald-400',
                'bg-amber-400',
                'bg-slate-400',
              ]
              return (
                <>
                  <div className="mb-2 flex h-[7px] gap-0.5 overflow-hidden rounded-sm">
                    {included.map((sec, i) => (
                      <div
                        key={sec.key}
                        className={colors[i % colors.length]}
                        style={{ width: `${Math.max(0.6, (sec.tokens / CONTEXT_WINDOW) * 100)}%` }}
                        title={`${sec.title}: ${sec.tokens.toLocaleString()} tokens`}
                      />
                    ))}
                    <div className="flex-1 bg-line" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] text-muted">
                    {included.map((sec, i) => (
                      <span key={sec.key} className="inline-flex items-center gap-1.5">
                        <span className={`h-[7px] w-[7px] rounded-sm ${colors[i % colors.length]}`} />
                        {sec.title} {sec.tokens.toLocaleString()}
                      </span>
                    ))}
                    <span className="ml-auto text-faint">
                      of a {CONTEXT_WINDOW.toLocaleString()}-token window
                    </span>
                  </div>
                </>
              )
            })()}

            <div className="mt-2.5 border-t border-line pt-2.5 text-[11px] text-muted">
              {ctx.excluded_tokens.toLocaleString()} tokens deliberately withheld — the exclusions
              below are the point, not an omission.
            </div>
          </div>

          <Section title="Sections" right={<span className="text-[10.5px] text-faint">click a row to expand</span>}>
            <div className="overflow-hidden rounded-md border border-line bg-raise">
              {ctx.sections.map((s) => {
                const isOpen = !!open[s.key]
                const excluded = s.inclusion === 'excluded'
                return (
                  <div key={s.key} className="border-b border-line last:border-0">
                    <button
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-hover"
                      onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}
                    >
                      <Icon
                        name="chevron-right"
                        size={11}
                        className={`text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] ${
                          excluded ? 'text-muted line-through' : 'text-ink'
                        }`}
                      >
                        {s.title}
                      </span>
                      <Chip className={inclusionStyle(s.inclusion)}>{s.inclusion}</Chip>
                      <span
                        className={`w-[56px] text-right font-mono text-[11px] ${
                          excluded ? 'text-faint' : 'text-dim'
                        }`}
                      >
                        {excluded ? '—' : s.tokens.toLocaleString()}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pl-8">
                        <div className="mb-1.5 font-mono text-[10.5px] text-muted">{s.source}</div>
                        {s.reason && (
                          <div className="mb-2 rounded border border-line bg-page px-2.5 py-1.5 text-[11px] text-warn">
                            Excluded: {s.reason}
                          </div>
                        )}
                        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-line bg-page px-3 py-2.5 font-mono text-[11px] leading-[1.65] text-body">
                          {s.body}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

          {cmp && (
            <Section title={`Context changes · ${cmp.from.slice(0, 7)} → ${cmp.to}`}>
              <div className="overflow-hidden rounded-md border border-line bg-raise">
                {cmp.changes.length === 0 ? (
                  <div className="px-3 py-4 text-[11.5px] text-muted">
                    The context document is unchanged between these commits.
                  </div>
                ) : (
                  cmp.changes.map((c, i) => (
                    <div key={i} className="flex gap-2.5 border-b border-line px-3 py-2 last:border-0">
                      <Chip
                        className={
                          c.kind === 'added'
                            ? 'bg-emerald-500/12 text-ok'
                            : c.kind === 'removed'
                              ? 'bg-red-500/12 text-err'
                              : c.kind === 'conflicting'
                                ? 'bg-amber-500/14 text-warn'
                                : 'bg-sky-500/12 text-info'
                        }
                      >
                        {c.kind}
                      </Chip>
                      <span className="min-w-0 flex-1 text-[11.5px] text-body">{c.detail}</span>
                    </div>
                  ))
                )}
              </div>
              {cmp.changed_files.length > 0 && (
                <div className="mt-2 font-mono text-[10.5px] text-muted">
                  {cmp.changed_files.length} file(s): {cmp.changed_files.slice(0, 6).join(', ')}
                </div>
              )}
            </Section>
          )}
        </div>

        <div className="flex w-[430px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Icon name="note" size={13} className="text-indigo-400" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
              {raw?.path ?? '…'}
            </span>
            <div className="flex gap-px rounded border border-line bg-soft p-0.5">
              {(['Raw', 'Rendered'] as const).map((v) => (
                <button
                  key={v}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    view === v ? 'bg-raise font-semibold text-ink' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {err && <div className="text-[11.5px] text-err">{err}</div>}
            {!raw && !err && <div className="text-[11.5px] text-muted">Loading…</div>}
            {raw && view === 'Raw' && (
              <>
                <div className="mb-2.5 rounded border border-indigo-500/22 bg-indigo-500/6 px-3 py-2">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                    YAML frontmatter
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.65] text-dim">
                    {raw.frontmatter.trim()}
                  </pre>
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.65] text-body">
                  {raw.body}
                </pre>
              </>
            )}
            {raw && view === 'Rendered' && (
              <div className="text-[12px] leading-[1.65] text-body">
                {raw.body.split('\n').map((line, i) =>
                  line.startsWith('## ') ? (
                    <div
                      key={i}
                      className="mb-1.5 mt-3.5 text-[11px] font-semibold uppercase tracking-wide text-faint"
                    >
                      {line.slice(3)}
                    </div>
                  ) : line.startsWith('# ') ? (
                    <div key={i} className="mb-2 text-[15px] font-semibold text-ink">
                      {line.slice(2)}
                    </div>
                  ) : line.startsWith('- ') ? (
                    <div key={i} className="pl-3.5">
                      • {line.slice(2)}
                    </div>
                  ) : (
                    <div key={i}>{line}</div>
                  ),
                )}
              </div>
            )}
          </div>
          <div className="border-t border-line px-3 py-2 text-[10.5px] text-muted">
            It is a normal file on disk — edit it anywhere.
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conflicts, decisions, agents, activity, git, tools, knowledge, tests
// ---------------------------------------------------------------------------

function ConflictList({
  conflicts,
  onResolve,
}: {
  conflicts: Conflict[]
  onResolve: (id: string) => void
}) {
  if (conflicts.length === 0) {
    return (
      <Empty
        icon="ok"
        title="No conflicts"
        body="All active work is currently compatible. DevDeck re-checks whenever an agent claims work, writes a file, or the context changes."
      />
    )
  }
  return (
    <div className="flex flex-col gap-2.5">
      {conflicts.map((c) => {
        const st = severityStyle(c.severity)
        return (
          <div key={c.id} className={`overflow-hidden rounded-md border bg-raise ${st.border}`}>
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
              <Chip className={`${st.chip} tracking-wide`}>{c.severity.toUpperCase()}</Chip>
              <span className="text-[13.5px] font-semibold text-ink">{c.title}</span>
              {c.feature_id && <Chip className="bg-soft font-normal text-dim">{c.feature_id}</Chip>}
              <div className="flex-1" />
              <span className="text-[10.5px] text-faint">{ago(c.detected_at)}</span>
            </div>
            <div className="px-4 py-3">
              <div className="mb-3 flex items-stretch gap-3">
                <div className="min-w-0 flex-1 rounded border border-line bg-page px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Avatar id={c.left.agent_id} size={17} />
                    <span className="text-[10.5px] text-muted">{c.left.agent_id}</span>
                  </div>
                  <div className="text-[12px] leading-5 text-body">{c.left.detail}</div>
                  {c.left.source && (
                    <div className="mt-1 font-mono text-[10.5px] text-faint">{c.left.source}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <Icon name="conflict" size={15} className={c.severity === 'blocking' ? 'text-err' : 'text-warn'} />
                </div>
                <div className="min-w-0 flex-1 rounded border border-line bg-page px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Avatar id={c.right.agent_id} size={17} />
                    <span className="text-[10.5px] text-muted">{c.right.agent_id}</span>
                  </div>
                  <div className="text-[12px] leading-5 text-body">{c.right.detail}</div>
                  {c.right.source && (
                    <div className="mt-1 font-mono text-[10.5px] text-faint">{c.right.source}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button className="btn-primary text-[11.5px]" onClick={() => onResolve(c.id)}>
                  Resolve
                </button>
                <div className="flex-1" />
                <span className="font-mono text-[10px] text-faint">{c.kind}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Conflicts() {
  const a = useAiw()
  const [scope, setScope] = useState<'Open' | 'Resolved'>('Open')
  const shown = a.conflicts.filter((c) => (scope === 'Open' ? !c.resolved : c.resolved))
  return (
    <div className="flex h-full flex-col">
      <PageHead
        title="Conflict Center"
        subtitle="Where two pieces of work, or a piece of work and a rule, disagree."
      />
      <div className="flex items-center gap-1.5 border-b border-line px-5 py-2">
        <div className="flex gap-px rounded-md border border-line bg-soft p-0.5">
          {(['Open', 'Resolved'] as const).map((s) => (
            <button
              key={s}
              className={`rounded px-2.5 py-1 text-[11.5px] ${
                scope === s ? 'bg-raise font-semibold text-ink' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setScope(s)}
            >
              {s}
              <span className="ml-1 text-[10px] text-faint">
                {a.conflicts.filter((c) => (s === 'Open' ? !c.resolved : c.resolved)).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <ConflictList conflicts={shown} onResolve={(id) => void a.resolveConflict(id)} />
      </div>
    </div>
  )
}

function DecisionList({ rows }: { rows: DecisionRow[] }) {
  if (rows.length === 0) {
    return <Empty icon="decision" title="No decisions recorded" body="An agent or a human records one when a choice is made that later work must respect." />
  }
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((d) => (
        <div
          key={d.id}
          className={`rounded-md border border-line bg-raise px-4 py-3 ${d.status === 'superseded' ? 'opacity-70' : ''}`}
        >
          <div className="mb-1.5 flex items-center gap-2.5">
            <span
              className={`text-[13px] font-semibold ${d.status === 'superseded' ? 'text-dim line-through' : 'text-ink'}`}
            >
              {d.title}
            </span>
            <Chip
              className={
                d.status === 'approved'
                  ? 'bg-emerald-500/12 text-ok'
                  : d.status === 'superseded'
                    ? 'bg-slate-500/14 text-muted'
                    : 'bg-sky-500/12 text-info'
              }
            >
              {d.status}
            </Chip>
            <div className="flex-1" />
            <span className="text-[10.5px] text-faint">
              {ago(d.created)} {d.author ? `· ${d.author}` : ''}
            </span>
          </div>
          <div className="mb-2 max-w-[700px] text-[11.5px] leading-[1.55] text-dim">{d.body}</div>
          {d.impacts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[10.5px] text-muted">Impacts</span>
              {d.impacts.map((x) => (
                <Chip key={x} className="bg-soft font-normal text-dim">
                  {x}
                </Chip>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Agents() {
  const a = useAiw()
  // Which agent's own page is open. Null is the list. Seeded from the store
  // when something elsewhere — a pill in a thread — asked for one, and
  // consumed at once so the list is what you get next time.
  const [editing, setEditing] = useState<string | null>(() => {
    const wanted = useAiw.getState().editAgent
    if (wanted) useAiw.setState({ editAgent: null })
    return wanted
  })

  if (editing) return <AgentEditor id={editing} onClose={() => setEditing(null)} />

  const add = async () => {
    const name = prompt('Name for the new agent', 'Developer C')?.trim()
    if (!name) return
    // An id you can read in a file name and an event, derived once. Editable
    // afterwards, because guessing wrong should not mean starting over.
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await aiw.saveAgent({
      id,
      name,
      role: 'developer',
      provider: 'mock',
      model: 'mock-1',
      permissions: {},
      skills: [],
      builtin: false,
      instructions: '',
    })
    await a.reloadAgents()
    setEditing(id)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHead title="Agents" subtitle="Who is working right now, on what, and with which context." />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <Section title="Your team">
          <div className="grid grid-cols-3 gap-3">
            {a.agents.map((ag) => (
              <button
                key={ag.id}
                className="flex items-center gap-2.5 rounded-md border border-line bg-raise p-3 text-left hover:border-line2"
                onClick={() => setEditing(ag.id)}
              >
                <Avatar id={ag.id} size={29} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink">{ag.name}</div>
                  <div className="mt-px truncate text-[10.5px] text-muted">
                    {ag.role} · {ag.provider === 'mock' ? 'Mock (no AI)' : ag.model || ag.provider}
                  </div>
                </div>
                {ag.provider === 'mock' && (
                  <span className="shrink-0 rounded bg-amber-500/14 px-1.5 text-[9.5px] font-semibold text-warn">
                    mock
                  </span>
                )}
              </button>
            ))}
            <button
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-line2 p-3 text-[12px] text-muted hover:border-line3 hover:text-ink"
              onClick={() => void add()}
            >
              <Icon name="add" size={13} /> New agent
            </button>
          </div>
        </Section>

        <Section title="Sessions">
          {a.sessions.length === 0 ? (
            <Empty
              icon="agent"
              title="No active agents"
              body="Start an agent on a feature and DevDeck will keep its context synchronised with everyone else."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {a.sessions.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-md border bg-raise p-3.5 ${s.stale ? 'border-amber-500/28' : 'border-line'}`}
                >
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <Avatar id={s.agent_id} size={29} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-ink">{s.agent_name}</div>
                      <div className="mt-px text-[10.5px] text-muted">{s.role}</div>
                    </div>
                    <div className="flex-1" />
                    <Chip className={sessionStatusStyle(s.status)}>{s.status}</Chip>
                  </div>
                  <div className="mb-2.5 rounded border border-line bg-page px-3 py-2.5">
                    <div className="mb-0.5 flex min-w-0 items-baseline gap-1 text-[10.5px] text-muted">
                      <ProjectTag id={s.project_id} />
                      <span className="shrink-0">·</span>
                      <span className="truncate">{s.feature_id}</span>
                    </div>
                    <div className="text-[12px] leading-[1.45] text-body">
                      {s.summary ?? 'Working…'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-[11px]">
                    <Kv k="Started" v={ago(s.started_at)} />
                    <Kv k="Checkpoint" v={s.checkpoint?.commit?.slice(0, 7) ?? '—'} />
                    <Kv
                      k="Context"
                      v={s.stale ? 'stale' : 'up to date'}
                      tone={s.stale ? 'text-warn' : 'text-ok'}
                    />
                    <Kv k="Files touched" v={String(s.files_touched.length)} />
                    <Kv k="Turns" v={String(s.turns)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="flex items-start gap-2.5 rounded-md border border-line bg-raise px-3.5 py-3">
          <Icon name="info" size={13} className="mt-px shrink-0 text-muted" />
          <div className="text-[11.5px] leading-[1.55] text-dim">
            Which provider each agent runs on, and what tools it may touch, are configured under{' '}
            <button
              className="text-indigo-400 hover:text-indigo-300"
              onClick={() => a.setPage('settings')}
            >
              Settings
            </button>
            . This page is the live view: who is working, on what, from which checkpoint.
          </div>
        </div>
      </div>
    </div>
  )
}

const Kv = ({ k, v, tone = 'text-dim' }: { k: string; v: string; tone?: string }) => (
  <div className="flex justify-between gap-2.5">
    <span className="text-muted">{k}</span>
    <span className={tone}>{v}</span>
  </div>
)

const ACTIVITY_KINDS = ['Agent', 'Task', 'Tool', 'File', 'Git', 'Context', 'Conflict', 'Decision', 'Test', 'Session']

function Activity() {
  const a = useAiw()
  const [off, setOff] = useState<Record<string, boolean>>({})
  const shown = a.events.filter((e) => !off[e.category])
  return (
    <div className="flex h-full flex-col">
      <PageHead
        title="Activity"
        subtitle="Everything humans and agents did, in the order it happened."
        right={<span className="text-[11px] text-faint">{shown.length} events</span>}
      />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2">
        {ACTIVITY_KINDS.map((k) => {
          const on = !off[k]
          return (
            <button
              key={k}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
                on ? 'border-line2 text-body' : 'border-line text-muted opacity-60'
              }`}
              onClick={() => setOff((o) => ({ ...o, [k]: !o[k] }))}
            >
              <span className={`h-1.5 w-1.5 rounded-sm ${on ? 'bg-indigo-400' : 'bg-line2'}`} />
              {k}
              <span className="text-[10px] text-faint">
                {a.events.filter((e) => e.category === k).length}
              </span>
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {shown.length === 0 ? (
          <Empty icon="history" title="Nothing to show" body="No events match these filters yet." />
        ) : (
          <div className="rounded-md border border-line bg-raise py-1">
            {shown.map((e) => (
              <EventRow key={e.id} e={e} showMeta />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GitList() {
  const a = useAiw()
  if (a.commits.length === 0) {
    return <Empty icon="commit" title="No commits" body="This project has no git history yet." />
  }
  return (
    <div className="overflow-hidden rounded-md border border-line bg-raise">
      {a.commits.map((c) => (
        <div key={c.sha} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-0">
          <span className="w-[52px] shrink-0 pt-px font-mono text-[11px] text-indigo-400">{c.short}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-ink">{c.subject}</div>
            <div className="mt-0.5 text-[10.5px] text-muted">
              {c.author} · {c.files.length} file(s) · {ago(c.when)}
            </div>
          </div>
          {c.context_updated && (
            <Chip className="bg-sky-500/12 text-info">context updated</Chip>
          )}
        </div>
      ))}
    </div>
  )
}

export function Git() {
  const a = useAiw()
  // The working tree comes first. History is what already happened; the
  // uncommitted work is the thing you came here to do something about.
  const nodeId = a.projectId ? Number(a.projectId) : null
  return (
    <div className="flex h-full flex-col">
      <PageHead
        title="Git"
        subtitle="What has changed and is not committed yet, and the commits behind it — each one a checkpoint agents can be measured against."
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <GitChanges nodeId={Number.isFinite(nodeId) ? nodeId : null} />
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          History
        </h3>
        <GitList />
      </div>
    </div>
  )
}

function Knowledge() {
  const a = useAiw()
  const [tree, setTree] = useState<string[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!a.projectId) return
    aiw
      .knowledgeTree(a.projectId)
      .then((t) => {
        setTree(t)
        if (t.length && !sel) setSel(t[0])
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.projectId])

  useEffect(() => {
    if (!a.projectId || !sel) return
    aiw
      .readFile(a.projectId, sel)
      .then(setBody)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [a.projectId, sel])

  return (
    <div className="flex h-full flex-col">
      <PageHead title="Project knowledge" subtitle="The .devdeck directory — the durable source of truth." />
      <div className="flex min-h-0 flex-1">
        <div className="w-[280px] shrink-0 overflow-auto border-r border-line p-2">
          {tree.length === 0 && <div className="px-2 py-3 text-[11.5px] text-muted">Nothing yet.</div>}
          {tree.map((p) => (
            <button
              key={p}
              className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] ${
                sel === p ? 'bg-raise text-ink' : 'text-dim hover:bg-hover hover:text-ink'
              }`}
              onClick={() => setSel(p)}
              title={p}
            >
              {p.replace('.devdeck/', '')}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {err && <div className="text-[11.5px] text-err">{err}</div>}
          <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-[1.7] text-body">{body}</pre>
        </div>
      </div>
    </div>
  )
}

function Tests() {
  const a = useAiw()
  return (
    <div className="flex h-full flex-col">
      <PageHead
        title="Test runs"
        subtitle="Results recorded by QA agents through the test service."
        right={<span className="text-[11px] text-faint">{a.testRuns.length} runs</span>}
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {a.testRuns.length === 0 ? (
          <Empty icon="ok" title="No test runs" body="Start the QA agent on a feature — it runs the command configured in .devdeck/config/app.yaml." />
        ) : (
          <div className="flex flex-col gap-2.5">
            {a.testRuns.map((r) => (
              <div
                key={r.id}
                className={`rounded-md border bg-raise px-4 py-3 ${r.passed ? 'border-line' : 'border-red-500/30'}`}
              >
                <div className="mb-1.5 flex items-center gap-2.5">
                  <Icon name={r.passed ? 'ok' : 'alert'} size={14} className={r.passed ? 'text-ok' : 'text-err'} />
                  <span className="font-mono text-[12px] text-ink">{r.command}</span>
                  <Chip className={r.passed ? 'bg-emerald-500/12 text-ok' : 'bg-red-500/12 text-err'}>
                    {r.passed ? 'passed' : 'failed'}
                  </Chip>
                  <div className="flex-1" />
                  <span className="text-[10.5px] text-faint">
                    {r.agent_id} · {ago(r.started_at)}
                  </span>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-page px-3 py-2 font-mono text-[11px] leading-[1.6] text-dim">
                  {r.output || '(no output)'}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function AiWorkspace() {
  const a = useAiw()

  // Screenshot harness (temporary). Applied on every render rather than as
  // initial state, because Vite swaps the module without recreating the store —
  // a value read only at store-construction time would never change.
  useEffect(() => {
    if (CAPTURE_PAGE && a.page !== CAPTURE_PAGE) a.setPage(CAPTURE_PAGE as AiwPage)
    if (CAPTURE_FEATURE && a.featureId !== CAPTURE_FEATURE && a.features.length > 0) {
      void a.selectFeature(CAPTURE_FEATURE)
    }
  })

  // Above the page, not on one of them: an agent blocked on approval is stopped
  // mid-turn against a deadline, so it has to be answerable from wherever you
  // happen to be — including the error and loading states, which is why the bar
  // wraps them rather than sitting inside a page.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The bar itself is in the shell now: an agent waiting on you has to
          reach you on Team or on Home, not only here. */}
      <div className="min-h-0 flex-1">
        <Page />
      </div>
    </div>
  )
}

function Page() {
  const a = useAiw()

  if (a.error) return <Failure error={a.error} onRetry={() => void a.bootstrap()} />

  if (!a.ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted">
        <Icon name="spinner" size={14} className="animate-spin" /> Loading the Assistant…
      </div>
    )
  }

  // The assistant works before any project is registered — it is the thing you
  // talk to about getting one started, so gating it behind having one would put
  // the empty state in front of its own cure.
  if (a.page === 'chat') return <Chat />

  if (a.projects.length === 0) {
    return (
      <Empty
        icon="ai"
        title="No projects yet"
        body="Run the mock demo to create TyreX and AssetX, then watch four agents collaborate through the real runtime — no API key required."
        action={
          <button className="btn-primary text-[12px]" disabled={a.demoRunning} onClick={() => void a.runDemo()}>
            {a.demoRunning ? 'Running…' : 'Run mock demo'}
          </button>
        }
      />
    )
  }

  switch (a.page) {
    case 'features':
      return <Features />
    case 'feature':
      return <FeatureDetail />
    case 'context':
      return <ContextInspector />
    case 'conflicts':
      return <Conflicts />
    case 'agents':
      return <Agents />
    case 'activity':
      return <Activity />
    case 'decisions':
      return (
        <div className="flex h-full flex-col">
          <PageHead title="Decisions" subtitle="Choices later work must respect. Superseded ones are kept — they explain why the current one exists." />
          <div className="min-h-0 flex-1 overflow-auto p-5">
            <DecisionList rows={a.decisions} />
          </div>
        </div>
      )
    case 'git':
      return <Git />
    case 'skills':
      return <Skills />
    case 'settings':
      return <Settings />
    case 'knowledge':
      return <Knowledge />
    case 'tests':
      return <Tests />

    default:
      return <Overview />
  }
}
