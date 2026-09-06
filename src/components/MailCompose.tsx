// The composer: a slide-over, like the command/service/connection editors.
//
// Two rules it exists to keep. A reply goes out from the address the mail
// arrived at, not whatever the default is — a reply that silently changes
// your address splits a client thread across two inboxes. And a send that
// fails leaves the draft open with every word intact.

import { useEffect } from 'react'
import { useApp } from '../store'
import { Icon } from '../lib/icons'

export function MailCompose() {
  const {
    mailCompose: draft,
    mailAccounts,
    mailContacts,
    closeCompose,
    updateCompose,
    sendCompose,
  } = useApp()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCompose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeCompose])

  if (!draft) return null

  const account = mailAccounts.find((a) => a.id === draft.account_id)
  const canSend = draft.to.trim() !== '' && !draft.sending && mailAccounts.length > 0

  return (
    <>
      <div className="sheet-scrim" onClick={closeCompose} />
      <div className="sheet-panel flex flex-col" style={{ width: 680 }}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="edit" size={15} className="text-indigo-400" />
          <span className="text-[13.5px] font-semibold text-ink">
            {draft.in_reply_to ? 'Reply' : 'New message'}
          </span>
          <button className="ml-auto rounded p-1 text-muted hover:text-ink" onClick={closeCompose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* From */}
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-2">
            <span className="w-12 shrink-0 font-mono text-[10.5px] text-muted">From</span>
            {mailAccounts.length === 0 ? (
              <span className="text-[12px] text-err">
                No accounts configured — add one before sending.
              </span>
            ) : (
              <select
                className="input flex-1 text-[12px]"
                value={draft.account_id}
                onChange={(e) => updateCompose({ account_id: Number(e.target.value) })}
              >
                {mailAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.address}
                  </option>
                ))}
              </select>
            )}
            {account && (
              <span className="shrink-0 font-mono text-[9.5px] text-faint">
                via {account.smtp_host || 'no SMTP host'}:{account.smtp_port}
              </span>
            )}
          </div>

          {/* To */}
          <div className="border-b border-line px-4 py-2">
            <div className="flex items-center gap-2.5">
              <span className="w-12 shrink-0 font-mono text-[10.5px] text-muted">To</span>
              <input
                className="input flex-1 text-[12px]"
                list="mail-contact-suggestions"
                placeholder="name@example.com, another@example.com"
                value={draft.to}
                onChange={(e) => updateCompose({ to: e.target.value })}
              />
              <button
                className="shrink-0 text-[11.5px] text-indigo-300 hover:text-ink"
                onClick={() => updateCompose({ showCc: !draft.showCc })}
              >
                Cc
              </button>
            </div>
            {/* Recipients autocomplete from the address book, which fills
                itself from the mail you already have. */}
            <datalist id="mail-contact-suggestions">
              {mailContacts.map((c) => (
                <option key={c.id} value={c.email}>
                  {c.name || c.email}
                </option>
              ))}
            </datalist>
            {draft.showCc && (
              <div className="mt-2 flex items-center gap-2.5">
                <span className="w-12 shrink-0 font-mono text-[10.5px] text-muted">Cc</span>
                <input
                  className="input flex-1 text-[12px]"
                  list="mail-contact-suggestions"
                  value={draft.cc}
                  onChange={(e) => updateCompose({ cc: e.target.value })}
                />
              </div>
            )}
          </div>

          {/* Subject */}
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-2">
            <span className="w-12 shrink-0 font-mono text-[10.5px] text-muted">Subject</span>
            <input
              className="input flex-1 text-[12.5px]"
              value={draft.subject}
              onChange={(e) => updateCompose({ subject: e.target.value })}
            />
          </div>

          {/* Body */}
          <textarea
            className="min-h-0 flex-1 resize-none bg-page px-4 py-3 text-[13px] leading-[1.7] text-body outline-none placeholder:text-faint"
            placeholder="Write your message…"
            value={draft.body}
            onChange={(e) => updateCompose({ body: e.target.value })}
          />

          {account?.signature && (
            <div className="border-t border-line px-4 py-2 font-mono text-[10px] text-faint">
              signature appended on send: {account.signature.split('\n')[0]}
            </div>
          )}
        </div>

        {/* Send */}
        <div className="border-t border-line bg-panel px-4 py-3">
          {draft.error && (
            <div className="mb-2.5 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] leading-[1.55] text-err">
              {draft.error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
              disabled={!canSend}
              onClick={() => void sendCompose()}
            >
              <Icon name="send" size={13} spin={draft.sending} />
              {draft.sending ? 'Sending…' : 'Send'}
            </button>
            <span className="flex-1" />
            {account && !account.has_password && (
              <span className="font-mono text-[10px] text-warn">
                no password stored for this account
              </span>
            )}
            <button className="btn-ghost text-[12px]" onClick={closeCompose}>
              Discard
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
