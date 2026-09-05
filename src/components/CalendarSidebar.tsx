// The calendar's sidebar: the things that have no duration.
//
// A month you can jump around in, the layers and what they hold, the deadlines
// coming at you, and the reminders left today. None of it belongs on the clock
// — a deadline takes no time, a layer is not an hour — and all of it is the
// context you read the grid against.
//
// It shares the page's day through the store rather than through props: the
// sidebar is fixed chrome and the surface is a page, so there is no component
// above both to hold "which Tuesday". Two copies of that is one too many.

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../lib/ipc'
import type { CalendarItem } from '../lib/ipc'
import { useApp } from '../store'
import { Icon } from '../lib/icons'
import { LAYERS, layerOf } from '../lib/calendarLayers'
import {
  DAY_MS,
  hhmm,
  startOfDay,
  startOfMonth,
  startOfWeek,
  windowFor,
} from '../lib/calendarWindow'

/// How far ahead a deadline is worth showing before it is simply "later".
const HORIZON_DAYS = 14
/// And how far back an unfinished one keeps shouting.
const OVERDUE_DAYS = 30

const dayKey = (ms: number) => startOfDay(new Date(ms)).getTime()

/// "today", "tomorrow", "Fri", "12 Oct" — the shortest true thing.
function whenSaid(at: number, now: number): string {
  const days = Math.round((dayKey(at) - dayKey(now)) / DAY_MS)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${-days}d ago`
  if (days < 7) return new Date(at).toLocaleDateString([], { weekday: 'short' })
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function CalendarSidebar() {
  const app = useApp()
  const { calView, calHidden } = app
  const anchor = useMemo(() => new Date(app.calAnchor), [app.calAnchor])
  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [err, setErr] = useState('')
  const now = Date.now()

  // One read, wide enough for everything on this panel: the month grid, the
  // deadline horizon behind and ahead, and whatever window the page itself is
  // showing — so the counts here and the grid there cannot disagree.
  const span = useMemo(() => {
    const page = windowFor(calView, anchor)
    const monthFrom = startOfWeek(startOfMonth(anchor))
    const monthTo = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 7)
    const from = Math.min(page.from.getTime(), monthFrom.getTime(), now - OVERDUE_DAYS * DAY_MS)
    const to = Math.max(page.to.getTime(), monthTo.getTime(), now + HORIZON_DAYS * DAY_MS)
    return { from, to, page }
    // `now` moves every render; the window it decides does not need to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calView, anchor])

  useEffect(() => {
    ipc
      .calendarRange(span.from, span.to)
      .then((r) => {
        setItems(r)
        setErr('')
      })
      .catch((e) => setErr(String(e)))
  }, [span])

  // Stable across renders, or every memo below it is decoration.
  const all = useMemo(() => items ?? [], [items])

  /// What each layer holds *in the window the page is showing* — not in this
  /// panel's wider read, which would tell you there are nine events on a day
  /// that has two.
  const counts = useMemo(() => {
    const from = span.page.from.getTime()
    const to = span.page.to.getTime()
    const m = new Map<string, number>()
    for (const i of all) {
      if (i.at < from || i.at > to) continue
      const l = layerOf(i)
      m.set(l, (m.get(l) ?? 0) + 1)
    }
    return m
  }, [all, span])

  /// How much is on each day of the month, for the dots under the grid.
  const perDay = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of all) m.set(dayKey(i.at), (m.get(dayKey(i.at)) ?? 0) + 1)
    return m
  }, [all])

  const deadlines = useMemo(
    () =>
      all
        .filter((i) => i.kind === 'deadline' && i.status !== 'done')
        .filter((i) => i.at <= now + HORIZON_DAYS * DAY_MS)
        .sort((a, b) => a.at - b.at)
        .slice(0, 6),
    [all, now],
  )

  const reminders = useMemo(
    () =>
      all
        .filter((i) => i.kind === 'schedule' && i.sort === 'reminder')
        .filter((i) => dayKey(i.at) === dayKey(now))
        .sort((a, b) => a.at - b.at),
    [all, now],
  )

  const weeks = useMemo(() => {
    const first = startOfWeek(startOfMonth(anchor))
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => new Date(first.getTime() + (w * 7 + d) * DAY_MS)),
    )
  }, [anchor])

  const month = anchor.getMonth()
  const todayKey = dayKey(now)
  const anchorKey = dayKey(anchor.getTime())

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-panel">
      {/* the month */}
      <div className="px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center gap-1">
          <span className="text-[12px] font-semibold text-ink">
            {anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </span>
          <span className="flex-1" />
          <button
            className="btn-ghost px-1 py-0 text-[11px]"
            title="Previous month"
            onClick={() =>
              app.setCalAnchor(new Date(anchor.getFullYear(), month - 1, 1).getTime())
            }
          >
            <Icon name="chevron-left" size={11} />
          </button>
          <button
            className="btn-ghost px-1 py-0 text-[11px]"
            title="Next month"
            onClick={() =>
              app.setCalAnchor(new Date(anchor.getFullYear(), month + 1, 1).getTime())
            }
          >
            <Icon name="chevron-right" size={11} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-y-0.5">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, n) => (
            <span key={n} className="text-center text-[9px] font-semibold text-faint">
              {d}
            </span>
          ))}
          {weeks.flat().map((d) => {
            const key = dayKey(d.getTime())
            const outside = d.getMonth() !== month
            const isAnchor = key === anchorKey
            const isToday = key === todayKey
            const n = perDay.get(key) ?? 0
            return (
              <button
                key={key}
                className={`flex h-[22px] flex-col items-center justify-center rounded text-[10px] ${
                  isAnchor
                    ? 'bg-indigo-500 font-bold text-white'
                    : isToday
                      ? 'text-ink ring-1 ring-inset ring-indigo-500/50'
                      : outside
                        ? 'text-faint'
                        : 'text-dim hover:bg-hover/50'
                }`}
                title={`${d.toLocaleDateString()} — ${n} thing${n === 1 ? '' : 's'}`}
                onClick={() => app.setCalAnchor(d.getTime())}
              >
                {d.getDate()}
                {/* How much is on that day, in three widths. A daily rhythm
                    puts something on every day of the month, so a mark that
                    means "anything at all" is on always and says nothing. */}
                <span
                  className={`mt-px h-[2px] rounded-full ${
                    n === 0 ? 'w-0' : n < 3 ? 'w-[4px]' : n < 6 ? 'w-[8px]' : 'w-[12px]'
                  } ${isAnchor ? 'bg-white/70' : n < 6 ? 'bg-line2' : 'bg-indigo-400'}`}
                />
              </button>
            )
          })}
        </div>
      </div>

      {err && <div className="px-3 pb-2 text-[11px] text-err">{err}</div>}

      {/* layers */}
      <div className="border-t border-line px-2 py-2">
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Layers
        </div>
        {LAYERS.map((l) => {
          const off = calHidden.includes(l.id)
          const n = counts.get(l.id) ?? 0
          return (
            <button
              key={l.id}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-[3px] text-left text-[11.5px] hover:bg-hover/50 ${
                off ? 'opacity-40' : ''
              }`}
              title={off ? `Show ${l.label}` : `Hide ${l.label}`}
              onClick={() => app.toggleCalLayer(l.id)}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${l.swatch}`} />
              <span className="min-w-0 flex-1 truncate text-dim">{l.label}</span>
              <span className="shrink-0 text-[10.5px] text-faint">{n || ''}</span>
            </button>
          )
        })}
      </div>

      {/* deadlines */}
      <div className="border-t border-line px-3 py-2">
        <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Deadlines
        </div>
        {items == null ? (
          <div className="text-[10.5px] text-faint">reading…</div>
        ) : deadlines.length === 0 ? (
          <div className="text-[10.5px] leading-[1.55] text-faint">
            Nothing due in the next fortnight. A work item gets a deadline from{' '}
            <span className="font-mono text-muted">due:</span> in the feature&rsquo;s work list.
          </div>
        ) : (
          deadlines.map((i) => {
            const late = i.at < now
            return (
              <button
                key={i.id}
                className="mb-2 block w-full text-left last:mb-0"
                title={`${i.title} · ${i.space}${i.feature ? ` · ${i.feature}` : ''} · ${i.status}`}
                onClick={() => {
                  app.setRailView('team')
                  app.setTeamTab('work')
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">
                    {i.title}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[9.5px] ${late ? 'text-err' : 'text-warn'}`}
                  >
                    {late ? 'overdue' : whenSaid(i.at, now)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted">
                  {i.space}
                  {i.feature ? ` · ${i.feature}` : ''}
                  {i.status === 'blocked' ? ' · ' : ''}
                  {i.status === 'blocked' && <span className="text-err">blocked</span>}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* reminders */}
      <div className="mt-auto border-t border-line px-3 py-2">
        <div className="flex items-center pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Reminders
          </span>
          <span className="flex-1" />
          <span className="text-[10px] text-faint">
            {reminders.length} today
          </span>
        </div>
        {reminders.length === 0 ? (
          <div className="text-[10.5px] text-faint">None today.</div>
        ) : (
          reminders.slice(0, 5).map((i) => {
            const done = i.at <= now
            return (
              <div key={i.id} className="flex items-center gap-2 py-[3px]">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    done ? 'bg-line2' : 'bg-amber-400'
                  }`}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[11px] ${done ? 'text-muted' : 'text-dim'}`}
                >
                  {i.title}
                </span>
                <span className="shrink-0 font-mono text-[9.5px] text-faint">{hhmm(i.at)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
