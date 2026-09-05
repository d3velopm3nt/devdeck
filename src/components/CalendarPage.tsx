// Time, across every space.
//
// Four views over one query. Day, week, month and year differ in the window
// they ask for and how they draw the answer — never in what they ask, so a day
// and the month containing it cannot show different things about the same
// afternoon.
//
// What lands here has a time: schedules, whether they are rhythms or moments;
// work items with a deadline, read from each space's `.devdeck`; and the focus
// sessions you have run, which were always recorded and never drawn.
//
// **The day is placed, not listed.** A block is as tall as it is long, and it
// sits in one of two lanes: your day, and the agents'. Before this it was a
// chip inside a slot row, so an hour and ten minutes were the same size and
// a bot's two-hour run could sit on top of your lunch. Two rules follow from
// placing things:
//
//   * a block never shrinks below 18px, or the label goes and you are left
//     clicking at a stripe — when it is floored, a full-strength tick on the
//     left edge still shows its true length;
//   * a deadline is a line, not a block. Drawing it as a box would claim it
//     takes an hour. It takes no time at all.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import * as ipc from '../lib/ipc'
import type { CalendarItem } from '../lib/ipc'
import { useApp } from '../store'
import type { CalView } from '../store'
import { findNode } from '../lib/tree'
import { CAPTURE_CAL_VIEW, CAPTURE_EVENT_OPEN } from '../lib/devCapture'
import { EventPage } from './EventPage'
import { blockSkin, laneOf, layerMeta, layerOf, wentOf } from '../lib/calendarLayers'
import { place } from '../lib/calendarPlace'
import type { Placed } from '../lib/calendarPlace'
import {
  DAY_MS,
  daysFrom,
  hhmm,
  sameDay,
  startOfDay,
  step,
  windowFor,
} from '../lib/calendarWindow'

const VIEWS: Array<[CalView, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
]

/// Minutes a row covers in the day view, and how tall that row is. With blocks
/// placed by time rather than dropped into rows, this is a zoom: at five
/// minutes the day is four thousand pixels tall and a ten-minute habit is a
/// readable block; at an hour the whole day fits and you are glancing.
const SLOTS: Array<[number, number]> = [
  [5, 16],
  [15, 22],
  [30, 30],
  [60, 46],
]

const rowHeight = (slot: number) => SLOTS.find(([m]) => m === slot)?.[1] ?? 22

/// A block small enough to lose its label is no longer a block.
const MIN_BLOCK_PX = 18

function Dot({ i }: { i: CalendarItem }) {
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${layerMeta(layerOf(i)).swatch}`} />
}

/// One line: what, when, where. The same in every view that lists rather than
/// places.
function Line({ i, onOpen }: { i: CalendarItem; onOpen: (i: CalendarItem) => void }) {
  const went = wentOf(i)
  return (
    <button
      className={`flex w-full items-center gap-1.5 truncate rounded px-1 py-px text-left text-[10px] hover:brightness-125 ${
        went === 'past' || went === 'missed' || went === 'done' ? 'opacity-60' : ''
      }`}
      title={`${hhmm(i.at)} · ${i.title}${i.space ? ` · ${i.space}` : ' · personal'}`}
      onClick={() => onOpen(i)}
    >
      <Dot i={i} />
      <span className="shrink-0 text-faint">{hhmm(i.at)}</span>
      <span
        className={`min-w-0 flex-1 truncate text-dim ${went === 'done' ? 'line-through' : ''}`}
      >
        {i.title}
      </span>
    </button>
  )
}

/// A focus session is a thing that happened at a time, and it was in the
/// database all along — `focus_sessions` has a start and an end. It is shaped
/// into a calendar item here rather than in Rust because nothing about it is
/// new: no table, no command, no rule.
function focusAsItems(
  sessions: ipc.Focus[],
  from: number,
  to: number,
  now: number,
  nameOf: (id: number | null | undefined) => string,
): CalendarItem[] {
  return sessions
    .filter((f) => f.started_at <= to && (f.ended_at ?? now) >= from)
    .map((f) => ({
      id: `focus:${f.id}`,
      kind: 'focus',
      sort: 'focus',
      every: '',
      title: f.goal || 'Focus',
      at: f.started_at,
      // A session still running is as long as it has been so far, not zero.
      end: f.ended_at ?? now,
      node_id: f.node_id ?? null,
      space: nameOf(f.node_id),
      feature: '',
      work_item: '',
      status: f.ended_at == null ? 'running' : 'done',
      past: (f.ended_at ?? now) <= now,
      schedule_id: null,
    }))
}

export function CalendarPage() {
  const app = useApp()
  const { calView: view, calSlot: slot, calHidden, nodes } = app
  const anchor = useMemo(() => new Date(app.calAnchor), [app.calAnchor])

  // Screenshot harness: `view` or `view@YYYY-MM-DD`.
  const [capView, capDay] = CAPTURE_CAL_VIEW.split('@')
  useEffect(() => {
    if (capView) app.setCalView(capView as CalView)
    if (capDay) app.setCalAnchor(new Date(`${capDay}T12:00`).getTime())
    // Once, on mount: the harness sets the scene and then leaves it alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [focus, setFocus] = useState<ipc.Focus[]>([])
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
    // Recent sessions cover any window a person is looking at in practice; a
    // failure here dims one layer and must never take the calendar with it.
    ipc
      .focusRecent(60)
      .then(setFocus)
      .catch(() => setFocus([]))
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = useCallback(
    (id: number | null | undefined) => (id == null ? '' : (findNode(nodes, id)?.name ?? '')),
    [nodes],
  )

  /// Everything with a time on it, minus the layers you have switched off.
  const shown = useMemo(() => {
    const all = [
      ...(items ?? []),
      ...focusAsItems(focus, from.getTime(), to.getTime(), Date.now(), nameOf),
    ]
    return all
      .filter((i) => !calHidden.includes(layerOf(i)))
      .sort((a, b) => a.at - b.at)
  }, [items, focus, from, to, calHidden, nameOf])

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const i of shown) {
      const key = startOfDay(new Date(i.at)).toDateString()
      const list = m.get(key)
      if (list) list.push(i)
      else m.set(key, [i])
    }
    return m
  }, [shown])

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
    // A focus session has no rule behind it and no page of its own: it is a
    // record of two hours you spent, and the block is the whole of it.
    if (i.kind === 'focus') return
    setOpenItem(i)
  }

  /// The same event a day either side, found by asking the calendar rather
  /// than by guessing: a weekdays rhythm has no Saturday, and stepping onto
  /// one would open a page for something that never happens.
  const step1 = async (fromItem: CalendarItem, days: number) => {
    const dir = days > 0 ? 1 : -1
    const base = new Date(fromItem.at)
    for (let n = 1; n <= 62; n++) {
      const probe = new Date(base.getTime() + dir * n * DAY_MS)
      const dayStart = startOfDay(probe).getTime()
      const found = (await ipc.calendarRange(dayStart, dayStart + DAY_MS - 1)).find(
        (c) => c.schedule_id === fromItem.schedule_id,
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
    if (view === 'month') return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    return String(anchor.getFullYear())
  }, [view, anchor, from, to])

  const hiddenCount = (items?.length ?? 0) + focus.length - shown.length

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      {/* One row, the way the design has it: the day is the title, and
          everything that changes what you are looking at sits on the right. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        {view === 'day' && sameDay(anchor, new Date()) && (
          <span className="text-[10.5px] text-faint">today</span>
        )}
        <span className="flex items-center gap-1">
          <button
            className="btn-ghost px-1.5 text-[11px]"
            title="Back"
            onClick={() => app.setCalAnchor(step(view, anchor, -1).getTime())}
          >
            <Icon name="chevron-left" size={12} />
          </button>
          <button className="btn-ghost text-[11px]" onClick={() => app.setCalAnchor(Date.now())}>
            Today
          </button>
          <button
            className="btn-ghost px-1.5 text-[11px]"
            title="Forward"
            onClick={() => app.setCalAnchor(step(view, anchor, 1).getTime())}
          >
            <Icon name="chevron-right" size={12} />
          </button>
        </span>
        <span className="text-[10.5px] text-muted">
          {items == null ? 'reading…' : `${shown.length} in view`}
        </span>
        {hiddenCount > 0 && (
          <button
            className="text-[10.5px] text-warn hover:underline"
            onClick={() => calHidden.forEach((l) => app.toggleCalLayer(l))}
            title="Show every layer again"
          >
            {hiddenCount} hidden
          </button>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Segmented
            options={VIEWS}
            value={view}
            onChange={(v) => app.setCalView(v)}
            accent
          />
          {view === 'day' && (
            <Segmented
              options={SLOTS.map(([m]) => [m, m < 60 ? `${m}m` : '1h'] as [number, string])}
              value={slot}
              onChange={(m) => app.setCalSlot(m)}
              title="How tall an hour is"
            />
          )}
          <button className="btn-ghost px-1.5 text-[11px]" onClick={() => load()} title="Reload">
            <Icon name="update" size={12} />
          </button>
          <button
            className="flex items-center gap-1 rounded-md bg-indigo-500 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-indigo-400"
            title="A new one-off, on the day you are looking at"
            onClick={() => {
              // 09:00 on that day, or the next hour if the day is today and
              // nine has been and gone.
              const d = startOfDay(anchor)
              d.setHours(9)
              const now = new Date()
              if (sameDay(anchor, now) && now.getHours() >= 9) {
                d.setHours(now.getHours() + 1, 0, 0, 0)
              }
              app.setNewScheduleAt(d.getTime())
              app.setSettingsTab('routines')
              app.setRailView('settings')
            }}
          >
            <Icon name="add" size={12} />
            New
          </button>
        </span>
      </div>

      {view === 'day' && !openItem && <DayStats items={shown} day={from} />}

      {err && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/[0.06] px-5 py-2 text-[11.5px] text-err">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {openItem && (
          <div className="h-full overflow-auto p-4">
            <EventPage
              item={openItem}
              onBack={() => setOpenItem(null)}
              onStep={(i, d) => void step1(i, d)}
            />
          </div>
        )}
        {!openItem && view === 'day' && (
          <DayGrid day={from} slot={slot} items={shown} onOpen={open} />
        )}
        {!openItem && view === 'week' && (
          <div className="h-full overflow-auto p-4">
            <WeekGrid from={from} byDay={byDay} onOpen={open} />
          </div>
        )}
        {!openItem && view === 'month' && (
          <div className="h-full overflow-auto p-4">
            <MonthGrid
              from={from}
              to={to}
              month={anchor.getMonth()}
              byDay={byDay}
              onOpen={open}
            />
          </div>
        )}
        {!openItem && view === 'year' && (
          <div className="h-full overflow-auto p-4">
            <YearGrid year={anchor.getFullYear()} items={shown} onOpen={open} />
          </div>
        )}
      </div>
    </div>
  )
}

/// One control, several choices, one of them on. Views and zoom are the same
/// shape because they are the same gesture: change what you are looking at
/// without leaving where you are.
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  accent,
  title,
}: {
  options: Array<[T, string]>
  value: T
  onChange: (v: T) => void
  accent?: boolean
  title?: string
}) {
  return (
    <span
      className="flex items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5"
      title={title}
    >
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          className={`rounded-md px-2.5 py-0.5 text-[11px] ${
            v === value
              ? accent
                ? 'bg-indigo-500 font-medium text-white'
                : 'bg-hover text-ink'
              : 'text-muted hover:text-dim'
          }`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </span>
  )
}

/// Minutes covered by any of these spans, counting overlap once.
///
/// Two hours of focus inside a three-hour block of your own time is three
/// hours of day, not five. Summing durations is the easy way to a number that
/// is always too big.
function unionMinutes(spans: Array<[number, number]>, from: number, to: number): number {
  const clipped = spans
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let cur: [number, number] | null = null
  for (const sp of clipped) {
    if (cur && sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1])
    else {
      if (cur) total += cur[1] - cur[0]
      cur = [sp[0], sp[1]]
    }
  }
  if (cur) total += cur[1] - cur[0]
  return Math.round(total / 60_000)
}

const hoursSaid = (min: number) =>
  min === 0 ? '—' : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`

/// What the day adds up to.
///
/// Every card here is a real number over data that already exists. The design
/// also had "agents working, 2.5h" and "habits banked" — one needs agent
/// sessions written down (they live in memory, so yesterday would be a lie)
/// and the other needs habits to exist at all. An empty card is worse than no
/// card, so they are absent rather than zero.
function DayStats({ items, day }: { items: CalendarItem[]; day: Date }) {
  const from = day.getTime()
  const to = from + DAY_MS - 1
  const now = Date.now()

  const focusMin = unionMinutes(
    items.filter((i) => layerOf(i) === 'focus').map((i) => [i.at, i.end] as [number, number]),
    from,
    to,
  )
  const yoursMin = unionMinutes(
    items
      .filter((i) => i.kind !== 'deadline' && laneOf(i) === 'you')
      .map((i) => [i.at, Math.max(i.end, i.at + 60_000)] as [number, number]),
    from,
    to,
  )
  const agentItems = items.filter((i) => i.kind !== 'deadline' && laneOf(i) === 'agents')
  const running = agentItems.filter((i) => wentOf(i, now) === 'running').length
  const due = items.filter((i) => i.kind === 'deadline')
  const blocked = due.filter((i) => i.status === 'blocked').length

  const cards: Array<{ n: string; label: string; sub?: string; bad?: boolean }> = [
    { n: hoursSaid(focusMin), label: 'Deep focus', sub: focusMin === 0 ? 'none today' : undefined },
    { n: hoursSaid(yoursMin), label: 'Your day', sub: 'booked' },
    {
      n: String(agentItems.length),
      label: agentItems.length === 1 ? 'Agent run' : 'Agent runs',
      sub: running > 0 ? `${running} running now` : undefined,
    },
    { n: String(due.length), label: due.length === 1 ? 'Deadline' : 'Deadlines', sub: 'today' },
    // Scoped, or it argues with the sidebar: an overdue item blocked last
    // week is not on this day, and a bare "Blocked · 0" beside a sidebar
    // saying "blocked" is the kind of small lie that costs trust in the rest.
    { n: String(blocked), label: 'Blocked', sub: 'of those', bad: blocked > 0 },
  ]

  return (
    <div className="flex shrink-0 gap-2 border-b border-line px-4 py-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`flex-1 rounded-lg border px-3 py-1.5 ${
            c.bad ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-line bg-panel'
          }`}
        >
          <div
            className={`text-[18px] font-semibold leading-tight ${c.bad ? 'text-err' : 'text-ink'}`}
          >
            {c.n}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-[9.5px] font-semibold uppercase tracking-wider ${
                c.bad ? 'text-err' : 'text-muted'
              }`}
            >
              {c.label}
            </span>
            {c.sub && <span className="truncate text-[9.5px] text-faint">{c.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/// The day you are running, placed on a clock you can zoom.
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
  const pxPerMin = rowHeight(slot) / slot
  const dayStart = day.getTime()
  const now = Date.now()
  const isToday = sameDay(day, new Date())
  const height = 24 * 60 * pxPerMin
  const minMs = (MIN_BLOCK_PX / pxPerMin) * 60_000

  const deadlines = items.filter((i) => i.kind === 'deadline')
  const timed = items.filter((i) => i.kind !== 'deadline')
  const you = useMemo(
    () => place(timed.filter((i) => laneOf(i) === 'you'), minMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, minMs],
  )
  const agents = useMemo(
    () => place(timed.filter((i) => laneOf(i) === 'agents'), minMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, minMs],
  )

  // A day that opens at midnight hides the day. Scroll to now, or to the first
  // thing on it — nobody wants to scroll past seven hours of empty night.
  const scroller = useRef<HTMLDivElement>(null)
  const firstAt = timed.length > 0 ? Math.min(...timed.map((i) => i.at)) : null
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const at = isToday ? now : (firstAt ?? dayStart + 8 * 3_600_000)
    const min = Math.max(0, (at - dayStart) / 60_000 - 60)
    el.scrollTop = min * pxPerMin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, dayStart, items.length])

  /// Lines every hour, and a fainter one between. Below a quarter of an hour
  /// the grid stops being a rule and starts being stripes.
  const gridEvery = Math.max(slot, 15)
  const rows = Math.round((24 * 60) / gridEvery)

  const topOf = (ms: number) => ((ms - dayStart) / 60_000) * pxPerMin

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="flex shrink-0 items-center border-b border-line pb-1 pl-[52px] pr-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span className="flex-[62]">Your day</span>
        <span className="flex flex-[38] items-center gap-2">
          Agents
          {agents.some(({ i }) => wentOf(i, now) === 'running') && (
            <span className="text-[9.5px] normal-case tracking-normal text-ok">running now</span>
          )}
        </span>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto rounded-b-lg border-x border-b border-line bg-panel"
      >
        <div className="relative" style={{ height }}>
          {/* the rule */}
          {Array.from({ length: rows }, (_, r) => {
            const min = r * gridEvery
            const onHour = min % 60 === 0
            return (
              <div
                key={r}
                className={`absolute left-0 right-0 border-t ${
                  onHour ? 'border-line' : 'border-dashed border-line/60'
                }`}
                style={{ top: min * pxPerMin }}
              >
                {onHour && (
                  <span className="absolute -top-[6px] left-0 w-[44px] pr-1 text-right font-mono text-[9.5px] text-faint">
                    {String(min / 60).padStart(2, '0')}:00
                  </span>
                )}
              </div>
            )
          })}

          {/* a deadline is a line, not a block */}
          {deadlines.map((i) => (
            <button
              key={i.id}
              className="absolute left-[52px] right-2 flex items-center justify-end border-t border-dashed border-red-400/80 hover:border-red-400"
              style={{ top: topOf(i.at) }}
              title={`${hhmm(i.at)} · ${i.title}${i.space ? ` · ${i.space}` : ''} · ${i.status}`}
              onClick={() => onOpen(i)}
            >
              <span className="-mt-[8px] bg-panel px-1 font-mono text-[9px] text-err">
                DUE {hhmm(i.at)} · {i.title}
                {i.feature ? ` · ${i.feature}` : ''}
              </span>
            </button>
          ))}

          {/* the two lanes */}
          <div className="absolute bottom-0 left-[52px] right-2 top-0 flex gap-2">
            <Lane placed={you} flex={62} {...{ dayStart, pxPerMin, now, onOpen }} />
            <Lane placed={agents} flex={38} {...{ dayStart, pxPerMin, now, onOpen }} />
          </div>

          {/* now — only ever on today */}
          {isToday && (
            <div
              className="pointer-events-none absolute left-2 right-2 flex items-center"
              style={{ top: topOf(now) }}
            >
              <span className="rounded bg-red-500 px-1 font-mono text-[9px] text-white">
                {hhmm(now)}
              </span>
              <span className="h-px flex-1 bg-red-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Lane({
  placed,
  flex,
  dayStart,
  pxPerMin,
  now,
  onOpen,
}: {
  placed: Placed[]
  flex: number
  dayStart: number
  pxPerMin: number
  now: number
  onOpen: (i: CalendarItem) => void
}) {
  return (
    <div className="relative min-w-0" style={{ flex }}>
      {placed.map(({ i, col, cols }) => {
        const startMin = Math.max(0, (i.at - dayStart) / 60_000)
        const trueMin = Math.max(0, (i.end - i.at) / 60_000)
        const top = startMin * pxPerMin
        const trueH = trueMin * pxPerMin
        const h = Math.max(MIN_BLOCK_PX, trueH)
        const went = wentOf(i, now)
        const meta = layerMeta(layerOf(i))
        const w = 100 / cols
        // A focus session has nowhere to open, so its block is inert rather
        // than a button that lies about being one.
        const clickable = i.kind !== 'focus'
        return (
          <button
            key={i.id}
            type="button"
            className={`absolute overflow-hidden rounded border-l-2 px-1.5 py-0.5 text-left text-[10.5px] ${blockSkin(
              i,
              now,
            )} ${clickable ? 'hover:brightness-125' : ''}`}
            style={{ top, height: h, left: `${col * w}%`, width: `calc(${w}% - 2px)` }}
            title={`${hhmm(i.at)}–${hhmm(i.end)} · ${i.title}${
              i.space ? ` · ${i.space}` : ' · personal'
            } · ${went}`}
            onClick={clickable ? () => onOpen(i) : undefined}
          >
            {/* When the block is floored, the tick still tells the truth about
                how long the thing actually takes. */}
            {trueH < MIN_BLOCK_PX && (
              <span
                className={`absolute -left-[2px] top-0 w-[2px] ${meta.swatch}`}
                style={{ height: Math.max(2, trueH) }}
              />
            )}
            <span className="flex items-center gap-1.5">
              {went === 'running' && (
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.swatch} animate-pulse`} />
              )}
              <span
                className={`min-w-0 flex-1 truncate font-semibold ${
                  went === 'planned' ? 'text-dim' : 'text-ink'
                } ${went === 'done' ? 'line-through' : ''}`}
              >
                {i.title}
              </span>
              {h >= 30 && (
                <span className="shrink-0 font-mono text-[9px] text-muted">
                  {trueMin >= 1 ? `${Math.round(trueMin)}m` : hhmm(i.at)}
                </span>
              )}
            </span>
            {h >= 30 && (
              <span className="mt-0.5 block truncate font-mono text-[9px] text-muted">
                {hhmm(i.at)}
                {trueMin >= 1 ? `–${hhmm(i.end)}` : ''}
                {i.space ? ` · ${i.space}` : ''}
              </span>
            )}
            {h >= 52 && went === 'failed' && (
              <span className="mt-0.5 block truncate text-[9.5px] text-err">
                failed — see the log
              </span>
            )}
            {h >= 52 && went === 'missed' && (
              <span className="mt-0.5 block truncate text-[9.5px] text-muted">
                missed — never fired late, on purpose
              </span>
            )}
          </button>
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
      {daysFrom(from, new Date(from.getTime() + 6 * DAY_MS + 3_600_000))
        .slice(0, 7)
        .map((day) => {
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
          <div
            key={d}
            className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint"
          >
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
