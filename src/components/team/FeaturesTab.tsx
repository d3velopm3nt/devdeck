// Features — every feature in every space, as a table you can filter.
//
// The same rows Goals groups; this one is for when you want the whole list at
// once, with who manages it and who is on it. A row is a thread, so clicking
// one opens the room.
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
import { FeatureThread } from './FeatureThread'
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

export function FeaturesTab({ board }: { board: Board }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const speakers = useSpeakers()

  const key = (g: GoalRow) => `${g.node_id}:${g.feature_id}`
  const rows = board.rows.filter(MATCH[filter])
  const current = board.rows.find((g) => key(g) === open)

  if (current) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <button
          className="flex shrink-0 items-center gap-1.5 border-b border-line px-5 py-1.5 text-left text-[11px] text-muted hover:text-ink"
          onClick={() => setOpen(null)}
        >
          <Icon name="chevron-left" size={12} /> All features
        </button>
        <div className="min-h-0 flex-1">
          <FeatureThread goal={current} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-5 py-2.5">
        {(Object.keys(LABEL) as Filter[]).map((f) => {
          const n = board.rows.filter(MATCH[f]).length
          return (
            <button
              key={f}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
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
        <span className="ml-auto text-[10.5px] text-faint">a row is a thread</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="grid grid-cols-[minmax(0,2fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] gap-3 px-4 py-2 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            <span>Feature</span>
            <span>Progress</span>
            <span>Managed by</span>
            <span>On it</span>
            <span>Last said</span>
          </div>
          {rows.length === 0 ? (
            <div className="border-t border-line px-4 py-6 text-center text-[11.5px] text-muted">
              {board.loaded ? 'Nothing matches that filter.' : 'Reading the board…'}
            </div>
          ) : (
            rows.map((g) => (
              <button
                key={key(g)}
                className="grid w-full grid-cols-[minmax(0,2fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] items-center gap-3 border-t border-line px-4 py-2.5 text-left hover:bg-hover/40"
                onClick={() => setOpen(key(g))}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                      goalGroup(g) === 'waiting'
                        ? 'bg-amber-400'
                        : goalGroup(g) === 'moving'
                          ? 'bg-emerald-400'
                          : 'bg-line3'
                    }`}
                  />
                  <span className="truncate text-[12.5px] text-ink">{g.feature_name}</span>
                  <span className="shrink-0 text-[10.5px] text-faint">{g.space}</span>
                </span>
                <span>
                  <span className="block h-[4px] overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full bg-emerald-500"
                      style={{
                        width: `${g.items_total ? Math.round((g.items_done / g.items_total) * 100) : 0}%`,
                      }}
                    />
                  </span>
                  <span className="mt-1 block text-[10px] text-faint">
                    {g.items_done} of {g.items_total}
                    {g.items_blocked > 0 && ` · ${g.items_blocked} blocked`}
                  </span>
                </span>
                <span className="truncate text-[10.5px] text-indigo-400">
                  {g.managed_by ?? <span className="text-faint">no manager</span>}
                </span>
                <span className="flex min-w-0 flex-wrap gap-1.5 text-[10.5px] text-muted">
                  {g.waiting > 0 && <span className="font-semibold text-warn">@you</span>}
                  {g.on_it.length === 0 && g.waiting === 0 ? (
                    <span className="text-faint">nobody yet</span>
                  ) : (
                    g.on_it.map((a) => <span key={a}>{speakers(a)}</span>)
                  )}
                </span>
                <span className="min-w-0 truncate text-[11px] text-muted">
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
                </span>
              </button>
            ))
          )}
        </div>
        <p className="mt-2.5 text-[10.5px] leading-[1.5] text-faint">
          Every feature in every space. “Managed by” is the bot whose plan it is — a feature made by
          hand has none until a bot adopts it.
        </p>
      </div>
    </div>
  )
}
