// Two things at the same time sit beside each other, not on top.
//
// Its own file because it is the one piece of the day view that is pure
// arithmetic over times — no React, no colours, no store — and so it is the
// one piece that can be checked without an app, a window or a screenshot.

import type { CalendarItem } from './ipc'

/// One thing at one time, laid out: which of the side-by-side columns it
/// takes, and how many there are to share.
export type Placed = { i: CalendarItem; col: number; cols: number }

/// Overlapping items sit beside each other rather than on top of each other.
///
/// Clusters first — a run of items that touch, directly or through a
/// neighbour — then greedy columns inside each cluster. The width is decided
/// per cluster and not per day, so one 8am collision does not squeeze the
/// afternoon into narrow strips.
export function place(items: CalendarItem[], minMs: number): Placed[] {
  const sorted = [...items].sort((a, b) => a.at - b.at || b.end - a.end)
  const out: Placed[] = []
  let cluster: Array<{ i: CalendarItem; col: number }> = []
  let ends: number[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    const cols = ends.length
    for (const c of cluster) out.push({ i: c.i, col: c.col, cols })
    cluster = []
    ends = []
    clusterEnd = -Infinity
  }

  for (const i of sorted) {
    const end = Math.max(i.end, i.at + minMs)
    if (i.at >= clusterEnd && cluster.length > 0) flush()
    let col = ends.findIndex((e) => e <= i.at)
    if (col === -1) {
      ends.push(end)
      col = ends.length - 1
    } else {
      ends[col] = end
    }
    cluster.push({ i, col })
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length > 0) flush()
  return out
}

