// Goals — every space, right now, grouped by goal rather than by bot.
//
// A bot on two goals appears twice, which is the point: the thing you are
// trying to move is the goal, and "which bot owns it" is an answer to a
// different question.
//
// Three groups, ranked: **Waiting on you** first because it has a person in
// it, then **Moving**, then **Quiet**. A board where a blocked approval sits
// under a green progress bar is one that teaches you to skim past the
// approval.
//
// Selecting a goal opens its thread — the feature *is* the room, so there is
// nowhere else for it to go.

import { useState } from 'react'
import type { GoalRow } from '../../lib/aiw'
import { goalGroup } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { fmtAgo } from '../../lib/time'
import { useSpeakers } from '../thread/speakers'
import { FeatureThread } from './FeatureThread'
import type { Board } from './TeamPage'
import { CAPTURE_GOAL } from '../../lib/devCapture'

const GROUPS: { id: 'waiting' | 'moving' | 'quiet'; label: string }[] = [
  { id: 'moving', label: 'Moving' },
  { id: 'waiting', label: 'Waiting on you' },
  { id: 'quiet', label: 'Quiet' },
]

export function Goals({ board }: { board: Board }) {
  const first = board.rows[0]
  const [picked, setPicked] = useState<string | null>(CAPTURE_GOAL || null)
  const speakers = useSpeakers()

  const key = (g: GoalRow) => `${g.node_id}:${g.feature_id}`
  const current = board.rows.find((g) => key(g) === picked) ?? (picked ? undefined : first)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
          {board.loaded && board.rows.length === 0 && !board.error && (
            <div className="px-3 py-8 text-center text-[11.5px] leading-relaxed text-muted">
              No goals yet, in any space. A goal is a feature in a node&rsquo;s deck — a bot&rsquo;s
              plan makes one, and so does creating a feature by hand.
            </div>
          )}
          {!board.loaded && (
            <div className="px-3 py-8 text-center text-[11.5px] text-muted">Reading the board…</div>
          )}

          {GROUPS.map(({ id, label }) => {
            const rows = board.rows.filter((g) => goalGroup(g) === id)
            if (rows.length === 0) return null
            return (
              <div key={id}>
                <div className="px-3 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
                  {label}
                </div>
                {rows.map((g) => {
                  const on = current && key(current) === key(g)
                  return (
                    <button
                      key={key(g)}
                      className={`flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left ${
                        on ? 'bg-hover' : 'hover:bg-hover/50'
                      }`}
                      onClick={() => setPicked(key(g))}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                          {g.feature_name}
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">{g.space}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {g.managed_by && (
                          <span className="flex items-center gap-1 text-[10.5px] text-indigo-400">
                            <Icon name="bot" size={10} />
                            {g.managed_by}
                          </span>
                        )}
                        {g.on_it.map((a) => (
                          <span key={a} className="flex items-center gap-1 text-[10.5px] text-muted">
                            <span className="h-[6px] w-[6px] rounded-full bg-emerald-400" />
                            {speakers(a)}
                          </span>
                        ))}
                        {g.waiting > 0 && (
                          <span className="text-[10.5px] font-semibold text-warn">@you</span>
                        )}
                        {g.conflicts > 0 && (
                          <span className="text-[10.5px] text-warn">
                            {g.conflicts} disagreement{g.conflicts === 1 ? '' : 's'}
                          </span>
                        )}
                        {g.items_total > 0 && (
                          <span className="ml-auto shrink-0 text-[10px] text-faint">
                            {g.items_done} of {g.items_total}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10.5px] text-muted">
                        {g.last_said
                          ? `${g.last_by ? `${speakers(g.last_by)}: ` : ''}${g.last_said}`
                          : 'nothing said in its thread yet'}
                        {g.last_at && (
                          <span className="text-faint">
                            {' · '}
                            {fmtAgo(Date.parse(g.last_at), Date.now())}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="shrink-0 border-t border-line px-4 py-2 text-[10px] leading-[1.5] text-faint">
          Grouped by goal, not by bot. A bot on two goals appears twice.
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {current ? (
          <FeatureThread goal={current} />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-[12px] text-muted">
            Pick a goal to open its thread.
          </div>
        )}
      </div>
    </div>
  )
}
