// Bots — the people, on a page of their own.
//
// Team is the work: goals, features, items. This is who does it. Keeping the
// two apart is what the owner asked for after seeing them nested — a list of
// bots inside a tab of a page about goals was tidy and unfindable.
//
// It is a list, deliberately. Clicking a bot opens its *page* — plan, knows,
// tools, settings, with the thread as the first tab — rather than a chat pane
// beside the list. A chat pane hid everything else a bot has; the page opens
// on the conversation anyway, so nothing is lost and the rest is one click
// away instead of unknown.
//
// The Assistant is first, and it is a contact like the rest: the orchestrator,
// in the permission matrix, talked to through the same loop with a different
// voice.

import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { aiw, type ConversationSummary } from '../lib/aiw'
import { Icon } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds, workspaceOf } from '../lib/tree'
import { routine } from '../lib/bots'
import { openAssistant, openBot } from '../lib/dock'
import { BotCreate } from './bot/BotCreate'

export function BotsPage() {
  const { bots, refreshBots, nodes, activeWorkspaceId } = useApp()
  const a = useAiw()
  const [threads, setThreads] = useState<ConversationSummary[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void refreshBots()
    if (a.agents.length === 0) void a.reloadAgents()
    // Previews come from the threads themselves rather than from a second
    // record of "what a bot last said" — there is only one transcript.
    void aiw.conversations().then(setThreads).catch(() => setThreads(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const previewOf = (nodeId: number) => threads?.find((t) => t.bot_node === nodeId)
  const assistantThread = threads?.find((t) => !t.bot_node && !t.feature && !t.node)

  // Every bot, every workspace. A bot two workspaces over is still one of
  // yours, and "which tab is open" is the wrong thing for this list to hide
  // behind — each row says where it lives instead.
  const candidates = nodes.filter(
    (n) =>
      !bots.some((b) => b.node_id === n.id) &&
      (activeWorkspaceId == null || subtreeIds(nodes, activeWorkspaceId).includes(n.id)),
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Bots</h2>
          <p className="text-[11.5px] text-muted">
            Who you talk to, and who they put to work. Click one to open its page.
          </p>
        </div>
        <button
          className="btn-primary ml-auto text-[11.5px]"
          disabled={candidates.length === 0}
          title={candidates.length === 0 ? 'Every folder in this workspace already has one' : undefined}
          onClick={() => setCreating(true)}
        >
          <Icon name="add" size={12} /> New bot
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <button
          className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover/50"
          onClick={() => openAssistant()}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
            <Icon name="ai" size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink">Assistant</span>
            <span className="block truncate text-[11.5px] text-muted">
              {assistantThread?.preview || 'The one you talk to about everything. It can put an agent on a feature and leave a bot behind.'}
            </span>
          </span>
          <Icon name="chevron-right" size={13} className="mt-2 shrink-0 text-faint" />
        </button>

        <div className="px-3 pb-1 pt-4 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
          Bots
        </div>
        {bots.length === 0 && (
          <div className="px-3 py-4 text-[11.5px] leading-relaxed text-muted">
            No bots yet. A bot is a goal, a heartbeat and the work it manages — written as{' '}
            <code className="text-dim">_bot.md</code> in the folder it runs.
          </div>
        )}
        {bots.map((b) => {
          const node = findNode(nodes, b.node_id)
          const ws = workspaceOf(nodes, node)
          const t = previewOf(b.node_id)
          return (
            <button
              key={b.node_id}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover/50"
              onClick={() => openBot(b.node_id, b.name)}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10.5px] font-bold text-black/80"
                style={{ background: node ? nodeColor(node) : undefined }}
              >
                {avatarLabel(b.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{b.name}</span>
                  <span className="shrink-0 text-[10.5px] text-faint">
                    {ws && ws.id !== b.node_id ? `${ws.name} / ${b.node_name}` : b.node_name}
                  </span>
                </span>
                <span className="block truncate text-[11.5px] text-muted">
                  {t?.preview || b.goal || (b.every ? routine(b) : 'no heartbeat')}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-2 text-[10.5px] text-faint">
                  <span>{routine(b)}</span>
                  {b.agent ? <span>runs {b.agent}</span> : <span>watches only</span>}
                  {b.stop_at?.length > 0 && <span>stops {b.stop_at.join(', ')}</span>}
                </span>
              </span>
              <Icon name="chevron-right" size={13} className="mt-2 shrink-0 text-faint" />
            </button>
          )
        })}

        <div className="px-3 pb-1 pt-4 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
          Agents
        </div>
        {a.agents
          .filter((ag) => ag.id !== 'assistant')
          .map((ag) => {
            const live = a.sessions.find(
              (s) => s.agent_id === ag.id && (s.status === 'working' || s.status === 'planning'),
            )
            return (
              <div
                key={ag.id}
                className="flex items-center gap-3 rounded-lg px-3 py-1.5"
                title="An agent works inside a session. Talk to it by @-ing it in a thread; a bot puts it to work."
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-soft text-[9px] font-bold text-muted">
                  {avatarLabel(ag.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-body">{ag.id}</span>
                  <span className="block truncate text-[10.5px] text-faint">
                    {ag.role} · {ag.provider === 'mock' ? 'mock provider' : ag.provider}
                  </span>
                </span>
                <span className={`shrink-0 text-[10.5px] ${live ? 'text-ok' : 'text-faint'}`}>
                  {live ? `working · ${live.feature_id}` : 'idle'}
                </span>
              </div>
            )
          })}
      </div>

      <div className="shrink-0 border-t border-line px-5 py-2 text-[10.5px] text-faint">
        A bot is someone you talk to. An agent is someone a bot puts to work. Both can be @’d in
        any thread.
      </div>

      {creating && (
        <BotCreate
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false)
            void refreshBots()
            openBot(b.node_id, b.name, true)
          }}
        />
      )}
    </div>
  )
}
