// Which stretch of time a view is asking about.
//
// Day, week, month and year differ only in the window they ask for. That was
// already true inside the calendar page; it moved out here the moment the
// sidebar needed to ask the same question from outside it, because two
// functions computing "which Tuesday" is how a day and the month containing it
// start disagreeing.

export const DAY_MS = 86_400_000

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/// Weeks start on Monday: a working week that begins on Sunday puts the
/// weekend in two different rows.
export const startOfWeek = (d: Date) => {
  const s = startOfDay(d)
  const back = (s.getDay() + 6) % 7
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - back)
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
export const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1)

/// Every day from one to the other, stepped by the calendar rather than by
/// 86,400,000.
///
/// A day is not always that many milliseconds — the clocks change twice a year
/// — and dividing a span by a fixed day gave the month grid a stray thirty-sixth
/// cell containing the 5th of October on its own.
export function daysFrom(from: Date, to: Date): Date[] {
  const out: Date[] = []
  const d = startOfDay(from)
  while (d.getTime() <= to.getTime()) {
    out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

export type CalWindow = { from: Date; to: Date }

export function windowFor(view: 'day' | 'week' | 'month' | 'year', anchor: Date): CalWindow {
  if (view === 'day') {
    const from = startOfDay(anchor)
    return { from, to: new Date(from.getTime() + DAY_MS - 1) }
  }
  if (view === 'week') {
    const from = startOfWeek(anchor)
    return { from, to: new Date(from.getTime() + 7 * DAY_MS - 1) }
  }
  if (view === 'month') {
    // The grid shows whole weeks, so the window is the grid, not the month.
    const first = startOfMonth(anchor)
    const from = startOfWeek(first)
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
    const to = new Date(startOfWeek(last).getTime() + 7 * DAY_MS - 1)
    return { from, to }
  }
  const from = startOfYear(anchor)
  return { from, to: new Date(from.getFullYear(), 11, 31, 23, 59, 59, 999) }
}

export function step(view: 'day' | 'week' | 'month' | 'year', anchor: Date, by: number): Date {
  const d = new Date(anchor)
  if (view === 'day') d.setDate(d.getDate() + by)
  if (view === 'week') d.setDate(d.getDate() + by * 7)
  if (view === 'month') d.setMonth(d.getMonth() + by)
  if (view === 'year') d.setFullYear(d.getFullYear() + by)
  return d
}

export const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime()
