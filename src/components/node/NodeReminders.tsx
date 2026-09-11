// What this node has promised to do, and whether it did.
//
// The tab that makes a client folder worth opening. A folder with no
// repository has no branch, no services and no commands — but it can still be
// the thing you said you would chase on Thursday, and until now there was
// nowhere on its page for that to live.
//
// Reminders only. A command or a bot on a clock is the machine's business and
// belongs on the calendar with the rest of the schedule; this answers the
// narrower question of what *you* undertook here.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store'
import { DAY_MS, startOfDay } from '../../lib/calendarWindow'

/// "every weekday at 08:00", from the fields a schedule actually carries.
function rhythm(s: ipc.Schedule): string {
  const at = `${String(Math.floor(s.at_min / 60)).padStart(2, '0')}:${String(s.at_min % 60).padStart(2, '0')}`
  if (s.every === 'once') {
    return s.at_ms ? new Date(s.at_ms).toLocaleString() : 'once'
  }
  if (s.every === 'hourly') return 'every hour'
  if (s.every === 'weekly') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const days = s.days
      .split(',')
      .map((d) => names[Number(d)])
      .filter(Boolean)
      .join(', ')
    return days ? `${days} at ${at}` : `weekly at ${at}`
  }
  return `${s.every} at ${at}`
}

export function NodeReminders({ nodeId }: { nodeId: number }) {
  const setRailView = useApp((s) => s.setRailView)
  const [rows, setRows] = useState<ipc.Schedule[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const all = await ipc.schedulesList()
      setRows(all.filter((s) => s.node_id === nodeId && s.kind === 'reminder'))
      setErr(null)
    } catch (e) {
      setRows(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [nodeId])
  useEffect(() => {
    void load()
  }, [load])

  if (err) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">
        <Icon name="alert" size={13} className="mt-px shrink-0" />
        <span className="min-w-0 flex-1">{err}</span>
      </div>
    )
  }
  if (rows === null) {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <Icon name="update" size={12} spin /> Reading the schedule…
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-panel px-3 py-3">
        <p className="text-[12px] text-muted">
          Nothing recurring here yet. A reminder on this folder is how it asks you for something
          — a chase, a review, a weekly look.
        </p>
        <button className="btn-ghost mt-2 text-[11px]" onClick={() => setRailView('calendar')}>
          <Icon name="schedule" size={12} /> Open the calendar
        </button>
      </div>
    )
  }

  const today = startOfDay(new Date()).getTime()
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      {rows.map((s) => {
        // Whole days since it last ran. Never run at all is not "0 days ago",
        // and it is not an overdue either — it has simply never happened.
        const missed = s.last_run ? Math.floor((Date.now() - s.last_run) / DAY_MS) : null
        const doneToday = !!s.last_run && s.last_run >= today
        return (
          <div
            key={s.id}
            className="flex items-center gap-2.5 border-t border-line px-3 py-2.5 first:border-t-0"
          >
            <span
              className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                !s.enabled
                  ? 'bg-line2'
                  : doneToday
                    ? 'bg-emerald-400'
                    : missed != null && missed >= 2
                      ? 'bg-red-400'
                      : 'bg-line2'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[12.5px] ${s.enabled ? 'text-ink' : 'text-muted'}`}>
                {s.name}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted">{rhythm(s)}</span>
            </span>
            {!s.enabled ? (
              <span className="shrink-0 text-[10.5px] text-faint">off</span>
            ) : doneToday ? (
              <span className="shrink-0 text-[10.5px] text-ok">done today</span>
            ) : missed == null ? (
              <span className="shrink-0 text-[10.5px] text-muted">never run</span>
            ) : missed >= 2 ? (
              <span className="shrink-0 text-[10.5px] text-err">{missed} days since</span>
            ) : (
              <span className="shrink-0 text-[10.5px] text-muted">ran {missed}d ago</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
