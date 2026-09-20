// Workers — the hands you own.
//
// A manager keeps a plan; a worker does one job and hands back a draught. It
// belongs to you rather than to a space, so the same taste reviewer serves
// every business you run. This page is where they are made, given skills, and
// lent to spaces.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { avatarLabel } from '../../lib/spaces'
import { LibraryPanel, useLibrary } from './LibraryPanel'
import { WorkerEditor } from './WorkerEditor'
import { startWorker } from './StartWorker'

export function WorkersPage() {
  const nodes = useApp((s) => s.nodes)
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [starters, setStarters] = useState<ipc.Worker[]>([])
  const [runs, setRuns] = useState<ipc.Run[]>([])
  const [editing, setEditing] = useState<ipc.Worker | null>(null)
  const [err, setErr] = useState('')
  const lib = useLibrary()

  const reload = () => {
    void ipc.workersList().then(setWorkers).catch((e) => setErr(String(e)))
    void ipc.workerStarters().then(setStarters).catch(() => setStarters([]))
    void ipc.runsList(0).then(setRuns).catch(() => setRuns([]))
  }
  useEffect(reload, [])

  const blank: ipc.Worker = {
    handle: '',
    name: '',
    what: '',
    brief: '',
    skills: [],
    runner: 'claude-code',
    model: 'sonnet',
    writes: 'folder',
    minutes: 20,
    usd: 2,
    spaces: [],
    unattended: false,
    created_at: '',
    body: '',
  }

  const runsOf = (handle: string) => runs.filter((r) => r.worker === handle)
  const spaceName = (id: number) => nodes.find((n) => n.id === id)?.name ?? `space ${id}`

  return (
    <div className="flex h-full min-h-0 bg-page">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line px-6 py-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <h2 className="text-[17px] font-semibold text-ink">Workers</h2>
              <p className="mt-1 max-w-[760px] text-[12.5px] leading-relaxed text-dim">
                Yours, not a space&rsquo;s. Each is a brief, the skills it may use, one folder it may write in, and a
                limit. Managers hand them work; you can start one yourself from any space.
              </p>
            </div>
            <button className="btn-primary text-[12px]" onClick={() => setEditing(blank)}>
              <Icon name="add" size={12} /> New worker
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {err && <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">{err}</div>}

          {workers.length === 0 && (
            <div className="mb-5 rounded-[10px] border border-dashed border-line2 px-5 py-6 text-center">
              <div className="text-[13px] text-ink">No workers yet</div>
              <p className="mx-auto mt-1 max-w-[460px] text-[12px] leading-relaxed text-muted">
                Start from one below, or write your own. Nothing runs until you say so, and no worker can send, post, pay,
                push or merge whatever it is asked.
              </p>
            </div>
          )}

          {workers.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
              {workers.map((w) => {
                const mine = runsOf(w.handle)
                const last = mine[0]
                return (
                  <div key={w.handle} className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-[10px] font-bold text-indigo-300">
                        {avatarLabel(w.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">{w.name}</div>
                        <div className="truncate font-mono text-[10.5px] text-faint">@{w.handle}</div>
                      </div>
                      <button className="btn-ghost text-[11px]" onClick={() => setEditing(w)}>
                        <Icon name="edit" size={12} /> Edit
                      </button>
                    </div>
                    {w.what && <p className="m-0 line-clamp-2 text-[12px] leading-relaxed text-dim">{w.what}</p>}
                    <div className="flex flex-wrap gap-1">
                      {w.brief && (
                        <span className="rounded bg-violet-500/10 px-1.5 py-px font-mono text-[10.5px] text-viol">{w.brief}</span>
                      )}
                      {w.skills.map((s) => (
                        <span
                          key={s}
                          className={`rounded px-1.5 py-px font-mono text-[10.5px] ${
                            lib.items.some((i) => i.id === s) ? 'bg-indigo-500/10 text-indigo-300' : 'bg-amber-500/10 text-warn'
                          }`}
                          title={lib.items.some((i) => i.id === s) ? '' : 'not in your library yet'}
                        >
                          {s}
                        </span>
                      ))}
                      {w.skills.length === 0 && !w.brief && <span className="text-[11px] text-faint">no skills yet</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span className="flex items-center gap-1">
                        <Icon name={w.writes === 'branch' ? 'code' : 'folder'} size={11} />
                        {w.writes === 'branch' ? 'its own branch' : 'one folder'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Icon name="clock" size={11} /> {w.minutes} min · ${w.usd.toFixed(2)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Icon name="workspace" size={11} />
                        {w.spaces.length === 0 ? 'any space' : w.spaces.map(spaceName).join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 border-t border-line pt-2.5">
                      <button className="btn-ghost text-[11.5px]" onClick={() => startWorker({ handle: w.handle })}>
                        <Icon name="run" size={12} /> Start it
                      </button>
                      <span className="flex-1" />
                      <span className="text-[10.5px] text-faint">
                        {mine.length === 0
                          ? 'never run'
                          : `${mine.length} run${mine.length === 1 ? '' : 's'}${last ? ` · last ${last.status}` : ''}`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {starters.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Worth having</span>
                <span className="text-[10.5px] text-faint">made in one click, edited like any other</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
                {starters.map((s) => (
                  <div key={s.handle} className="flex items-start gap-2.5 rounded-[10px] border border-dashed border-line2 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-ink">{s.name}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{s.what}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {s.skills.map((x) => (
                          <span key={x} className="rounded bg-raise px-1.5 py-px font-mono text-[10px] text-dim">
                            {x}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className="btn-ghost shrink-0 text-[11px]"
                      onClick={() => void ipc.workerSave(s).then(reload)}
                    >
                      <Icon name="add" size={11} /> Make
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {runs.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Lately</div>
              <div className="overflow-hidden rounded-[10px] border border-line bg-panel">
                {runs.slice(0, 6).map((r) => (
                  <button
                    key={r.id}
                    className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-2 text-left last:border-b-0 hover:bg-hover/40"
                    onClick={() => window.dispatchEvent(new CustomEvent('devdeck:open-run', { detail: { id: r.id, title: r.title } }))}
                  >
                    <Icon
                      name={r.status === 'running' ? 'spinner' : r.ok ? 'check' : 'alert'}
                      size={13}
                      spin={r.status === 'running'}
                      className={r.status === 'running' ? 'text-indigo-400' : r.ok ? 'text-ok' : 'text-warn'}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{r.title}</span>
                    <span className="shrink-0 text-[11px] text-muted">{r.worker_name}</span>
                    <span className="w-24 shrink-0 truncate text-right text-[11px] text-faint">{r.space}</span>
                    <span className="w-20 shrink-0 text-right text-[10.5px] text-faint">
                      {r.status === 'running' ? 'running' : `${Math.round(r.seconds / 60)} min · $${r.usd.toFixed(2)}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-[380px] shrink-0 flex-col border-l border-line bg-panel px-4 py-4">
        <LibraryPanel items={lib.items} reload={lib.reload} />
      </div>

      {editing && (
        <WorkerEditor
          worker={editing}
          library={lib.items}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
