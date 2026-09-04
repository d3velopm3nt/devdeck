// Time, across every space.
//
// Four views over one query. Day, week, month and year differ in the window
// they ask for and how they draw the answer — never in what they ask, so a day
// and the month containing it cannot show different things about the same
// afternoon.
//
// What lands here has a time: schedules, whether they are rhythms or moments;
// and work items with a deadline, read from each space's `.devdeck`. A bot's
// wake and your evening reminder sit on the same grid because they are both
// things that happen at a time, and seeing them together is the point.
//
// The day view is a grid you can set the resolution of — five minutes up to an
// hour — because a day you are running is a different thing from a day you are
// glancing at.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import * as ipc from '../lib/ipc'
import type { CalendarItem } from '../lib/ipc'
import { useApp } from '../store'
import { CAPTURE_CAL_VIEW, CAPTURE_EVENT_OPEN } from '../lib/devCapture'
import { EventPage } from './EventPage'

type View = 'day' | 'week' | 'month' | 'year'

const VIEWS: Array<[View, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
]

/// Minutes a row covers in the day view.
const SLOTS = [5, 15, 30, 60]

const DAY_MS = 86_400_000

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
/// Weeks start on Monday: a working week that begins on Sunday puts the
/// weekend in two different rows.
const startOfWeek = (d: Date) => {
  const s = startOfDay(d)
  const back = (s.getDay() + 6) % 7
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - back)
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

/// Every day from one to the other, stepped by the calendar rather than by
/// 86,400,000.
///
/// A day is not always that many milliseconds — the clocks change twice a year
/// — and dividing a span by a fixed day gave the month grid a stray thirty-sixth
/// cell containing the 5th of October on its own.
function daysFrom(from: Date, to: Date): Date[] {
  const out: Date[] = []
  const d = startOfDay(from)
  while (d.getTime() <= to.getTime()) {
    out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1)

/// The window a view asks for. Month and year are padded to whole weeks and
/// whole months so the grid that draws them has no ragged edges.
function windowFor(view: View, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case 'day':
      return { from: startOfDay(anchor), to: new Date(startOfDay(anchor).getTime() + DAY_MS - 1) }
    case 'week': {
      const from = startOfWeek(anchor)
      return { from, to: new Date(from.getTime() + 7 * DAY_MS - 1) }
    }
    case 'month': {
      const first = startOfMonth(anchor)
      const from = startOfWeek(first)
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      const to = new Date(startOfWeek(last).getTime() + 7 * DAY_MS - 1)
      return { from, to }
    }
    case 'year': {
      const from = startOfYear(anchor)
      return { from, to: new Date(anchor.getFullYear() + 1, 0, 1, 0, 0, 0, -1) }
    }
  }
}

function step(view: View, anchor: Date, by: number): Date {
  const d = new Date(anchor)
  if (view === 'day') d.setDate(d.getDate() + by)
  if (view === 'week') d.setDate(d.getDate() + by * 7)
  if (view === 'month') d.setMonth(d.getMonth() + by)
  if (view === 'year') d.setFullYear(d.getFullYear() + by)
  return d
}

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/// What colour a thing is, by what it is. Deadlines are the only ones that can
/// be late, so they are the only ones that go red on their own.
function tone(i: CalendarItem): string {
  if (i.kind === 'deadline') {
    if (i.status === 'done') return 'border-emerald-500/40 bg-emerald-500/10 text-ok'
    if (i.past) return 'border-red-500/45 bg-red-500/10 text-err'
    return 'border-amber-500/40 bg-amber-500/10 text-warn'
  }
  if (i.sort === 'bot') return 'border-indigo-500/40 bg-indigo-500/12 text-indigo-300'
  if (i.sort === 'command') return 'border-sky-500/35 bg-sky-500/10 text-info'
  return 'border-line2 bg-raise text-dim'
}

function Dot({ i }: { i: CalendarItem }) {
  const c =
    i.kind === 'deadline'
      ? i.status === 'done'
        ? 'bg-emerald-400'
        : i.past
          ? 'bg-red-400'
          : 'bg-amber-400'
      : i.sort === 'bot'
        ? 'bg-indigo-400'
        : i.sort === 'command'
          ? 'bg-sky-400'
          : 'bg-slate-400'
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />
}

/// One line: what, when, where. The same in every view that lists rather than
/// places.
function Line({ i, onOpen }: { i: CalendarItem; onOpen: (i: CalendarItem) => void }) {
  return (
    <button
      className={`flex w-full items-center gap-1.5 truncate rounded px-1 py-px text-left text-[10px] hover:brightness-125 ${
        i.past && i.kind !== 'deadline' ? 'opacity-60' : ''
      }`}
      title={`${hhmm(i.at)} · ${i.title}${i.space ? ` · ${i.space}` : ' · personal'}`}
      onClick={() => onOpen(i)}
    >
      <Dot i={i} />
      <span className="shrink-0 text-faint">{hhmm(i.at)}</span>
      <span className="min-w-0 flex-1 truncate text-dim">{i.title}</span>
    </button>
  )
}

export function CalendarPage() {
  const app = useApp()
  // Screenshot harness: `view` or `view@YYYY-MM-DD`.
  const [capView, capDay] = CAPTURE_CAL_VIEW.split('@')
  const [view, setView] = useState<View>(
    () => (capView as View) || (localStorage.getItem('devdeck.calendar.view') as View) || 'week',
  )
  const [anchor, setAnchor] = useState(() => (capDay ? new Date(`${capDay}T12:00`) : new Date()))
  const [slot, setSlot] = useState(
    () => Number(localStorage.getItem('devdeck.calendar.slot')) || 15,
  )
  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [err, setErr] = useState('')

  const { from, to } = useMemo(() => windowFor(view, anchor), [view, anchor])

  const load = useCallback(() => {
    ipc
      .calendarRange(from.getTime(), to.getTime())
      .then((r) => {
        setItems(r)
        setErr('')
      })
      // An empty calendar and a failed read must not look the same.
      .catch((e) => setErr(String(e)))
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => localStorage.setItem('devdeck.calendar.view', view), [view])
  useEffect(() => localStorage.setItem('devdeck.calendar.slot', String(slot)), [slot])

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const i of items ?? []) {
      const key = startOfDay(new Date(i.at)).toDateString()
      const list = m.get(key)
      if (list) list.push(i)
      else m.set(key, [i])
    }
    return m
  }, [items])

  /// Opening an occurrence opens *that occurrence* — not the page that owns
  /// the rule behind it, and certainly not the assistant. A deadline is the
  /// exception and stays one: its record is the work item, so it goes there.
  const [openItem, setOpenItem] = useState<CalendarItem | null>(null)

  // Screenshot harness: open one occurrence on mount. `scheduleId|ISO`.
  useEffect(() => {
    if (!CAPTURE_EVENT_OPEN) return
    const [sid, iso] = CAPTURE_EVENT_OPEN.split('|')
    const at = new Date(iso).getTime()
    const day = startOfDay(new Date(at)).getTime()
    void ipc.calendarRange(day, day + DAY_MS - 1).then((list) => {
      const found = list.find((c) => c.schedule_id === Number(sid))
      if (found) setOpenItem(found)
    })
  }, [])
  const open = (i: CalendarItem) => {
    if (i.kind === 'deadline') {
      app.setRailView('team')
      app.setTeamTab('work')
      return
    }
    setOpenItem(i)
  }

  /// The same event a day either side, found by asking the calendar rather
  /// than by guessing: a weekdays rhythm has no Saturday, and stepping onto
  /// one would open a page for something that never happens.
  const step1 = async (from: CalendarItem, days: number) => {
    const dir = days > 0 ? 1 : -1
    const base = new Date(from.at)
    for (let n = 1; n <= 62; n++) {
      const probe = new Date(base.getTime() + dir * n * DAY_MS)
      const dayStart = startOfDay(probe).getTime()
      const found = (await ipc.calendarRange(dayStart, dayStart + DAY_MS - 1)).find(
        (c) => c.schedule_id === from.schedule_id,
      )
      if (found) {
        setOpenItem(found)
        return
      }
    }
  }

  const title = useMemo(() => {
    if (view === 'day')
      return anchor.toLocaleDateString([], {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    if (view === 'week')
      return `${from.toLocaleDateString([], { day: 'numeric', month: 'short' })} — ${to.toLocaleDateString(
        [],
        { day: 'numeric', month: 'short', year: 'numeric' },
      )}`
    if (view === 'month')
      return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    return String(anchor.getFullYear())
  }, [view, anchor, from, to])

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Calendar</h2>
          <p className="text-[11.5px] text-muted">
            Everything with a time on it, across every space — schedules, bot wakes and deadlines.
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button className="btn-ghost px-1.5 text-[11px]" onClick={() => setAnchor(step(view, anchor, -1))}>
            <Icon name="chevron-left" size={12} />
          </button>
          <button className="btn-ghost text-[11px]" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button className="btn-ghost px-1.5 text-[11px]" onClick={() => setAnchor(step(view, anchor, 1))}>
            <Icon name="chevron-right" size={12} />
          </button>
          <span className="mx-1 h-4 w-px bg-line" />
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                view === v ? 'border-line2 bg-raise text-ink' : 'border-line text-muted hover:text-dim'
              }`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
          {view === 'day' && (
            <select
              className="input h-[24px] w-[86px] py-0 text-[11px]"
              value={slot}
              onChange={(e) => setSlot(Number(e.target.value))}
              title="How fine the grid is"
            >
              {SLOTS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          )}
          <button className="btn-ghost px-1.5 text-[11px]" onClick={() => load()} title="Reload">
            <Icon name="update" size={12} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-1.5">
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="text-[10.5px] text-muted">
          {items == null ? 'reading…' : `${items.length} in view`}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-faint">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> deadline
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" /> bot wake
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> reminder
          </span>
        </span>
      </div>

      {err && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/[0.06] px-5 py-2 text-[11.5px] text-err">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {openItem && (
          <EventPage
            item={openItem}
            onBack={() => setOpenItem(null)}
            onStep={(i, d) => void step1(i, d)}
          />
        )}
        {!openItem && view === 'day' && (
          <DayGrid day={from} slot={slot} items={items ?? []} onOpen={open} />
        )}
        {!openItem && view === 'week' && <WeekGrid from={from} byDay={byDay} onOpen={open} />}
        {!openItem && view === 'month' && (
          <MonthGrid from={from} to={to} month={anchor.getMonth()} byDay={byDay} onOpen={open} />
        )}
        {!openItem && view === 'year' && <YearGrid year={anchor.getFullYear()} items={items ?? []} onOpen={open} />}
      </div>
    </div>
  )
}

/// The day you are running, on a grid you set the resolution of.
function DayGrid({
  day,
  slot,
  items,
  onOpen,
}: {
  day: Date
  slot: number
  items: CalendarItem[]
  onOpen: (i: CalendarItem) => void
}) {
  const rows = Math.round((24 * 60) / slot)
  const now = Date.now()
  const start = day.getTime()
  const height = slot <= 5 ? 16 : slot <= 15 ? 22 : 30

  // A day that opens at midnight hides the day. Scroll to now, or to the
  // first thing on it when now is not on this day at all — nobody wants to
  // scroll past seven hours of empty night to find the morning.
  const nowRow = useRef<HTMLDivElement>(null)
  const firstRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = nowRow.current ?? firstRow.current
    el?.scrollIntoView({ block: 'center' })
  }, [slot, day.getTime(), items.length])

  const firstAt = items.length > 0 ? Math.min(...items.map((i) => i.at)) : null

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      {Array.from({ length: rows }, (_, r) => {
        const at = start + r * slot * 60_000
        const end = at + slot * 60_000
        const here = items.filter((i) => i.at >= at && i.at < end)
        const onHour = (r * slot) % 60 === 0
        const isNow = now >= at && now < end
        const isFirst = firstAt != null && firstAt >= at && firstAt < end
        return (
          <div
            key={r}
            ref={isNow ? nowRow : isFirst ? firstRow : undefined}
            className={`flex items-stretch border-t border-line first:border-0 ${
              onHour ? '' : 'border-dashed'
            } ${isNow ? 'bg-indigo-500/[0.07]' : ''}`}
            style={{ minHeight: height }}
          >
            <div
              className={`w-[54px] shrink-0 border-r border-line px-2 py-0.5 text-right text-[10px] ${
                onHour ? 'text-dim' : 'text-faint'
              }`}
            >
              {onHour || slot >= 30 ? hhmm(at) : ''}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-2 py-0.5">
              {here.map((i) => (
                <button
                  key={i.id}
                  className={`flex items-center gap-1.5 truncate rounded border px-1.5 py-px text-[10.5px] hover:brightness-125 ${tone(i)}`}
                  onClick={() => onOpen(i)}
                  title={`${i.title}${i.space ? ` · ${i.space}` : ' · personal'}`}
                >
                  <span className="truncate">{i.title}</span>
                  {i.end > i.at && (
                    <span className="shrink-0 text-[9.5px] opacity-70">
                      {Math.round((i.end - i.at) / 60000)}m
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekGrid({
  from,
  byDay,
  onOpen,
}: {
  from: Date
  byDay: Map<string, CalendarItem[]>
  onOpen: (i: CalendarItem) => void
}) {
  const today = new Date().toDateString()
  return (
    <div className="grid grid-cols-7 gap-2">
      {daysFrom(from, new Date(from.getTime() + 6 * DAY_MS + 3_600_000)).slice(0, 7).map((day) => {
        const list = byDay.get(day.toDateString()) ?? []
        const isToday = day.toDateString() === today
        return (
          <div
            key={day.toDateString()}
            className={`min-h-[200px] overflow-hidden rounded-lg border bg-panel ${
              isToday ? 'border-indigo-500/45' : 'border-line'
            }`}
          >
            <div
              className={`flex items-baseline gap-1.5 border-b px-2 py-1.5 ${
                isToday ? 'border-indigo-500/30 bg-indigo-500/[0.07]' : 'border-line'
              }`}
            >
              <span className="text-[11px] font-semibold text-ink">
                {day.toLocaleDateString([], { weekday: 'short' })}
              </span>
              <span className="text-[11px] text-muted">{day.getDate()}</span>
              {list.length > 0 && (
                <span className="ml-auto text-[10px] text-faint">{list.length}</span>
              )}
            </div>
            <div className="flex flex-col gap-px p-1">
              {list.map((i) => (
                <Line key={i.id} i={i} onOpen={onOpen} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthGrid({
  from,
  to,
  month,
  byDay,
  onOpen,
}: {
  from: Date
  to: Date
  month: number
  byDay: Map<string, CalendarItem[]>
  onOpen: (i: CalendarItem) => void
}) {
  const days = daysFrom(from, to)
  const today = new Date().toDateString()
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const list = byDay.get(day.toDateString()) ?? []
          const outside = day.getMonth() !== month
          const isToday = day.toDateString() === today
          return (
            <div
              key={day.toDateString()}
              className={`min-h-[92px] overflow-hidden rounded-md border bg-panel p-1 ${
                isToday ? 'border-indigo-500/45' : 'border-line'
              } ${outside ? 'opacity-45' : ''}`}
            >
              <div className="px-1 text-[10.5px] text-muted">{day.getDate()}</div>
              <div className="flex flex-col gap-px">
                {list.slice(0, 3).map((i) => (
                  <Line key={i.id} i={i} onOpen={onOpen} />
                ))}
                {list.length > 3 && (
                  <span className="px-1 text-[9.5px] text-faint">+{list.length - 3} more</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/// A year is too much to read, so it counts rather than lists: how busy each
/// day was, and what is still ahead.
function YearGrid({
  year,
  items,
  onOpen,
}: {
  year: number
  items: CalendarItem[]
  onOpen: (i: CalendarItem) => void
}) {
  const deadlines = items.filter((i) => i.kind === 'deadline')
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, m) => {
          const inMonth = items.filter((i) => new Date(i.at).getMonth() === m)
          const due = inMonth.filter((i) => i.kind === 'deadline').length
          return (
            <div key={m} className="rounded-lg border border-line bg-panel px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-semibold text-ink">
                  {new Date(year, m, 1).toLocaleDateString([], { month: 'long' })}
                </span>
                <span className="ml-auto text-[11px] text-muted">{inMonth.length}</span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded bg-line">
                <span
                  className="block h-full bg-indigo-500"
                  style={{
                    width: `${Math.min(100, Math.round((inMonth.length / Math.max(1, items.length / 6)) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-1 text-[10px] text-faint">
                {due > 0 ? `${due} deadline${due === 1 ? '' : 's'}` : 'no deadlines'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-3 py-2 text-[12px] font-semibold text-ink">
          Deadlines this year
        </div>
        {deadlines.length === 0 ? (
          <div className="px-3 py-3 text-[11.5px] leading-[1.6] text-muted">
            None. A work item gets one by writing <span className="font-mono text-dim">due:</span> on
            it in the feature&rsquo;s <span className="font-mono text-dim">work.md</span> — the
            deadline lives beside the item, in the vault, because it is the project&rsquo;s own.
          </div>
        ) : (
          deadlines.map((i) => (
            <button
              key={i.id}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left first:border-0 hover:bg-hover/40"
              onClick={() => onOpen(i)}
            >
              <Dot i={i} />
              <span className="w-[110px] shrink-0 text-[11px] text-dim">
                {new Date(i.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{i.title}</span>
              <span className="shrink-0 text-[10.5px] text-muted">{i.space}</span>
              <span className="w-[80px] shrink-0 text-right text-[10.5px] text-faint">
                {i.status}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
