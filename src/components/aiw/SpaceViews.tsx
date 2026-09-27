// Three panels a space's page still wants: its features, what its context is
// made of, and its git changes.
//
// This used to be the AI Workspace — a rail view with no rail button, fourteen
// sub-pages and 1,860 lines, holding a second copy of Spaces, the thread and
// the Workers roster. The page is gone; these three are what outlived it,
// because `ProjectPanels` and `NodePage` render them as documents of their own.
// Decisions and conflicts, the only things that lived nowhere else, moved to
// `node/NodeRecord.tsx` and sit beside the thread now.
//
// Every number here still comes from a service call or the event bus — there is
// no display-only data. Where something failed to load it says so rather than
// rendering an empty state, because "no conflicts" and "the conflict query
// broke" must never look the same.

import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { GitChanges } from './GitChanges'
import {
  aiw,
  ago,
  contextHealthStyle,
  initials,
  inclusionStyle,
  type ContextComparison,
  type RawContext,
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

