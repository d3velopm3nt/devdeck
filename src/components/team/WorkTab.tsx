// Work — every open item, everywhere, grouped by the feature it belongs to.
//
// The Features tab answers "what is there". This answers the question you have
// when a bot has been running overnight: what moved, what is stuck, and who
// has it. Answering that by opening features one at a time is how you stop
// asking.
//
// **"Has it" is a live claim, not a status.** An item that says `in-progress`
// and names nobody is a different thing from one an agent is holding right
// now, and the difference is the whole point of showing both.
//
// The list stays; the thread beside it changes. An item and its feature select
// together, because the item has no room of its own — the feature *is* the
// room, and that is where the item is being talked about.

import { useEffect, useState } from 'react'
import { useAiw } from '../../lib/aiwStore'
import type { GoalRow } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { useSpeakers } from '../thread/speakers'
import type { Board } from './TeamPage'

/// Colour per status. Blocked is the only warm one: it is the only status
/// that is asking you for something.
function statusDot(status: string): string {
  if (status === 'done') return 'bg-line3'
  if (status === 'blocked') return 'bg-amber-400'
  if (status === 'in-progress') return 'bg-emerald-400'
  if (status === 'claimed') return 'bg-indigo-400'
  return 'bg-line2'
}

export function WorkList({
  board,
  picked,
  onPick,
}: {
  board: Board
  picked: string | null
  onPick: (key: string) => void
}) {
  const a = useAiw()
  const [showDone, setShowDone] = useState(false)
  const speakers = useSpeakers()

  useEffect(() => {
    void a.loadAllWork()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only claims still held. A released claim naming an agent who finished
  // hours ago reads exactly like one being worked on now.
  const held = new Map(
    a.claims
      .filter((c) => c.status === 'active' && c.work_item_id)
      .map((c) => [c.work_item_id as string, c.agent_id]),
  )

  const key = (g: { node_id: number; feature_id: string }) => `${g.node_id}:${g.feature_id}`

  const groups = a.allWork
    .map((f) => ({ ...f, items: f.items.filter((i) => showDone || i.status !== 'done') }))
    .filter((f) => f.items.length > 0)
  const openCount = a.allWork.flatMap((f) => f.items).filter((i) => i.status !== 'done').length
  const total = a.allWork.flatMap((f) => f.items).length

  /// The board row behind a feature, for the manager's name and the thread.
  const rowFor = (projectId: string, featureId: string): GoalRow | undefined =>
    board.rows.find((g) => String(g.node_id) === projectId && g.feature_id === featureId)

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[10.5px] text-muted">
          {openCount} open of {total}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[10.5px] text-muted">
          <input
            type="checkbox"
            className="h-3 w-3 accent-indigo-500"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Finished
        </label>
        <button
          className="text-muted hover:text-ink"
          title="Read the work again"
          onClick={() => void a.loadAllWork()}
        >
          <Icon name="update" size={11} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {a.allWork.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11.5px] leading-relaxed text-muted">
            Nothing here yet, in any space. Work items come from a feature — a bot&rsquo;s plan makes
            one, and so does creating a feature by hand.
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11.5px] text-muted">
            {total} item{total === 1 ? '' : 's'}, all finished. Tick &ldquo;finished&rdquo; to see
            them.
          </div>
        ) : (
          groups.map((f) => {
            const row = rowFor(f.project_id, f.feature_id)
            const on = row != null && picked === key(row)
            return (
              <div key={`${f.project_id}:${f.feature_id}`} className="mb-1">
                <button
                  className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left ${
                    on ? 'bg-hover' : 'hover:bg-hover/50'
                  }`}
                  disabled={!row}
                  title={row ? 'Open its thread' : 'This feature is not on the board'}
                  onClick={() => row && onPick(key(row))}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">
                    {f.feature_name}
                  </span>
                  <span className="shrink-0 text-[10px] text-faint">
                    {f.items.filter((i) => i.status === 'done').length}/{f.items.length}
                  </span>
                </button>
                <div className="px-2.5 pb-1 text-[10px] text-faint">
                  {f.project_name}
                  {row?.managed_by && (
                    <span className="text-indigo-400"> · {row.managed_by} manages</span>
                  )}
                </div>

                {f.items.map((i) => {
                  const by = held.get(i.id)
                  return (
                    <button
                      key={i.id}
                      className="flex w-full items-center gap-2 rounded px-2.5 py-1 text-left hover:bg-hover/40"
                      disabled={!row}
                      onClick={() => row && onPick(key(row))}
                    >
                      <span
                        className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusDot(i.status)}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[11.5px] ${
                          i.status === 'done' ? 'text-muted line-through' : 'text-body'
                        }`}
                      >
                        {i.title}
                      </span>
                      {by ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 text-[9.5px] font-semibold text-ok">
                          {speakers(by)}
                        </span>
                      ) : i.assignee ? (
                        <span className="shrink-0 text-[10px] text-muted">{i.assignee}</span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-faint">nobody</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-2 text-[10px] leading-[1.5] text-faint">
        A name in green is a live claim; &ldquo;nobody&rdquo; means unclaimed. Items live in each
        feature&rsquo;s work.md in the vault.
      </div>
    </>
  )
}
