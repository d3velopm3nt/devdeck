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

import { createContext, useContext, useState, type ReactNode } from 'react'
import { useAiw } from '../../lib/aiwStore'
import { useApp } from '../../store'

/// Who is mid-turn right now, by id, with the name the turn announced. The
/// thread provides it; every pill inside reads it.
export const SpeakingContext = createContext<Record<string, string>>({})

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
      className="relative inline-block align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
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

      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 block w-[280px] rounded-lg border border-line bg-menu p-3 text-left text-[11px] font-normal shadow-lg">
          <span className="block text-[12px] font-semibold text-ink">
            {bot?.name ?? agent?.name ?? label}
          </span>
          <span className="block text-[10.5px] text-muted">
            {bot
              ? `bot · ${bot.node_name}${bot.agent ? ` · runs ${bot.agent}` : ' · watches only'}`
              : agent
                ? `${agent.role} · ${agent.provider === 'mock' ? 'mock provider' : agent.provider}`
                : host
                  ? 'the assistant'
                  : id}
          </span>
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
        </span>
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
