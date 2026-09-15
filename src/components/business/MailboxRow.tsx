// One mailbox in the business's mail step: its state, what went wrong in
// full when something did, and its details to put right in place.

import { useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { MailAccount, MailTestResult } from '../../lib/types'
import { Icon } from '../../lib/icons'
import { explainMailError } from '../../lib/mailError'
import { Err } from '../setup/LearnStep'
import { FetchedMail } from './FetchedMail'

export interface FetchResult {
  ok: boolean
  text: string
}

interface Props {
  account: MailAccount
  business: string
  kind: string
  busy: boolean
  disabled: boolean
  result?: FetchResult
  onFetch: () => void
  onTie?: () => void
  onChanged: () => Promise<void>
  onForget: () => void
}

export function MailboxRow({ account: a, business, kind, busy, disabled, result, onFetch, onTie, onChanged, onForget }: Props) {
  const [editing, setEditing] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showMail, setShowMail] = useState(false)

  // A fetch that worked can still have skipped a folder, and says so on the
  // account, so the account's own error wins over a bare "n new".
  const raw = result && !result.ok ? result.text : a.last_error
  const problem = raw && !busy ? explainMailError(raw, `${a.imap_host}:${a.imap_port}`) : null
  const warn = problem?.kind === 'partial'
  const fetched = !!a.last_sync || !!result?.ok

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* nothing to copy to; the text stays selectable */
    }
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raise text-[9.5px] font-semibold text-dim">
          {a.address.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] text-ink">{a.address}</div>
          <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
            <span className="shrink-0">{kind}</span>
            {onTie && <span className="truncate">· not tied to {business} yet</span>}
            {busy ? (
              <span className="text-info">· fetching…</span>
            ) : problem ? (
              <span className={`flex items-center gap-1 ${warn ? 'text-warn' : 'text-err'}`}>
                · <Icon name="alert" size={11} /> {warn ? 'fetched, some folders skipped' : "couldn't fetch"}
              </span>
            ) : result?.ok ? (
              <span className="flex items-center gap-1 text-ok">
                · <Icon name="ok" size={11} /> {result.text}
              </span>
            ) : a.last_sync ? (
              <span>· fetched</span>
            ) : !a.has_password ? (
              <span className="text-warn">· no password yet</span>
            ) : null}
          </div>
        </div>
        {onTie && (
          <button className="btn-ghost text-[11.5px]" onClick={onTie}>
            Belongs to {business}
          </button>
        )}
        {fetched && (
          <button
            className="btn-ghost text-[11.5px]"
            onClick={() => setShowMail((v) => !v)}
            title="See what has been fetched"
            aria-expanded={showMail}
          >
            <Icon name="mail" size={12} /> {showMail ? 'Hide mail' : 'Show mail'}
          </button>
        )}
        {!editing && (
          <button className="btn-ghost text-[11.5px]" onClick={() => setEditing(true)} title="Change this mailbox's details">
            <Icon name="edit" size={12} /> Edit
          </button>
        )}
        {busy ? (
          <span className="flex items-center gap-1.5 px-2 text-[11.5px] text-muted">
            <Icon name="spinner" size={12} spin className="text-indigo-400" /> Fetching
          </span>
        ) : (
          <button className="btn-ghost text-[11.5px]" disabled={disabled} onClick={onFetch}>
            Fetch mail
          </button>
        )}
      </div>

      {problem && !editing && (
        <div
          role="alert"
          className={`mx-4 mb-3 flex gap-2.5 rounded-[8px] border px-3 py-2.5 ${
            warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/10'
          }`}
        >
          <Icon name="alert" size={14} className={`mt-0.5 shrink-0 ${warn ? 'text-warn' : 'text-err'}`} />
          <div className="min-w-0 flex-1">
            <div className={`text-[12px] font-medium ${warn ? 'text-warn' : 'text-err'}`}>{problem.title}</div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-body">{problem.hint}</div>
            {showDetail && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-page px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-dim">
                {problem.detail}
              </pre>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="btn-ghost text-[11.5px]" disabled={disabled} onClick={onFetch}>
                <Icon name="reset" size={12} /> Try again
              </button>
              <button className="btn-ghost text-[11.5px]" onClick={() => setEditing(true)}>
                <Icon name="edit" size={12} /> Edit details
              </button>
              <button className="text-[11px] text-muted hover:text-ink" onClick={() => setShowDetail((v) => !v)}>
                {showDetail ? 'Hide what the server said' : 'Show what the server said'}
              </button>
              {showDetail && (
                <button className="text-[11px] text-muted hover:text-ink" onClick={() => void copy(problem.detail)}>
                  <Icon name={copied ? 'ok' : 'copy'} size={11} /> {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showMail && <FetchedMail accountId={a.id} stamp={a.last_sync} />}

      {editing && (
        <MailboxEdit
          account={a}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            onForget()
            await onChanged()
          }}
          onRemoved={async () => {
            setEditing(false)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

function MailboxEdit({
  account: a,
  onClose,
  onSaved,
  onRemoved,
}: {
  account: MailAccount
  onClose: () => void
  onSaved: () => Promise<void>
  onRemoved: () => Promise<void>
}) {
  const [address, setAddress] = useState(a.address)
  // The username follows the address while they are the same, which is how
  // nearly every host has it; typing a different one breaks the link.
  const [username, setUsername] = useState(a.username)
  const [follows, setFollows] = useState(a.username === a.address || !a.username)
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState(a.imap_host)
  const [imapPort, setImapPort] = useState(a.imap_port)
  const [smtpHost, setSmtpHost] = useState(a.smtp_host)
  const [smtpPort, setSmtpPort] = useState(a.smtp_port)
  const [working, setWorking] = useState<'' | 'save' | 'test' | 'remove'>('')
  const [test, setTest] = useState<MailTestResult | null>(null)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState('')

  const oauth = a.auth === 'oauth'
  const user = follows ? address.trim() : username.trim()

  const save = async () => {
    if (!address.trim().includes('@')) {
      setErr('The address needs an @ and a domain.')
      return false
    }
    if (!imapHost.trim()) {
      setErr('The incoming server is needed to fetch mail.')
      return false
    }
    await ipc.mailAccountSave({
      ...a,
      address: address.trim(),
      username: user,
      imap_host: imapHost.trim(),
      imap_port: imapPort,
      smtp_host: smtpHost.trim(),
      smtp_port: smtpPort,
    })
    if (password) await ipc.mailAccountSetPassword(a.id, user, password)
    setPassword('')
    return true
  }

  const run = async (what: 'save' | 'test') => {
    setErr('')
    setTest(null)
    setWorking(what)
    try {
      if (!(await save())) return
      await onSaved()
      if (what === 'save') onClose()
      else setTest(await ipc.mailAccountTest(a.id))
    } catch (e) {
      setErr(String(e))
    } finally {
      setWorking('')
    }
  }

  const remove = async () => {
    setErr('')
    setWorking('remove')
    try {
      await ipc.mailAccountDelete(a.id)
      await onRemoved()
    } catch (e) {
      setErr(String(e))
      setWorking('')
    }
  }

  const label = 'text-[11px] text-muted'
  return (
    <div className="mx-4 mb-3 rounded-[8px] border border-line2 bg-raise px-3 py-3">
      <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <span className={label}>Address</span>
        <input
          className="input font-mono text-[12px]"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={oauth}
        />
        {!oauth && (
          <>
            <span className={label}>Username</span>
            <input
              className="input font-mono text-[12px]"
              value={follows ? address : username}
              onChange={(e) => {
                setFollows(false)
                setUsername(e.target.value)
              }}
              placeholder="usually the full address"
            />
            <span className={label}>Password</span>
            <input
              className="input text-[12px]"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={a.has_password ? 'saved. Type a new one to replace it' : 'not saved yet'}
            />
          </>
        )}
        <span className={label}>Incoming</span>
        <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
          <input className="input font-mono text-[11.5px]" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="IMAP server" />
          <input className="input text-[11.5px]" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value) || 993)} aria-label="IMAP port" />
        </div>
        <span className={label}>Outgoing</span>
        <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
          <input className="input font-mono text-[11.5px]" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="SMTP server" />
          <input className="input text-[11.5px]" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value) || 465)} aria-label="SMTP port" />
        </div>
      </div>

      {test && (
        <div className="mt-3 flex flex-col gap-1.5 rounded border border-line bg-page px-2.5 py-2">
          <TestLine ok={test.imap_ok} label="Incoming" detail={test.imap_detail} />
          <TestLine ok={test.smtp_ok} label="Outgoing" detail={test.smtp_detail} />
        </div>
      )}
      {err && (
        <div className="mt-3">
          <Err>{err}</Err>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary text-[11.5px]" disabled={working !== ''} onClick={() => void run('save')}>
          {working === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-ghost text-[11.5px]" disabled={working !== ''} onClick={() => void run('test')}>
          {working === 'test' ? <Icon name="spinner" size={12} spin /> : <Icon name="check" size={12} />} Save and test
        </button>
        <button className="btn-ghost text-[11.5px]" disabled={working !== ''} onClick={onClose}>
          {test ? 'Done' : 'Cancel'}
        </button>
        <span className="flex-1" />
        {removing ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-muted">Remove it, and the mail fetched from it?</span>
            <button className="btn-danger text-[11.5px]" disabled={working !== ''} onClick={() => void remove()}>
              Remove
            </button>
            <button className="btn-ghost text-[11.5px]" onClick={() => setRemoving(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="flex items-center gap-1 text-[11px] text-muted hover:text-err" onClick={() => setRemoving(true)}>
            <Icon name="delete" size={11} /> Remove mailbox
          </button>
        )}
      </div>
    </div>
  )
}

function TestLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const problem = ok ? null : explainMailError(detail)
  return (
    <div className="flex items-start gap-2 text-[11.5px]">
      <Icon name={ok ? 'ok' : 'alert'} size={12} className={`mt-0.5 shrink-0 ${ok ? 'text-ok' : 'text-err'}`} />
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <span className={`min-w-0 break-words ${ok ? 'text-body' : 'text-err'}`}>
        {ok ? detail : problem!.title}
        {!ok && <span className="block break-words font-mono text-[10.5px] text-dim">{detail}</span>}
      </span>
    </div>
  )
}
