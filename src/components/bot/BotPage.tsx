// One bot, as a document.
//
// It opens in the dock rather than on a rail view because a bot is a file in a
// folder, and everything a folder offers opens as a document here. The Bots
// page is the index; this is the thing.
//
// The overview answers four questions in the order you would ask them: does it
// wake, does it know anything, what is it managing, and what does it think you
// should do. Every suggestion carries the signal it read — none of this path
// touches a model, so "why are you telling me this" always has an answer.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'
import { Icon, type IconName } from '../../lib/icons'
import { avatarLabel, nodeColor } from '../../lib/spaces'
import { findNode, subtreeIds, workspaceOf } from '../../lib/tree'
import { progress, routine } from '../../lib/bots'
import { FocusStart } from '../FocusBar'
import { BotPlan } from './BotPlan'
import { BotKnows } from './BotKnows'
import { BotTools } from './BotTools'
import { BotSettings } from './BotSettings'
import { BotInterview } from './BotInterview'
import { BotGrants } from './BotGrants'
import { BotChat } from './BotChat'
import { CAPTURE_BOT_MODAL, CAPTURE_BOT_TAB } from '../../lib/devCapture'

type Tab = 'chat' | 'overview' | 'plan' | 'knows' | 'tools' | 'settings'

const SUGGESTION_ICON: Record<string, IconName> = {
  interview: 'ai',
  heartbeat: 'schedule',
  work: 'check',
  tool: 'tool',
  goal: 'project',
}

export function BotPage({ params }: IDockviewPanelProps<{ id: number; ask?: boolean }>) {
  const nodeId = params.id
  const { nodes, focus, refreshBots, refreshActivity } = useApp()
  const aiw = useAiw()

  const [bot, setBot] = useState<ipc.Bot | null>(null)
  const [work, setWork] = useState<ipc.BotWork[]>([])
  const [suggestions, setSuggestions] = useState<ipc.BotSuggestion[] | null>(null)
  const [interview, setInterview] = useState<ipc.Interview | null>(null)
  const [templates, setTemplates] = useState<ipc.BotTemplate[]>([])
  // Opens on the thread. A page that opened on settings was a form with a bot
  // attached; opening on what the bot said is the other way round.
  const [tab, setTab] = useState<Tab>((CAPTURE_BOT_TAB as Tab) || 'chat')
  const [gone, setGone] = useState(false)
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState(params.ask === true || CAPTURE_BOT_MODAL === 'interview')
  const [focusing, setFocusing] = useState(false)
  const [wrongFor, setWrongFor] = useState<string | null>(null)
  const [why, setWhy] = useState('')

  // Every read reports its own failure. A `mind.md` someone hand-edited into
  // invalid YAML must never render as "this bot knows nothing" — that is the
  // update checker's old bug (couldn't reach the server → "up to date"), and
  // here it would be followed by a write that replaced everything you told it.
  const reload = useCallback(() => {
    setErr('')
    void ipc.botGet(nodeId).then(setBot).catch((e) => setErr(String(e)))
    void ipc.botWork(nodeId).then(setWork).catch((e) => {
      setWork([])
      setErr(String(e))
    })
    void ipc.botSuggestions(nodeId).then(setSuggestions).catch((e) => {
      // null, not [] — "nothing to suggest" is a claim, and a read that failed
      // has not earned it.
      setSuggestions(null)
      setErr(String(e))
    })
    void ipc.botInterview(nodeId).then(setInterview).catch((e) => {
      setInterview(null)
      setErr(String(e))
    })
    void refreshBots()
  }, [nodeId, refreshBots])

  useEffect(() => {
    reload()
    void ipc.botCatalog().then(setTemplates).catch(() => setTemplates([]))
    // Agent names, for the heartbeat line and the sub-agent list. A bot document
    // can be the first thing opened, before the Assistant page has ever loaded.
    if (aiw.agents.length === 0) void useAiw.getState().reloadAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  const node = findNode(nodes, nodeId)
  const ws = workspaceOf(nodes, node)
  const template = useMemo(
    () => templates.find((t) => t.id === bot?.template) ?? null,
    [templates, bot?.template],
  )

  // Its agents: the AI sessions running on this space. Borrowed, not invented —
  // a second place that says an agent is waiting is how the first stops working.
  const agents = useMemo(() => {
    const ids = new Set(subtreeIds(nodes, nodeId))
    const mine = (pid: string | null | undefined) => {
      const n = Number(pid)
      return Number.isFinite(n) && ids.has(n)
    }
    return {
      sessions: aiw.sessions.filter((s) => mine(s.project_id)),
      waiting: aiw.approvals.filter((r) => mine(r.project_id)).length,
      conflicts: aiw.conflicts.filter((c) => !c.resolved && mine(c.project_id)).length,
    }
  }, [aiw.sessions, aiw.approvals, aiw.conflicts, nodes, nodeId])

  const answer = (id: string, response: string, reason = '') => {
    setErr('')
    void ipc
      .botSuggestionAnswer(nodeId, id, response, reason)
      .then(() => {
        setWrongFor(null)
        setWhy('')
        reload()
      })
      .catch((e) => setErr(String(e)))
  }

  const wake = () => {
    if (!bot?.schedule_id) return
    setErr('')
    void ipc
      .scheduleRunNow(bot.schedule_id)
      .then(() => {
        reload()
        void refreshActivity()
      })
      .catch((e) => setErr(String(e)))
  }

  if (gone) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-page px-8 text-center">
        <Icon name="bot" size={24} className="text-faint" />
        <div className="text-[12.5px] text-dim">That bot is gone</div>
        <p className="max-w-[380px] text-[11.5px] leading-relaxed text-muted">
          Its folder, its work items and everything else in the space are untouched. You can close
          this tab.
        </p>
      </div>
    )
  }

  if (!bot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-page px-8 text-center">
        <Icon name="bot" size={24} className="text-faint" />
        <div className="text-[12.5px] text-dim">
          {err ? 'That did not load' : 'No bot in this folder'}
        </div>
        {err && <p className="max-w-[420px] text-[11.5px] text-err">{err}</p>}
      </div>
    )
  }

  const p = progress(work)
  // When the interview could not be read at all, the badge says nothing rather
  // than "0/6" — which would be a claim about what it knows.
  const seen = interview ? interview.answers.length : null
  const scriptLen = interview?.script.length ?? 6

  const TABS: { id: Tab; label: string; badge?: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'overview', label: 'Overview' },
    { id: 'plan', label: 'Plan', badge: work.length ? `${p.done}/${p.total}` : undefined },
    {
      id: 'knows',
      label: 'Knows',
      badge: seen != null && seen < scriptLen ? `${seen}/${scriptLen}` : undefined,
    },
    { id: 'tools', label: 'Tools' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="flex h-full flex-col bg-page">
      {/* Who it is */}
      <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
        <span
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-black/80"
          style={{ background: node ? nodeColor(node) : undefined }}
        >
          {avatarLabel(bot.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-semibold text-ink">{bot.name}</span>
            {ws?.label && (
              <span className="shrink-0 rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
                {ws.label}
              </span>
            )}
            {template && (
              <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-indigo-400">
                {template.name}
              </span>
            )}
            <span className="shrink-0 text-[10.5px] text-faint">{bot.node_name}</span>
          </div>
          <div className="mt-0.5 text-[12px] leading-[1.5] text-body">{bot.goal}</div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!focus && (
            <button
              className="btn-ghost text-[11.5px]"
              title="Hold everything outside this space until you are done"
              onClick={() => setFocusing(true)}
            >
              <Icon name="focus" size={12} /> Focus
            </button>
          )}
          {bot.schedule_id && (
            <button className="btn-ghost text-[11.5px]" title="Wake it now" onClick={wake}>
              <Icon name="update" size={12} /> Wake it
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-[12px] ${
              tab === t.id ? 'text-ink' : 'text-muted hover:text-dim'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge && (
              <span className="rounded-full bg-soft px-1.5 text-[9.5px] tabular-nums text-muted">
                {t.badge}
              </span>
            )}
            {tab === t.id && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded bg-indigo-500" />
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {err && (
          <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[11.5px] leading-[1.5] text-err">
            {err}
          </div>
        )}

        {tab === 'chat' && bot && (
          <div className="h-full">
            <BotChat bot={bot} />
          </div>
        )}

        {tab === 'overview' && (
          <div className="flex flex-col gap-3.5">
            {/* The heartbeat. Without it a bot is only ever a chat window. */}
            <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-3">
              <span
                className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg ${
                  bot.every ? 'bg-emerald-500/15 text-ok' : 'bg-soft text-faint'
                }`}
              >
                <Icon name="schedule" size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">{routine(bot)}</div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {bot.agent
                    ? `Reads the space, then runs ${
                        aiw.agents.find((x) => x.id === bot.agent)?.name ?? bot.agent
                      }. `
                    : ''}
                  {bot.last_woke
                    ? `Last woke ${new Date(bot.last_woke).toLocaleString()}`
                    : bot.every
                      ? 'It has not woken yet.'
                      : 'It only looks at this space when you open it.'}
                </div>
              </div>
              <button className="btn-ghost shrink-0 text-[11px]" onClick={() => setTab('settings')}>
                Change
              </button>
            </div>

            {/* The other half of the routine. "It wakes at 07:00 and runs the
                QA agent" is only half a sentence; this is the rest of it. */}
            <BotGrants bot={bot} />

            {/* What it suggests. Always a proposal, never a fait accompli. */}
            {suggestions && suggestions.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  It suggests
                </div>
                {suggestions.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.05] px-3.5 py-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded bg-indigo-500/20 text-indigo-400">
                        <Icon name={SUGGESTION_ICON[s.kind] ?? 'ai'} size={11} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] text-ink">{s.title}</div>
                        <div className="mt-0.5 text-[11px] leading-[1.5] text-muted">{s.evidence}</div>

                        {wrongFor === s.id ? (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              autoFocus
                              className="input min-w-0 flex-1 text-[11.5px]"
                              placeholder="Why is it wrong? It will remember this."
                              value={why}
                              onChange={(e) => setWhy(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setWrongFor(null)
                                if (e.key === 'Enter') answer(s.id, 'wrong', why)
                              }}
                            />
                            <button
                              className="btn-ghost shrink-0 text-[11px]"
                              onClick={() => answer(s.id, 'wrong', why)}
                            >
                              Tell it
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                              className="btn-primary text-[11px]"
                              onClick={() => {
                                if (s.kind === 'interview') setAsking(true)
                                else if (s.kind === 'work') setTab('plan')
                                else if (s.kind === 'tool') setTab('tools')
                                else if (s.kind === 'heartbeat' || s.kind === 'goal') setTab('settings')
                                answer(s.id, 'done')
                              }}
                            >
                              {s.kind === 'interview' ? 'Ask me' : 'Take me there'}
                            </button>
                            <button
                              className="btn-ghost text-[11px]"
                              onClick={() => answer(s.id, 'snoozed')}
                            >
                              Not now
                            </button>
                            <button
                              className="btn-ghost text-[11px] text-faint"
                              onClick={() => {
                                setWhy('')
                                setWrongFor(s.id)
                              }}
                            >
                              Wrong — here’s why
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-[10.5px] text-faint">
                  Every one of these comes from something it can point at. “Not now” comes back in a
                  week; “wrong” never does, and the reason becomes something it knows.
                </p>
              </div>
            )}

            {suggestions?.length === 0 && (
              <div className="rounded-lg border border-line bg-panel px-3.5 py-3 text-[11.5px] text-muted">
                Nothing to suggest. It has your answers, a routine, and a plan that is moving.
              </div>
            )}

            {/* What it is managing */}
            <button
              className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-3 text-left hover:border-line2"
              onClick={() => setTab('plan')}
            >
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-soft text-muted">
                <Icon name="check" size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">
                  {work.length === 0
                    ? 'No steps yet'
                    : `${p.done} of ${p.total} steps done`}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {work.length === 0
                    ? 'Give the goal a plan and it becomes something you can watch finish.'
                    : work
                        .filter((w) => w.status !== 'done')
                        .slice(0, 2)
                        .map((w) => w.title)
                        .join(' · ') || 'Everything is done.'}
                </div>
              </div>
              <Icon name="chevron-right" size={13} className="shrink-0 text-faint" />
            </button>

            {/* Its agents, borrowed from the runtime that already has them */}
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              <div className="flex items-center gap-2 px-3.5 py-2.5">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Its agents
                </span>
                <span className="ml-auto text-[10.5px] text-faint">
                  {agents.sessions.length === 0
                    ? 'none running'
                    : `${agents.sessions.length} session${agents.sessions.length === 1 ? '' : 's'}`}
                </span>
              </div>
              {agents.sessions.length === 0 ? (
                <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-muted">
                  Nothing is working on this space yet. A bot holds the plan and the standards; the
                  work itself is done by agents under Assistant.
                </div>
              ) : (
                agents.sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2.5 border-t border-line px-3.5 py-2 text-[11.5px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-body">
                      {aiw.agents.find((a) => a.id === s.agent_id)?.name ?? s.agent_id}
                    </span>
                    <span className="shrink-0 rounded bg-soft px-1.5 text-[9.5px] font-semibold text-muted">
                      {s.status}
                    </span>
                  </div>
                ))
              )}
              {(agents.waiting > 0 || agents.conflicts > 0) && (
                <div className="border-t border-line px-3.5 py-2 text-[11px] text-warn">
                  {agents.waiting > 0 && `${agents.waiting} waiting on you`}
                  {agents.waiting > 0 && agents.conflicts > 0 && ' · '}
                  {agents.conflicts > 0 && `${agents.conflicts} disagreement`}
                  <span className="text-faint"> — in your inbox</span>
                </div>
              )}
            </div>

            {/* Standards, when it has any */}
            {bot.body.trim() && (
              <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  What it is for
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[11.5px] leading-[1.6] text-body">
                  {bot.body.trim()}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === 'plan' && (
          <BotPlan bot={bot} work={work} reload={reload} template={template} />
        )}
        {tab === 'knows' && <BotKnows bot={bot} />}
        {tab === 'tools' && <BotTools bot={bot} onChanged={reload} />}
        {tab === 'settings' && (
          <BotSettings bot={bot} reload={reload} onDeleted={() => setGone(true)} />
        )}
      </div>

      {asking && (
        <BotInterview bot={bot} onClose={() => setAsking(false)} onChanged={reload} />
      )}
      {focusing && (
        <FocusStart goal={bot.goal} nodeId={bot.node_id} onClose={() => setFocusing(false)} />
      )}
    </div>
  )
}
