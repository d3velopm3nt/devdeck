// Decisions and conflicts, on the space they belong to.
//
// These two were the only things the AI Workspace held that existed nowhere
// else — everything else on that page was a second copy of Spaces, the thread
// or Workers, which is why the page is gone. Knowledge was never unique
// either: `NodePage`'s Known tab already reads the same folder.
//
// They sit beside the thread on purpose. A decision is a choice later work has
// to respect and a conflict is two pieces of work disagreeing, and both are
// answered by talking — so they belong where the talking happens, not on a
// separate page you had to know existed.

import { useCallback, useEffect, useState } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { aiw, type Conflict, type DecisionRow } from '../../lib/aiw'

/** How long ago, in the shortest form that is still true. */
function ago(iso?: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, (Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const Chip = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>
)

const Nothing = ({ icon, title, body }: { icon: IconName; title: string; body: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
    <Icon name={icon} size={22} className="text-faint" />
    <div className="text-[13px] font-medium text-body">{title}</div>
    <p className="max-w-[420px] text-[11.5px] leading-relaxed text-muted">{body}</p>
  </div>
)

const Failed = ({ why, onRetry }: { why: string; onRetry: () => void }) => (
  <div className="rounded-lg border border-err/40 bg-err/[0.06] px-3.5 py-3">
    <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-err">
      <Icon name="alert" size={13} />
      That could not be read
    </div>
    <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-body">
      {why}
    </div>
    <button className="btn mt-2 text-[11.5px]" onClick={onRetry}>
      Try again
    </button>
  </div>
)

/**
 * Choices later work must respect.
 *
 * Superseded ones stay, struck through rather than removed: the old decision
 * is usually the only thing that explains why the current one exists.
 */
export function DecisionsTab({ nodeId }: { nodeId: number }) {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [failed, setFailed] = useState('')

  const load = useCallback(() => {
    setFailed('')
    aiw
      .decisions(String(nodeId))
      .then(setRows)
      .catch((e) => setFailed(String(e)))
  }, [nodeId])

  useEffect(load, [load])

  return (
    <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
      <div className="max-w-[980px]">
        {failed ? (
          <Failed why={failed} onRetry={load} />
        ) : rows.length === 0 ? (
          <Nothing
            icon="decision"
            title="No decisions recorded"
            body="One is recorded when a choice is made that later work has to respect — by a manager, a worker, or you."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((d) => {
              const gone = d.status === 'superseded'
              return (
                <div
                  key={d.id}
                  className={`rounded-lg border border-line bg-panel px-4 py-3 ${gone ? 'opacity-70' : ''}`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                    <span
                      className={`text-[13px] font-semibold ${gone ? 'text-dim line-through' : 'text-ink'}`}
                    >
                      {d.title}
                    </span>
                    <Chip
                      className={
                        d.status === 'approved'
                          ? 'bg-emerald-500/12 text-ok'
                          : gone
                            ? 'bg-slate-500/14 text-muted'
                            : 'bg-sky-500/12 text-info'
                      }
                    >
                      {d.status}
                    </Chip>
                    {d.feature && <Chip className="bg-soft text-dim">{d.feature}</Chip>}
                    <div className="flex-1" />
                    <span className="text-[10.5px] text-faint">
                      {ago(d.created)}
                      {d.author ? ` · ${d.author}` : ''}
                    </span>
                  </div>
                  {d.body && (
                    <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-body">
                      {d.body}
                    </p>
                  )}
                  {d.impacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.impacts.map((i) => (
                        <Chip key={i} className="bg-soft font-mono text-dim">
                          {i}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const TONE: Record<string, string> = {
  high: 'border-err/40',
  medium: 'border-warn/40',
  low: 'border-line2',
}
const CHIP: Record<string, string> = {
  high: 'bg-red-500/12 text-err',
  medium: 'bg-amber-500/12 text-warn',
  low: 'bg-soft text-dim',
}

/**
 * Two pieces of work that disagree, and what you said about it.
 *
 * Resolving one records *your* words as the resolution rather than closing it
 * silently, because the next person to hit the same disagreement needs the
 * reason and not just the fact that somebody once dismissed it.
 */
export function ConflictsTab({ nodeId }: { nodeId: number }) {
  const [rows, setRows] = useState<Conflict[]>([])
  const [failed, setFailed] = useState('')
  const [saying, setSaying] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    setFailed('')
    aiw
      .conflicts(String(nodeId))
      .then(setRows)
      .catch((e) => setFailed(String(e)))
  }, [nodeId])

  useEffect(load, [load])

  const resolve = async (id: string) => {
    setBusy(id)
    try {
      await aiw.resolveConflict(id, 'you', (saying[id] ?? '').trim() || 'Resolved.')
      load()
    } catch (e) {
      setFailed(String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
      <div className="max-w-[980px]">
        {failed && (
          <div className="mb-3">
            <Failed why={failed} onRetry={load} />
          </div>
        )}
        {rows.length === 0 ? (
          <Nothing
            icon="ok"
            title="Nothing is disagreeing"
            body="All the work in this space is currently compatible. It is re-checked whenever somebody claims work, writes a file, or the context moves."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((c) => (
              <div
                key={c.id}
                className={`overflow-hidden rounded-lg border bg-panel ${TONE[c.severity] ?? 'border-line'}`}
              >
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2.5">
                  <Chip className={`${CHIP[c.severity] ?? 'bg-soft text-dim'} tracking-wide`}>
                    {c.severity.toUpperCase()}
                  </Chip>
                  <span className="text-[13px] font-semibold text-ink">{c.title}</span>
                  {c.feature_id && <Chip className="bg-soft text-dim">{c.feature_id}</Chip>}
                  <div className="flex-1" />
                  <span className="text-[10.5px] text-faint">{ago(c.detected_at)}</span>
                </div>

                <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                  {[c.left, c.right].map((side, i) => (
                    <div key={i} className="rounded-md border border-line bg-raise px-3 py-2.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                        {side.agent_id || 'unknown'}
                      </div>
                      <div className="whitespace-pre-line text-[12px] leading-relaxed text-body">
                        {side.detail}
                      </div>
                      {side.source && (
                        <div className="mt-1 font-mono text-[10.5px] text-faint">{side.source}</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                  <input
                    className="input min-w-[220px] flex-1 text-[12px]"
                    placeholder="What did you decide, and why?"
                    value={saying[c.id] ?? ''}
                    onChange={(e) => setSaying({ ...saying, [c.id]: e.target.value })}
                  />
                  <button
                    className="btn btn-primary text-[12px]"
                    disabled={busy === c.id}
                    onClick={() => void resolve(c.id)}
                  >
                    {busy === c.id ? 'Saving…' : 'Resolve'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
