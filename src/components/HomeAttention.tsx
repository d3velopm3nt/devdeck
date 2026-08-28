// Home's right column: what needs you, then what happened.
//
// Everything here spans every workspace, which is the whole reason it is on
// Home rather than inside one. An agent waiting on a project in *Client work*
// has to reach you while you are looking at *Innotrack*, so each row names
// where it came from and clicking it takes you there.
//
// Two kinds, ranked, never mixed:
//
//   * **Approvals** — an agent is stopped mid-turn on a 90-second clock. The
//     only rows with a deadline, so they sit on top and are answerable here.
//   * **Blockers** — work that cannot continue: a conflict, stale context.
//     No clock, but nothing moves until you deal with them.
//
// There is deliberately no third "suggestions" tier yet. A panel that goes
// amber because storybook is not running teaches you to ignore it when an
// agent is genuinely stuck, and nothing in the app currently produces a
// suggestion worth that risk.

import { useEffect } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { aiw, initials, severityStyle, describeEvent, ago } from '../lib/aiw'
import { Icon } from '../lib/icons'

export function HomeAttention() {
  const app = useApp()
  const a = useAiw()

  // Home is often the first thing on screen, before the AI Workspace has ever
  // been opened — so it loads its own data rather than assuming someone else
  // did. Without this the column reads "nothing needs you" on a cold start,
  // which is the one wrong answer it must never give.
  useEffect(() => {
    if (!a.ready) void a.bootstrap()
    else void a.refreshApprovals()
    // And subscribe while Home is open: without the live tail this feed is a
    // snapshot from whenever the page mounted, and an approval raised a minute
    // later would never appear.
    let stop: (() => void) | undefined
    void aiw.onEvent((e) => useAiw.getState().pushEvent(e)).then((un) => {
      stop = un
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blockers = a.conflicts.filter((c) => !c.resolved)
  const needs = a.approvals.length + blockers.length

  // Project names, so a row can say "assetx" rather than "17". The AI
  // Workspace speaks in node ids now, which is what makes this a lookup rather
  // than a second list to keep in step.
  const nameOf = (projectId?: string) => {
    if (!projectId) return ''
    const node = app.nodes.find((n) => String(n.id) === projectId)
    return node?.name ?? projectId
  }

  const openProject = (projectId?: string) => {
    if (!projectId) return
    const node = app.nodes.find((n) => String(n.id) === projectId)
    if (node) app.setSelectedNode(node.id)
    void a.selectProject(projectId)
    app.setRailView('aiworkspace')
  }

  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-line bg-app">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-warn">
          Needs you
        </span>
        {needs > 0 && (
          <span className="rounded-full bg-amber-500/14 px-1.5 text-[9.5px] font-bold text-warn">
            {needs}
          </span>
        )}
      </div>

      <div className="shrink-0 space-y-1.5 px-3">
        {needs === 0 && (
          <div className="rounded-lg border border-line bg-raise px-3 py-3 text-[11.5px] leading-5 text-muted">
            Nothing is waiting. Agents show up here when they need an answer, and so does anything
            that stops work.
          </div>
        )}

        {a.approvals.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-amber-500/28 bg-amber-500/[0.06] px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-amber-500/16 text-[8px] font-bold text-warn">
                {initials(a.agents.find((x) => x.id === r.agent_id)?.name ?? r.agent_id)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink" title={r.detail}>
                {r.summary}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                className="btn-primary px-2.5 py-0.5 text-[10.5px]"
                onClick={() => void a.resolveApproval(r.id, 'allow')}
              >
                Allow
              </button>
              <button
                className="rounded border border-line2 px-2.5 py-0.5 text-[10.5px] text-dim hover:text-ink"
                onClick={() => void a.resolveApproval(r.id, 'deny')}
              >
                Deny
              </button>
              {r.project_id && (
                <span className="ml-auto truncate rounded bg-raise px-1.5 text-[9.5px] text-muted">
                  {nameOf(r.project_id)}
                </span>
              )}
            </div>
          </div>
        ))}

        {blockers.slice(0, 5).map((c) => {
          const tone =
            severityStyle(c.severity)
              .chip.split(' ')
              .find((x) => x.startsWith('text-')) ?? 'text-dim'
          return (
            <button
              key={c.id}
              className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-raise px-3 py-2.5 text-left hover:border-line2"
              onClick={() => {
                openProject(c.project_id)
                a.setPage('conflicts')
              }}
            >
              <Icon name="conflict" size={13} className={`mt-px shrink-0 ${tone}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-ink">{c.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted">
                  {nameOf(c.project_id)} · {c.feature_id}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="shrink-0 px-4 pb-2 pt-4">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
          Agent activity
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-3">
        {a.events.length === 0 ? (
          <div className="text-[11.5px] leading-5 text-muted">
            Nothing yet. This fills up as agents work.
          </div>
        ) : (
          a.events.slice(0, 40).map((e) => (
            <div key={e.id} className="flex gap-2.5 py-1.5">
              <span className={`mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full ${dot(e.type)}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] leading-[1.5] text-body">{describeEvent(e)}</div>
                <div className="mt-0.5 truncate text-[9.5px] text-faint">
                  {[nameOf(e.project_id ?? undefined), ago(e.timestamp)].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-2 text-[10px] text-faint">
        Across every workspace
      </div>
    </aside>
  )
}

/// A colour per kind, so the stream is scannable without reading it. Failures
/// and conflicts are the only ones that are not grey or green — a feed where
/// everything is coloured is a feed where nothing stands out.
function dot(type: string): string {
  if (type.startsWith('conflict')) return 'bg-amber-400'
  if (type.endsWith('.failed')) return 'bg-red-400'
  if (type.startsWith('agent') || type.startsWith('session')) return 'bg-emerald-400'
  if (type.startsWith('context') || type.startsWith('decision')) return 'bg-violet-400'
  return 'bg-line3'
}
