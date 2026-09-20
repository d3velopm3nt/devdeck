// A run, while it happens and after it.
//
// When the work happens in another process the transcript *is* the product,
// so this is the whole of it: every step as the CLI reports it, what it wrote,
// what it spent against what it was allowed, and a hand on the stop. When it
// finishes, the same page is where you keep it or throw it away — the only
// decision that changes anything, because keeping writes a line into the
// space's knowledge and the next worker starts from there.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'

export function RunPanel({ params }: IDockviewPanelProps<{ id: string }>) {
  return <RunView id={params.id} />
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function RunView({ id }: { id: string }) {
  const [run, setRun] = useState<ipc.Run | null>(null)
  const [live, setLive] = useState<ipc.RunStep[]>([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    void ipc
      .runGet(id)
      .then((r) => {
        if (r) {
          setRun(r)
          setLive(r.steps)
        }
      })
      .catch((e) => setErr(String(e)))
  }, [id])

  useEffect(load, [load])

  // Live while it runs: steps as they arrive, and the receipt when it lands.
  useEffect(() => {
    let off: (() => void) | undefined
    void ipc
      .onWorker({
        step: (e) => {
          if (e.run !== id) return
          setLive((cur) => [...cur, e.step])
        },
        done: (e) => {
          if (e.run.id !== id) return
          setRun(e.run)
          setLive(e.run.steps)
        },
      })
      .then((f) => (off = f))
    return () => off?.()
  }, [id])

  // A clock for the running case only, so the time against the limit moves.
  useEffect(() => {
    if (run?.status !== 'running') return
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [run?.status])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [live.length])

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center bg-page text-[12.5px] text-muted">
        {err || 'Opening the run…'}
      </div>
    )
  }

  const running = run.status === 'running'
  const seconds = running ? Math.max(0, Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000)) + tick * 0 : run.seconds
  const pct = run.minutes_limit > 0 ? Math.min(100, (seconds / (run.minutes_limit * 60)) * 100) : 0
  const spent = run.usd_limit > 0 ? Math.min(100, (run.usd / run.usd_limit) * 100) : 0
  const tone =
    running ? 'text-indigo-400' : run.status === 'kept' ? 'text-ok' : run.ok ? 'text-ok' : 'text-warn'

  const decide = async (what: 'keep' | 'discard') => {
    setErr('')
    try {
      setRun(await ipc.runDecide(run.id, what, note))
    } catch (e) {
      setErr(String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <Icon
          name={running ? 'spinner' : run.status === 'kept' ? 'check' : run.ok ? 'check' : 'alert'}
          size={17}
          spin={running}
          className={tone}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-ink">{run.title}</div>
          <div className="truncate text-[11px] text-muted">
            {run.worker_name} · {run.space} · <span className="font-mono">{run.folder}</span>
            {run.branch && <span className="font-mono"> · {run.branch}</span>}
          </div>
        </div>
        <span
          className={`rounded-full px-2 text-[9.5px] font-semibold uppercase tracking-wider leading-[1.7] ${
            running
              ? 'bg-indigo-500/15 text-indigo-300'
              : run.status === 'kept'
                ? 'bg-emerald-500/15 text-ok'
                : run.ok
                  ? 'bg-emerald-500/15 text-ok'
                  : 'bg-amber-500/15 text-warn'
          }`}
        >
          {run.status}
        </span>
        {running && (
          <button className="btn-danger text-[11.5px]" onClick={() => void ipc.workerStop(run.id)}>
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">What it did</span>
              <span className="text-[10.5px] text-faint">every step as Claude Code reported it</span>
            </div>
            {live.map((s, i) => (
              <div key={i} className="flex gap-3 border-t border-line py-2 first:border-t-0">
                <span className="w-16 shrink-0 pt-px text-right font-mono text-[10.5px] text-faint">
                  {new Date(s.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <Icon
                  name={s.kind === 'tool' ? 'tool' : s.kind === 'stderr' ? 'alert' : s.kind === 'note' ? 'info' : 'ai'}
                  size={13}
                  className={`mt-0.5 shrink-0 ${s.kind === 'stderr' ? 'text-warn' : 'text-muted'}`}
                />
                <span
                  className={`min-w-0 whitespace-pre-wrap break-words text-[12px] leading-relaxed ${
                    s.kind === 'tool' ? 'font-mono text-dim' : s.kind === 'stderr' ? 'text-warn' : 'text-body'
                  }`}
                >
                  {s.text}
                </span>
              </div>
            ))}
            {live.length === 0 && <div className="py-6 text-center text-[12px] text-muted">Nothing said yet.</div>}
            <div ref={bottom} />
          </div>

          {!running && (
            <div className="shrink-0 border-t border-line px-5 py-3">
              {run.verdict && (
                <div className="mb-2.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">It says</div>
                  <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-relaxed text-body">{run.verdict}</p>
                </div>
              )}
              {run.status === 'kept' || run.status === 'discarded' ? (
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <Icon name={run.status === 'kept' ? 'check' : 'close'} size={13} className={run.status === 'kept' ? 'text-ok' : 'text-faint'} />
                  {run.status === 'kept'
                    ? 'Kept. A line about it is in the space’s knowledge, so the next worker starts from it.'
                    : 'Discarded. The files are still on disk; nothing was written into what the space knows.'}
                  {run.decision && <span className="italic text-dim">“{run.decision}”</span>}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button className="btn-primary text-[12px]" onClick={() => void decide('keep')}>
                    Keep it
                  </button>
                  <input
                    className="input flex-1 text-[12px]"
                    placeholder="Anything to remember about it: “good angle, drop the uptime figure until Norcrest agrees”"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="btn-ghost text-[12px] text-muted" onClick={() => void decide('discard')}>
                    Discard
                  </button>
                </div>
              )}
              {err && <div className="mt-2 text-[12px] text-err">{err}</div>}
            </div>
          )}
        </div>

        <div className="flex w-[300px] shrink-0 flex-col gap-3.5 border-l border-line px-4 py-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-[10px] border border-line bg-panel px-3 py-2">
              <div className="text-[10px] text-faint">Time</div>
              <div className="text-[16px] font-semibold tabular-nums text-ink">{mmss(seconds)}</div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-raise">
                <span className="block h-full bg-indigo-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-faint">of {run.minutes_limit} min</div>
            </div>
            <div className="rounded-[10px] border border-line bg-panel px-3 py-2">
              <div className="text-[10px] text-faint">Spent</div>
              <div className="text-[16px] font-semibold tabular-nums text-ink">${run.usd.toFixed(2)}</div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-raise">
                <span className="block h-full bg-emerald-500" style={{ width: `${spent}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-faint">of ${run.usd_limit.toFixed(2)}</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Files it wrote {run.files.length > 0 && <span className="text-faint">{run.files.length}</span>}
            </div>
            {run.files.length === 0 ? (
              <div className="text-[11.5px] text-faint">{running ? 'nothing yet' : 'nothing'}</div>
            ) : (
              <div className="flex flex-col gap-1">
                {run.files.slice(0, 14).map((f) => (
                  <div key={f.path} className="flex items-baseline gap-2">
                    <Icon name="file" size={11} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-body" title={f.path}>
                      {f.path}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-faint">{Math.max(1, Math.round(f.bytes / 1024))} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">It was given</div>
            <div className="flex flex-wrap gap-1">
              {run.skills.map((s) => (
                <span key={s} className="rounded bg-indigo-500/10 px-1.5 py-px font-mono text-[10.5px] text-indigo-300">
                  {s}
                </span>
              ))}
              {run.skills.length === 0 && <span className="text-[11.5px] text-faint">no skills, just the job</span>}
            </div>
          </div>

          <div className="mt-auto text-[10.5px] leading-relaxed text-faint">
            Asked for: {run.intent || '—'}
          </div>
        </div>
      </div>
    </div>
  )
}
