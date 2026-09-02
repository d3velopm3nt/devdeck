// One thread, wherever it is.
//
// A node's thread, a feature's room and a bot's own thread are the same
// record in three places, so they are the same component. What differs is who
// answers and what there is to say — not how a message is drawn, and not how
// you send one.
//
// Three kinds of line, and keeping them apart is the whole readability of the
// surface:
//
//   * **Someone said something** — a bubble, with a name, because a room with
//     five things talking in it cannot be read otherwise.
//   * **The thread recorded something** — a rule across the middle. Nobody
//     asked a question: a participant was pulled in, a claim moved, a session
//     came back. Drawing those as speech would put words in an agent's mouth.
//   * **A tool ran** — collapsed evidence, the shape the assistant already
//     uses.

import { useCallback, useEffect, useRef, useState } from 'react'
import { aiw, ago, type ChatEvent, type ChatMessage, type ConversationMeta } from '../../lib/aiw'
import { Bubble } from '../aiw/Chat'
import { Icon, type IconName } from '../../lib/icons'
import { useSpeakers } from './speakers'
import { useAiw } from '../../lib/aiwStore'
import { MentionText, Pill, SpeakingContext, ThreadContext } from './Pill'
import { openAgentSettings, openBot } from '../../lib/dock'
import { useApp } from '../../store'

/// Someone you can @: an agent, a bot, or you.
interface Handle {
  handle: string
  name: string
  kind: 'agent' | 'bot' | 'you'
  /// What it runs on, or when it wakes.
  meta?: string
  /// What it is doing right now.
  state?: { text: string; tone: string }
  /// Where to go to change it.
  open?: () => void
}

/// The `@word` the caret is inside, if any — its start offset and the word.
function mentionAt(text: string, caret: number): { start: number; word: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  // Part of an email or a word: not a mention.
  if (at > 0 && /[\w.]/.test(before[at - 1])) return null
  const word = before.slice(at + 1)
  if (/\s/.test(word)) return null
  return { start: at, word }
}

/// The receipt kinds. Anything else with a `tool` is a real tool step.
const RECEIPTS: Record<string, { icon: IconName; tint: string }> = {
  'pulled-in': { icon: 'agent', tint: 'text-indigo-400' },
  handover: { icon: 'arrow-right', tint: 'text-ok' },
  session: { icon: 'check', tint: 'text-ok' },
  routine: { icon: 'schedule', tint: 'text-ok' },
  grant: { icon: 'secret', tint: 'text-viol' },
}

/// Something the thread recorded, drawn as a rule rather than as speech.
function Receipt({ m }: { m: ChatMessage }) {
  const kind = RECEIPTS[m.tool ?? ''] ?? { icon: 'info' as IconName, tint: 'text-muted' }
  const failed = m.ok === false
  return (
    <div className="my-2 flex items-center gap-2.5">
      <span className="h-px max-w-[120px] flex-1 bg-line" />
      <span
        className={`flex items-center gap-1.5 text-center text-[11px] ${
          failed ? 'text-err' : 'text-dim'
        }`}
      >
        <Icon name={failed ? 'alert' : kind.icon} size={11} className={failed ? '' : kind.tint} />
        <MentionText text={m.text} />
      </span>
      <span className="h-px max-w-[120px] flex-1 bg-line" />
    </div>
  )
}

/// A wake report. Not a reply to anything — the bot came back from looking —
/// so it is a receipt with the time it woke rather than a speech bubble.
function Wake({ m, name }: { m: ChatMessage; name: string }) {
  return (
    <div className="my-2 flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300">
        <Icon name="schedule" size={12} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[11.5px] font-semibold text-ink">{name}</span>
          <span className="text-[10px] text-faint">woke · {ago(m.at)}</span>
        </div>
        <div className="rounded-lg border border-line bg-raise px-3.5 py-2.5 text-[12px] leading-[1.6] text-body">
          <MentionText text={m.text} />
        </div>
      </div>
    </div>
  )
}

/// A run of tool steps, folded into one line.
///
/// The steps are evidence and they have to stay — "I read the roadmap" is a
/// claim, a `files.read` row is a fact. But fourteen of them between two
/// sentences turn a room into a log, and the room is the thing worth reading.
/// So a run collapses to one line that says how many and what they touched,
/// and opens on a click.
function Steps({ steps, who }: { steps: ChatMessage[]; who: (m: ChatMessage) => string }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 1 && !open) {
    return <Bubble m={steps[0]} who={who(steps[0])} />
  }
  const failed = steps.filter((m) => m.ok === false).length
  const kinds = Array.from(new Set(steps.map((m) => (m.tool ?? '').split('.')[0]))).filter(Boolean)
  return (
    <div className="my-1.5 ml-9">
      <button
        className="inline-flex items-center gap-1.5 rounded border border-line bg-raise px-2 py-1 text-left text-[10.5px] text-muted hover:text-dim"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        {steps.length} step{steps.length === 1 ? '' : 's'}
        <span className="text-faint">{kinds.join(' · ')}</span>
        {failed > 0 && <span className="text-err">{failed} failed</span>}
      </button>
      {open && steps.map((m, i) => <Bubble key={i} m={m} who={who(m)} />)}
    </div>
  )
}

/// The transcript, with runs of tool steps folded together.
function fold(messages: ChatMessage[]): (ChatMessage | ChatMessage[])[] {
  const out: (ChatMessage | ChatMessage[])[] = []
  for (const m of messages) {
    const isStep = m.from === 'tool'
    const last = out[out.length - 1]
    if (isStep && Array.isArray(last)) last.push(m)
    else if (isStep) out.push([m])
    else out.push(m)
  }
  return out
}

export interface ThreadProps {
  /// Read the thread. Called on mount and after every send, because the
  /// backend decides the timestamps, the receipts and the tool steps — a
  /// transcript assembled from two sources drifts.
  load: () => Promise<ConversationMeta>
  send: (text: string) => Promise<unknown>
  /// Who answers here, when a message does not name anyone.
  name: string
  /// What the composer says before you type in it.
  placeholder?: string
  /// One line under the composer: what this thread can and cannot do.
  footnote?: string
  /// Shown instead of the transcript when there is nothing in it yet.
  empty?: React.ReactNode
  /// Re-read when this changes.
  reloadKey?: string | number
}

export function Thread({ load, send, name, placeholder, footnote, empty, reloadKey }: ThreadProps) {
  const [conv, setConv] = useState<ConversationMeta | null>(null)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')
  // The picker: which handles match the `@word` at the caret, and which one is
  // lit. It is a courtesy — the backend reads `@name` out of the sent text
  // either way — but a thing that only works if you already know the exact
  // id is a thing that looks broken.
  const [pick, setPick] = useState(0)
  const [caret, setCaret] = useState(0)
  const agents = useAiw((s) => s.agents)
  const sessions = useAiw((s) => s.sessions)
  const approvals = useAiw((s) => s.approvals)
  const bots = useApp((s) => s.bots)
  const mention = mentionAt(draft, caret)
  const stateOf = (id: string): Handle['state'] => {
    if (id in speaking) return { text: 'thinking…', tone: 'text-indigo-300' }
    if (approvals.some((r) => r.agent_id === id)) return { text: 'waiting on you', tone: 'text-warn' }
    const live = sessions.find(
      (x) => x.agent_id === id && (x.status === 'working' || x.status === 'planning'),
    )
    if (live) return { text: `working · ${live.feature_id}`, tone: 'text-ok' }
    return { text: 'idle', tone: 'text-faint' }
  }
  const handles: Handle[] = mention
    ? [
        { handle: 'you', name: 'you — puts it in the Inbox', kind: 'you' as const },
        // A bot answers to its folder's name, hyphenated, which is what the
        // backend resolves. Its display name is shown beside it.
        ...bots.map((b) => ({
          handle: b.node_name.trim().toLowerCase().replace(/\s+/g, '-'),
          name: b.name,
          kind: 'bot' as const,
          meta: b.agent ? `runs ${b.agent}` : 'watches only',
          state: b.every
            ? { text: 'watching', tone: 'text-muted' }
            : { text: 'no heartbeat', tone: 'text-faint' },
          open: () => openBot(b.node_id, b.name),
        })),
        ...agents
          .filter((a) => a.id !== 'assistant')
          .map((a) => ({
            handle: a.id,
            name: a.name,
            kind: 'agent' as const,
            meta: `${a.provider === 'mock' ? 'mock' : a.provider} · ${a.model}`,
            state: stateOf(a.id),
            open: () => openAgentSettings(a.id),
          })),
      ].filter(
        (h) =>
          h.handle.toLowerCase().startsWith(mention.word.toLowerCase()) ||
          h.name.toLowerCase().startsWith(mention.word.toLowerCase()),
      )
    : []
  const choose = (h: Handle) => {
    if (!mention) return
    const next = `${draft.slice(0, mention.start)}@${h.handle} ${draft.slice(caret)}`
    setDraft(next)
    setPick(0)
    const pos = mention.start + h.handle.length + 2
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [steps, setSteps] = useState<ChatMessage[]>([])
  // Who is mid-turn right now, by id, with the name the turn announced. A
  // pill lights up on the start event and goes out on the done one — which
  // is what "see the agent become active when I name it" means.
  const [speaking, setSpeaking] = useState<Record<string, string>>({})
  const hostId = conv?.bot_node != null ? `bot:${conv.bot_node}` : conv?.messages.find((m) => m.by && m.from === 'assistant')?.by
  const bottom = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const speakers = useSpeakers()
  // Every message in a thread is a model call. With no provider configured the
  // mock answers, and it can coordinate but not think — so the thread says so
  // rather than letting a scripted line pass for a conversation. Making a
  // space, a bot or a routine still works with no key at all; only talking
  // needs one.
  const onMock = useAiw((s) => {
    const a = s.agents.find((x) => x.id === 'assistant')
    return !!a && a.provider === 'mock'
  })

  const reload = useCallback(() => {
    return load()
      .then((c) => {
        setConv(c)
        setErr('')
      })
      .catch((e) => setErr(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  useEffect(() => {
    setConv(null)
    void reload()
  }, [reload])

  // The pills read live sessions and approvals. Load them here and keep them
  // moving: a room may be the first thing opened, before anything else has
  // asked the runtime for them, and a pill that says "idle" about an agent
  // mid-session is the kind of wrong that costs trust.
  useEffect(() => {
    const a = useAiw.getState()
    if (!a.ready) void a.bootstrap()
    void a.refreshApprovals()
    let stop: (() => void) | undefined
    void aiw
      .onEvent(() => {
        void useAiw.getState().refreshApprovals()
        void aiw.sessions().then((sessions) => useAiw.setState({ sessions })).catch(() => {})
      })
      .then((un) => {
        stop = un
      })
    void aiw.sessions().then((sessions) => useAiw.setState({ sessions })).catch(() => {})
    return () => stop?.()
  }, [])

  // Progress arrives on the assistant's channel, keyed by conversation. Only
  // this one is ours: another thread's tokens spliced in here would be worse
  // than a spinner.
  useEffect(() => {
    let stop: (() => void) | undefined
    void aiw
      .onChat((e: ChatEvent) => {
        if (!conv || e.conversation_id !== conv.id) return
        if (e.kind === 'delta') setStreaming((s) => s + e.text)
        if (e.kind === 'step') setSteps((s) => [...s, e.message])
        if (e.kind === 'turn') {
          setSpeaking((cur) => {
            const next = { ...cur }
            if (e.done) delete next[e.by]
            else next[e.by] = e.name
            return next
          })
          // A new voice: what streamed so far belonged to the last one.
          if (!e.done) setStreaming('')
          // A turn that ended while nothing was being sent from here — a
          // wake, an agent answering after the host — lands on disk, not in
          // this component. Re-read, or the room shows a reply that never
          // arrives until you type.
          if (e.done) void reload()
        }
      })
      .then((un) => {
        stop = un
      })
    return () => stop?.()
  }, [conv?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [conv?.messages.length, sending, streaming, steps.length])

  const submit = async () => {
    const text = draft.trim()
    if (!text || sending || !conv) return
    // Shown before the round trip: a message that vanishes until the reply
    // lands reads as a dropped one.
    const pending: ChatMessage = { at: new Date().toISOString(), from: 'user', text }
    setConv({ ...conv, messages: [...conv.messages, pending] })
    setDraft('')
    setSending(true)
    setStreaming('')
    setSteps([])
    if (box.current) box.current.style.height = 'auto'
    try {
      await send(text)
      await reload()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSending(false)
      setStreaming('')
      setSteps([])
    }
  }

  const who = (m: ChatMessage) => (m.by ? speakers(m.by) : name)

  return (
    <SpeakingContext.Provider value={speaking}>
    <ThreadContext.Provider value={{ convId: conv?.id ?? null, feature: !!conv?.feature }}>
    <div className="flex h-full min-h-0 flex-col">
      {err && (
        <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[11.5px] leading-[1.5] text-err">
          {err}
        </div>
      )}

      {conv && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line pb-2">
          <span className="mr-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            In this thread
          </span>
          <Pill id={hostId ?? ''} label={name} host />
          {(conv.participants ?? []).map((p) => (
            <Pill key={p} id={p} label={speakers(p)} />
          ))}
        </div>
      )}

      {onMock && (
        <div className="mb-2 flex shrink-0 items-start gap-2 rounded-lg border border-line bg-raise px-3 py-2 text-[11px] leading-[1.55] text-dim">
          <Icon name="info" size={12} className="mt-px shrink-0 text-indigo-400" />
          <span>
            Running on the <span className="text-ink">mock provider</span>: replies here are
            scripted. Spaces, bots and routines all still work with no API key — talking is the
            part that needs one. Connect a provider under Settings → Assistant.
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {conv == null && !err ? (
          <div className="py-8 text-center text-[12px] text-muted">Opening the thread…</div>
        ) : conv && conv.messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Icon name="ai" size={22} className="text-faint" />
            <div className="text-[12.5px] text-dim">Nothing said yet</div>
            {empty && (
              <div className="max-w-[460px] text-[11.5px] leading-relaxed text-muted">{empty}</div>
            )}
          </div>
        ) : (
          fold(conv?.messages ?? []).map((m, i) =>
            Array.isArray(m) ? (
              <Steps key={i} steps={m} who={who} />
            ) : m.tool === 'wake' ? (
              <Wake key={i} m={m} name={who(m)} />
            ) : m.tool && RECEIPTS[m.tool] ? (
              <Receipt key={i} m={m} />
            ) : (
              <Bubble
                key={i}
                m={m}
                who={who(m)}
                nameNode={m.by ? <Pill id={m.by} label={who(m)} /> : hostId ? <Pill id={hostId} label={name} host /> : undefined}
                renderText={(t) => <MentionText text={t} />}
              />
            ),
          )
        )}
        {steps.map((m, i) => (
          <Bubble key={`s-${i}`} m={m} who={who(m)} renderText={(t) => <MentionText text={t} />} />
        ))}
        {sending && (
          <div className="flex gap-3 py-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300">
              <Icon name="ai" size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[11.5px] font-semibold text-ink">
                {Object.keys(speaking)[0] ? (
                  <Pill id={Object.keys(speaking)[0]} label={Object.values(speaking)[0]} />
                ) : (
                  name
                )}
              </div>
              {streaming ? (
                <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-body">
                  {streaming}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[11.5px] text-muted">
                  <Icon name="spinner" size={12} className="animate-spin" />
                  {steps.length > 0 ? 'still working' : 'reading'}
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="relative mt-3 shrink-0 border-t border-line pt-3">
        {mention && handles.length > 0 && (
          <div className="absolute bottom-full left-0 z-10 mb-1 w-[300px] overflow-hidden rounded-lg border border-line bg-menu shadow-lg">
            {handles.slice(0, 8).map((h, i) => (
              <div
                key={h.kind + h.handle}
                className={`group flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] ${
                  i === pick ? 'bg-hover text-ink' : 'text-body hover:bg-hover/50'
                }`}
                onMouseDown={(e) => {
                  // Before the textarea loses focus, or the caret is gone.
                  e.preventDefault()
                  choose(h)
                }}
              >
                <Icon
                  name={h.kind === 'bot' ? 'bot' : h.kind === 'agent' ? 'agent' : 'inbox'}
                  size={12}
                  className="shrink-0 text-indigo-400"
                />
                <span className="font-mono text-[11.5px]">@{h.handle}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-[11px] text-muted">{h.name}</span>
                  {h.meta && <span className="ml-1.5 text-[10px] text-faint">{h.meta}</span>}
                </span>
                {h.state && (
                  <span className={`shrink-0 text-[10px] ${h.state.tone}`}>{h.state.text}</span>
                )}
                {h.open && (
                  <button
                    className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
                    title={h.kind === 'bot' ? 'Open its page' : 'Provider, model, permissions'}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      h.open?.()
                    }}
                  >
                    <Icon name={h.kind === 'bot' ? 'external' : 'settings'} size={12} />
                  </button>
                )}
              </div>
            ))}
            <div className="border-t border-line px-3 py-1 text-[10px] text-faint">
              A mention pulls them in. Add <span className="font-mono">take "an item"</span> to hand work over.
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={box}
            rows={1}
            className="input max-h-40 min-h-[34px] flex-1 resize-none py-2 text-[12.5px]"
            placeholder={placeholder ?? `Message ${name}…`}
            value={draft}
            disabled={!conv || sending}
            onChange={(e) => {
              setDraft(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              setPick(0)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={(e) => {
              const open = mention && handles.length > 0
              if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                const n = Math.min(handles.length, 8)
                setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
                return
              }
              if (open && (e.key === 'Tab' || e.key === 'Enter')) {
                e.preventDefault()
                choose(handles[pick] ?? handles[0])
                return
              }
              if (open && e.key === 'Escape') {
                // Close it by breaking the word: a space after the @ is a
                // mention of nobody, which is what dismissing means.
                e.preventDefault()
                setCaret(0)
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <button
            className="btn-primary h-[34px] px-3 text-[12px]"
            disabled={!draft.trim() || sending || !conv}
            onClick={() => void submit()}
          >
            Send
          </button>
        </div>
        {footnote && <div className="mt-1.5 text-[10.5px] text-faint">{footnote}</div>}
      </div>
    </div>
    </ThreadContext.Provider>
    </SpeakingContext.Provider>
  )
}
