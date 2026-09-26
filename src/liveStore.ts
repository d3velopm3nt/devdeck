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

import { create } from 'zustand'
import type { LogEntry, ProcStat } from './lib/types'

export const LOG_UI_LIMIT = 5000

interface LiveState {
  logs: LogEntry[]
  stats: ProcStat[]
  appendLog: (e: LogEntry) => void
  clearLogs: () => void
  /** Returns whether anything changed, so callers can skip follow-up work. */
  setStats: (s: ProcStat[]) => boolean
}

let pending: LogEntry[] = []
let flushQueued = false

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

export const useLive = create<LiveState>((set) => ({
  logs: [],
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
        return { logs: merged.length > LOG_UI_LIMIT ? merged.slice(-LOG_UI_LIMIT) : merged }
      })
    })
  },
  clearLogs: () => {
    pending = []
    set({ logs: [] })
  },
  setStats: (stats) => {
    const key = JSON.stringify(stats)
    if (key === lastStatsKey) return false
    lastStatsKey = key
    set({ stats })
    return true
  },
}))
