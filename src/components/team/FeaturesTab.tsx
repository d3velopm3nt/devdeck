// Features — every feature in every space, as a list beside its thread.
//
// The same rows Goals groups; this one is the flat list, filtered, for when
// you want to find one rather than be shown what matters. It was a five-column
// table that swapped itself out for a thread when you clicked a row, so reading
// two features meant going back, finding your place, and clicking again. The
// list stays where it is now and the thread changes beside it.
//
// The filters are the states worth acting on rather than the statuses the deck
// happens to record: *Moving*, *Waiting on you*, *Nobody on it*, *Quiet*,
// *Done*. "Nobody on it" is the one that earns its place — a feature with a
// plan and no one working it is invisible in every other view.

import { useState } from 'react'
import type { GoalRow } from '../../lib/aiw'
import { goalGroup } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { fmtAgo } from '../../lib/time'
import { useSpeakers } from '../thread/speakers'
import type { Board } from './TeamPage'

type Filter = 'all' | 'moving' | 'waiting' | 'nobody' | 'quiet' | 'done'

const done = (g: GoalRow) => g.items_total > 0 && g.items_done === g.items_total

const MATCH: Record<Filter, (g: GoalRow) => boolean> = {
  all: () => true,
  moving: (g) => goalGroup(g) === 'moving',
  waiting: (g) => goalGroup(g) === 'waiting',
  nobody: (g) => g.on_it.length === 0 && !done(g),
  quiet: (g) => goalGroup(g) === 'quiet' && !done(g),
  done,
}

const LABEL: Record<Filter, string> = {
  all: 'All',
  moving: 'Moving',
  waiting: 'Waiting on you',
  nobody: 'Nobody on it',
  quiet: 'Quiet',
  done: 'Done',
}

export function FeaturesList({
  board,
  picked,
  onPick,
}: {
  board: Board
  picked: string | null
  onPick: (key: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const speakers = useSpeakers()

  const key = (g: GoalRow) => `${g.node_id}:${g.feature_id}`
  const rows = board.rows.filter(MATCH[filter])

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-2">
        {(Object.keys(LABEL) as Filter[]).map((f) => {
          const n = board.rows.filter(MATCH[f]).length
          return (
            <button
              key={f}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
                filter === f
                  ? 'border-line2 bg-raise text-ink'
                  : 'border-line text-muted hover:text-dim'
              }`}
              onClick={() => setFilter(f)}
            >
              {LABEL[f]} {n}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center text-[11.5px] text-muted">
            {board.loaded ? 'Nothing matches that filter.' : 'Reading the board…'}
          </div>
        )}
        {rows.map((g) => {
          const on = picked === key(g)
          const pct = g.items_total ? Math.round((g.items_done / g.items_total) * 100) : 0
          return (
            <button
              key={key(g)}
              className={`flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left ${
                on ? 'bg-hover' : 'hover:bg-hover/50'
              }`}
              onClick={() => onPick(key(g))}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                    goalGroup(g) === 'waiting'
                      ? 'bg-amber-400'
                      : goalGroup(g) === 'moving'
                        ? 'bg-emerald-400'
                        : 'bg-line3'
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {g.feature_name}
                </span>
                <span className="shrink-0 text-[10px] text-faint">{g.space}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="block h-[4px] flex-1 overflow-hidden rounded-full bg-line">
                  <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </span>
                <span className="shrink-0 text-[10px] text-faint">
                  {g.items_done} of {g.items_total}
                  {g.items_blocked > 0 && (
                    <span className="text-warn"> · {g.items_blocked} blocked</span>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {g.managed_by ? (
                  <span className="flex items-center gap-1 text-[10.5px] text-indigo-400">
                    <Icon name="bot" size={10} />
                    {g.managed_by}
                  </span>
                ) : (
                  <span className="text-[10.5px] text-faint">no manager</span>
                )}
                {g.waiting > 0 && <span className="text-[10.5px] font-semibold text-warn">@you</span>}
                {g.on_it.map((a) => (
                  <span key={a} className="flex items-center gap-1 text-[10.5px] text-muted">
                    <span className="h-[6px] w-[6px] rounded-full bg-emerald-400" />
                    {speakers(a)}
                  </span>
                ))}
                {g.on_it.length === 0 && g.waiting === 0 && !done(g) && (
                  <span className="text-[10.5px] text-faint">nobody on it</span>
                )}
              </div>

              <div className="truncate text-[10.5px] text-muted">
                {g.last_said ? (
                  <>
                    {g.last_by && <span className="text-dim">{speakers(g.last_by)}: </span>}
                    {g.last_said}
                    {g.last_at && (
                      <span className="text-faint">
                        {' · '}
                        {fmtAgo(Date.parse(g.last_at), Date.now())}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-faint">no thread yet</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-2 text-[10px] leading-[1.5] text-faint">
        &ldquo;Managed by&rdquo; is the bot whose plan it is — a feature made by hand has none until
        a bot adopts it.
      </div>
    </>
  )
}
