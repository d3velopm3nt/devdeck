// Bots — a contact list, and whoever you picked on the right.
//
// A bot is someone you talk to; an agent is someone a bot puts to work. Both
// are listed, and both can be `@`d in any thread — but only bots have a thread
// of their own, because only a bot outlives the session it started.
//
// The Assistant is first, and it is a contact like the rest: it is the
// orchestrator, it appears in the permission matrix, and talking to it is the
// same loop with a different voice.
//
// This replaced the Bots rail entry. The bot's *page* — plan, knows, tools,
// settings — is still there, one click away, because a thread is the right
// place to talk to a manager and the wrong place to edit its permissions.

import { useEffect, useState } from 'react'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'
import * as ipc from '../../lib/ipc'
import { aiw, type ConversationSummary } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { avatarLabel, nodeColor } from '../../lib/spaces'
import { findNode } from '../../lib/tree'
import { routine } from '../../lib/bots'
import { openBot } from '../../lib/dock'
import { Thread } from '../thread/Thread'
import { CAPTURE_BOT } from '../../lib/devCapture'

/// Who is selected: a bot by its node, or the assistant.
type Picked = { kind: 'bot'; nodeId: number } | { kind: 'assistant' }

export function BotsTab() {
  const { bots, refreshBots, nodes } = useApp()
  const a = useAiw()
  const [picked, setPicked] = useState<Picked>(
    CAPTURE_BOT ? { kind: 'bot', nodeId: Number(CAPTURE_BOT) } : { kind: 'assistant' },
  )
  const [threads, setThreads] = useState<ConversationSummary[] | null>(null)

  useEffect(() => {
    void refreshBots()
    if (a.agents.length === 0) void a.reloadAgents()
    // The previews come from the threads themselves rather than from a second
    // record of "what a bot last said" — there is only one transcript.
    void aiw.conversations().then(setThreads).catch(() => setThreads(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const previewOf = (nodeId: number) => threads?.find((t) => t.bot_node === nodeId)
  const assistantThread = threads?.find((t) => !t.bot_node && !t.feature && !t.node)

  const bot = picked.kind === 'bot' ? bots.find((b) => b.node_id === picked.nodeId) : undefined

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
          <button
            className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
              picked.kind === 'assistant' ? 'bg-hover' : 'hover:bg-hover/50'
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

          {bots.length > 0 && (
            <div className="px-2.5 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
              Bots
            </div>
          )}
          {bots.map((b) => {
            const node = findNode(nodes, b.node_id)
            const on = picked.kind === 'bot' && picked.nodeId === b.node_id
            const t = previewOf(b.node_id)
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
                    <span className="shrink-0 text-[10px] text-faint">{b.node_name}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {t?.preview || (b.every ? routine(b) : 'no heartbeat')}
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
                  title="An agent works inside a session. Talk to it by @-ing it in a thread."
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

      <div className="flex min-w-0 flex-1 flex-col">
        {picked.kind === 'assistant' ? (
          <>
            <div className="shrink-0 border-b border-line px-5 py-3">
              <div className="text-[14px] font-semibold text-ink">Assistant</div>
              <div className="text-[10.5px] text-muted">
                The orchestrator. It can put an agent on a feature and leave a bot behind, and it
                asks before anything that changes your machine.
              </div>
            </div>
            <div className="min-h-0 flex-1 px-5 py-3">
              <AssistantThread />
            </div>
          </>
        ) : bot ? (
          <>
            <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink">{bot.name}</div>
                <div className="text-[10.5px] text-muted">
                  {bot.goal || 'no goal yet'} · {routine(bot)}
                  {bot.team.length > 0 && ` · team ${bot.team.join(', ')}`}
                </div>
              </div>
              <button
                className="btn-ghost shrink-0 text-[11px]"
                onClick={() => openBot(bot.node_id, bot.name)}
              >
                Its page
              </button>
            </div>
            <div className="min-h-0 flex-1 px-5 py-3">
              <Thread
                reloadKey={bot.node_id}
                load={() => ipc.botThread(bot.node_id)}
                send={(text) => ipc.botThreadSend(bot.node_id, text)}
                name={bot.name}
                placeholder={`Message ${bot.name} — @ an agent to pull one in`}
                footnote={
                  bot.agent
                    ? `Runs as ${bot.agent}. Anything needing approval stops and asks you here.`
                    : 'No agent named, so it can answer but not act.'
                }
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-[12px] text-muted">
            That bot is not in this vault any more.
          </div>
        )}
      </div>
    </div>
  )
}

/// The assistant's own thread, opened the same way every other one is.
function AssistantThread() {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    void aiw
      .conversations()
      .then(async (list) => {
        const mine = list.find((c) => !c.bot_node && !c.feature && !c.node)
        setId(mine ? mine.id : (await aiw.newConversation()).id)
      })
      .catch(() => setId(null))
  }, [])

  if (!id) {
    return <div className="py-8 text-center text-[12px] text-muted">Opening the thread…</div>
  }
  return (
    <Thread
      reloadKey={id}
      load={() => aiw.conversation(id)}
      send={(text) => aiw.sendMessage(id, text)}
      name="Assistant"
      placeholder="Ask the assistant…"
      footnote="Conversations and anything it remembers are kept outside every repository."
    />
  )
}
