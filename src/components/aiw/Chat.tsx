// The assistant — the one AI you talk to.
//
// Everything else in this module is a surface you *watch*. This is the one you
// *use*, so it is deliberately plain: a transcript, a box, and no chrome
// competing with the conversation.
//
// Two things it must not hide:
//
//   1. **What was actually done.** The assistant delegates and runs tools;
//      those steps are in the transcript as their own rows, not folded into
//      prose that claims something happened. A row that says `delegate.start`
//      is checkable; "I've started that for you" is not.
//   2. **Where a reply came from.** On the mock provider the assistant can
//      coordinate but not think, and the surface says so rather than letting a
//      scripted answer pass for a conversation.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw, ago, type ChatMessage } from '../../lib/aiw'

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/** A tool step. Collapsed by default — it is evidence, not conversation. */
function ToolRow({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const failed = m.ok === false
  return (
    <div className="my-1.5 ml-9">
      <button
        className={`inline-flex max-w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-[10.5px] ${
          failed
            ? 'border-red-500/25 bg-red-500/[0.06] text-err'
            : 'border-line bg-raise text-muted hover:text-dim'
        }`}
        onClick={() => setOpen(!open)}
      >
        <Icon name={failed ? 'alert' : 'tool'} size={11} className="shrink-0" />
        <span className="font-mono">{m.tool}</span>
        <span className="truncate opacity-70">{m.text.split('\n')[0]}</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded border border-line bg-app px-2.5 py-2 font-mono text-[10.5px] leading-[1.55] text-dim">
          {m.text}
        </pre>
      )}
    </div>
  )
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.from === 'tool') return <ToolRow m={m} />
  const mine = m.from === 'user'
  return (
    <div className="flex gap-3 py-2.5">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          mine ? 'bg-hover text-dim' : 'bg-indigo-500/15 text-indigo-300'
        }`}
      >
        {mine ? 'You' : <Icon name="ai" size={12} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[11.5px] font-semibold text-ink">
            {mine ? 'You' : 'Assistant'}
          </span>
          <span className="text-[10px] text-faint">{ago(m.at)}</span>
        </div>
        {/* Pre-wrap rather than a Markdown renderer: the assistant's answers are
            short prose, and a half-working renderer that mangles a path or a
            snippet is worse than none. */}
        <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-body">
          {m.text}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

function ConversationList() {
  const a = useAiw()
  if (a.conversations.length === 0) return null
  return (
    <div className="w-56 shrink-0 border-r border-line bg-app">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
          Conversations
        </span>
        <button
          className="btn-ghost ml-auto text-[11px]"
          title="Start a new conversation"
          onClick={() => void a.newConversation()}
        >
          <Icon name="add" size={12} />
        </button>
      </div>
      <div className="overflow-auto">
        {a.conversations.map((c) => {
          const active = a.conversation?.id === c.id
          return (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-start gap-1.5 border-b border-line px-3 py-2 ${
                active ? 'bg-hover' : 'hover:bg-soft'
              }`}
              onClick={() => void a.openConversation(c.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-ink">{c.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted">
                  {c.preview || 'Nothing said yet'}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-faint">
                  <span>{ago(c.updated_at)}</span>
                  {c.project_id && (
                    <>
                      <span>·</span>
                      <span>{c.project_id}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete this conversation"
                onClick={(e) => {
                  e.stopPropagation()
                  void a.deleteConversation(c.id)
                }}
              >
                <Icon name="delete" size={11} className="text-faint hover:text-err" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function Chat() {
  const a = useAiw()
  const [draft, setDraft] = useState('')
  const [root, setRoot] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Load the list once, and open something so the surface is never a dead end.
  useEffect(() => {
    void (async () => {
      await a.loadConversations()
      const { conversations, conversation } = useAiw.getState()
      if (!conversation) {
        if (conversations.length > 0) await useAiw.getState().openConversation(conversations[0].id)
        else await useAiw.getState().newConversation()
      }
    })()
    // Not knowing where the store is should not break the chat.
    aiw.personalRoot().then(setRoot).catch(() => setRoot(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Before paint, so a long transcript never flashes at the top first.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [a.conversation?.messages.length, a.sending])

  const conv = a.conversation
  const assistant = a.agents.find((x) => x.id === 'assistant')
  const onMock = !assistant || assistant.provider === 'mock'

  const submit = () => {
    const text = draft.trim()
    if (!text || a.sending) return
    setDraft('')
    void a.send(text)
    box.current?.focus()
  }

  return (
    <div className="flex h-full min-h-0">
      <ConversationList />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
          <Icon name="ai" size={14} className="text-indigo-400" />
          <span className="truncate text-[13px] font-semibold text-ink">
            {conv?.title ?? 'Assistant'}
          </span>

          {/* Focus, not a boundary — the assistant works across projects, but
              the code tools need a root to resolve against. */}
          <select
            className="input ml-auto max-w-44 text-[11px]"
            value={conv?.project_id ?? ''}
            title="Which project this conversation is about"
            onChange={(e) => void a.focusConversation(e.target.value || undefined)}
          >
            <option value="">No project</option>
            {a.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost text-[11px]"
            title="Start a new conversation"
            onClick={() => void a.newConversation()}
          >
            <Icon name="add" size={12} /> New
          </button>
        </div>

        {onMock && (
          <div className="flex shrink-0 items-start gap-2.5 border-b border-line bg-raise px-5 py-2.5">
            <Icon name="info" size={12} className="mt-px shrink-0 text-indigo-400" />
            <div className="text-[11px] leading-[1.55] text-dim">
              Running on the <span className="text-ink">mock provider</span> — the assistant can
              coordinate and delegate, but not think. Ask it to start work on a feature, or to
              remember something. Connect a real provider under{' '}
              <button className="text-indigo-300 underline-offset-2 hover:underline" onClick={() => a.setPage('settings')}>
                Settings
              </button>{' '}
              for an actual conversation.
            </div>
          </div>
        )}

        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {!conv ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted">
              <Icon name="spinner" size={14} className="mr-2 animate-spin" /> Opening…
            </div>
          ) : conv.messages.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md text-center">
              <Icon name="ai" size={26} className="mx-auto text-indigo-400/50" />
              <div className="mt-3 text-[14px] font-semibold text-ink">
                What are we working on?
              </div>
              <div className="mt-1.5 text-[12px] leading-[1.6] text-dim">
                I coordinate the agents. Ask me to start work on a feature and I&rsquo;ll hand it to
                a developer, or ask what everyone is doing.
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              {conv.messages.map((m, i) => (
                <Bubble key={`${m.at}-${i}`} m={m} />
              ))}
              {a.sending && (
                <div className="flex items-center gap-2 py-2.5 pl-9 text-[11.5px] text-muted">
                  <Icon name="spinner" size={12} className="animate-spin" />
                  Thinking — this can pause to ask your approval.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-5 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={box}
              rows={1}
              className="input max-h-40 min-h-[34px] flex-1 resize-none py-2 text-[12.5px]"
              placeholder="Ask the assistant…"
              value={draft}
              disabled={!conv}
              onChange={(e) => {
                setDraft(e.target.value)
                // Grow with the text rather than scrolling a one-line box.
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline. The usual contract, and
                // getting it backwards is the fastest way to lose a message.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <button
              className="btn-primary h-[34px] px-3.5 text-[12px]"
              disabled={!conv || !draft.trim() || a.sending}
              onClick={submit}
            >
              {a.sending ? '…' : 'Send'}
            </button>
          </div>
          {root && (
            <div className="mx-auto mt-1.5 max-w-3xl text-[10px] text-faint">
              Conversations and anything remembered are kept at{' '}
              <span className="font-mono">{root}</span> — outside every repository, never committed.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
