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
//
// And one rule of its own: while a focus session is running, anything that
// needs you from outside the goal's space is *held* — still here, counted, one
// click from view, and never dropped. Holding is a rendering rule and nothing
// more, which is why ending a session cannot lose anything.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { Icon, type IconName } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import { findNode, subtreeIds, workspaceOf } from '../lib/tree'
import { FocusStart } from './FocusBar'

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
  /// The node this is about, when it names one. Only used to decide whether a
  /// focus session holds it back.
  nodeId?: number | null
  onOpen?: () => void
}

const TONE: Record<Tone, { dot: string; text: string }> = {
  wait: { dot: 'bg-amber-500/16 text-warn', text: 'text-warn' },
  agent: { dot: 'bg-indigo-500/16 text-indigo-400', text: 'text-indigo-400' },
  fail: { dot: 'bg-red-500/16 text-err', text: 'text-err' },
  news: { dot: 'bg-hover text-dim', text: 'text-dim' },
}

export function InboxPage() {
  const { activity, refreshActivity, nodes, setRailView, focus, endFocus, showBottom } = useApp()
  const aiw = useAiw()
  const [showHeld, setShowHeld] = useState(false)
  const [starting, setStarting] = useState(false)
  const [read, setRead] = useState(false)

  useEffect(() => {
    void refreshActivity().finally(() => setRead(true))
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
        nodeId: Number(r.project_id),
        onOpen: () => {
          setRailView('aiworkspace')
          useAiw.getState().setPage('agents')
        },
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
        nodeId: Number(c.project_id),
        onOpen: () => {
          setRailView('aiworkspace')
          useAiw.getState().setPage('conflicts')
        },
      })
    }

    // Then what went wrong. Only what went wrong: something you set up is not
    // doing its job, and that is a thing to fix rather than a thing to read.
    //
    // What *worked* used to be here too, and it drowned the rest — an inbox
    // that fills up on an ordinary day is one you stop opening, and then the
    // agent waiting on you is behind forty lines saying a reminder fired. That
    // stream is on Home now, where reading it is the point.
    for (const a of activity.filter((x) => !x.ok)) {
      out.push({
        id: `activity-${a.id}`,
        tone: 'fail',
        icon: 'alert',
        title: a.title,
        evidence: a.detail || `${a.kind}${a.project_name ? ` · ${a.project_name}` : ''}`,
        space: a.project_name,
        at: a.ts,
        // A failed turn has one more thing to show than its sentence: the
        // prompt that was sent and whatever came back. That is the Models
        // tab, so the row opens it rather than leaving you to find it.
        onOpen: a.kind === 'agent' ? () => showBottom('calls') : undefined,
      })
    }

    // Waiting sorts above everything, then newest first.
    const rank = (r: Row) => (r.tone === 'wait' ? 0 : 1)
    return out.sort((x, y) => rank(x) - rank(y) || y.at - x.at)
  }, [activity, aiw.approvals, aiw.conflicts, aiw.agents, nodes, showBottom, setRailView])

  // What the focus session holds. Only things that need you: news was never
  // going to interrupt, so hiding it would only make the page emptier.
  const [visible, held] = useMemo(() => {
    if (!focus?.node_id) return [rows, [] as Row[]]
    const inGoal = new Set(subtreeIds(nodes, focus.node_id))
    const keep: Row[] = []
    const hold: Row[] = []
    for (const r of rows) {
      const outside = r.nodeId == null || !Number.isFinite(r.nodeId) || !inGoal.has(r.nodeId)
      if (r.tone === 'wait' && outside) hold.push(r)
      else keep.push(r)
    }
    return [keep, hold]
  }, [rows, focus, nodes])

  const waiting = visible.filter((r) => r.tone === 'wait').length
  const shown = showHeld ? [...visible, ...held] : visible

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Needs you</h2>
          <p className="text-[11.5px] text-muted">Across every space. What merely happened is on Home.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {waiting > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-warn">
              {waiting} need{waiting === 1 ? 's' : ''} you
            </span>
          )}
          {focus ? (
            <button className="btn-ghost text-[11.5px]" onClick={() => void endFocus(held.length)}>
              <Icon name="focus" size={12} /> End focus
            </button>
          ) : (
            <button className="btn-ghost text-[11.5px]" onClick={() => setStarting(true)}>
              <Icon name="focus" size={12} /> Focus
            </button>
          )}
          <button className="btn-ghost text-[11.5px]" onClick={() => void refreshActivity()}>
            <Icon name="update" size={12} /> Refresh
          </button>
        </div>
      </div>

      {held.length > 0 && (
        <button
          className="flex shrink-0 items-center gap-2.5 border-b border-line bg-soft px-5 py-2 text-left hover:bg-hover"
          onClick={() => setShowHeld((v) => !v)}
        >
          <Icon name={showHeld ? 'chevron-down' : 'chevron-right'} size={12} className="text-muted" />
          <span className="text-[11.5px] text-dim">
            {held.length} held while you focus
          </span>
          <span className="text-[10.5px] text-faint">
            Outside “{focus?.goal}”. Nothing is dropped — it all arrives when you finish.
          </span>
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && !read ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted">
            Reading what happened…
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="inbox" size={26} className="text-faint" />
            <div className="text-[12.5px] text-dim">Nothing needs you</div>
            <div className="max-w-[380px] text-[11.5px] leading-relaxed text-muted">
              An agent waiting on an answer, work that cannot continue, something that ran and
              failed. Everything that simply happened is on Home.
            </div>
          </div>
        ) : (
          shown.map((r) => {
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
                    <span
                      className={`text-[12.5px] ${r.tone === 'fail' ? 'text-err' : 'text-ink'}`}
                    >
                      {r.title}
                    </span>
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
                      // Where a row goes is the row's business. This used to
                      // jump to the Assistant first whatever the row was, which
                      // was right for an approval and wrong for a failed turn:
                      // the call is at the bottom of the page you are on.
                      onClick={() => r.onOpen?.()}
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

      {starting && <FocusStart onClose={() => setStarting(false)} />}

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
