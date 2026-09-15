// The mail fetched from one mailbox, folder by folder, so what Learn will
// read can be seen before it reads it. Read only: this is a look, not a
// mail client.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { MailMessage, MailQuery } from '../../lib/types'
import { Icon } from '../../lib/icons'

const FOLDERS = ['INBOX', 'Sent', 'Drafts', 'Archive']
const LIMIT = 100

const folderLabel = (m: string) => (m === 'INBOX' ? 'Inbox' : m.replace(/^INBOX[./]/i, ''))

function when(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
      })
}

const firstRecipient = (to: string) => {
  const first = to.split(',')[0]?.trim() ?? ''
  return first.replace(/^"?([^"<]*)"?\s*<.*>$/, '$1').trim() || first || 'nobody'
}

export function FetchedMail({ accountId, stamp }: { accountId: number; stamp: number }) {
  const [boxes, setBoxes] = useState<ipc.MailBoxCount[] | null>(null)
  const [box, setBox] = useState('INBOX')
  const [search, setSearch] = useState('')
  const [list, setList] = useState<MailMessage[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    ipc
      .mailAccountBoxes(accountId)
      .then(setBoxes)
      .catch((e) => setErr(String(e)))
  }, [accountId, stamp])

  useEffect(() => {
    let live = true
    const known = FOLDERS.includes(box)
    const t = window.setTimeout(
      () => {
        ipc
          .mailList({
            group: (known ? box.toLowerCase() : 'inbox') as MailQuery['group'],
            chip: 'all' as MailQuery['chip'],
            search,
            account_id: accountId,
            label: known ? null : box,
            limit: LIMIT,
          })
          .then((r) => live && setList(r))
          .catch((e) => live && setErr(String(e)))
      },
      search ? 250 : 0,
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [accountId, box, search, stamp])

  const sentEmpty = boxes?.find((b) => b.mailbox === 'Sent')?.count === 0
  const outgoing = box === 'Sent' || box === 'Drafts'

  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-[8px] border border-line2 bg-page">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-raise px-2 py-1.5">
        {(boxes ?? []).map((b) => (
          <button
            key={b.mailbox}
            className={`rounded px-2 py-0.5 text-[11px] ${
              box === b.mailbox ? 'bg-hover text-ink' : 'text-muted hover:text-ink'
            }`}
            onClick={() => {
              setBox(b.mailbox)
              setOpen(null)
            }}
          >
            {folderLabel(b.mailbox)}{' '}
            <span className={b.count === 0 && b.mailbox === 'Sent' ? 'text-warn' : 'text-faint'}>{b.count}</span>
          </button>
        ))}
        <span className="flex-1" />
        <div className="flex items-center gap-1 rounded border border-line2 bg-page px-1.5">
          <Icon name="search" size={11} className="text-faint" />
          <input
            className="w-36 bg-transparent py-0.5 text-[11px] text-ink outline-none placeholder:text-faint"
            placeholder="Search this folder"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {sentEmpty && (
        <div className="flex items-start gap-2 border-b border-line bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-warn">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          <span>
            No sent mail has been fetched. Learn reads the people you have written to, so without Sent it finds
            nobody. Fetch again; if Sent stays at nought, the alert above says what the server said.
          </span>
        </div>
      )}
      {err && <div className="border-b border-line px-3 py-2 text-[11px] text-err">{err}</div>}

      <div className="max-h-72 overflow-y-auto">
        {list === null ? (
          <div className="px-3 py-2 text-[11px] text-muted">Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted">
            {search ? `Nothing in ${folderLabel(box)} matches “${search}”.` : `Nothing fetched in ${folderLabel(box)}.`}
          </div>
        ) : (
          list.map((m) => (
            <button
              key={m.id}
              className="block w-full border-b border-line px-3 py-1.5 text-left last:border-b-0 hover:bg-hover"
              onClick={() => setOpen(open === m.id ? null : m.id)}
            >
              <div className="flex items-baseline gap-2">
                <span className={`w-40 shrink-0 truncate text-[11.5px] ${m.unread ? 'font-medium text-ink' : 'text-body'}`}>
                  {outgoing ? `To ${firstRecipient(m.to_addrs)}` : m.from_name || m.from_addr}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-body">{m.subject || '(no subject)'}</span>
                {m.attachments > 0 && <Icon name="attachment" size={11} className="shrink-0 text-faint" />}
                <span className="shrink-0 text-[10.5px] text-faint">{when(m.ts)}</span>
              </div>
              {open === m.id && (
                <div className="mt-1 text-[11px] leading-relaxed">
                  <div className="break-words font-mono text-[10.5px] text-dim">
                    {m.from_addr} → {m.to_addrs}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-muted">{m.preview || '(no text)'}</div>
                </div>
              )}
            </button>
          ))
        )}
      </div>
      {list && list.length === LIMIT && (
        <div className="border-t border-line px-3 py-1.5 text-[10.5px] text-faint">
          The newest {LIMIT} are shown. Search to find older ones.
        </div>
      )}
    </div>
  )
}
