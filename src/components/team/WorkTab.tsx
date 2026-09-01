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
// Clicking a row opens the feature's thread, because that is where the item is
// being talked about.

import { useEffect, useState } from 'react'
import { useAiw } from '../../lib/aiwStore'
import type { GoalRow } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { useSpeakers } from '../thread/speakers'
import { FeatureThread } from './FeatureThread'
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

export function WorkTab({ board }: { board: Board }) {
  const a = useAiw()
  const [showDone, setShowDone] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
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
  const current = board.rows.find((g) => key(g) === open)
  if (current) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <button
          className="flex shrink-0 items-center gap-1.5 border-b border-line px-5 py-1.5 text-left text-[11px] text-muted hover:text-ink"
          onClick={() => setOpen(null)}
        >
          <Icon name="chevron-left" size={12} /> All work
        </button>
        <div className="min-h-0 flex-1">
          <FeatureThread goal={current} />
        </div>
      </div>
    )
  }

  const groups = a.allWork
    .map((f) => ({ ...f, items: f.items.filter((i) => showDone || i.status !== 'done') }))
    .filter((f) => f.items.length > 0)
  const openCount = a.allWork.flatMap((f) => f.items).filter((i) => i.status !== 'done').length
  const total = a.allWork.flatMap((f) => f.items).length

  /// The board row behind a feature, for the manager's name and the thread.
  const rowFor = (projectId: string, featureId: string): GoalRow | undefined =>
    board.rows.find((g) => String(g.node_id) === projectId && g.feature_id === featureId)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 py-2.5">
        <span className="text-[11px] text-muted">
          {openCount} open of {total}, across every space
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-indigo-500"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Show finished
        </label>
        <button className="btn-ghost text-[11px]" onClick={() => void a.loadAllWork()}>
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
        {a.allWork.length === 0 ? (
          <div className="py-10 text-center text-[12px] leading-relaxed text-muted">
            Nothing here yet, in any space. Work items come from a feature — a bot&rsquo;s plan makes
            one, and so does creating a feature by hand.
          </div>
        ) : groups.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-muted">
            {total} item{total === 1 ? '' : 's'}, all finished. Tick “show finished” to see them.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((f) => {
              const row = rowFor(f.project_id, f.feature_id)
              return (
                <div
                  key={`${f.project_id}:${f.feature_id}`}
                  className="overflow-hidden rounded-xl border border-line bg-panel"
                >
                  <button
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-hover/40"
                    disabled={!row}
                    onClick={() => row && setOpen(key(row))}
                  >
                    <span className="truncate text-[12.5px] font-semibold text-ink">
                      {f.feature_name}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-faint">
                      {f.project_name} · {f.items.filter((i) => i.status === 'done').length} of{' '}
                      {f.items.length}
                    </span>
                    {row?.managed_by && (
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-[10.5px] text-indigo-400">
                        <Icon name="bot" size={10} /> {row.managed_by} manages
                      </span>
                    )}
                  </button>
                  {f.items.map((i) => {
                    const by = held.get(i.id)
                    return (
                      <div
                        key={i.id}
                        className="flex items-center gap-2.5 border-t border-line px-4 py-1.5"
                      >
                        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${statusDot(i.status)}`} />
                        <span
                          className={`min-w-0 flex-1 truncate text-[12px] ${
                            i.status === 'done' ? 'text-muted line-through' : 'text-body'
                          }`}
                        >
                          {i.title}
                        </span>
                        {by ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 text-[10px] font-semibold text-ok">
                            {speakers(by)} has it
                          </span>
                        ) : i.assignee ? (
                          <span className="shrink-0 text-[10.5px] text-muted">{i.assignee}</span>
                        ) : (
                          <span className="shrink-0 rounded-full border border-line px-2 text-[10px] text-faint">
                            nobody yet
                          </span>
                        )}
                        <span className="w-[74px] shrink-0 text-right text-[10.5px] text-faint">
                          {i.status || 'unclaimed'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-2.5 text-[10.5px] leading-[1.5] text-faint">
          “Has it” is a live claim; “nobody yet” means the item is unclaimed. Work items live in each
          feature&rsquo;s work.md in the vault — editing that file changes this.
        </p>
      </div>
    </div>
  )
}
