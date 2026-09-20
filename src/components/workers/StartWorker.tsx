// The one yes.
//
// Inside a delegated session the CLI asks nobody, so everything that decides
// what it could touch is settled here and written down: which worker, which
// skills, one folder, a branch where there is code, and the limits. This card
// is the gate, and it says what it will not do as plainly as what it will.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { openRun } from '../../lib/dock'

/** Open the card. `handle` preselects a worker, `nodeId` a space. */
export const startWorker = (detail: { handle?: string; nodeId?: number; title?: string; intent?: string } = {}) =>
  window.dispatchEvent(new CustomEvent('devdeck:start-worker', { detail }))

export function StartWorker({
  open,
  onClose,
}: {
  open: { handle?: string; nodeId?: number; title?: string; intent?: string }
  onClose: () => void
}) {
  const nodes = useApp((s) => s.nodes)
  const spaces = nodes.filter((n) => n.kind === 'workspace' || n.kind === 'project')
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [handle, setHandle] = useState(open.handle ?? '')
  const [nodeId, setNodeId] = useState(open.nodeId ?? 0)
  const [title, setTitle] = useState(open.title ?? '')
  const [intent, setIntent] = useState(open.intent ?? '')
  const [plan, setPlan] = useState<ipc.RunPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    void ipc
      .workersList()
      .then((w) => {
        setWorkers(w)
        if (!handle && w.length) setHandle(w[0]!.handle)
      })
      .catch((e) => setErr(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!nodeId && spaces.length) setNodeId(spaces[0]!.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length])

  // The card is the plan, so it is re-read whenever anything that shapes it
  // changes. Nothing here starts anything.
  useEffect(() => {
    if (!handle || !nodeId) return
    let live = true
    void ipc
      .workerPlan(handle, nodeId, title || 'A job', intent)
      .then((p) => live && setPlan(p))
      .catch((e) => live && setErr(String(e)))
    return () => {
      live = false
    }
  }, [handle, nodeId, title, intent])

  const start = async () => {
    setErr('')
    setBusy(true)
    try {
      const run = await ipc.workerStart(handle, nodeId, title.trim(), intent.trim())
      onClose()
      openRun(run.id, run.title)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const worker = workers.find((w) => w.handle === handle)
  const ready = !!plan?.ready && !!title.trim() && !!intent.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8" onClick={onClose}>
      <div
        className="flex max-h-full w-[820px] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="terminal" size={16} className="text-indigo-400" />
            <span className="text-[15px] font-semibold text-ink">Start a worker</span>
            <span className="flex-1" />
            <button className="btn-ghost text-[11.5px]" onClick={onClose}>
              <Icon name="close" size={12} /> Close
            </button>
          </div>
          <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
            <span className="text-[11px] text-muted">Worker</span>
            <div className="flex flex-wrap gap-1.5">
              {workers.map((w) => (
                <button
                  key={w.handle}
                  className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${
                    handle === w.handle ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => setHandle(w.handle)}
                >
                  {w.name}
                </button>
              ))}
              {workers.length === 0 && <span className="text-[11.5px] text-warn">No workers yet. Make one first.</span>}
            </div>

            <span className="text-[11px] text-muted">In</span>
            <select
              className="input w-56 text-[12px]"
              value={nodeId}
              onChange={(e) => setNodeId(Number(e.target.value))}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <span className="text-[11px] text-muted">The job</span>
            <input
              className="input text-[12.5px]"
              placeholder="Landing page copy for Sounder"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <span className="self-start pt-1 text-[11px] text-muted">What you want</span>
            <textarea
              className="input min-h-[62px] resize-y text-[12.5px] leading-relaxed"
              placeholder="One page for the October launch: the angle, three proof points, and a call to book a survey."
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            />
          </div>
        </div>

        {plan && (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid grid-cols-2">
              <div className="border-r border-line px-5 py-3.5">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">What will happen</div>
                <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
                  <span className="text-muted">Runs as</span>
                  <span className="text-ink">
                    Claude Code{plan.brief ? <span className="font-mono text-[11.5px] text-viol"> · {plan.brief.id}</span> : ''}
                    <span className="ml-1.5 text-[11px] text-faint">{plan.model}</span>
                  </span>
                  <span className="text-muted">Skills</span>
                  <span className="flex flex-wrap gap-1">
                    {plan.skills.map((s) => (
                      <span key={s.id} className="rounded bg-indigo-500/10 px-1.5 font-mono text-[10.5px] text-indigo-300">
                        {s.id}
                      </span>
                    ))}
                    {plan.skills.length === 0 && <span className="text-[11.5px] text-faint">none</span>}
                  </span>
                  <span className="text-muted">Writes in</span>
                  <span className="min-w-0 break-words font-mono text-[11px] text-body">{plan.folder}</span>
                  {plan.is_repo && (
                    <>
                      <span className="text-muted">Branch</span>
                      <span className="font-mono text-[11px] text-body">{plan.branch}</span>
                    </>
                  )}
                  <span className="text-muted">Reads</span>
                  <span className="text-body">
                    {plan.reads.length ? `${plan.space}: ${plan.reads.slice(0, 4).join(', ')}` : `${plan.space} (nothing known yet)`}
                  </span>
                  <span className="text-muted">Stops at</span>
                  <span className="text-body">
                    {plan.minutes} minutes or ${plan.usd.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="px-5 py-3.5">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">It will not</div>
                <div className="flex flex-col gap-1.5">
                  {plan.never.map((n) => (
                    <span key={n} className="flex items-center gap-2 text-[12px] text-body">
                      <Icon name="close" size={12} className="text-err" /> {n}
                    </span>
                  ))}
                  <span className="flex items-center gap-2 text-[12px] text-body">
                    <Icon name="close" size={12} className="text-err" /> write anything outside that folder
                  </span>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-line bg-raise px-3 py-2">
                  <Icon name="info" size={13} className="mt-0.5 shrink-0 text-muted" />
                  <span className="text-[11px] leading-relaxed text-muted">
                    Inside the session Claude Code asks nobody. This is the one yes, and you can stop it at any point.
                  </span>
                </div>
              </div>
            </div>
            {plan.note && (
              <div
                className={`flex items-start gap-2 border-t px-5 py-2.5 text-[11.5px] leading-relaxed ${
                  plan.ready ? 'border-line bg-amber-500/5 text-warn' : 'border-red-500/30 bg-red-500/10 text-err'
                }`}
              >
                <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                {plan.note}
              </div>
            )}
          </div>
        )}

        {err && <div className="border-t border-line px-5 py-2 text-[12px] text-err">{err}</div>}

        <div className="flex items-center gap-2 border-t border-line bg-raise px-5 py-3">
          <button className="btn-primary text-[12px]" disabled={!ready || busy} onClick={() => void start()}>
            <Icon name="run" size={12} /> {busy ? 'Starting…' : 'Start'}
          </button>
          <button className="btn-ghost text-[12px]" onClick={onClose}>
            Not now
          </button>
          <span className="flex-1" />
          {worker && (
            <span className="text-[11px] text-faint">
              {worker.name} · {worker.writes === 'branch' ? 'its own branch' : 'one folder'} ·{' '}
              {worker.unattended ? 'may be started by a manager' : 'only when you say so'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
