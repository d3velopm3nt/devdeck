// Bots — the people, as Team's fourth view.
//
// Team is the work: goals, features, items. This is who does it. A list on
// the left; on the right, whoever is selected — in full. Not a chat pane, the
// whole bot page: its thread first, then its overview, plan, what it knows,
// its tools and its settings. A chat pane beside a list hid everything else a
// bot has; the page opens on the thread anyway, so nothing is lost and the
// rest is a tab away instead of unknown.
//
// `compact` is for living inside Team, which already names the view above it:
// the title goes, the New button stays, because that is the only way to make
// a bot from here.
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
type Picked = { kind: 'assistant' } | { kind: 'bot'; nodeId: number; handle?: string; ask?: boolean }

const isPicked = (p: Picked, b: { handle: string; node_id: number }) =>
  p.kind === 'bot' && (p.handle ? p.handle === b.handle : p.nodeId === b.node_id)

const KEY = 'devdeck.bots.picked'

function loadPicked(): Picked {
  if (CAPTURE_BOT) return { kind: 'bot', nodeId: Number(CAPTURE_BOT) }
  const raw = localStorage.getItem(KEY) ?? ''
  const v = Number(raw)
  // A handle now; a space's id from before a space could have several.
  if (raw && !Number.isFinite(v)) return { kind: 'bot', nodeId: 0, handle: raw }
  return Number.isFinite(v) && v > 0 ? { kind: 'bot', nodeId: v } : { kind: 'assistant' }
}

export function BotsPage({ compact }: { compact?: boolean } = {}) {
  const { bots, refreshBots, nodes, activeWorkspaceId } = useApp()
  const a = useAiw()
  const [threads, setThreads] = useState<ConversationSummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<Picked>(loadPicked)

  useEffect(() => {
    localStorage.setItem(KEY, picked.kind === 'bot' ? picked.handle || String(picked.nodeId) : '')
  }, [picked])

  useEffect(() => {
    void refreshBots()
    if (a.agents.length === 0) void a.reloadAgents()
    // Previews come from the threads themselves rather than from a second
    // record of "what a bot last said" — there is only one transcript.
    void aiw.conversations().then(setThreads).catch(() => setThreads(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each manager's own chat, by handle. Several share a space, so the space
  // alone would give all of them the same last line.
  const previewOf = (b: { handle: string; node_id: number; name: string }) =>
    threads?.find((t) => t.bot_handle === b.handle) ??
    threads?.find((t) => !t.bot_handle && t.bot_node === b.node_id && t.title === b.name)
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
    picked.kind === 'bot' && bots.length > 0 && !bots.some((b) => isPicked(picked, b))
      ? { kind: 'assistant' }
      : picked

  return (
    <div className="flex h-full min-h-0 bg-page">
      {/* The list */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-panel">
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-line px-4 ${
            compact ? 'py-2' : 'py-3'
          }`}
        >
          {!compact && (
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-ink">Bots</h2>
              <p className="text-[10.5px] text-muted">Who you talk to, and who they put to work.</p>
            </div>
          )}
          {compact && (
            <span className="text-[10.5px] text-muted">
              {bots.length} bot{bots.length === 1 ? '' : 's'} · {a.agents.length} agent
              {a.agents.length === 1 ? '' : 's'}
            </span>
          )}
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
            const t = previewOf(b)
            const on = isPicked(current, b)
            return (
              <button
                key={b.handle || b.node_id}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                  on ? 'bg-hover' : 'hover:bg-hover/50'
                }`}
                onClick={() => setPicked({ kind: 'bot', nodeId: b.node_id, handle: b.handle })}
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

          {/* Agents are listed, not opened: there is no agent page to go to,
              and a row that looks clickable and is not is worse than one that
              plainly is not. They are here because a bot puts them to work and
              you want to know which of them is busy. */}
          <div className="px-2.5 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
            Agents
            <span className="ml-1.5 font-normal normal-case tracking-normal text-faint">
              · @ one in a thread to use it
            </span>
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
          <BotDetail
            key={current.handle || current.nodeId}
            nodeId={bots.find((b) => isPicked(current, b))?.node_id ?? current.nodeId}
            handle={current.handle}
            ask={current.ask}
          />
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
            setPicked({ kind: 'bot', nodeId: b.node_id, handle: b.handle, ask: true })
          }}
        />
      )}
    </div>
  )
}
