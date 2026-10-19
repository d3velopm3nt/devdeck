import { Markdown } from '../thread/Markdown'
import { StateBadge, TabStrip } from '../ui/DesignSystem'
// A run, while it happens and after it.
//
// When the work happens in another process the transcript *is* the product,
// so this is the whole of it: every step as the CLI reports it, what it wrote,
// what it spent against what it was allowed, and a hand on the stop. When it
// finishes, the same page is where you keep it or throw it away — the only
// decision that changes anything, because keeping writes a line into the
// space's knowledge and the next worker starts from there.

import { useCallback, useEffect, useId, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'

export function RunPanel({ params }: IDockviewPanelProps<{ id: string }>) {
  return <RunView id={params.id} />
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function RunView({ id, compact = false }: { id: string; compact?: boolean }) {
  const panelId = useId()
  const [tab, setTab] = useState<'overview' | 'activity' | 'files' | 'request'>('overview')
  useEffect(() => setTab('overview'), [id])
  const [run, setRun] = useState<ipc.Run | null>(null)
  const [live, setLive] = useState<ipc.RunStep[]>([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  // What it has stopped to ask. A worker sitting on one of these is burning
  // its clock, so this is the only thing on the page that is urgent.
  const [asks, setAsks] = useState<ipc.Ask[]>([])

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

  const loadAsks = useCallback(() => {
    void ipc
      .workerAsks(id)
      .then(setAsks)
      .catch(() => setAsks([]))
  }, [id])
  useEffect(loadAsks, [loadAsks])

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
          setAsks([])
        },
        asking: (e) => {
          if (e.run !== id) return
          setAsks((cur) => (cur.some((a) => a.id === e.ask.id) ? cur : [...cur, e.ask]))
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


  if (!run) {
    return (
      <div className="flex h-full items-center justify-center bg-page text-[12.5px] text-muted">
        {err || 'Opening the run…'}
      </div>
    )
  }

  const running = run.status === 'running'
  const nativeAgent = run.worker.startsWith('agent:')
  // `tick` is named so the dependency is honest: this clock re-reads on every
  // tick, and `+ tick * 0` was a way of saying that which added zero and read
  // as a mistake. Referencing it plainly says the same thing.
  void tick
  const seconds = running
    ? Math.max(0, Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000))
    : run.seconds
  const pct = run.minutes_limit > 0 ? Math.min(100, (seconds / (run.minutes_limit * 60)) * 100) : 0
  const spent = run.usd_limit > 0 ? Math.min(100, (run.usd / run.usd_limit) * 100) : 0
  const tone =
    running ? 'text-info' : run.status === 'kept' ? 'text-ok' : run.ok ? 'text-ok' : 'text-err'

  // What it is asking for, in the words it used. Never a paraphrase of ours:
  // approving a summary of a command is not approving the command.
  const asked = (a: ipc.Ask): string => {
    for (const k of ['command', 'file_path', 'path', 'url', 'pattern', 'prompt']) {
      const v = a.input?.[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return JSON.stringify(a.input ?? {})
  }

  const answer = async (a: ipc.Ask, allow: boolean) => {
    setErr('')
    try {
      await ipc.workerAnswer(run.id, a.id, allow, allow ? '' : note)
      setAsks((cur) => cur.filter((x) => x.id !== a.id))
      setNote('')
    } catch (e) {
      setErr(String(e))
    }
  }

  const decide = async (what: 'keep' | 'discard') => {
    setErr('')
    try {
      setRun(await ipc.runDecide(run.id, what, note))
    } catch (e) {
      setErr(String(e))
    }
  }

  return (
    <div className={`run-view flex h-full min-h-0 flex-col bg-page${compact ? ' run-view-compact' : ''}`}>
      {/* Above everything, because the run is stopped until this is answered
          and its minutes and its budget are still running down. */}
      {asks.map((a) => (
        <div
          key={a.id}
          className="flex shrink-0 items-start gap-3 border-b border-line bg-amber-500/[0.06] px-5 py-3"
        >
          <Icon name="alert" size={15} className="mt-px shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-ink">
              {run.worker_name} is asking to use {a.tool}
            </div>
            <div className="mt-1 overflow-x-auto rounded border border-line2 bg-raise px-2.5 py-1.5 font-mono text-[11.5px] text-body">
              {asked(a)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary text-[12px]" onClick={() => void answer(a, true)}>
                Yes
              </button>
              <button className="btn text-[12px]" onClick={() => void answer(a, false)}>
                No
              </button>
              <input
                className="input h-7 min-w-[220px] flex-1 px-2 py-0 text-[12px]"
                placeholder="Why not — it is told this, in your words"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="mt-1.5 text-[10.5px] text-faint">
              It waits 90 seconds. After that it stops and the question keeps waiting here.
            </div>
          </div>
        </div>
      ))}
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
        <StateBadge state={run.status} label={run.status}/>
        {running && (
          <button className="btn-danger text-[11.5px]" onClick={() => void ipc.workerStop(run.id)}>
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
      </div>

      <TabStrip label="Agent run details" value={tab} onChange={setTab} panelId={panelId} options={[
        { id: 'overview', label: 'Overview', icon: 'info' },
        { id: 'activity', label: 'Activity', icon: 'list', count: live.length },
        { id: 'files', label: 'Files', icon: 'folder', count: run.files.length },
        { id: 'request', label: 'Request', icon: 'note' },
      ]}/>
      <div id={panelId} role="tabpanel" aria-labelledby={panelId+'-tab-'+tab} className="run-view-body flex min-h-0 flex-1 overflow-auto flex-col">
        <div className={`flex min-w-0 flex-col ${tab === 'activity' ? 'flex-1' : ''}`}>
          {tab === 'activity' && <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">What it did</span>
              <span className="text-[10.5px] text-faint">{nativeAgent ? 'native agent messages and tool activity' : 'every step as Claude Code reported it'}</span>
            </div>
            {[...live].reverse().map((s, i) => (
              <div key={live.length - 1 - i} className="flex gap-3 border-t border-line py-2 first:border-t-0">
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
          </div>}

          {tab === 'overview' && !running && (
            <div className="shrink-0 border-t border-line px-5 py-3">
              {run.verdict && (
                <div className="mb-2.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">It says</div>
                  <Markdown text={run.verdict} />
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
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary text-[12px]" disabled={!run.ok || !note.trim()} onClick={() => void decide('keep')}>
                    Accept reviewed output
                  </button>
                  <input
                    className="input min-w-0 w-full flex-auto text-[12px]"
                    placeholder="Required: what did you check? Include tests or acceptance evidence."
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

        <div className="run-view-metadata flex min-w-0 flex-col gap-4 px-5 py-4">
          {tab === 'overview' && <><div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-[10px] border border-line bg-panel px-3 py-2">
              <div className="text-[10px] text-faint">Time</div>
              <div className="text-[16px] font-semibold tabular-nums text-ink">{mmss(seconds)}</div>
              {run.minutes_limit > 0 && <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-raise">
                <span className="block h-full bg-info" style={{ width: `${pct}%` }} />
              </div>}
              <div className="mt-1 text-[10px] text-faint">{run.minutes_limit > 0 ? `of ${run.minutes_limit} min` : 'No overall time limit'}</div>
            </div>
            <div className="rounded-[10px] border border-line bg-panel px-3 py-2">
              <div className="text-[10px] text-faint">{nativeAgent ? 'Model connection' : 'Spent'}</div>
              <div className="text-[16px] font-semibold tabular-nums text-ink">{nativeAgent ? 'Existing' : `$${run.usd.toFixed(2)}`}</div>
              {!nativeAgent && <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-raise">
                <span className="block h-full bg-emerald-500" style={{ width: `${spent}%` }} />
              </div>}
              <div className="mt-1 text-[10px] text-faint">{nativeAgent ? 'Cost not reported here' : `of $${run.usd_limit.toFixed(2)}`}</div>
            </div>
          </div>

          {running && <p className="text-sm text-muted">The agent is working. Activity shows its recorded messages and tool calls; its report will appear here when it finishes.</p>}
          </>}
          {tab === 'files' && <div>
            <div className="mb-1.5 text-sm font-semibold text-muted">
              Files it wrote {run.files.length > 0 && <span className="text-faint">{run.files.length}</span>}
            </div>
            {run.files.length === 0 ? (
              <div className="text-[11.5px] text-faint">{running ? 'No files recorded yet.' : 'No written files recorded for this run.'}</div>
            ) : (
              <div className="flex flex-col gap-1">
                {run.files.map((f) => (
                  <div key={f.path} className="flex items-baseline gap-2">
                    <Icon name="note" size={11} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-body" title={f.path}>
                      {f.path}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-faint">{Math.max(1, Math.round(f.bytes / 1024))} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>}

          {tab === 'request' && <><div>
            <div className="mb-2 text-sm font-semibold text-muted">Skills supplied</div>
            <div className="flex flex-wrap gap-1">
              {run.skills.map((s) => (
                <span key={s} className="rounded bg-indigo-500/10 px-1.5 py-px font-mono text-[10.5px] text-indigo-300">
                  {s}
                </span>
              ))}
              {run.skills.length === 0 && <span className="text-[11.5px] text-faint">no skills, just the job</span>}
            </div>
          </div>

          <div className="min-w-0 text-sm leading-relaxed text-body">
            <h3 className="mb-3 font-semibold">Request</h3>
            <Markdown text={run.intent || 'No request recorded.'} />
          </div></>}
        </div>
      </div>
    </div>
  )
}
