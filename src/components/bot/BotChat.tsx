// A bot's own thread — the first thing you see on its page.
//
// The same record a conversation with the assistant is, marked as the bot's,
// and the same loop underneath: what differs is the voice and the permissions.
// So this reuses the assistant's rows and its streaming channel rather than
// growing a second chat. The one thing it adds is the wake: a report the bot
// posted on its own, drawn as a receipt rather than a reply, because nobody
// asked it anything — it just came back from looking.
//
// Why it is first: a page that opened on tabs of settings was a form with a
// bot attached. Opening on what the bot said is the other way round.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { aiw, ago, type ChatEvent, type ChatMessage, type ConversationMeta } from '../../lib/aiw'
import { Bubble } from '../aiw/Chat'
import { Icon } from '../../lib/icons'

export function BotChat({ bot }: { bot: ipc.Bot }) {
  const [conv, setConv] = useState<ConversationMeta | null>(null)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [steps, setSteps] = useState<ChatMessage[]>([])
  const bottom = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const load = () =>
    ipc
      .botThread(bot.node_id)
      .then((c) => {
        setConv(c)
        setErr('')
      })
      .catch((e) => setErr(String(e)))

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.node_id])

  // Progress arrives on the assistant's channel, keyed by conversation. Only
  // this bot's is ours; another page's tokens spliced in here would be worse
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
    // Shown before the round trip; a message that vanishes until the reply
    // lands reads as a dropped one.
    const pending: ChatMessage = { at: new Date().toISOString(), from: 'user', text }
    setConv({ ...conv, messages: [...conv.messages, pending] })
    setDraft('')
    setSending(true)
    setStreaming('')
    setSteps([])
    if (box.current) box.current.style.height = 'auto'
    try {
      await ipc.botThreadSend(bot.node_id, text)
      // Re-read rather than splice: the backend decided the timestamps and the
      // tool steps, and a transcript assembled from two sources drifts.
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSending(false)
      setStreaming('')
      setSteps([])
    }
  }

  const acts = bot.agent.trim().length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {err && (
        <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[11.5px] leading-[1.5] text-err">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {conv == null && !err ? (
          <div className="py-8 text-center text-[12px] text-muted">Opening its thread…</div>
        ) : conv && conv.messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Icon name="bot" size={22} className="text-faint" />
            <div className="text-[12.5px] text-dim">Nothing said yet</div>
            <div className="max-w-[420px] text-[11.5px] leading-relaxed text-muted">
              Its wakes will land here as receipts, and anything you ask it goes here too.
              {acts
                ? ` It runs as ${bot.agent}, so it can act within what that agent is allowed.`
                : ' It has no agent, so it can tell you about this space but cannot touch it.'}
            </div>
          </div>
        ) : (
          conv?.messages.map((m, i) =>
            m.tool === 'wake' ? <Wake key={i} m={m} name={bot.name} /> : <Bubble key={i} m={m} who={bot.name} />,
          )
        )}
        {steps.map((m, i) => (
          <Bubble key={`s-${i}`} m={m} who={bot.name} />
        ))}
        {sending && (
          <div className="flex gap-3 py-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300">
              <Icon name="bot" size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[11.5px] font-semibold text-ink">{bot.name}</div>
              {streaming ? (
                <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-body">
                  {streaming}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[11.5px] text-muted">
                  <Icon name="spinner" size={12} className="animate-spin" />
                  {steps.length > 0 ? 'still working' : 'reading the space'}
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
            placeholder={`Message ${bot.name}…`}
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
        <div className="mt-1.5 text-[10.5px] text-faint">
          {acts
            ? `Runs as ${bot.agent}. Anything needing approval stops and asks you here.`
            : 'No agent named, so it can answer but not act. Name one on Settings.'}
        </div>
      </div>
    </div>
  )
}

/// A wake report. Not a reply to anything — the bot came back from looking
/// and said what it found — so it is drawn as a receipt with the time it
/// woke, not as a speech bubble answering a question nobody asked.
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
