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
import { Markdown } from '../thread/Markdown'
import { useAiw } from '../../lib/aiwStore'
import { aiw, ago, type ChatMessage } from '../../lib/aiw'
import { useProjectsByWorkspace } from '../../lib/aiwLabels'
import { ProviderChip } from './ChatHeader'
import { useApp } from '../../store'
import { openUrl } from '../../lib/ipc'
import { useWorkData } from '../work/useWorkData'
import { assembleWork, workDisplayState } from '../../lib/workHub'
import { StateIcon } from '../ui/DesignSystem'
import { IssueConversation } from './IssueConversation'
import { PanelResizer } from './PanelResizer'
import { ChatDetails, ChatInspector } from './ChatDetails'
import { useChatWorkspace, migrateBuildDiscussion, sendTeamMessage } from '../../lib/chatWorkspace'
import { parsePlannerReply, plannerPreview } from '../../lib/teamPlanning'
import './chat-workspace.css'

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

/// One message. Shared with a bot's thread, which is the same record in a
/// different voice — `who` is the name the non-user side speaks as.
export function Bubble({
  m,
  who = 'Assistant',
  nameNode,
  renderText,
  dir,
  nodeId,
}: {
  m: ChatMessage
  who?: string
  /// Something richer than the name — a thread passes the speaker's pill.
  nameNode?: React.ReactNode
  /// Something richer than the words — a thread draws @names as pills.
  renderText?: (text: string) => React.ReactNode
  /// Where a code block's Run button should open its terminal. Without it,
  /// blocks still render and copy; they just do not offer to run.
  dir?: string
  /// Whose files an inline path can be opened from.
  nodeId?: number
}) {
  if (m.from === 'tool') return <ToolRow m={m} />
  const mine = m.from === 'user'
  return (
    <div className="flex gap-3 py-2.5">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          mine ? 'bg-hover text-dim' : 'bg-accent/12 text-accent'
        }`}
      >
        {mine ? 'You' : <Icon name="ai" size={12} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[11.5px] font-semibold text-ink">
            {mine ? 'You' : (nameNode ?? who)}
          </span>
          <span className="text-[10px] text-faint">{ago(m.at)}</span>
        </div>
        {/* Markdown for what came back, pre-wrap for what you typed.
            Rendering your own message would eat the asterisks out of a
            sentence you wrote and can still see in the box above. */}
        {mine ? (
          <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-body">
            {renderText ? renderText(m.text) : m.text}
          </div>
        ) : (
          <Markdown text={m.text} renderText={renderText} dir={dir} nodeId={nodeId} />
        )}
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

function ConversationList({ onClose }: { onClose: () => void }) {
  const a = useAiw()
  const nodes = useApp(s => s.nodes)
  const { data, reload } = useWorkData(nodes)
  useEffect(() => { const timer = setInterval(() => void reload(), 5000); return () => clearInterval(timer) }, [reload])
  const workCards = new Map(assembleWork(data.records, data.legacy, data.monitor, data.workflows, data.claims).map(card => [card.record.id, card]))
  const [search, setSearch] = useState('')
  const w = useChatWorkspace()
  return (
    <div style={{ width: w.listWidth }} className="chat-conversations w-56 shrink-0 border-r border-line bg-app">
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
        <button className="btn-ghost text-[11px]" title="Hide conversations" onClick={onClose}>
          <Icon name="chevron-left" size={12} />
        </button>
      </div>
      <input aria-label="Search conversations" className="input m-2" placeholder="Search conversations…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="overflow-auto">
        {[...a.conversations].filter(c => (c.title + ' ' + c.preview).toLowerCase().includes(search.toLowerCase())).sort((a,b) => Number(w.pinned.includes(b.id)) - Number(w.pinned.includes(a.id))).map((c) => {
          const active = a.conversation?.id === c.id
          const linkedWork = c.work_item || w.subjects[c.id]?.workItem
          const workCard = linkedWork ? workCards.get(linkedWork) : undefined
          const workStatus = workCard ? workDisplayState(workCard) : undefined
          const issueUrl = workCard?.record.source_url
          const issueNumber = issueUrl?.match(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)$/i)?.[1]
          return (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-start gap-1.5 border-b border-line px-3 py-2 ${
                active ? 'bg-hover' : 'hover:bg-soft'
              }`}
              role="button" tabIndex={0} aria-current={active ? 'true' : undefined}
              onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void a.openConversation(c.id) } }}
              onClick={() => void a.openConversation(c.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-ink">{c.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted">
                  {(w.subjects[c.id]?.planning ? plannerPreview(c.preview) : c.preview) || 'Nothing said yet'}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px] text-faint">
                  {linkedWork ? <><StateIcon size={14} state={workStatus ?? 'neutral'} label={workStatus ? undefined : data.loading ? 'Loading status' : 'Status unavailable'}/>{data.errors.length > 0 && <StateIcon state="warning" label="Work status may be out of date"/>}<span>{ago(c.updated_at)}</span></> : <span>{w.subjects[c.id]?.choices?.length && !w.subjects[c.id]?.proposal ? 'Needs input' : w.pending === c.id || (a.sendingConversationId === c.id) ? 'Working' : w.subjects[c.id]?.proposal && !w.subjects[c.id]?.saved ? 'Ready for review' : 'Recent'} · {ago(c.updated_at)}</span>}
                  {issueNumber && <a href={issueUrl} title={issueUrl} aria-label={`Open GitHub issue ${issueNumber} for ${c.title}`} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-info hover:underline focus-visible:outline focus-visible:outline-2" onClick={e => { e.preventDefault(); e.stopPropagation(); void openUrl(issueUrl!).catch(error => useAiw.setState({chatError:String(error)})) }}><Icon name="github" size={13}/><span>#{issueNumber}</span></a>}
                  {c.project_id && (
                    <>
                      <span>·</span>
                      <span>{c.project_id}</span>
                    </>
                  )}
                </div>
              </div>
              <button className="chat-icon-button chat-row-action" title={w.pinned.includes(c.id) ? "Unpin conversation" : "Pin conversation"} aria-pressed={w.pinned.includes(c.id)} aria-label={(w.pinned.includes(c.id) ? 'Unpin ' : 'Pin ') + c.title} onClick={e => { e.stopPropagation(); useChatWorkspace.setState({ pinned: w.pinned.includes(c.id) ? w.pinned.filter(id => id !== c.id) : [...w.pinned, c.id] }) }}><Icon name="pin" size={14}/></button>
              <button
                className="chat-icon-button chat-row-action"
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

/// The reply as it arrives.
///
/// A preview, not the record: when the turn ends the transcript is re-read and
/// this is dropped, so nothing here has to be reconciled with what was saved.
/// Until then it is the only thing distinguishing "thinking" from "hung".
function Live() {
  const a = useAiw()
  return (
    <>
      {a.streamingSteps.map((m, i) => (
        <Bubble key={`live-${i}`} m={m} />
      ))}
      {a.streaming ? (
        <div className="flex gap-3 py-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
            <Icon name="ai" size={12} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[11.5px] font-semibold text-ink">Assistant</div>
            <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-body">
              {a.streaming}
              {/* A caret, so a pause between tokens still reads as "working". */}
              <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] animate-pulse bg-accent" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 py-2.5 pl-9 text-[11.5px] text-muted">
          <Icon name="spinner" size={12} className="animate-spin" />
          {a.streamingSteps.length > 0
            ? 'Working…'
            : 'Thinking — this can pause to ask your approval.'}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

export function Chat() {
  const a = useAiw()
  const byWorkspace = useProjectsByWorkspace()
  const workspace = useChatWorkspace()
  const conversationId = a.conversation?.id ?? ''
  const subject = workspace.subjects[conversationId] ?? {}
  const draft = subject.draft ?? ''
  const setDraft = (draft: string) => workspace.patch(conversationId, { draft })
  const planningBusy = workspace.pending === conversationId
  const container = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<string | null>(null)
  const [showList, setShowList] = useState(() => window.innerWidth > 760)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Load the list once, and open something so the surface is never a dead end.
  useEffect(() => {
    void (async () => {
      if (!useAiw.getState().ready) await useAiw.getState().bootstrap()
      await migrateBuildDiscussion()
      await a.loadConversations()
      const { conversations, conversation } = useAiw.getState()
      if (!conversation) {
        if (conversations.length > 0) await useAiw.getState().openConversation(conversations.find(c => c.id === localStorage.getItem('devdeck.chat.selected'))?.id ?? conversations[0].id)
        else await useAiw.getState().newConversation()
      }
    })()
    // Not knowing where the store is should not break the chat.
    aiw.personalRoot().then(setRoot).catch(() => setRoot(null))

    // Live progress for the reply being produced right now.
    // Hold the promise, not the resolved unlisten: cleanup can run before it
    // resolves, and a listener captured late is never removed.
    const conversationTimer = setInterval(() => { void useAiw.getState().loadConversations() }, 15000)
    const stopEvents = aiw.onEvent(e => useAiw.getState().pushEvent(e))
    const stopChat = aiw.onChat((e) => useAiw.getState().pushChat(e))
    return () => { clearInterval(conversationTimer); void stopChat.then((un) => un()); void stopEvents.then(un => un()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (a.conversation?.work_item) workspace.patch(a.conversation.id, {workItem:a.conversation.work_item}) }, [a.conversation?.id, a.conversation?.work_item])

  useEffect(() => { if (conversationId) localStorage.setItem('devdeck.chat.selected', conversationId) }, [conversationId])

  // Before paint, so a long transcript never flashes at the top first.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [a.conversation?.messages.length, a.sending, a.streaming, a.streamingSteps.length])

  const conv = a.conversation
  const assistant = a.agents.find((x) => x.id === 'assistant')
  const onMock = !assistant?.provider || assistant.provider === 'mock'
  // Connecting a provider points the *assistant* at it, and nothing else.
  // The specialists stay on the mock until each is moved, so "I've put
  // Developer A on it" can be a true sentence about a scripted agent
  // producing fixture output. This is the only place that would say so.

  const submit = () => {
    const text = draft.trim()
    if (!text || a.sending || workspace.pending || onMock) return
    setDraft('')
    if (subject.planning) void sendTeamMessage(conversationId, text)
    else void a.send(text)
    box.current?.focus()
  }

  return (
    <div ref={container} className="chat-workspace flex h-full min-h-0">
      {showList && <><ConversationList onClose={() => setShowList(false)} /><PanelResizer label="Resize conversations" value={workspace.listWidth} min={180} max={360} side="left" onChange={listWidth => useChatWorkspace.setState({ listWidth })}/></>}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="chat-toolbar relative flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          <button
            className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] ${
              showList ? 'bg-hover text-ink' : 'text-dim hover:bg-hover hover:text-ink'
            }`}
            title={showList ? 'Hide conversations' : `Conversations (${a.conversations.length})`}
            onClick={() => setShowList(!showList)}
          >
            <Icon name="list" size={13} />
            {!showList && a.conversations.length > 0 && (
              <span className="text-[10px] text-faint">{a.conversations.length}</span>
            )}
          </button>
          <Icon name="ai" size={14} className="text-accent" />
          <span className="truncate text-[13px] font-semibold text-ink">
            {conv?.title ?? 'Assistant'}
          </span>

          {/* Focus, not a boundary — the assistant works across projects, but
              the code tools need a root to resolve against. Grouped by
              workspace, because the list spans all of them and two projects
              can share a name across two workspaces. */}
          <select
            className="input ml-auto max-w-44 text-[11px]"
            value={conv?.project_id ?? ''}
            title="Which project this conversation is about"
            onChange={(e) => void a.focusConversation(e.target.value || undefined)}
          >
            <option value="">No project</option>
            {byWorkspace.map((g) => (
              <optgroup key={g.workspace} label={g.workspace}>
                {g.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ProviderChip />
          <button className="chat-icon-button" title="Conversation details" aria-label="Conversation details" aria-pressed={workspace.inspector && !workspace.split} onClick={() => useChatWorkspace.setState({ inspector: workspace.split || !workspace.inspector, split: false })}><Icon name="info" size={17}/></button>
          <button className="chat-icon-button" title="Workspace panel" aria-label="Split" aria-pressed={workspace.split} onClick={() => useChatWorkspace.setState({ split: !workspace.split })}><Icon name="layout" size={17}/></button>
          <button
            className="chat-icon-button"
            title="Start a new conversation"
            onClick={() => void a.newConversation()}
          >
            <Icon name="add" size={17} />
          </button>
        </div>

        {onMock && (
          <div className="flex shrink-0 items-start gap-2.5 border-b border-line bg-raise px-5 py-2.5">
            <Icon name="info" size={12} className="mt-px shrink-0 text-accent" />
            <div className="text-[11px] leading-[1.55] text-dim">
              Set up an agent to start chatting. Your local workspace is ready to use.{' '}
              Use the Set up agent control above to choose a connection.
            </div>
          </div>
        )}

        {a.chatError && (
          <div className="flex shrink-0 items-start gap-2.5 border-b border-red-500/25 bg-red-500/[0.06] px-5 py-2.5">
            <Icon name="alert" size={12} className="mt-px shrink-0 text-err" />
            <div className="min-w-0 flex-1 text-[11.5px] leading-[1.55] text-err">
              {a.chatError}
              {/* The overwhelmingly common cause, and one you cannot guess from
                  the message Tauri gives back. */}
              {a.chatError.includes('not found') && (
                <span className="text-dim">
                  {' '}
                  — this usually means the app is running an older build than the
                  UI. Restart DevDeck.
                </span>
              )}
            </div>
            <button
              className="btn-ghost shrink-0 text-[11px]"
              onClick={() => void a.loadConversations()}
            >
              Retry
            </button>
          </div>
        )}

        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {!conv ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted">
              <Icon name="spinner" size={14} className="mr-2 animate-spin" /> Opening…
            </div>
          ) : conv.work_item ? (
            <><IssueConversation key={conv.id} id={conv.id} workItem={conv.work_item} messages={conv.messages} renderMessage={(m,key) => <Bubble key={key} m={m} who={m.by ? a.agents.find(agent => agent.id === m.by)?.name ?? m.by : 'Dev'}/>}/>{a.sending && a.sendingConversationId === conversationId && <Live/>}</>
          ) : conv.messages.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md text-center">
              <Icon name="ai" size={26} className="mx-auto text-accent/50" />
              <div className="mt-3 text-[14px] font-semibold text-ink">
                What are we working on?
              </div>
              <div className="mt-1.5 text-[12px] leading-[1.6] text-dim">
                Work with Dev using skills, discuss a team, or review progress. Open the workspace panel to inspect the team, context and activity.
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              {conv.messages.map((m, i) => (
                <Bubble key={`${m.at}-${i}`} m={m.from === 'assistant' && subject.planning ? { ...m, text: parsePlannerReply(m.text).text } : m} who={m.by && m.by !== 'team-planner' ? a.agents.find(agent => agent.id === m.by)?.name ?? m.by : 'Dev'} />
              ))}
              {a.sending && a.sendingConversationId === conversationId && <Live />}{planningBusy && <div role="status" className="text-muted">Dev is refining the team…</div>}
            </div>
          )}
        </div>

        {!!subject.choices?.length && <div className="flex flex-wrap gap-2 px-5 py-2">{subject.choices.map(choice => <button key={choice} className="btn-ghost" disabled={!!workspace.pending || a.sending} onClick={() => void sendTeamMessage(conversationId, choice)}>{choice}</button>)}<button className="btn-ghost" onClick={() => box.current?.focus()}>Write my own reply</button></div>}
        {subject.error && <p role="alert" className="px-5 text-err">{subject.error}</p>}
        <div className="shrink-0 border-t border-line px-5 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={box}
              rows={1}
              className="input max-h-40 min-h-[34px] flex-1 resize-none py-2 text-[12.5px]"
              placeholder="Ask the assistant…"
              value={draft}
              disabled={!conv || onMock}
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
              className="btn-primary chat-send-button"
              aria-label="Send" title="Send message"
              disabled={!conv || onMock || !draft.trim() || a.sending || !!workspace.pending}
              onClick={submit}
            >
              <Icon name={a.sending || planningBusy ? "spinner" : "send"} size={17} className={a.sending || planningBusy ? "animate-spin" : undefined}/>
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
      {!workspace.split && workspace.inspector && conv && <><PanelResizer label="Resize conversation details" value={workspace.inspectorWidth} min={230} max={420} side="right" onChange={inspectorWidth => useChatWorkspace.setState({ inspectorWidth })}/><ChatInspector id={conv.id}/></>}
      {workspace.split && conv && <>
        <PanelResizer label="Resize chat details" value={workspace.width} min={360} max={960} side="right" onChange={width => useChatWorkspace.setState({ width })}/>
        <aside aria-label="Chat details" className="chat-details flex min-h-0 flex-col border-l border-line bg-app" style={{ width: workspace.width }}><button className="btn-ghost chat-details-close" onClick={() => useChatWorkspace.setState({ split: false, ...(window.innerWidth <= 760 ? { inspector: false } : {}) })}>Back to conversation</button><ChatDetails id={conv.id}/></aside>
      </>}
    </div>
  )
}
