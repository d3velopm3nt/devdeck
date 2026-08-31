// Bots: one per space that needs one, and not every folder does.
//
// This is the index. A bot itself opens as a document in the dock, the same as
// everything else a folder offers — a bot is a file in a folder, so it should
// not need a rail view of its own to be looked at.
//
// Nothing on this page is a new stream. Its heartbeat is a `schedules` row, its
// agents are the sessions already running on that node, and anything that needs
// you is already in the inbox. A second place that says an agent is waiting is
// how the first one stops being read.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds, workspaceOf } from '../lib/tree'
import { progress, routine } from '../lib/bots'
import { openBot } from '../lib/dock'
import { FocusStart } from './FocusBar'
import { BotCreate } from './bot/BotCreate'
import { grantsFor } from './bot/BotGrants'
import { CAPTURE_BOT_MODAL } from '../lib/devCapture'

export function BotsPage() {
  const { bots, refreshBots, nodes, activeWorkspaceId, focus, setRailView, services, commands } =
    useApp()
  const [dismissedProposal, setDismissedProposal] = useState(false)
  const aiw = useAiw()
  const [creating, setCreating] = useState<{ nodeId?: number } | null>(
    CAPTURE_BOT_MODAL === 'create' ? {} : null,
  )
  const [startFocusFor, setStartFocusFor] = useState<ipc.Bot | null>(null)
  const [work, setWork] = useState<Record<number, ipc.BotWork[]>>({})

  useEffect(() => {
    void refreshBots()
    // A bot that names an agent but has no standing grants will wake, refuse
    // everything and achieve nothing. That is worth seeing from the list.
    void aiw.refreshGrants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bots in the workspace you are in. A bot elsewhere is not hidden — you
  // switch to that workspace, the same as everything else.
  const inWorkspace = useMemo(() => {
    if (activeWorkspaceId == null) return bots
    const ids = new Set(subtreeIds(nodes, activeWorkspaceId))
    return bots.filter((b) => ids.has(b.node_id))
  }, [bots, nodes, activeWorkspaceId])

  // Progress per bot. One small read each, and it is the number you actually
  // want from an index — "is this moving".
  useEffect(() => {
    let alive = true
    void Promise.all(
      inWorkspace.map((b) => ipc.botWork(b.node_id).then((w) => [b.node_id, w] as const).catch(() => [b.node_id, []] as const)),
    ).then((pairs) => {
      if (alive) setWork(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [inWorkspace])

  // Anything in the workspace that could have one, the workspace included.
  // A bot for "Business" is exactly the level people ask for, and excluding it
  // was a judgement call that turned out to be wrong.
  const candidates = useMemo(() => {
    if (activeWorkspaceId == null) return []
    const ids = new Set(subtreeIds(nodes, activeWorkspaceId))
    const taken = new Set(bots.map((b) => b.node_id))
    return nodes.filter((n) => ids.has(n.id) && !taken.has(n.id))
  }, [nodes, bots, activeWorkspaceId])

  // A space the Assistant thinks should have one. The signal is real and small:
  // a folder you have set up — services, commands, or a `.devdeck` of its own —
  // that nothing is watching. It proposes; it never creates.
  const proposed = useMemo(() => {
    if (activeWorkspaceId == null || candidates.length === 0) return null
    const score = (id: number) => {
      const ids = new Set(subtreeIds(nodes, id))
      return (
        services.filter((x) => x.project_id != null && ids.has(x.project_id)).length +
        commands.filter((x) => x.project_id != null && ids.has(x.project_id)).length
      )
    }
    const ranked = candidates
      .map((n) => ({ node: n, n: score(n.id) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
    return ranked[0] ?? null
  }, [candidates, nodes, services, commands, activeWorkspaceId])

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

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Bots</h2>
          <p className="text-[11.5px] text-muted">One per space that needs one.</p>
        </div>
        <button
          className="btn-primary ml-auto text-[11.5px]"
          disabled={candidates.length === 0}
          title={candidates.length === 0 ? 'Every folder in this workspace already has one' : undefined}
          onClick={() => setCreating({})}
        >
          <Icon name="add" size={12} /> New bot
        </button>
      </div>

      {focus && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-soft px-5 py-2">
          <Icon name="focus" size={12} className="shrink-0 text-indigo-400" />
          <span className="text-[11.5px] text-dim">
            Focused on <span className="text-ink">{focus.goal}</span>
          </span>
          <span className="text-[10.5px] text-faint">Bots keep working; they just stop talking.</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {inWorkspace.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="bot" size={26} className="text-faint" />
            <div className="text-[12.5px] text-dim">No bots here yet</div>
            <div className="max-w-[420px] text-[11.5px] leading-relaxed text-muted">
              A bot is a goal, a heartbeat and the work it is managing — written as{' '}
              <code className="text-dim">_bot.md</code> in the folder it runs, so it travels with
              it. Give one to a space you are actually trying to move.
            </div>
            {candidates.length > 0 && (
              <button className="btn-primary mt-1.5 text-[11.5px]" onClick={() => setCreating({})}>
                <Icon name="add" size={12} /> New bot
              </button>
            )}
          </div>
        ) : (
          inWorkspace.map((b) => {
            const node = findNode(nodes, b.node_id)
            const ws = workspaceOf(nodes, node)
            const t = trouble(b.node_id)
            const p = progress(work[b.node_id] ?? [])
            const focused = focus?.node_id === b.node_id
            return (
              <div key={b.node_id} className="group border-b border-line px-5 py-3.5 hover:bg-hover/30">
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
                        onClick={() => openBot(b.node_id, b.name)}
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

                    {p.total > 0 && (
                      <div className="mt-2 flex items-center gap-2.5">
                        <div className="h-[4px] w-[120px] overflow-hidden rounded bg-line">
                          <span
                            className="block h-full bg-emerald-500"
                            style={{ width: `${p.pct}%` }}
                          />
                        </div>
                        <span className="text-[10.5px] text-muted">
                          {p.done} of {p.total} done
                        </span>
                      </div>
                    )}

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
                      {b.agent && (
                        <span
                          className={
                            (grantsFor(aiw.grants, b)?.length ?? 0) === 0 && aiw.grants != null
                              ? 'text-warn'
                              : 'text-muted'
                          }
                        >
                          {aiw.grants == null
                            ? ''
                            : (grantsFor(aiw.grants, b)?.length ?? 0) === 0
                              ? 'runs an agent, but may do nothing'
                              : `runs an agent · ${grantsFor(aiw.grants, b)?.length} grant${
                                  grantsFor(aiw.grants, b)?.length === 1 ? '' : 's'
                                }`}
                        </span>
                      )}
                      {t.working + t.blocked + t.waiting + t.conflicts === 0 && p.total === 0 && (
                        <span className="text-faint">nothing needs you</span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!focus && b.goal && (
                      <button
                        className="btn-ghost text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                        title="Hold everything outside this space until you are done"
                        onClick={() => setStartFocusFor(b)}
                      >
                        <Icon name="focus" size={11} /> Focus
                      </button>
                    )}
                    <button className="btn-ghost text-[11px]" onClick={() => openBot(b.node_id, b.name)}>
                      Open
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {proposed && !dismissedProposal && inWorkspace.length > 0 && (
        <div className="shrink-0 border-t border-line bg-panel px-5 py-3">
          <div className="flex items-start gap-3">
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-ok">
              <Icon name="ai" size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-ink">
                {proposed.node.name} has {proposed.n} thing{proposed.n === 1 ? '' : 's'} set up and
                nothing watching it
              </div>
              <div className="mt-0.5 text-[11px] leading-[1.5] text-muted">
                A bot there would start with your workspace's defaults and no access beyond the
                folder itself. It would ask you six questions before doing anything.
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  className="btn-primary text-[11px]"
                  onClick={() => setCreating({ nodeId: proposed.node.id })}
                >
                  Draft one
                </button>
                <button
                  className="btn-ghost text-[11px]"
                  onClick={() => setDismissedProposal(true)}
                >
                  No thanks
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {startFocusFor && (
        <FocusStart
          goal={startFocusFor.goal}
          nodeId={startFocusFor.node_id}
          onClose={() => setStartFocusFor(null)}
        />
      )}

      {creating && (
        <BotCreate
          nodeId={creating.nodeId}
          onClose={() => setCreating(null)}
          onCreated={(b) => {
            setCreating(null)
            void refreshBots()
            openBot(b.node_id, b.name, true)
          }}
        />
      )}
    </div>
  )
}
