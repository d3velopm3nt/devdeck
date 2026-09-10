// The goal you are on, in the chrome, for as long as you are on it.
//
// It lives beside the workspace tabs rather than on a page because the whole
// value is being reminded without going to look. A focus session you have to
// navigate to is a note to yourself.
//
// Two deliberate absences:
//
//   * **No drift detection.** Telling you that you have strayed needs a signal
//     we do not have and a rule for reading it, and a thing that interrupts you
//     to be wrong gets switched off within a week — taking the useful half with
//     it. The useful half is the goal, the hold and the count.
//   * **No pause.** A session you can pause is a session you forget is running.
//     End it and start another; the history keeps both.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../lib/icons'
import { findNode, subtreeIds } from '../lib/tree'
import { useAiw } from '../lib/aiwStore'

/** How long it has been, in the units a person would say it in. */
function since(startedAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** What a session holds back, counted the same way the inbox counts it: an
 *  approval or an unresolved conflict outside the goal's space. Activity is
 *  news and is never held — it was not going to interrupt you anyway. */
export function useHeldCount(): number {
  const { focus, nodes } = useApp()
  const aiw = useAiw()

  return useMemo(() => {
    if (!focus) return 0
    const inGoal = focus.node_id == null ? null : new Set(subtreeIds(nodes, focus.node_id))
    // A goal that names no space holds nothing: you asked to focus on
    // everything, so everything is the goal.
    if (!inGoal) return 0

    const outside = (projectId: string | null | undefined) => {
      const id = Number(projectId)
      return !Number.isFinite(id) || !inGoal.has(id)
    }
    return (
      aiw.approvals.filter((r) => outside(r.project_id)).length +
      aiw.conflicts.filter((c) => !c.resolved && outside(c.project_id)).length
    )
  }, [focus, nodes, aiw.approvals, aiw.conflicts])
}

export function FocusBar() {
  const { focus, endFocus, nodes, setRailView } = useApp()
  const held = useHeldCount()
  const [now, setNow] = useState(() => Date.now())

  // A clock that only ticks when there is something to count.
  useEffect(() => {
    if (!focus) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [focus])

  if (!focus) return null
  const space = focus.node_id == null ? null : findNode(nodes, focus.node_id)

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-indigo-500/30 bg-indigo-500/[0.07] px-4 py-1.5">
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400">
        <Icon name="focus" size={13} />
      </span>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-indigo-400">
          Focus
        </span>
        <span className="truncate text-[12px] text-ink">{focus.goal}</span>
      </div>
      {space && (
        <span className="shrink-0 rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
          {space.name}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[11px] text-muted">{since(focus.started_at, now)}</span>
      {held > 0 && (
        <button
          className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-[10.5px] text-dim hover:text-ink"
          title="Waiting until you finish. Nothing is dropped."
          onClick={() => setRailView('inbox')}
        >
          {held} held
        </button>
      )}
      <button className="btn-ghost shrink-0 text-[11px]" onClick={() => void endFocus(held)}>
        End
      </button>
    </div>
  )
}

/// Starting one. A goal and, optionally, the space it is about — and the
/// second is what makes holding possible, so the dialog says so rather than
/// leaving you to find out that a session held nothing.
export function FocusStart({
  goal: initialGoal = '',
  nodeId: initialNode = null,
  onClose,
}: {
  goal?: string
  nodeId?: number | null
  onClose: () => void
}) {
  const { nodes, startFocus, activeWorkspaceId } = useApp()
  const [goal, setGoal] = useState(initialGoal)
  const [nodeId, setNodeId] = useState<number | null>(initialNode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Only what is in the workspace you are in — a picker listing every space
  // you own makes the common choice the hardest one to find.
  const choices = useMemo(() => {
    if (activeWorkspaceId == null) return []
    const ids = new Set(subtreeIds(nodes, activeWorkspaceId))
    return nodes.filter((n) => ids.has(n.id) && n.id !== activeWorkspaceId)
  }, [nodes, activeWorkspaceId])

  const go = async () => {
    if (!goal.trim() || busy) return
    setBusy(true)
    try {
      await startFocus(goal.trim(), nodeId)
      onClose()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[16vh]"
      onClick={onClose}
    >
      <div
        className="w-[460px] rounded-xl border border-line2 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="flex h-[24px] w-[24px] items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400">
            <Icon name="focus" size={13} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">What are you getting done?</div>
            <div className="text-[11px] text-muted">
              Everything outside it waits until you finish.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3.5">
          <input
            autoFocus
            className="input w-full text-[12.5px]"
            placeholder="Get the demo build green"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void go()
              if (e.key === 'Escape') onClose()
            }}
          />

          <div>
            <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              About which space
            </label>
            <select
              className="input w-full text-[12px]"
              value={nodeId ?? ''}
              onChange={(e) => setNodeId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Everything — hold nothing</option>
              {choices.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
              {nodeId == null
                ? 'With no space chosen nothing is held — you asked to focus on everything, so everything is the goal.'
                : 'Approvals and conflicts from anywhere else are held and counted until you end the session. Nothing is dropped.'}
            </p>
          </div>

          {error && <div className="text-[11.5px] text-err">{error}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <button className="btn-primary text-[12px]" disabled={!goal.trim() || busy} onClick={() => void go()}>
            Start
          </button>
          <button className="btn-ghost text-[12px]" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
