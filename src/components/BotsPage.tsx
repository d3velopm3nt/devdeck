// Bots: one per space that needs one, and not every folder does.
//
// A bot is `_bot.md` in a vault folder — a name, a goal, and when it wakes.
// That is the whole entity. Everything else on this page is borrowed from
// something that already existed:
//
//   * its **heartbeat** is a `schedules` row (`bots.rs` keeps it in step with
//     the file, and the file wins),
//   * its **agents** are the AI sessions running on that node,
//   * its **issues** are the approvals and conflicts already in the inbox.
//
// So there is no bot task list and no bot notification stream. A second place
// that tells you something needs you is how the first one stops being read.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds, workspaceOf } from '../lib/tree'
import { FocusStart } from './FocusBar'

const EVERY = [
  { id: '', label: 'Never — no heartbeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Certain days' },
  { id: 'hourly', label: 'Every hour' },
]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const toMin = (v: string) => {
  const [h, m] = v.split(':')
  return Math.min(1439, Math.max(0, (Number(h) || 0) * 60 + (Number(m) || 0)))
}

/** When it wakes, said the way a person would say it. */
function routine(b: ipc.Bot): string {
  if (!b.every) return 'No heartbeat'
  if (b.every === 'hourly') return 'Every hour'
  const at = hhmm(b.at_min)
  if (b.every === 'daily') return `Daily at ${at}`
  if (b.every === 'weekdays') return `Weekdays at ${at}`
  const names = b.days
    .split(',')
    .map((d) => DAYS[Number(d.trim())])
    .filter(Boolean)
  return names.length ? `${names.join(' / ')} at ${at}` : `Weekly at ${at}`
}

type Draft = {
  nodeId: number
  name: string
  goal: string
  every: string
  at: string
  days: string[]
  body: string
  existing: boolean
}

export function BotsPage() {
  const { bots, refreshBots, nodes, activeWorkspaceId, focus, setRailView } = useApp()
  const aiw = useAiw()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [startFocusFor, setStartFocusFor] = useState<ipc.Bot | null>(null)

  useEffect(() => {
    void refreshBots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bots in the workspace you are in. A bot in another workspace is not
  // hidden — you switch to it, the same as everything else.
  const inWorkspace = useMemo(() => {
    if (activeWorkspaceId == null) return bots
    const ids = new Set(subtreeIds(nodes, activeWorkspaceId))
    return bots.filter((b) => ids.has(b.node_id))
  }, [bots, nodes, activeWorkspaceId])

  // Folders that could have one. A workspace cannot: a bot is for a thing you
  // are trying to do, and a workspace is where things live.
  const candidates = useMemo(() => {
    if (activeWorkspaceId == null) return []
    const ids = new Set(subtreeIds(nodes, activeWorkspaceId))
    const taken = new Set(bots.map((b) => b.node_id))
    return nodes.filter((n) => ids.has(n.id) && n.id !== activeWorkspaceId && !taken.has(n.id))
  }, [nodes, bots, activeWorkspaceId, bots.length])

  /** Its issues, borrowed rather than invented. */
  const trouble = (nodeId: number) => {
    const ids = new Set(subtreeIds(nodes, nodeId))
    const mine = (projectId: string | null | undefined) => {
      const id = Number(projectId)
      return Number.isFinite(id) && ids.has(id)
    }
    return {
      waiting: aiw.approvals.filter((r) => mine(r.project_id)).length,
      conflicts: aiw.conflicts.filter((c) => !c.resolved && mine(c.project_id)).length,
      working: aiw.sessions.filter(
        (s) => mine(s.project_id) && (s.status === 'working' || s.status === 'planning'),
      ).length,
      blocked: aiw.sessions.filter((s) => mine(s.project_id) && s.status === 'blocked').length,
    }
  }

  const open = (b: ipc.Bot) =>
    setDraft({
      nodeId: b.node_id,
      name: b.name,
      goal: b.goal,
      every: b.every,
      at: hhmm(b.at_min),
      days: b.days ? b.days.split(',').map((d) => d.trim()).filter(Boolean) : [],
      body: b.body,
      existing: true,
    })

  const create = (nodeId: number) => {
    const n = findNode(nodes, nodeId)
    setDraft({
      nodeId,
      name: `${n?.name ?? 'New'} bot`,
      goal: '',
      every: 'weekdays',
      at: '07:00',
      days: [],
      body: '',
      existing: false,
    })
  }

  const save = async () => {
    if (!draft) return
    setError('')
    try {
      await ipc.botSave({
        nodeId: draft.nodeId,
        name: draft.name,
        goal: draft.goal,
        every: draft.every,
        atMin: toMin(draft.at),
        days: draft.days.join(','),
        body: draft.body,
      })
      await refreshBots()
      setDraft(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const remove = async () => {
    if (!draft?.existing) return
    setError('')
    try {
      await ipc.botDelete(draft.nodeId)
      await refreshBots()
      setDraft(null)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Bots</h2>
          <p className="text-[11.5px] text-muted">One per space that needs one.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {candidates.length > 0 && (
            <select
              className="input w-[190px] text-[11.5px]"
              value=""
              onChange={(e) => e.target.value && create(Number(e.target.value))}
            >
              <option value="">New bot for…</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {inWorkspace.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="bot" size={26} className="text-faint" />
            <div className="text-[12.5px] text-dim">No bots here yet</div>
            <div className="max-w-[400px] text-[11.5px] leading-relaxed text-muted">
              A bot is a goal, a heartbeat and the agents working on it — written as{' '}
              <code className="text-dim">_bot.md</code> in the folder it runs, so it travels with
              it. Give one to a space you are actually trying to move.
            </div>
          </div>
        ) : (
          inWorkspace.map((b) => {
            const node = findNode(nodes, b.node_id)
            const ws = workspaceOf(nodes, node)
            const t = trouble(b.node_id)
            const focused = focus?.node_id === b.node_id
            return (
              <div key={b.node_id} className="border-b border-line px-5 py-3.5">
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-[9.5px] font-bold text-black/80"
                    style={{ background: node ? nodeColor(node) : undefined }}
                  >
                    {avatarLabel(b.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="text-[13px] font-semibold text-ink hover:text-indigo-400"
                        onClick={() => open(b)}
                      >
                        {b.name}
                      </button>
                      {ws?.label && (
                        <span className="shrink-0 rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
                          {ws.label}
                        </span>
                      )}
                      <span className="shrink-0 text-[10.5px] text-faint">{b.node_name}</span>
                      {focused && (
                        <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 text-[9.5px] font-semibold text-indigo-400">
                          focused
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-[12px] leading-[1.5] text-body">{b.goal}</div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px] text-muted">
                      <span className="flex items-center gap-1.5">
                        <Icon name="schedule" size={11} className={b.every ? 'text-ok' : 'text-faint'} />
                        {routine(b)}
                      </span>
                      {b.last_woke && (
                        <span className="text-faint">
                          last woke {new Date(b.last_woke).toLocaleString()}
                        </span>
                      )}
                      {t.working > 0 && <span className="text-ok">{t.working} working</span>}
                      {t.blocked > 0 && <span className="text-err">{t.blocked} blocked</span>}
                      {t.waiting > 0 && (
                        <button className="text-warn hover:underline" onClick={() => setRailView('inbox')}>
                          {t.waiting} needs you
                        </button>
                      )}
                      {t.conflicts > 0 && (
                        <button className="text-warn hover:underline" onClick={() => setRailView('inbox')}>
                          {t.conflicts} disagreement{t.conflicts === 1 ? '' : 's'}
                        </button>
                      )}
                      {t.working + t.blocked + t.waiting + t.conflicts === 0 && (
                        <span className="text-faint">nothing needs you</span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!focus && b.goal && (
                      <button
                        className="btn-ghost text-[11px]"
                        title="Hold everything outside this space until you are done"
                        onClick={() => setStartFocusFor(b)}
                      >
                        <Icon name="focus" size={11} /> Focus
                      </button>
                    )}
                    <button className="btn-ghost text-[11px]" onClick={() => open(b)}>
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {startFocusFor && (
        <FocusStart
          goal={startFocusFor.goal}
          nodeId={startFocusFor.node_id}
          onClose={() => setStartFocusFor(null)}
        />
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]"
          onClick={() => setDraft(null)}
        >
          <div
            className="flex max-h-[76vh] w-[520px] flex-col rounded-xl border border-line2 bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <span className="flex h-[24px] w-[24px] items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400">
                <Icon name="bot" size={13} />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink">
                  {draft.existing ? draft.name : `A bot for ${findNode(nodes, draft.nodeId)?.name ?? ''}`}
                </div>
                <div className="truncate text-[10.5px] text-muted">
                  Written to <code>_bot.md</code> in that folder
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
              <div>
                <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Called
                </label>
                <input
                  className="input text-[12.5px]"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Its goal
                </label>
                <input
                  className="input text-[12.5px]"
                  placeholder="Ship the demo on 12 September"
                  value={draft.goal}
                  onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                />
                <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
                  Required. Without one it has nothing to judge a suggestion against, and a bot that
                  suggests things for no stated reason is one you stop reading.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Wakes
                </label>
                <div className="flex items-center gap-2">
                  <select
                    className="input flex-1 text-[12px]"
                    value={draft.every}
                    onChange={(e) => setDraft({ ...draft, every: e.target.value })}
                  >
                    {EVERY.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {draft.every && draft.every !== 'hourly' && (
                    <input
                      type="time"
                      className="input w-[110px] text-[12px]"
                      value={draft.at}
                      onChange={(e) => setDraft({ ...draft, at: e.target.value })}
                    />
                  )}
                </div>

                {draft.every === 'weekly' && (
                  <div className="mt-2 flex gap-1">
                    {DAYS.map((d, i) => {
                      const on = draft.days.includes(String(i))
                      return (
                        <button
                          key={d}
                          className={`flex-1 rounded py-1 text-[10px] ${
                            on ? 'bg-indigo-500/20 text-indigo-300' : 'bg-soft text-muted'
                          }`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              days: on
                                ? draft.days.filter((x) => x !== String(i))
                                : [...draft.days, String(i)],
                            })
                          }
                        >
                          {d}
                        </button>
                      )
                    })}
                  </div>
                )}

                <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
                  Waking reads the space and writes at most one line to your inbox — and nothing at
                  all when there is nothing to say. It does not run an agent: that needs a standing
                  grant the permission model does not offer yet.
                </p>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  What it is for, in your words
                </label>
                <textarea
                  className="input min-h-[110px] flex-1 resize-none font-mono text-[11.5px] leading-[1.6]"
                  placeholder={'Cares about the three repos that ship together.\nDo not touch anything on a Friday.'}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>

              {error && <div className="text-[11.5px] text-err">{error}</div>}
            </div>

            <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
              <button className="btn-primary text-[12px]" onClick={() => void save()}>
                {draft.existing ? 'Save' : 'Make it'}
              </button>
              <button className="btn-ghost text-[12px]" onClick={() => setDraft(null)}>
                Cancel
              </button>
              {draft.existing && (
                <button className="btn-danger ml-auto text-[12px]" onClick={() => void remove()}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
