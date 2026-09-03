// What this thread is about to send, and what to take out of it.
//
// Every turn carries three things the model sees and you don't: a system
// prompt, an assembled context, and a list of tools. All three are prompt, all
// three are paid for on every turn, and until now all three were invisible —
// so "why did it answer like that" and "why did that cost so much" were both
// unanswerable from inside the app.
//
// The rule this panel lives by: **it shows the assembly that will actually
// run.** The breakdown and the turn call the same function, so a part shown
// here as off is off, and an edited part is sent as you wrote it. A panel that
// described a different context than the one sent would be worse than no
// panel, because it would be believed.
//
// Switching a tool off here is not a permission. The matrix decides what may
// ever run; this decides only what is offered in this room, and it can narrow
// that and never widen it.

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import * as ipc from '../../lib/ipc'
import { CAPTURE_CONTEXT } from '../../lib/devCapture'
import type { ContextView } from '../../lib/ipc'

/// 1240 → "1.2k". Token counts are estimates; the last three digits are noise.
function k(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`
}

function Row({
  on,
  title,
  meta,
  tokens,
  onToggle,
  children,
  right,
}: {
  on: boolean
  title: string
  meta: string
  tokens: number
  onToggle: () => void
  children?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className={`border-t border-line px-3 py-1.5 ${on ? '' : 'opacity-45'}`}>
      <div className="flex items-center gap-2">
        <button
          className="shrink-0"
          title={on ? 'Stop sending this' : 'Send this again'}
          onClick={onToggle}
        >
          <Icon name={on ? 'check' : 'close'} size={12} className={on ? 'text-ok' : 'text-faint'} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{title}</span>
        <span className="hidden shrink-0 truncate text-[10px] text-faint lg:block">{meta}</span>
        <span className="w-[52px] shrink-0 text-right text-[10.5px] text-muted">
          {k(tokens)} tok
        </span>
        {right}
      </div>
      {children}
    </div>
  )
}

export function ContextBar({ conversationId }: { conversationId: string }) {
  const [view, setView] = useState<ContextView | null>(null)
  // Screenshot harness: open on mount so a capture shows it expanded.
  const [open, setOpen] = useState(CAPTURE_CONTEXT)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!conversationId) return
    ipc
      .threadContext(conversationId)
      .then((v) => {
        setView(v)
        setErr('')
      })
      // An empty panel and a failed read must not look the same.
      .catch((e) => setErr(String(e)))
  }, [conversationId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const set = async (kind: 'context' | 'tool', key: string, on: boolean) => {
    setBusy(true)
    try {
      setView(await ipc.threadContextSet(conversationId, kind, key, on))
      setErr('')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (key: string, body: string) => {
    setBusy(true)
    try {
      setView(await ipc.threadContextEdit(conversationId, key, body))
      setEditing(null)
      setErr('')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 shrink-0 overflow-hidden rounded-lg border border-line bg-raise">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover/40"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} className="text-faint" />
        <span className="text-[11px] font-semibold text-dim">Context</span>
        <span className="text-[10.5px] text-muted">
          {view
            ? `${view.parts.filter((p) => p.on).length} of ${view.parts.length} parts · ${
                view.tools.filter((t) => t.on).length
              } of ${view.tools.length} tools`
            : 'what this thread sends'}
        </span>
        <span className="ml-auto text-[10.5px] text-faint">
          {view ? `≈${k(view.total_tokens)} tokens a turn` : ''}
        </span>
      </button>

      {open && (
        <div className="border-t border-line">
          {err && (
            <div className="border-b border-red-500/25 bg-red-500/[0.06] px-3 py-1.5 text-[11px] text-err">
              {err}
            </div>
          )}
          {view == null && !err && (
            <div className="px-3 py-2 text-[11px] text-muted">Working out what goes in…</div>
          )}

          {view && (
            <>
              <div className="flex items-baseline gap-2 bg-soft px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Context
                </span>
                <span className="text-[10px] text-muted">
                  assembled for this thread · {k(view.context_tokens)} tok
                </span>
              </div>

              {view.parts.length === 0 && (
                <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
                  Nothing assembled yet — no project in focus and nothing remembered.
                </div>
              )}

              {view.parts.map((p) => (
                <Row
                  key={p.key}
                  on={p.on}
                  title={p.title}
                  meta={p.edited ? `${p.source} · edited` : p.source}
                  tokens={p.tokens}
                  onToggle={() => void set('context', p.key, !p.on)}
                  right={
                    <button
                      className="btn-ghost shrink-0 px-1 text-[10px] text-muted"
                      disabled={busy}
                      onClick={() => {
                        setEditing(editing === p.key ? null : p.key)
                        setDraft(p.body)
                      }}
                    >
                      {editing === p.key ? 'Close' : 'Edit'}
                    </button>
                  }
                >
                  {editing === p.key && (
                    <div className="mt-1.5">
                      <textarea
                        className="input h-[160px] w-full resize-y font-mono text-[10.5px] leading-[1.5]"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div className="mt-1 flex items-center gap-1.5">
                        <button
                          className="btn-primary text-[10.5px]"
                          disabled={busy}
                          onClick={() => void save(p.key, draft)}
                        >
                          Send this instead
                        </button>
                        {p.edited && (
                          <button
                            className="btn-ghost text-[10.5px] text-muted"
                            disabled={busy}
                            title="Go back to what DevDeck assembles"
                            onClick={() => void save(p.key, '')}
                          >
                            Reset to assembled
                          </button>
                        )}
                        <span className="ml-auto text-[10px] text-faint">
                          {draft.length.toLocaleString()} chars
                        </span>
                      </div>
                    </div>
                  )}
                </Row>
              ))}

              <div className="flex items-baseline gap-2 border-t border-line bg-soft px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Tools
                </span>
                <span className="text-[10px] text-muted">
                  offered to whoever answers here · {k(view.tool_tokens)} tok
                </span>
              </div>

              {view.tools.length === 0 && (
                <div className="border-t border-line px-3 py-2 text-[11px] leading-[1.5] text-muted">
                  None offered. Being named in a room is free: an agent answering a mention talks
                  rather than acts, and work happens in a session.
                </div>
              )}

              {view.tools.map((t) => (
                <Row
                  key={t.id}
                  on={t.on}
                  title={t.title}
                  meta={`${t.actions} action${t.actions === 1 ? '' : 's'} · ${t.permission}`}
                  tokens={t.tokens}
                  onToggle={() => void set('tool', t.id, !t.on)}
                >
                  <div className="pl-[22px] pr-2 text-[10px] leading-[1.5] text-muted">
                    {t.description}
                  </div>
                </Row>
              ))}

              <div className="border-t border-line px-3 py-1.5 text-[10px] leading-[1.6] text-faint">
                Instructions {k(view.system_tokens)} · context {k(view.context_tokens)} · tools{' '}
                {k(view.tool_tokens)} · {view.history_turns} earlier message
                {view.history_turns === 1 ? '' : 's'} {k(view.history_tokens)} ={' '}
                <span className="text-muted">≈{k(view.total_tokens)} tokens</span> before you type
                anything. Counts are estimated at four characters a token; the Models tab has what
                each call actually cost. Turning a tool off here changes what is offered in this
                thread, not what it is allowed to do.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
