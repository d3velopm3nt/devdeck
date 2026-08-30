// One inbox: what happened, and what is waiting on you, across every space.
//
// Nothing here is a new stream. `activity` already collects everything the app
// *does* — the module comment on activity.rs is explicit that a new kind of
// event should show up everywhere at once — and the AI side already tracks who
// is blocked on an approval and where two pieces of work disagree. This is the
// one place those three meet.
//
// Two rules it inherits from `conflict.rs`, and they are what stop it becoming
// a notification list you learn to ignore:
//
//   * **Every item carries its evidence.** A row says what was seen, not just
//     that something happened, so you can judge it without opening anything.
//   * **Anything that needs you sorts above anything that is merely news.**
//     A feed where an agent waiting on a decision sits below a git pull is a
//     feed that trains you to skim past the decision.

import { useEffect, useMemo } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { Icon, type IconName } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import { findNode, workspaceOf } from '../lib/tree'

type Tone = 'wait' | 'agent' | 'fail' | 'news'

interface Row {
  id: string
  tone: Tone
  icon: IconName
  title: string
  /// Why this is on screen. Never optional — a row without it is an assertion.
  evidence: string
  space: string
  at: number
  onOpen?: () => void
}

const TONE: Record<Tone, { dot: string; text: string }> = {
  wait: { dot: 'bg-amber-500/16 text-warn', text: 'text-warn' },
  agent: { dot: 'bg-indigo-500/16 text-indigo-400', text: 'text-indigo-400' },
  fail: { dot: 'bg-red-500/16 text-err', text: 'text-err' },
  news: { dot: 'bg-hover text-dim', text: 'text-dim' },
}

export function InboxPage() {
  const { activity, refreshActivity, nodes, setRailView } = useApp()
  const aiw = useAiw()

  useEffect(() => {
    void refreshActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const now = Date.now()

  const rows = useMemo(() => {
    const out: Row[] = []

    // Which space something belongs to, by the node it names.
    const spaceOf = (projectId: string | null | undefined): string => {
      if (!projectId) return ''
      const id = Number(projectId)
      if (!Number.isFinite(id)) return projectId
      const node = findNode(nodes, id)
      if (!node) return ''
      const ws = workspaceOf(nodes, node)
      return ws && ws.id !== node.id ? `${ws.name} / ${node.name}` : node.name
    }

    // Waiting on you, first and always.
    for (const r of aiw.approvals) {
      out.push({
        id: `approval-${r.id}`,
        tone: 'wait',
        icon: 'alert',
        title: `${aiw.agents.find((a) => a.id === r.agent_id)?.name ?? r.agent_id} is waiting on you`,
        evidence: r.detail || r.summary,
        space: spaceOf(r.project_id),
        at: now,
        onOpen: () => useAiw.getState().setPage('agents'),
      })
    }

    for (const c of aiw.conflicts.filter((x) => !x.resolved)) {
      out.push({
        id: `conflict-${c.id}`,
        tone: 'wait',
        icon: 'conflict',
        title: c.title,
        evidence: [c.left?.detail, c.right?.detail].filter(Boolean).join('  vs  ') ||
          'Two pieces of work look like they disagree.',
        space: spaceOf(c.project_id),
        at: Date.parse(c.detected_at) || now,
        onOpen: () => useAiw.getState().setPage('conflicts'),
      })
    }

    // Then what happened. A failure is not news — it reads as one.
    for (const a of activity) {
      out.push({
        id: `activity-${a.id}`,
        tone: a.ok ? 'news' : 'fail',
        icon: a.ok ? 'history' : 'alert',
        title: a.title,
        evidence: a.detail || `${a.kind}${a.project_name ? ` · ${a.project_name}` : ''}`,
        space: a.project_name,
        at: a.ts * 1000,
      })
    }

    // Waiting sorts above everything, then newest first.
    const rank = (r: Row) => (r.tone === 'wait' ? 0 : 1)
    return out.sort((x, y) => rank(x) - rank(y) || y.at - x.at)
  }, [activity, aiw.approvals, aiw.conflicts, aiw.agents, nodes])

  const waiting = rows.filter((r) => r.tone === 'wait').length

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">What happened</h2>
          <p className="text-[11.5px] text-muted">Across every space.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {waiting > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-warn">
              {waiting} need{waiting === 1 ? 's' : ''} you
            </span>
          )}
          <button className="btn-ghost text-[11.5px]" onClick={() => void refreshActivity()}>
            <Icon name="update" size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="inbox" size={26} className="text-faint" />
            <div className="text-[12.5px] text-dim">Nothing yet</div>
            <div className="max-w-[380px] text-[11.5px] leading-relaxed text-muted">
              Start a service, run a command, or put an agent on something. What they do turns up
              here.
            </div>
          </div>
        ) : (
          rows.map((r) => {
            const tone = TONE[r.tone]
            return (
              <div
                key={r.id}
                className={`flex gap-3 border-b border-line px-5 py-3 ${
                  r.tone === 'wait' ? 'bg-amber-500/[0.04]' : ''
                }`}
              >
                <span
                  className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg ${tone.dot}`}
                >
                  <Icon name={r.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-ink">{r.title}</span>
                    {r.space && (
                      <span className="shrink-0 rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
                        {r.space}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-faint">
                      {fmtAgo(r.at, now)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-[1.5] text-muted">{r.evidence}</div>
                  {r.onOpen && (
                    <button
                      className="btn-ghost mt-2 text-[11px]"
                      onClick={() => {
                        setRailView('aiworkspace')
                        r.onOpen?.()
                      }}
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* The reply box is what makes this a conversation rather than a list.
          It is not wired to the assistant yet — saying so beats a box that
          silently does nothing. */}
      <div className="shrink-0 border-t border-line bg-panel px-4 py-2.5">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-page px-3 py-2 text-left hover:border-line2"
          onClick={() => {
            setRailView('aiworkspace')
            useAiw.getState().setPage('chat')
          }}
        >
          <Icon name="ai" size={14} className="shrink-0 text-indigo-400" />
          <span className="flex-1 text-[12px] text-faint">
            Ask, or just tell it something — opens the assistant
          </span>
        </button>
      </div>
    </div>
  )
}
