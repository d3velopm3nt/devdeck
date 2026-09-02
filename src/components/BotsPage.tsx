// Bots — the people, on a page of their own.
//
// Team is the work: goals, features, items. This is who does it. A list on
// the left; on the right, whoever is selected — in full. Not a chat pane, the
// whole bot page: its thread first, then its overview, plan, what it knows,
// its tools and its settings. A chat pane beside a list hid everything else a
// bot has; the page opens on the thread anyway, so nothing is lost and the
// rest is a tab away instead of unknown.
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
import { BotCreate } from './bot/BotCreate'
import { BotDetail } from './bot/BotPage'
import { AssistantThread } from './thread/AssistantThread'
import { CAPTURE_BOT } from '../lib/devCapture'

/// Who is on the right: a bot by its node, or the assistant.
type Picked = { kind: 'assistant' } | { kind: 'bot'; nodeId: number; ask?: boolean }

const KEY = 'devdeck.bots.picked'

function loadPicked(): Picked {
  if (CAPTURE_BOT) return { kind: 'bot', nodeId: Number(CAPTURE_BOT) }
  const v = Number(localStorage.getItem(KEY))
  return Number.isFinite(v) && v > 0 ? { kind: 'bot', nodeId: v } : { kind: 'assistant' }
}

export function BotsPage() {
  const { bots, refreshBots, nodes, activeWorkspaceId } = useApp()
  const a = useAiw()
  const [threads, setThreads] = useState<ConversationSummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<Picked>(loadPicked)

  useEffect(() => {
    localStorage.setItem(KEY, picked.kind === 'bot' ? String(picked.nodeId) : '')
  }, [picked])

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

  // Every bot, every workspace. A bot two tabs over is still one of yours,
  // and "which workspace is open" is the wrong thing for this list to hide
  // behind — each row says where it lives instead.
  const candidates = nodes.filter(
    (n) =>
      !bots.some((b) => b.node_id === n.id) &&
      (activeWorkspaceId == null || subtreeIds(nodes, activeWorkspaceId).includes(n.id)),
  )

  // A bot that was deleted while selected must not leave a page for nothing.
  const current: Picked =
    picked.kind === 'bot' && bots.length > 0 && !bots.some((b) => b.node_id === picked.nodeId)
      ? { kind: 'assistant' }
      : picked

  return (
    <div className="flex h-full min-h-0 bg-page">
      {/* The list */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">Bots</h2>
            <p className="text-[10.5px] text-muted">Who you talk to, and who they put to work.</p>
          </div>
          <button
            className="btn-primary ml-auto shrink-0 text-[11px]"
            disabled={candidates.length === 0}
            title={
              candidates.length === 0 ? 'Every folder in this workspace already has one' : 'New bot'
            }
            onClick={() => setCreating(true)}
          >
            <Icon name="add" size={12} /> New
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
          <button
            className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
              current.kind === 'assistant' ? 'bg-hover' : 'hover:bg-hover/50'
            }`}
            onClick={() => setPicked({ kind: 'assistant' })}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
              <Icon name="ai" size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">Assistant</span>
              <span className="block truncate text-[11px] text-muted">
                {assistantThread?.preview || 'the one you talk to about everything'}
              </span>
            </span>
          </button>

          <div className="px-2.5 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
            Bots
          </div>
          {bots.length === 0 && (
            <div className="px-2.5 py-3 text-[11px] leading-relaxed text-muted">
              No bots yet. A bot is a goal, a heartbeat and the work it manages — written as{' '}
              <code className="text-dim">_bot.md</code> in the folder it runs.
            </div>
          )}
          {bots.map((b) => {
            const node = findNode(nodes, b.node_id)
            const ws = workspaceOf(nodes, node)
            const t = previewOf(b.node_id)
            const on = current.kind === 'bot' && current.nodeId === b.node_id
            return (
              <button
                key={b.node_id}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                  on ? 'bg-hover' : 'hover:bg-hover/50'
                }`}
                onClick={() => setPicked({ kind: 'bot', nodeId: b.node_id })}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-black/80"
                  style={{ background: node ? nodeColor(node) : undefined }}
                >
                  {avatarLabel(b.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{b.name}</span>
                    <span className="shrink-0 text-[10px] text-faint">
                      {ws && ws.id !== b.node_id ? ws.name : b.node_name}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {t?.preview || b.goal || (b.every ? routine(b) : 'no heartbeat')}
                  </span>
                </span>
              </button>
            )
          })}

          <div className="px-2.5 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
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
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5"
                  title="An agent works inside a session. Talk to it by @-ing it in a thread; a bot puts it to work."
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-soft text-[9px] font-bold text-muted">
                    {avatarLabel(ag.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-body">{ag.id}</span>
                  <span className={`shrink-0 text-[10px] ${live ? 'text-ok' : 'text-faint'}`}>
                    {live ? `working · ${live.feature_id}` : 'idle'}
                  </span>
                </div>
              )
            })}
        </div>

        <div className="shrink-0 border-t border-line px-4 py-2 text-[10px] leading-[1.5] text-faint">
          A bot is someone you talk to. An agent is someone a bot puts to work. Both can be @’d.
        </div>
      </div>

      {/* The one you picked, in full */}
      <div className="min-w-0 flex-1">
        {current.kind === 'assistant' ? (
          <AssistantThread />
        ) : (
          <BotDetail key={current.nodeId} nodeId={current.nodeId} ask={current.ask} />
        )}
      </div>

      {creating && (
        <BotCreate
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false)
            void refreshBots()
            // Straight onto its page, with the interview open: a bot that was
            // just made is the one time asking is welcome.
            setPicked({ kind: 'bot', nodeId: b.node_id, ask: true })
          }}
        />
      )}
    </div>
  )
}
