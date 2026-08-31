// Everything that happens on a clock — yours and your agents'.
//
// A pillar rather than a face of the Assistant, because most of what belongs
// here has nothing to do with agents: a reminder only tells you, and a command
// runs without a model anywhere near it. Neither needs a standing grant, which
// is why both shipped first — and why a bot's heartbeat, which can now wake an
// agent, is bounded by grants rather than by this page.
//
// The one rule worth reading: a **reminder never catches up**. Being told to go
// to the gym at nine when you meant half six is noise, and noise is how a
// scheduler earns being ignored — so a missed reminder is recorded rather than
// fired, and the row says so.
//
// A bot's heartbeat appears here too, and is the one kind of row this page will
// not let you edit. Its routine is `_bot.md` in that space's folder; the row is
// only the clock agreeing with the file, and `bots_list` puts back anything
// changed here. Offering an Edit that is silently reverted is the same failure
// as the node colour that used to be written to SQLite and lost on the next
// scan — so it sends you to the bot instead.

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { Icon, type IconName } from '../lib/icons'
import { workspaceOf, findNode } from '../lib/tree'
import type { Activity } from '../lib/types'

const KIND: Record<string, { icon: IconName; label: string; tint: string }> = {
  reminder: { icon: 'alert', label: 'Reminder', tint: 'text-ok' },
  command: { icon: 'command', label: 'Command', tint: 'text-info' },
  bot: { icon: 'bot', label: 'Heartbeat', tint: 'text-indigo-400' },
  agent: { icon: 'agent', label: 'Agent', tint: 'text-indigo-400' },
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function whenText(s: ipc.Schedule): string {
  if (s.every === 'hourly') return 'Every hour'
  if (s.every === 'daily') return `Daily · ${hhmm(s.at_min)}`
  if (s.every === 'weekdays') return `Weekdays · ${hhmm(s.at_min)}`
  const picked = s.days
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 0 && d < 7)
    .map((d) => DAYS[d])
  return `${picked.join(', ') || 'No days'} · ${hhmm(s.at_min)}`
}

function until(ms: number | null): string {
  if (ms == null) return ''
  const mins = Math.round((ms - Date.now()) / 60000)
  if (mins < 1) return 'due now'
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

export function SchedulerPage() {
  const { nodes, setRailView, refreshActivity } = useApp()
  const [list, setList] = useState<ipc.Schedule[]>([])
  // What the last hand-run did, by schedule. A reminder that worked says
  // nothing at all through the schedules table — its note is empty, because
  // telling you is the whole job — so without this the button was
  // indistinguishable from one that did nothing.
  const [ran, setRan] = useState<Record<number, ipc.RunOutcome>>({})
  // The history that was already being written and never read: `activity`
  // stamps every fire with the schedule's id.
  const [past, setPast] = useState<Record<number, Activity[]>>({})
  const [editing, setEditing] = useState<Partial<ipc.Schedule> | null>(null)
  const [err, setErr] = useState('')

  const load = () => void ipc.schedulesList().then(setList).catch((e) => setErr(String(e)))
  useEffect(load, [])

  const next = useMemo(
    () =>
      list
        .filter((s) => s.enabled && s.next_run != null)
        .sort((a, b) => (a.next_run ?? 0) - (b.next_run ?? 0))[0] ?? null,
    [list],
  )

  const spaceName = (id: number | null) => {
    if (id == null) return 'All spaces'
    const n = findNode(nodes, id)
    if (!n) return ''
    const ws = workspaceOf(nodes, n)
    return ws && ws.id !== n.id ? `${ws.name} / ${n.name}` : n.name
  }

  const save = () => {
    if (!editing) return
    setErr('')
    const kind = editing.kind ?? 'reminder'
    void ipc
      .scheduleSave({
        id: editing.id ?? null,
        name: editing.name ?? '',
        kind,
        nodeId: editing.node_id ?? null,
        every: editing.every ?? 'daily',
        atMin: editing.at_min ?? 420,
        days: editing.days ?? '',
        payload: editing.payload ?? '',
        // A reminder that fires late is worse than one that did not fire, so
        // the default follows the kind rather than the last thing you ticked.
        catchUp: editing.catch_up ?? kind !== 'reminder',
      })
      .then(() => {
        setEditing(null)
        load()
      })
      .catch((e) => setErr(String(e)))
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Scheduler</h2>
          <p className="text-[11.5px] text-muted">
            Everything that happens on a clock — yours and your agents’.
          </p>
        </div>
        <button
          className="btn-primary ml-auto text-[11.5px]"
          onClick={() => setEditing({ kind: 'reminder', every: 'daily', at_min: 420 })}
        >
          <Icon name="add" size={12} /> New schedule
        </button>
      </div>

      {next && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-raise px-5 py-2.5">
          <Icon name="schedule" size={15} className="shrink-0 text-ok" />
          <span className="text-[12.5px] text-body">
            Next: <span className="font-semibold text-ink">{next.name}</span> {until(next.next_run)}
          </span>
        </div>
      )}

      {err && (
        <div className="shrink-0 border-b border-line bg-red-500/[0.07] px-5 py-2 text-[11.5px] text-err">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="schedule" size={26} className="text-faint" />
            <div className="text-[12.5px] text-dim">Nothing scheduled</div>
            <div className="max-w-[400px] text-[11.5px] leading-relaxed text-muted">
              A schedule is a reminder that only tells you, or a command that runs in a space’s
              folder. Give a space a bot and its heartbeat shows up here too — and a bot that names
              an agent wakes it, bounded by the standing grants you gave.
            </div>
          </div>
        ) : (
          list.map((s) => {
            const k = KIND[s.kind] ?? KIND.reminder
            return (
              <div key={s.id} className={`flex gap-3 border-b border-line px-5 py-3 ${s.enabled ? '' : 'opacity-60'}`}>
                <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-soft ${k.tint}`}>
                  <Icon name={k.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-ink">{s.name}</span>
                    <span className="shrink-0 rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
                      {spaceName(s.node_id)}
                    </span>
                    <span className="shrink-0 rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
                      {k.label}
                    </span>
                    <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-dim">
                      {whenText(s)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    {s.kind === 'command' ? (
                      <span className="truncate font-mono">{s.payload}</span>
                    ) : s.kind === 'bot' ? (
                      <span>
                        Reads the space, and runs the agent the bot names — if it names one.
                      </span>
                    ) : (
                      <span>Tells you. Nothing runs.</span>
                    )}
                    {!s.catch_up && <span className="text-faint">· never runs late</span>}
                    {s.last_note && <span className="text-warn">· {s.last_note}</span>}
                  </div>

                  {ran[s.id] && (
                    <div
                      className={`mt-1.5 text-[11px] ${ran[s.id].ok ? 'text-ok' : 'text-err'}`}
                    >
                      {ran[s.id].ok
                        ? ran[s.id].note.trim()
                          ? `Ran just now — ${ran[s.id].note}`
                          : s.kind === 'reminder'
                            ? 'Ran just now — it told you. It is in the Inbox.'
                            : 'Ran just now — nothing to report.'
                        : `Did not run — ${ran[s.id].note || 'no reason given'}`}
                    </div>
                  )}

                  {past[s.id] && past[s.id].length > 0 && (
                    <div className="mt-2 rounded-lg border border-line bg-panel">
                      {past[s.id].map((a) => (
                        <div
                          key={a.id}
                          className="flex items-baseline gap-2.5 border-b border-line px-3 py-1 last:border-0"
                        >
                          <span className="w-[112px] shrink-0 text-[10.5px] tabular-nums text-muted">
                            {new Date(a.ts).toLocaleString([], {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span
                            className={`min-w-0 flex-1 truncate text-[11px] ${
                              a.ok ? 'text-body' : 'text-err'
                            }`}
                          >
                            {a.detail || a.title}
                          </span>
                        </div>
                      ))}
                      {/* Said out loud, because "the last 8" and "everything
                          that ever happened" look identical in a list. */}
                      <div className="px-3 py-1.5 text-[10px] text-faint">
                        The most recent runs still kept. The feed is trimmed as it grows.
                      </div>
                    </div>
                  )}
                  {past[s.id] && past[s.id].length === 0 && (
                    <div className="mt-2 text-[11px] text-muted">
                      Nothing kept for this one yet.
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      className="btn-ghost text-[11px]"
                      onClick={() =>
                        void ipc
                          .scheduleRunNow(s.id)
                          .then(async (out) => {
                            setRan((r) => ({ ...r, [s.id]: out }))
                            await load()
                            // The fire wrote an activity row; the Inbox is
                            // reading a list from before it existed.
                            await refreshActivity()
                            if (past[s.id]) {
                              setPast((p) => ({ ...p, [s.id]: [] }))
                              void ipc
                                .activityFor(s.id, ['schedule', 'bot'])
                                .then((h) => setPast((p) => ({ ...p, [s.id]: h })))
                            }
                          })
                          .catch((e) => setErr(String(e)))
                      }
                    >
                      {s.kind === 'bot' ? 'Wake it now' : 'Run now'}
                    </button>
                    <button
                      className="btn-ghost text-[11px]"
                      onClick={() => {
                        if (past[s.id]) {
                          setPast((p) => {
                            const n = { ...p }
                            delete n[s.id]
                            return n
                          })
                          return
                        }
                        void ipc
                          .activityFor(s.id, ['schedule', 'bot'])
                          .then((h) => setPast((p) => ({ ...p, [s.id]: h })))
                          .catch((e) => setErr(String(e)))
                      }}
                    >
                      {past[s.id] ? 'Hide runs' : 'Past runs'}
                    </button>
                    {s.kind === 'bot' ? (
                      <>
                        <button className="btn-ghost text-[11px]" onClick={() => setRailView('bots')}>
                          Edit the bot
                        </button>
                        <span className="text-[10.5px] text-faint">
                          its routine lives in <code>_bot.md</code>
                        </span>
                      </>
                    ) : (
                      <>
                        <button className="btn-ghost text-[11px]" onClick={() => setEditing(s)}>
                          Edit
                        </button>
                        <button
                          className="btn-ghost text-[11px]"
                          onClick={() => void ipc.scheduleEnable(s.id, !s.enabled).then(load)}
                        >
                          {s.enabled ? 'Turn off' : 'Turn on'}
                        </button>
                        <button
                          className="btn-ghost text-[11px] text-dim"
                          onClick={() => {
                            if (!confirm(`Delete the schedule “${s.name}”?`)) return
                            void ipc.scheduleDelete(s.id).then(load)
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-panel px-5 py-2.5 text-[11px] leading-relaxed text-muted">
        Schedules run while DevDeck is open, and anything missed catches up when you next open it —
        except reminders, which are recorded as missed rather than fired late.
      </div>

      {editing && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-6" onClick={() => setEditing(null)}>
          <div className="w-full max-w-[460px] rounded-xl border border-line2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line px-5 py-3 text-[14px] font-semibold text-ink">
              {editing.id ? 'Edit schedule' : 'New schedule'}
            </div>
            <div className="space-y-3 px-5 py-4">
              <input
                autoFocus
                className="input w-full"
                placeholder="Name — “Gym”, “Pull everything”"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />

              <div className="flex gap-2">
                {(['reminder', 'command'] as const).map((k) => (
                  <button
                    key={k}
                    className={`flex-1 rounded-lg border px-3 py-2 text-left text-[12px] ${
                      (editing.kind ?? 'reminder') === k
                        ? 'border-indigo-500/50 bg-indigo-500/10 text-ink'
                        : 'border-line bg-raise text-dim hover:text-ink'
                    }`}
                    onClick={() => setEditing({ ...editing, kind: k, catch_up: k !== 'reminder' })}
                  >
                    {KIND[k].label}
                    <span className="block text-[10.5px] text-muted">
                      {k === 'reminder' ? 'Only tells you' : 'Runs a shell line'}
                    </span>
                  </button>
                ))}
              </div>

              {editing.kind === 'command' && (
                <input
                  className="input w-full font-mono text-[11.5px]"
                  placeholder="git pull --ff-only"
                  value={editing.payload ?? ''}
                  onChange={(e) => setEditing({ ...editing, payload: e.target.value })}
                />
              )}

              <div className="flex gap-2">
                <select
                  className="input flex-1"
                  value={editing.every ?? 'daily'}
                  onChange={(e) => setEditing({ ...editing, every: e.target.value })}
                >
                  <option value="daily">Every day</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Certain days</option>
                  <option value="hourly">Every hour</option>
                </select>
                {editing.every !== 'hourly' && (
                  <input
                    className="input w-28"
                    type="time"
                    value={hhmm(editing.at_min ?? 420)}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(':').map(Number)
                      setEditing({ ...editing, at_min: (h || 0) * 60 + (m || 0) })
                    }}
                  />
                )}
              </div>

              {editing.every === 'weekly' && (
                <div className="flex gap-1">
                  {DAYS.map((d, i) => {
                    const on = (editing.days ?? '').split(',').includes(String(i))
                    return (
                      <button
                        key={d}
                        className={`flex-1 rounded border px-1 py-1 text-[10.5px] ${
                          on ? 'border-indigo-500/50 bg-indigo-500/15 text-ink' : 'border-line text-muted'
                        }`}
                        onClick={() => {
                          const cur = (editing.days ?? '').split(',').filter(Boolean)
                          const nextDays = on ? cur.filter((x) => x !== String(i)) : [...cur, String(i)]
                          setEditing({ ...editing, days: nextDays.join(',') })
                        }}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              )}

              <select
                className="input w-full"
                value={editing.node_id ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, node_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">All spaces</option>
                {nodes
                  .filter((n) => n.kind !== 'workspace' && n.rel_path)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {spaceName(n.id)}
                    </option>
                  ))}
              </select>

              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={editing.catch_up ?? (editing.kind ?? 'reminder') !== 'reminder'}
                  onChange={(e) => setEditing({ ...editing, catch_up: e.target.checked })}
                />
                <span className="text-[12px] leading-relaxed text-body">
                  Run late if it was missed
                  <span className="block text-[11px] text-muted">
                    Off for reminders by default — a nudge for a moment that has passed is noise.
                    A missed one is still recorded so you can see it happened.
                  </span>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button className="btn-ghost text-[12px]" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary text-[12px]" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
