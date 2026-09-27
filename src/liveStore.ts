// High-frequency telemetry: service log lines and process stats.
//
// Kept out of `useApp` on purpose. Most of the shell reads `useApp()` with no
// selector, which subscribes to the whole store — so when every log line and
// every 2s stats sample was a write to it, each one re-rendered the entire
// shell, the rail and every panel in the (hidden) dock. That was the lag.
// Only the handful of views that actually show logs or stats subscribe here.
//
// Log lines are also batched: a busy service can emit hundreds a second, and
// copying a 5000-entry array per line is quadratic. Lines queue and land in
// one write per animation frame.
//
// Views that show a *summary* of the log — Home's error count and last six
// lines, a service page's last forty — read the derived fields below, not
// `logs`. They are kept up to date at flush time, so a flush that changes
// nothing a view shows does not re-render it.

import { create } from 'zustand'
import type { LogEntry, ProcStat } from './lib/types'

export const LOG_UI_LIMIT = 5000
/** Warn/error lines Home's issue feed shows, newest first. */
const ISSUE_LIMIT = 30
/** Lines Home's master-log card shows. */
const TAIL_LIMIT = 6
/** Lines a service page shows of its own output. */
const PER_SERVICE_LIMIT = 40

interface LiveState {
  logs: LogEntry[]
  /** Derived from `logs` at each flush; see the note above. */
  errorCount: number
  warnCount: number
  issues: LogEntry[]
  tail: LogEntry[]
  byService: Record<number, LogEntry[]>
  stats: ProcStat[]
  appendLog: (e: LogEntry) => void
  /** Replace the whole buffer (the backlog read at bootstrap). */
  setLogs: (logs: LogEntry[]) => void
  clearLogs: () => void
  /** Returns whether anything changed, so callers can skip follow-up work. */
  setStats: (s: ProcStat[]) => boolean
}

let pending: LogEntry[] = []
let flushQueued = false

// The derived views refresh a few times a second, not every frame. A summary
// card that updates 60 times a second reads the same as one that updates
// four, and Home re-renders each time its tail changes.
const DERIVE_EVERY_MS = 250
let sinceDerive: LogEntry[] = []
let droppedSinceDerive: LogEntry[] = []
let lastDerive = 0
let deriveTimer: ReturnType<typeof setTimeout> | undefined

// requestAnimationFrame pauses in a hidden window, and the queue must not grow
// without bound while it does — a timer fallback keeps it draining.
const schedule = (fn: () => void) => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    requestAnimationFrame(fn)
  } else {
    setTimeout(fn, 250)
  }
}

// Stats arrive as a fresh array every sample even when nothing moved. Compare
// by content so an idle machine costs no renders at all.
let lastStatsKey = ''

type Derived = Pick<LiveState, 'errorCount' | 'warnCount' | 'issues' | 'tail' | 'byService'>

const EMPTY: Derived = { errorCount: 0, warnCount: 0, issues: [], tail: [], byService: {} }

/** Everything from scratch — for a replaced or cleared buffer. */
function deriveAll(logs: LogEntry[]): Derived {
  return deriveNext(EMPTY, logs, [], logs)
}

/**
 * The derived fields after `batch` landed. `dropped` is what fell off the
 * front of the ring buffer, which only the counts have to know about — the
 * tails are re-read from `logs` when the batch touched them.
 */
function deriveNext(prev: Derived, batch: LogEntry[], dropped: LogEntry[], logs: LogEntry[]): Derived {
  let errorCount = prev.errorCount
  let warnCount = prev.warnCount
  for (const l of dropped) {
    if (l.level === 'error') errorCount -= 1
    else if (l.level === 'warn') warnCount -= 1
  }
  let anyIssue = false
  const touched = new Set<number>()
  for (const l of batch) {
    if (l.level === 'error') {
      errorCount += 1
      anyIssue = true
    } else if (l.level === 'warn') {
      warnCount += 1
      anyIssue = true
    }
    touched.add(l.service_id)
  }
  // Newest first, and only as many as the feed shows. Walked from the back so
  // a 5000-line buffer with thirty recent errors stops after thirty.
  let issues = prev.issues
  if (anyIssue || dropped.length > 0) {
    issues = []
    for (let i = logs.length - 1; i >= 0 && issues.length < ISSUE_LIMIT; i--) {
      const l = logs[i]
      if (l.level === 'error' || l.level === 'warn') issues.push(l)
    }
  }
  const tail = batch.length > 0 || dropped.length > 0 ? logs.slice(-TAIL_LIMIT) : prev.tail
  let byService = prev.byService
  if (touched.size > 0) {
    byService = { ...prev.byService }
    for (const id of touched) {
      const mine: LogEntry[] = []
      for (let i = logs.length - 1; i >= 0 && mine.length < PER_SERVICE_LIMIT; i--) {
        if (logs[i].service_id === id) mine.push(logs[i])
      }
      byService[id] = mine.reverse()
    }
  }
  return { errorCount, warnCount, issues, tail, byService }
}

function resetDerive() {
  pending = []
  sinceDerive = []
  droppedSinceDerive = []
  clearTimeout(deriveTimer)
  deriveTimer = undefined
}

function runDerive() {
  deriveTimer = undefined
  lastDerive = Date.now()
  const batch = sinceDerive
  const dropped = droppedSinceDerive
  sinceDerive = []
  droppedSinceDerive = []
  if (batch.length === 0 && dropped.length === 0) return
  useLive.setState((st) => deriveNext(st, batch, dropped, st.logs))
}

// Trailing-edge: the first flush after a quiet spell derives at once, a burst
// derives every DERIVE_EVERY_MS, and the last lines of a burst are never left
// waiting for a next one.
function scheduleDerive() {
  if (deriveTimer !== undefined) return
  const wait = Math.max(0, lastDerive + DERIVE_EVERY_MS - Date.now())
  deriveTimer = setTimeout(runDerive, wait)
}

export const useLive = create<LiveState>((set) => ({
  logs: [],
  ...EMPTY,
  stats: [],
  appendLog: (e) => {
    pending.push(e)
    if (flushQueued) return
    flushQueued = true
    schedule(() => {
      flushQueued = false
      const batch = pending
      pending = []
      if (batch.length === 0) return
      set((st) => {
        const merged = st.logs.concat(batch)
        const over = merged.length - LOG_UI_LIMIT
        const dropped = over > 0 ? merged.slice(0, over) : []
        const logs = over > 0 ? merged.slice(over) : merged
        sinceDerive = sinceDerive.concat(batch)
        droppedSinceDerive = droppedSinceDerive.concat(dropped)
        return { logs }
      })
      scheduleDerive()
    })
  },
  setLogs: (logs) => {
    resetDerive()
    set({ logs, ...deriveAll(logs) })
  },
  clearLogs: () => {
    resetDerive()
    set({ logs: [], ...EMPTY })
  },
  setStats: (stats) => {
    const key = JSON.stringify(stats)
    if (key === lastStatsKey) return false
    lastStatsKey = key
    set({ stats })
    return true
  },
}))
