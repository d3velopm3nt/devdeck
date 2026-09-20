// Idea to product, for one business.
//
// The stage is your claim: nothing here moves a product on its own, because
// "this is validated" is a statement about the world and no app is in a
// position to make it. What the board does is put the evidence next to the
// claim — the projects, the open work, what a worker did lately, what the
// space knows — so a stage nobody has touched in a month looks like one.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { startWorker } from '../workers/StartWorker'

const STAGES: { id: string; label: string; blurb: string; tone: string }[] = [
  { id: 'idea', label: 'Idea', blurb: 'worth trying', tone: 'text-muted' },
  { id: 'validating', label: 'Validating', blurb: 'someone else says so', tone: 'text-warn' },
  { id: 'building', label: 'Building', blurb: 'being made', tone: 'text-info' },
  { id: 'launched', label: 'Launched', blurb: 'people use it', tone: 'text-ok' },
]

const since = (iso: string) => {
  if (!iso) return 'never moved'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'moved today'
  if (days === 1) return 'moved yesterday'
  if (days < 31) return `moved ${days} days ago`
  const months = Math.round(days / 30)
  return `moved ${months} month${months === 1 ? '' : 's'} ago`
}

export function PipelineTab({ nodeId, space }: { nodeId: number; space: string }) {
  const [items, setItems] = useState<ipc.PipeItem[] | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [next, setNext] = useState('')

  const load = useCallback(() => {
    void ipc
      .businessPipeline(nodeId)
      .then(setItems)
      .catch((e) => setErr(String(e)))
  }, [nodeId])
  useEffect(load, [load])

  const move = async (p: ipc.PipeItem, stage: string, note = p.next) => {
    setErr('')
    try {
      setItems(await ipc.businessStageSet(nodeId, p.product, stage, note))
    } catch (e) {
      setErr(String(e))
    }
  }

  if (!items) {
    return <div className="px-6 py-4 text-[12px] text-muted">{err || 'Reading the board…'}</div>
  }

  const stale = items.filter((i) => i.stage !== 'launched' && i.updated && Date.now() - new Date(i.updated).getTime() > 21 * 86_400_000)

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-ink">Idea to product</div>
          <p className="mt-1 max-w-[760px] text-[12px] leading-relaxed text-dim">
            Where each of {space}&rsquo;s products has got to, and what DevDeck can see against it. You move a product;
            nothing else does.
          </p>
        </div>
        {stale.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-warn">
            <Icon name="clock" size={11} /> {stale.length} not moved in three weeks
          </span>
        )}
      </div>

      {err && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">{err}</div>}

      {items.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line2 px-5 py-6 text-center text-[12px] text-muted">
          Nothing to track yet. Products come from what the business sells, on its setup&rsquo;s What it sells step.
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-4 gap-3 overflow-auto pb-2">
          {STAGES.map((col) => {
            const here = items.filter((i) => i.stage === col.id)
            return (
              <div key={col.id} className="flex min-w-0 flex-col gap-2">
                <div className="flex items-baseline gap-2 px-1">
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${col.tone}`}>{col.label}</span>
                  <span className="text-[10.5px] text-faint">{col.blurb}</span>
                  <span className="flex-1" />
                  <span className="text-[10.5px] tabular-nums text-faint">{here.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {here.map((p) => {
                    const idx = STAGES.findIndex((s) => s.id === p.stage)
                    const old = p.updated && Date.now() - new Date(p.updated).getTime() > 21 * 86_400_000 && p.stage !== 'launched'
                    return (
                      <div key={p.product} className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">{p.product}</span>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                              disabled={idx <= 0}
                              title="Back a stage"
                              onClick={() => void move(p, STAGES[idx - 1]!.id)}
                            >
                              <Icon name="reply" size={12} />
                            </button>
                            <button
                              className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                              disabled={idx >= STAGES.length - 1}
                              title="On a stage"
                              onClick={() => void move(p, STAGES[idx + 1]!.id)}
                            >
                              <Icon name="send" size={12} />
                            </button>
                          </div>
                        </div>

                        {editing === p.product ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              className="input flex-1 text-[11.5px]"
                              placeholder="What has to be true to move it on?"
                              value={next}
                              onChange={(e) => setNext(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  void move(p, p.stage, next)
                                  setEditing(null)
                                }
                                if (e.key === 'Escape') setEditing(null)
                              }}
                            />
                            <button
                              className="btn-ghost text-[11px]"
                              onClick={() => {
                                void move(p, p.stage, next)
                                setEditing(null)
                              }}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <button
                            className="text-left text-[11.5px] leading-relaxed text-body hover:text-ink"
                            onClick={() => {
                              setEditing(p.product)
                              setNext(p.next)
                            }}
                          >
                            {p.next || <span className="text-faint">What has to be true to move it on?</span>}
                          </button>
                        )}

                        <div className="flex flex-col gap-1 border-t border-line pt-2 text-[11px] text-muted">
                          {p.projects.length > 0 && (
                            <span className="flex items-center gap-1.5">
                              <Icon name="code" size={11} className="shrink-0" />
                              <span className="truncate">{p.projects.join(', ')}</span>
                            </span>
                          )}
                          {(p.work_open > 0 || p.work_done > 0) && (
                            <span className="flex items-center gap-1.5">
                              <Icon name="check" size={11} className="shrink-0" />
                              {p.work_done} done, {p.work_open} open
                            </span>
                          )}
                          {p.notes.length > 0 && (
                            <span className="flex items-center gap-1.5">
                              <Icon name="note" size={11} className="shrink-0" />
                              <span className="truncate" title={p.notes.join(', ')}>
                                {p.notes.length} note{p.notes.length === 1 ? '' : 's'} name it
                              </span>
                            </span>
                          )}
                          {p.runs.map((r) => (
                            <button
                              key={r.id}
                              className="flex items-center gap-1.5 text-left hover:text-ink"
                              onClick={() => window.dispatchEvent(new CustomEvent('devdeck:open-run', { detail: { id: r.id, title: r.title } }))}
                            >
                              <Icon
                                name={r.status === 'running' ? 'spinner' : 'tool'}
                                size={11}
                                spin={r.status === 'running'}
                                className={`shrink-0 ${r.status === 'running' ? 'text-indigo-400' : ''}`}
                              />
                              <span className="truncate">
                                {r.worker}: {r.title}
                              </span>
                            </button>
                          ))}
                          {p.projects.length === 0 && p.runs.length === 0 && p.notes.length === 0 && (
                            <span className="text-faint">nothing recorded against it yet</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 border-t border-line pt-2">
                          <button
                            className="btn-ghost text-[11px]"
                            onClick={() =>
                              startWorker({
                                nodeId,
                                title: `${p.product}: ${p.next || 'move it on'}`,
                                intent: p.next
                                  ? `${p.next}\n\nIt is at "${p.stage}" for ${space}.`
                                  : `Work out what ${p.product} needs to move past "${p.stage}".`,
                              })
                            }
                          >
                            <Icon name="run" size={11} /> Put a worker on it
                          </button>
                          <span className="flex-1" />
                          <span className={`text-[10px] ${old ? 'text-warn' : 'text-faint'}`}>{since(p.updated)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {here.length === 0 && (
                    <div className="rounded-[10px] border border-dashed border-line2 px-3 py-4 text-center text-[11px] text-faint">
                      nothing here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
