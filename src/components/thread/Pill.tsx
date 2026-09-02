// A participant, as a pill — in the header, on a message, inside the text.
//
// The same pill everywhere, because it is the same person. Live from two
// sources: the turn events (thinking, in this room) and the runtime's sessions
// (working on an item, somewhere). Hovering shows the card — who they are,
// what they are on, what they last did. A name in small grey text was a name;
// this is someone you can glance at.
//
// `@dev-a` in a sentence is the inline size of the same pill. Text that names
// someone and does nothing about it looks like a mention that failed.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAiw } from '../../lib/aiwStore'
import { aiw } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { openAgentSettings, openBot } from '../../lib/dock'
import { Icon } from '../../lib/icons'
import { ModelPicker } from '../aiw/ModelPicker'

/// The three kinds of provider an agent can run on. Same list the assistant's
/// own chip offers, so a change made here is the same change made there.
const PROVIDERS = ['mock', 'anthropic', 'openai-compatible']

/// Change what an agent runs on, from inside its card.
///
/// "dev-a is on the mock provider" is only worth saying if fixing it is
/// right there. Same call the assistant's chip makes; the agent list is
/// re-read afterwards so every pill for this agent changes at once.
function ProviderSwitch({ agent }: { agent: { id: string; provider: string; model: string } }) {
  const a = useAiw()
  const [draft, setDraft] = useState({ provider: agent.provider, model: agent.model })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft({ provider: agent.provider, model: agent.model })
  }, [agent.provider, agent.model])
  const dirty = draft.provider !== agent.provider || draft.model !== agent.model

  const apply = async () => {
    setSaving(true)
    setError(null)
    try {
      await aiw.setAgentProvider(agent.id, draft.provider, draft.model)
      await a.reloadAgents()
    } catch (e) {
      // A refused switch must not look like a switch: the card keeps saying
      // what the agent actually runs on, and this says why.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="mt-2 block border-t border-line pt-2">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
        Runs on
      </span>
      <select
        className="input mt-1 w-full text-[11.5px]"
        value={draft.provider}
        onChange={(e) => setDraft({ provider: e.target.value, model: '' })}
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p === 'mock' ? 'Mock (no AI)' : p}
          </option>
        ))}
      </select>
      <span className="mt-1.5 block">
        <ModelPicker
          key={draft.provider}
          providerId={draft.provider}
          value={draft.model}
          onChange={(model) => setDraft({ ...draft, model })}
          compact
        />
      </span>
      {error && <span className="mt-1 block text-[10.5px] text-err">{error}</span>}
      <span className="mt-2 flex items-center gap-1.5">
        <button
          className="btn-primary text-[11px]"
          disabled={!dirty || saving || !draft.model}
          onClick={() => void apply()}
        >
          {saving ? 'Applying…' : 'Apply'}
        </button>
        <button
          className="btn-ghost text-[11px]"
          title="Instructions, skills and permissions"
          onClick={() => openAgentSettings(agent.id)}
        >
          <Icon name="settings" size={11} /> More
        </button>
      </span>
    </span>
  )
}

/// Who is mid-turn right now, by id, with the name the turn announced. The
/// thread provides it; every pill inside reads it.
export const SpeakingContext = createContext<Record<string, string>>({})

/// Which thread a pill is in, so its card can wake someone into it.
export const ThreadContext = createContext<{ convId: string | null; feature: boolean }>({
  convId: null,
  feature: false,
})

/// The id behind an `@handle`, or null when nobody answers to it.
///
/// Agents are named by id. A bot answers to its folder's name, hyphenated —
/// the same rule the backend resolves — and to the start of its own name.
export function resolveHandle(
  handle: string,
  agents: { id: string; name: string }[],
  bots: { node_id: number; node_name: string; name: string }[],
): string | null {
  const h = handle.toLowerCase()
  if (h === 'you') return 'you'
  if (agents.some((a) => a.id.toLowerCase() === h)) return h
  const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-')
  const bot = bots.find(
    (b) =>
      slug(b.node_name) === h ||
      slug(b.name) === h ||
      `${slug(b.node_name)}-bot` === h ||
      slug(b.node_name).split('-')[0] === h ||
      slug(b.name).split('-')[0] === h,
  )
  return bot ? `bot:${bot.node_id}` : null
}

export function Pill({
  id,
  label,
  host = false,
  inline = false,
}: {
  id: string
  label: string
  /// Whoever answers here when nobody is named.
  host?: boolean
  /// Inside a sentence: smaller, and the handle rather than the full name.
  inline?: boolean
}) {
  const [open, setOpen] = useState(false)
  const thread = useContext(ThreadContext)
  const [waking, setWaking] = useState<string | null>(null)
  // Hover opens the card; using a control inside pins it, because a select's
  // dropdown reaches outside the card and would otherwise close it mid-pick.
  // A click anywhere else unpins.
  const [pinned, setPinned] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLSpanElement>(null)
  // The card is rendered at the document root, not inside the message list:
  // a list scrolls, and anything inside it is clipped at its bottom edge —
  // which is exactly where the pill on the last message sits. Positioned
  // from the pill's rectangle, and flipped above it when there is no room
  // below.
  const [at, setAt] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const place = () => {
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return
    const room = window.innerHeight - r.bottom
    const up = room < 300 && r.top > room
    const left = Math.min(r.left, Math.max(8, window.innerWidth - 292))
    setAt({ left, top: up ? r.top - 6 : r.bottom + 6, up })
  }
  // Leaving the pill for the card must not close the card. Both sides count
  // as "over it", and closing waits a beat so the gap between them is not a
  // door slamming.
  const leaveTimer = useRef<number | null>(null)
  const enter = () => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
    place()
    setOpen(true)
  }
  const leave = () => {
    if (pinned) return
    leaveTimer.current = window.setTimeout(() => setOpen(false), 120)
  }
  useEffect(() => {
    if (!pinned) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrap.current?.contains(t) && !card.current?.contains(t)) {
        setPinned(false)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [pinned])
  const speaking = useContext(SpeakingContext)
  const agents = useAiw((s) => s.agents)
  const sessions = useAiw((s) => s.sessions)
  const approvals = useAiw((s) => s.approvals)
  const bots = useApp((s) => s.bots)

  if (id === 'you') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 font-medium text-warn ${
          inline ? 'px-1.5 py-px text-[11px] align-baseline' : 'px-2 py-[3px] text-[11px]'
        }`}
        title="Addressed to you. This is what puts it in the Inbox."
      >
        @you
      </span>
    )
  }

  const isBot = id.startsWith('bot:')
  const bot = isBot ? bots.find((b) => `bot:${b.node_id}` === id) : undefined
  const agent = !isBot ? agents.find((a) => a.id === id) : undefined
  const live = sessions.find(
    (x) => x.agent_id === id && (x.status === 'working' || x.status === 'planning'),
  )
  const waiting = approvals.find((r) => r.agent_id === id)
  const last = sessions
    .filter((x) => x.agent_id === id)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0]

  const thinking = id in speaking
  const status = thinking
    ? { text: 'thinking…', dot: 'bg-indigo-400 animate-pulse', tone: 'text-indigo-300' }
    : waiting
      ? { text: 'waiting on you', dot: 'bg-amber-400', tone: 'text-warn' }
      : live
        ? { text: `working · ${live.feature_id}`, dot: 'bg-emerald-400', tone: 'text-ok' }
        : bot
          ? {
              text: bot.every ? 'watching' : 'no heartbeat',
              dot: bot.every ? 'bg-emerald-400/70' : 'bg-line3',
              tone: 'text-muted',
            }
          : { text: 'idle', dot: 'bg-line3', tone: 'text-muted' }

  return (
    <span
      ref={wrap}
      className="relative inline-block align-baseline"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onMouseDown={() => setPinned(true)}
    >
      <span
        className={`inline-flex cursor-default items-center gap-1.5 rounded-full border ${
          inline ? 'px-1.5 py-px text-[11px]' : 'px-2 py-[3px] text-[11px]'
        } ${
          thinking
            ? 'border-indigo-500/40 bg-indigo-500/10 text-ink'
            : host
              ? 'border-line2 bg-raise text-ink'
              : 'border-line bg-panel text-body'
        }`}
      >
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${status.dot}`} />
        <span className="font-medium">{inline ? `@${label}` : label}</span>
        {!inline && <span className={`text-[10px] ${status.tone}`}>{status.text}</span>}
      </span>

      {open &&
        at &&
        createPortal(
        <span
          ref={card}
          className="fixed z-50 block w-[284px] rounded-lg border border-line bg-menu p-3 text-left text-[11px] font-normal shadow-lg"
          style={{
            left: at.left,
            top: at.top,
            transform: at.up ? 'translateY(-100%)' : undefined,
          }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onMouseDown={() => setPinned(true)}
        >
          <span className="block text-[12px] font-semibold text-ink">
            {bot?.name ?? agent?.name ?? label}
          </span>
          <span className="block text-[10.5px] text-muted">
            {bot
              ? `bot · ${bot.node_name}${bot.agent ? ` · runs ${bot.agent}` : ' · watches only'}`
              : agent
                ? `${agent.role} · ${agent.provider === 'mock' ? 'mock provider' : agent.provider} · ${agent.model}`
                : host
                  ? 'the assistant'
                  : id}
          </span>
          {agent?.provider === 'mock' && (
            <span className="mt-1 block text-[10.5px] text-warn">
              Scripted: it cannot think until it is pointed at a real provider.
            </span>
          )}
          <span className={`mt-1.5 block ${status.tone}`}>{status.text}</span>
          {bot?.goal && <span className="mt-1.5 block text-body">{bot.goal}</span>}
          {waiting && (
            <span className="mt-1.5 block text-body">
              wants to {waiting.summary} — answer it at the top of the window
            </span>
          )}
          {live && (
            <span className="mt-1.5 block text-body">
              {live.turns} turn{live.turns === 1 ? '' : 's'} so far
              {live.transcript.length > 0 &&
                ` · ${live.transcript[live.transcript.length - 1].text}`}
            </span>
          )}
          {!live && last && (
            <span className="mt-1.5 block text-muted">
              last: {last.status} on {last.feature_id}
              {last.summary && ` — ${last.summary}`}
            </span>
          )}
          {bot?.last_woke && (
            <span className="mt-1.5 block text-[10.5px] text-faint">
              last woke {new Date(bot.last_woke).toLocaleString()}
            </span>
          )}
          {agent && thread.convId && (
            <span className="mt-2 block border-t border-line pt-2">
              <button
                className="btn-primary text-[11px]"
                disabled={!!waking || thinking || !!live}
                title={
                  thread.feature
                    ? 'Start a session on this feature; it reports back here'
                    : 'Have it read this thread and answer now'
                }
                onClick={() => {
                  setWaking('…')
                  void ipc
                    .threadWake(thread.convId as string, agent.id)
                    .then((line) => setWaking(line))
                    .catch((e) => setWaking(String(e)))
                }}
              >
                <Icon name="update" size={11} /> {live ? 'Working' : 'Wake'}
              </button>
              <span className="ml-2 text-[10.5px] text-muted">
                {waking ??
                  (thread.feature ? 'starts a session on this feature' : 'answers in this thread')}
              </span>
            </span>
          )}
          {agent && <ProviderSwitch agent={agent} />}
          {bot && (
            <span className="mt-2 flex gap-1.5">
              <button
                className="btn-ghost text-[11px]"
                onClick={() => openBot(bot.node_id, bot.name)}
              >
                <Icon name="bot" size={11} /> Open its page
              </button>
              {bot.schedule_id && (
                <button
                  className="btn-primary text-[11px]"
                  disabled={!!waking}
                  title="Run its heartbeat now; the receipt lands in its thread"
                  onClick={() => {
                    setWaking('…')
                    void ipc
                      .scheduleRunNow(bot.schedule_id as number)
                      .then((r) => setWaking(r.note || (r.ok ? 'woke, nothing to say' : 'did not run')))
                      .catch((e) => setWaking(String(e)))
                  }}
                >
                  <Icon name="update" size={11} /> Wake it
                </button>
              )}
              {waking && <span className="text-[10.5px] text-muted">{waking}</span>}
            </span>
          )}
        </span>,
        document.body,
      )}
    </span>
  )
}

/// A message's text with every `@name` that names someone drawn as a pill.
///
/// A handle nobody answers to stays as typed: turning it into a pill would
/// claim a participant that does not exist, and an email address is not a
/// mention (the same rule the backend's parser follows).
export function MentionText({ text }: { text: string }): ReactNode {
  const agents = useAiw((s) => s.agents)
  const bots = useApp((s) => s.bots)
  const parts: ReactNode[] = []
  const re = /(^|[^\w.])@([\w-]+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length
    parts.push(text.slice(last, start))
    const id = resolveHandle(m[2], agents, bots)
    parts.push(
      id ? <Pill key={`${start}-${m[2]}`} id={id} label={m[2]} inline /> : `@${m[2]}`,
    )
    last = start + 1 + m[2].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}
