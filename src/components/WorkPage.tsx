// What is actually being worked on, across every feature at once.
//
// On the rail rather than inside the Assistant, because "what are my bots and
// agents doing" is a question you ask *about* the app, not a question you ask
// the Assistant. It reads the AI Workspace's store either way — the store is
// not the Assistant, it is where this knowledge lives.

import { useEffect, useState } from 'react'
import { useAiw } from '../lib/aiwStore'
import { Icon } from '../lib/icons'

/// What is actually being worked on, across every feature at once.
///
/// The Features page answers "what is there"; a feature page answers "what is
/// in this one". Neither answers the question you have when a bot has been
/// running overnight — what moved, what is stuck, and who has it — and
/// answering that by opening features one at a time is how you stop asking.
///
/// Claims are shown beside the item rather than on their own page: an item
/// that says `in-progress` and names nobody is a different thing from one an
/// agent is holding right now, and the difference is the whole point.
export function WorkPage() {
  const a = useAiw()
  const [done, setDone] = useState(false)

  useEffect(() => {
    void a.loadAllWork()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.projectId])

  // Only claims still held. `aiw_claims` can be asked for all of them, and a
  // released claim naming an agent who finished hours ago reads exactly like
  // one being worked on now.
  const held = new Map(
    a.claims
      .filter((c) => c.status === 'active' && c.work_item_id)
      .map((c) => [c.work_item_id as string, c.agent_id]),
  )
  const groups = a.allWork
    .map((f) => ({ ...f, items: f.items.filter((i) => done || i.status !== 'done') }))
    .filter((f) => f.items.length > 0)
  const open = a.allWork.flatMap((f) => f.items).filter((i) => i.status !== 'done').length
  const total = a.allWork.flatMap((f) => f.items).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Work</h2>
          <p className="text-[11.5px] text-muted">
            Every work item in this space, and who is holding it.
          </p>
        </div>
        <div className="ml-auto">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-indigo-500"
                checked={done}
                onChange={(e) => setDone(e.target.checked)}
              />
              Show finished
            </label>
            <button className="btn-ghost text-[11px]" onClick={() => void a.loadAllWork()}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {a.allWork.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-muted">
            Nothing here yet, in any space. Work items come from a feature — a bot&rsquo;s plan
            makes one, and
            so does creating a feature by hand.
          </div>
        ) : groups.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-muted">
            {total} item{total === 1 ? '' : 's'}, all finished. Tick &ldquo;show finished&rdquo; to
            see them.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((f) => (
              <div key={f.feature_id} className="overflow-hidden rounded-xl border border-line bg-panel">
                <button
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-hover/40"
                  onClick={() => {
                    void a.selectFeature(f.feature_id)
                    a.setPage('feature')
                  }}
                >
                  <Icon name="list" size={13} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                    {f.feature_name}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-faint">{f.status}</span>
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
                          {by} has it
                        </span>
                      ) : (
                        i.assignee && (
                          <span className="shrink-0 text-[10.5px] text-muted">{i.assignee}</span>
                        )
                      )}
                      <span className="w-[74px] shrink-0 text-right text-[10.5px] text-faint">
                        {i.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-5 py-2 text-[10.5px] text-faint">
        {open} open of {total}, across every space. Work items live in each feature&rsquo;s
        `work.md` in the vault —
        editing that file changes this.
      </div>
    </div>
  )
}

/// Colour per status. Blocked is the only warm one: it is the only status that
/// is asking you for something.
function statusDot(status: string): string {
  if (status === 'done') return 'bg-line3'
  if (status === 'blocked') return 'bg-amber-400'
  if (status === 'in-progress') return 'bg-emerald-400'
  if (status === 'claimed') return 'bg-indigo-400'
  return 'bg-line2'
}

