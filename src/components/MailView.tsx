// Mail — the reading surface: a thread list and a reader, the same shape as
// Stash's vault. The reader shows what actually arrived: the rendered HTML
// body, its attachments, the raw headers, and whatever the assistant has said
// about the thread.

import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { Icon, type IconName } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import type { MailChip, MailMessage } from '../lib/types'

const CHIPS: Array<{ key: MailChip; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'files', label: 'Has files' },
]

type Tab = 'message' | 'files' | 'source' | 'assistant'

const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`

/** Initials for the avatar. Falls back to the address when there is no name —
 *  a blank circle tells you nothing about who mailed you. */
function initials(name: string, addr: string): string {
  const src = name.trim() || addr.trim()
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Deterministic tint per sender, so the same person keeps the same colour.
 *  These are alpha-tinted status hues, which read on both themes. */
const TINTS = ['#38bdf8', '#a78bfa', '#4ade80', '#fbbf24', '#f87171', '#818cf8']
const tintFor = (key: string) => {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

function Avatar({ msg, size = 24 }: { msg: MailMessage; size?: number }) {
  const tint = tintFor(msg.from_addr || msg.from_name)
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold"
      style={{
        height: size,
        width: size,
        background: `${tint}22`,
        color: tint,
        fontSize: size < 30 ? 9.5 : 11,
      }}
    >
      {initials(msg.from_name, msg.from_addr)}
    </span>
  )
}

function ThreadCard({
  msg,
  now,
  active,
  onClick,
  onFlag,
}: {
  msg: MailMessage
  now: number
  active: boolean
  onClick: () => void
  onFlag: () => void
}) {
  return (
    <button
      className={`mb-1.5 block w-full rounded-lg border px-3 py-2.5 text-left ${
        active ? 'border-indigo-500/50 bg-raise' : 'border-line bg-panel hover:border-line3'
      }`}
      onClick={onClick}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Avatar msg={msg} />
        <span
          className={`truncate text-[12.5px] ${msg.unread ? 'font-semibold text-ink' : 'text-body'}`}
        >
          {msg.from_name || msg.from_addr}
        </span>
        {msg.is_bot && <Icon name="bot" size={11} className="shrink-0 text-viol" />}
        <span
          role="button"
          tabIndex={-1}
          title={msg.flagged ? 'Remove flag' : 'Flag this message'}
          className={`shrink-0 ${msg.flagged ? 'text-warn' : 'text-faint hover:text-warn'}`}
          onClick={(e) => {
            e.stopPropagation()
            onFlag()
          }}
        >
          <Icon name="star" size={11} />
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9.5px] text-muted">
          {fmtAgo(msg.ts, now)}
        </span>
      </div>
      <div
        className={`mb-0.5 truncate text-[12px] ${
          msg.unread ? 'font-semibold text-ink' : 'text-dim'
        }`}
      >
        {msg.subject || '(no subject)'}
      </div>
      <div className="truncate text-[11px] leading-[1.5] text-muted">{msg.preview}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {msg.attachments > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line2 px-1.5 py-[1px] font-mono text-[9.5px] text-muted">
            <Icon name="attachment" size={9} />
            {msg.attachments}
          </span>
        )}
        <span className="rounded-full px-1 font-mono text-[9.5px] text-faint">
          {msg.account_address}
        </span>
      </div>
    </button>
  )
}

/**
 * The HTML body, in a sandboxed frame with no scripts and no network.
 *
 * `sandbox=""` drops scripts, forms, popups and same-origin access; the CSP
 * allows inline styles and `data:` images only. That is what blocks tracking
 * pixels — a remote image is a read receipt you never agreed to — and it is
 * why the mail cannot reach back into DevDeck.
 */
function HtmlBody({ html }: { html: string }) {
  const doc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" ` +
      `content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` +
      `<style>body{margin:0;padding:4px;font-family:'Segoe UI',system-ui,sans-serif;` +
      `font-size:13px;line-height:1.65;color:#1f2430;background:#fff;}` +
      `img{max-width:100%;height:auto}table{max-width:100%}` +
      `</style></head><body>${html}</body></html>`,
    [html],
  )
  return (
    <iframe
      title="Message body"
      sandbox=""
      srcDoc={doc}
      className="h-[440px] w-full rounded-lg border border-line bg-white"
    />
  )
}

function Tabs({
  tab,
  setTab,
  files,
  notes,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  files: number
  notes: number
}) {
  const items: Array<{ key: Tab; label: string }> = [
    { key: 'message', label: 'Message' },
    { key: 'files', label: `Attachments · ${files}` },
    { key: 'source', label: 'Source' },
    { key: 'assistant', label: notes > 0 ? `Assistant · ${notes}` : 'Assistant' },
  ]
  return (
    <div className="flex gap-0.5 border-b border-line px-5">
      {items.map((it) => (
        <button
          key={it.key}
          className={`border-b-2 px-3 py-1.5 text-[12px] transition ${
            tab === it.key
              ? 'border-indigo-400 text-ink'
              : 'border-transparent text-muted hover:text-body'
          }`}
          onClick={() => setTab(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function AssistantPane() {
  const { mailNotes, setAssistantStatus } = useApp()

  if (mailNotes.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-panel px-3.5 py-3 text-[12px] leading-[1.6] text-muted">
        Nothing from the assistant on this thread yet. Summaries and drafts are
        recorded here when you ask for them — thread text only leaves this
        machine when you do, never on sync.
      </div>
    )
  }

  const STYLE: Record<string, { icon: IconName; label: string }> = {
    summary: { icon: 'example', label: 'Thread summary' },
    draft: { icon: 'edit', label: 'Suggested reply' },
    action: { icon: 'check', label: 'Action' },
  }

  return (
    <div className="space-y-2">
      {mailNotes.map((n) => {
        const s = STYLE[n.kind] ?? STYLE.summary
        const settled = n.status !== 'new'
        return (
          <div
            key={n.id}
            className="rounded-lg border border-indigo-500/30 border-l-[3px] border-l-indigo-500 bg-indigo-500/5 px-3.5 py-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Icon name={s.icon} size={13} className="text-indigo-300" />
              <span className="text-[12px] font-semibold text-ink">{s.label}</span>
              <span className="ml-auto font-mono text-[9.5px] text-muted">{n.status}</span>
            </div>
            <div className="whitespace-pre-wrap text-[12.5px] leading-[1.7] text-body">{n.body}</div>
            {!settled && (
              <div className="mt-2.5 flex gap-1.5">
                <button
                  className="btn-primary text-[11.5px]"
                  onClick={() => void setAssistantStatus(n.id, 'accepted')}
                >
                  Accept
                </button>
                <button
                  className="btn-ghost text-[11.5px]"
                  onClick={() => void setAssistantStatus(n.id, 'dismissed')}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MailView() {
  const {
    mailMessages,
    mailQuery,
    mailSelectedId,
    mailBody,
    mailNotes,
    mailSyncing,
    mailError,
    mailAccounts,
    setMailQuery,
    selectMailMessage,
    toggleMailFlag,
    archiveMailMessage,
    deleteMailMessage,
    replyToSelected,
    syncMail,
    openMailAccountEditor,
  } = useApp()

  const [tab, setTab] = useState<Tab>('message')
  const now = Date.now()
  const selected = mailMessages.find((m) => m.id === mailSelectedId) ?? null

  return (
    <div className="flex h-full">
      {/* ---- thread list ---- */}
      <section className="flex w-[400px] shrink-0 flex-col border-r border-line bg-page">
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
          <div className="flex flex-1 items-center gap-1.5 rounded border border-line2 bg-page px-2 py-1">
            <Icon name="search" size={12} className="text-faint" />
            <input
              className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
              placeholder="Search mail, people, attachments"
              value={mailQuery.search}
              onChange={(e) => void setMailQuery({ search: e.target.value })}
            />
          </div>
          <button
            className="btn-ghost px-1.5 py-1"
            title="Fetch new mail"
            disabled={mailSyncing}
            onClick={() => void syncMail()}
          >
            <Icon name="update" size={12} spin={mailSyncing} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              className={`rounded-full border px-2 py-[2px] font-mono text-[10px] ${
                mailQuery.chip === c.key
                  ? 'border-transparent bg-indigo-500/20 text-indigo-300'
                  : 'border-line2 text-dim hover:bg-hover/50'
              }`}
              onClick={() => void setMailQuery({ chip: c.key })}
            >
              {c.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[9.5px] text-faint">{mailMessages.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {/* A failed sync must never look like an empty inbox. */}
          {mailError && (
            <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] leading-[1.55] text-err">
              {mailError}
            </div>
          )}
          {mailMessages.length === 0 && !mailError && (
            <div className="px-3 py-8 text-center text-[12px] leading-5 text-muted">
              {mailAccounts.length === 0 ? (
                <>
                  No mail accounts yet.
                  <br />
                  <button
                    className="mt-2 text-indigo-300 hover:text-ink"
                    onClick={() => openMailAccountEditor(0)}
                  >
                    Add one
                  </button>{' '}
                  to start fetching.
                </>
              ) : (
                <>Nothing here. Sync, or widen the filters.</>
              )}
            </div>
          )}
          {mailMessages.map((m) => (
            <ThreadCard
              key={m.id}
              msg={m}
              now={now}
              active={m.id === mailSelectedId}
              onClick={() => void selectMailMessage(m.id)}
              onFlag={() => void toggleMailFlag(m.id)}
            />
          ))}
        </div>
      </section>

      {/* ---- reader ---- */}
      <section className="flex min-w-0 flex-1 flex-col bg-page">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-[12.5px] text-muted">
            Pick a message to read it.
          </div>
        ) : (
          <>
            <div className="border-b border-line px-5 py-3.5">
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold leading-[1.35] text-ink">
                    {selected.subject || '(no subject)'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Avatar msg={selected} size={22} />
                    <span className="text-[12.5px] text-body">
                      {selected.from_name || selected.from_addr}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted">
                      &lt;{selected.from_addr}&gt;
                    </span>
                    {selected.is_bot && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 px-1.5 py-[1px] font-mono text-[9.5px] text-viol">
                        <Icon name="bot" size={9} /> automated
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-faint">
                    to {selected.account_address} · {new Date(selected.ts).toLocaleString()}
                  </div>
                </div>
                <button
                  className={`shrink-0 ${selected.flagged ? 'text-warn' : 'text-faint hover:text-warn'}`}
                  title={selected.flagged ? 'Remove flag' : 'Flag this message'}
                  onClick={() => void toggleMailFlag(selected.id)}
                >
                  <Icon name="star" size={15} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 border-b border-line px-5 py-1.5">
              <button className="btn-primary inline-flex items-center gap-1.5 text-[12px]" onClick={replyToSelected}>
                <Icon name="reply" size={12} /> Reply
              </button>
              <button
                className="btn-ghost px-1.5 py-1"
                title="Archive"
                onClick={() => void archiveMailMessage(selected.id)}
              >
                <Icon name="stash" size={12} />
              </button>
              <button
                className="btn-ghost px-1.5 py-1"
                title="Delete from this machine"
                onClick={() => void deleteMailMessage(selected.id)}
              >
                <Icon name="delete" size={12} />
              </button>
            </div>

            <Tabs
              tab={tab}
              setTab={setTab}
              files={mailBody?.attachments.length ?? selected.attachments}
              notes={mailNotes.length}
            />

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {!mailBody ? (
                <div className="font-mono text-[11px] text-muted">loading…</div>
              ) : tab === 'message' ? (
                mailBody.body_html ? (
                  <>
                    <HtmlBody html={mailBody.body_html} />
                    <div className="mt-1.5 text-[11px] text-muted">
                      Remote images are blocked — a tracking pixel is a read receipt you did not
                      agree to.
                    </div>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.7] text-body">
                    {mailBody.body_text || '(this message has no body)'}
                  </pre>
                )
              ) : tab === 'files' ? (
                mailBody.attachments.length === 0 ? (
                  <div className="text-[12px] text-muted">No attachments on this message.</div>
                ) : (
                  <div className="space-y-2">
                    {mailBody.attachments.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2.5"
                      >
                        <Icon name="attachment" size={16} className="shrink-0 text-dim" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] text-ink">{f.filename}</div>
                          <div className="font-mono text-[10px] text-muted">
                            {fmtBytes(f.bytes)} · {f.mime || 'unknown type'}
                          </div>
                        </div>
                        <span className="font-mono text-[9.5px] text-faint">
                          {f.file_path ? 'saved' : 'on the server'}
                        </span>
                      </div>
                    ))}
                    <div className="rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[12px] leading-[1.6] text-muted">
                      Attachments stay in the message store until you save one — syncing a mailbox
                      must not quietly fill your disk.
                    </div>
                  </div>
                )
              ) : tab === 'source' ? (
                <pre className="whitespace-pre-wrap break-all rounded-lg border border-line bg-panel p-3.5 font-mono text-[11.5px] leading-[1.65] text-dim">
                  {mailBody.raw_headers || '(no headers stored)'}
                </pre>
              ) : (
                <AssistantPane />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
