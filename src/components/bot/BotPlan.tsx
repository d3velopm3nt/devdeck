// The plan: what the bot is managing, as work items you can move.
//
// These are not the bot's. They live in the project's `.devdeck`, committed,
// which is why applying a starter is a button rather than a side effect of
// creating a bot — it writes into something a teammate will pull. It also means
// a bot dropped onto a project that already had features shows you the work
// that is there rather than pretending the space is empty.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { STATUS_LABEL, STATUS_TONE, progress } from '../../lib/bots'

export function BotPlan({
  bot,
  work,
  reload,
  template,
}: {
  bot: ipc.Bot
  work: ipc.BotWork[]
  reload: () => void
  template: ipc.BotTemplate | null
}) {
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [assigning, setAssigning] = useState<string | null>(null)
  const [who, setWho] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  const p = progress(work)

  // Steps the starter offers that are not on the plan yet. Compared by title
  // because that is what the backend de-duplicates on.
  const missing = useMemo(() => {
    if (!template) return []
    const have = new Set(work.map((w) => w.title.toLowerCase()))
    return template.steps.filter((s) => !have.has(s.toLowerCase()))
  }, [template, work])

  const run = (fn: () => Promise<unknown>) => {
    setErr('')
    void fn()
      .then(reload)
      .catch((e) => setErr(String(e)))
  }

  const add = () => {
    const title = adding.trim()
    if (!title) return
    setAdding('')
    run(() =>
      ipc.botWorkSave({ nodeId: bot.node_id, id: '', title, status: 'unclaimed', assignee: null }),
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      {err && <div className="rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] text-err">{err}</div>}

      {work.length > 0 && (
        <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] text-body">
              <span className="font-semibold text-ink">{p.done}</span> of {p.total} done
            </span>
            <span className="ml-auto text-[10.5px] text-faint">
              in <code>.devdeck/features/{work[0].feature}</code>
            </span>
          </div>
          <div className="mt-2 h-[5px] overflow-hidden rounded bg-line">
            <span className="block h-full bg-emerald-500" style={{ width: `${p.pct}%` }} />
          </div>
        </div>
      )}

      {work.length === 0 && (
        <div className="rounded-lg border border-line bg-panel px-4 py-6 text-center">
          <Icon name="check" size={22} className="mx-auto text-faint" />
          <div className="mt-2 text-[12.5px] text-dim">No steps yet</div>
          <p className="mx-auto mt-1 max-w-[420px] text-[11.5px] leading-relaxed text-muted">
            “It manages the work” is only true if the work is a thing with a state. Steps become
            work items in this project’s <code>.devdeck</code> — committed, and readable by someone
            who never opens DevDeck.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.05] px-3.5 py-3">
          <div className="text-[12px] text-ink">
            {template?.name} brings {missing.length} step{missing.length === 1 ? '' : 's'}
            {work.length > 0 ? ' you do not have' : ''}
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {missing.slice(0, 4).map((s) => (
              <li key={s} className="text-[11.5px] text-muted">
                · {s}
              </li>
            ))}
            {missing.length > 4 && (
              <li className="text-[11px] text-faint">and {missing.length - 4} more</li>
            )}
          </ul>
          <button
            className="btn-primary mt-2.5 text-[11.5px]"
            onClick={() => run(() => ipc.botPlan(bot.node_id, missing))}
          >
            Add them to the plan
          </button>
          <p className="mt-1.5 text-[10.5px] text-faint">
            Writes into this project’s committed context.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line">
        {work.map((w) => (
          <div
            key={w.id}
            className={`group flex items-center gap-2.5 border-b border-line bg-panel px-3 py-2 last:border-b-0 ${
              w.status === 'done' ? 'opacity-60' : ''
            }`}
          >
            <button
              className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded border ${
                w.status === 'done' ? 'border-emerald-500 bg-emerald-500/20 text-ok' : 'border-line2'
              }`}
              title={w.status === 'done' ? 'Put it back' : 'Mark it done'}
              onClick={() =>
                run(() =>
                  ipc.botWorkSave({
                    nodeId: bot.node_id,
                    id: w.id,
                    title: w.title,
                    status: w.status === 'done' ? 'in-progress' : 'done',
                    assignee: w.assignee,
                  }),
                )
              }
            >
              {w.status === 'done' && <Icon name="check" size={11} />}
            </button>

            {editing === w.id ? (
              <input
                ref={editRef}
                className="input min-w-0 flex-1 text-[12px]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null)
                  if (e.key === 'Enter' && draft.trim()) {
                    setEditing(null)
                    run(() =>
                      ipc.botWorkSave({
                        nodeId: bot.node_id,
                        id: w.id,
                        title: draft.trim(),
                        status: w.status,
                        assignee: w.assignee,
                      }),
                    )
                  }
                }}
              />
            ) : (
              <button
                className={`min-w-0 flex-1 truncate text-left text-[12px] hover:text-ink ${
                  w.status === 'done' ? 'text-muted line-through' : 'text-body'
                }`}
                title="Rename"
                onClick={() => {
                  setDraft(w.title)
                  setEditing(w.id)
                }}
              >
                {w.title}
              </button>
            )}

            {assigning === w.id ? (
              <input
                autoFocus
                className="input w-[110px] shrink-0 text-[11px]"
                placeholder="who?"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                onBlur={() => setAssigning(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAssigning(null)
                  if (e.key !== 'Enter') return
                  setAssigning(null)
                  run(() =>
                    ipc.botWorkSave({
                      nodeId: bot.node_id,
                      id: w.id,
                      title: w.title,
                      status: w.status,
                      assignee: who.trim() || null,
                    }),
                  )
                }}
              />
            ) : (
              <button
                className={`shrink-0 rounded-full px-2 text-[9px] font-semibold uppercase tracking-[0.04em] ${
                  w.assignee
                    ? 'bg-soft text-muted hover:text-ink'
                    : 'text-faint opacity-0 transition-opacity group-hover:opacity-100'
                }`}
                title={w.assignee ? 'Change who has this' : 'Give it to someone'}
                onClick={() => {
                  setWho(w.assignee ?? '')
                  setAssigning(w.id)
                }}
              >
                {w.assignee ?? '+ assign'}
              </button>
            )}

            <select
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                STATUS_TONE[w.status] ?? STATUS_TONE.unclaimed
              }`}
              value={w.status}
              onChange={(e) =>
                run(() =>
                  ipc.botWorkSave({
                    nodeId: bot.node_id,
                    id: w.id,
                    title: w.title,
                    status: e.target.value,
                    assignee: w.assignee,
                  }),
                )
              }
            >
              {ipc.WORK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>

            <button
              className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-err"
              title="Remove this step"
              onClick={() => {
                if (!confirm(`Remove “${w.title}” from the plan?`)) return
                run(() => ipc.botWorkDelete(bot.node_id, w.id))
              }}
            >
              <Icon name="delete" size={12} />
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2.5 bg-panel px-3 py-2">
          <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded border border-dashed border-line2 text-faint">
            <Icon name="add" size={10} />
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent text-[12px] text-body outline-none placeholder:text-faint"
            placeholder="Add a step…"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          {adding.trim() && (
            <button className="btn-ghost shrink-0 text-[11px]" onClick={add}>
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
