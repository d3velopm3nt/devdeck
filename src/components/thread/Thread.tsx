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
        {m.text}
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
          {m.text}
        </div>
      </div>
    </div>
  )
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
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [steps, setSteps] = useState<ChatMessage[]>([])
  const bottom = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const speakers = useSpeakers()

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
    <div className="flex h-full min-h-0 flex-col">
      {err && (
        <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[11.5px] leading-[1.5] text-err">
          {err}
        </div>
      )}

      {conv && conv.participants && conv.participants.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 border-b border-line pb-2">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            In this thread
          </span>
          <span className="text-[10.5px] text-dim">{name}</span>
          {conv.participants.map((p) => (
            <span key={p} className="flex items-center gap-1 text-[10.5px] text-muted">
              <span className="h-[6px] w-[6px] rounded-full bg-indigo-400" />
              {speakers(p)}
            </span>
          ))}
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
          conv?.messages.map((m, i) =>
            m.tool === 'wake' ? (
              <Wake key={i} m={m} name={who(m)} />
            ) : m.tool && RECEIPTS[m.tool] ? (
              <Receipt key={i} m={m} />
            ) : (
              <Bubble key={i} m={m} who={who(m)} />
            ),
          )
        )}
        {steps.map((m, i) => (
          <Bubble key={`s-${i}`} m={m} who={who(m)} />
        ))}
        {sending && (
          <div className="flex gap-3 py-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300">
              <Icon name="ai" size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[11.5px] font-semibold text-ink">{name}</div>
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

      <div className="mt-3 shrink-0 border-t border-line pt-3">
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
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
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
  )
}
