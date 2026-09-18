// Step four: the business's mail.
//
// Every mailbox on the business's domain belongs to it. The first one asks
// for its server; every one after that on the same domain only needs its
// address and password. A partner's own mailbox is theirs, and is only added
// if they share it.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { MailAccount } from '../../lib/types'
import { Icon } from '../../lib/icons'
import { Err, Header } from '../setup/LearnStep'
import { Foot } from './BusinessStep'
import { MailboxRow, type FetchResult } from './MailboxRow'
import { BizFrame, hostOf, type StepProps } from './shared'

const SHARED = ['info', 'sales', 'accounts', 'admin', 'support', 'hello', 'office', 'enquiries', 'billing']

export function MailStep({ view, nav, onClose, next }: StepProps) {
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [local, setLocal] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState(993)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [other, setOther] = useState(false)
  const [busy, setBusy] = useState(0)
  const [result, setResult] = useState<Record<number, FetchResult>>({})
  const [err, setErr] = useState('')

  const domain = hostOf(view?.meta.website ?? '').replace(/^www\./, '')
  const load = () =>
    ipc
      .mailAccountsList()
      .then(setAccounts)
      .catch((e) => setErr(String(e)))
  useEffect(() => {
    void load()
    setImapHost(domain ? `mail.${domain}` : '')
    setSmtpHost(domain ? `mail.${domain}` : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.node_id])

  if (!view) return null
  const name = view.meta.name
  const mine = accounts.filter(
    (a) =>
      a.space.toLowerCase() === name.toLowerCase() ||
      (!!domain && a.address.toLowerCase().endsWith(`@${domain.toLowerCase()}`)),
  )
  const server = mine.find((a) => a.imap_host && a.address.toLowerCase().endsWith(`@${domain.toLowerCase()}`))
  const first = !server || other

  const add = async () => {
    const address = local.includes('@') ? local.trim() : `${local.trim()}@${domain}`
    setErr('')
    setBusy(-1)
    try {
      const def: MailAccount = {
        id: 0,
        name,
        address,
        kind: 'imap',
        imap_host: first ? imapHost.trim() : server!.imap_host,
        imap_port: first ? imapPort : server!.imap_port,
        smtp_host: first ? smtpHost.trim() : server!.smtp_host,
        smtp_port: first ? smtpPort : server!.smtp_port,
        username: address,
        signature: '',
        is_default: false,
        sort: 0,
        created_at: 0,
        last_sync: 0,
        last_error: '',
        has_password: false,
        auth: 'password',
        space: name,
      }
      const id = await ipc.mailAccountSave(def)
      if (password) await ipc.mailAccountSetPassword(id, address, password)
      setLocal('')
      setPassword('')
      setOther(false)
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(0)
    }
  }

  const forget = (id: number) =>
    setResult((cur) => {
      const rest = { ...cur }
      delete rest[id]
      return rest
    })

  const fetchMail = async (a: MailAccount) => {
    setBusy(a.id)
    forget(a.id)
    try {
      const n = await ipc.mailSync(a.id)
      setResult((cur) => ({ ...cur, [a.id]: { ok: true, text: `${n} new, just now` } }))
      await load()
    } catch (e) {
      setResult((cur) => ({ ...cur, [a.id]: { ok: false, text: String(e) } }))
      await load()
    } finally {
      setBusy(0)
    }
  }

  const tie = async (a: MailAccount) => {
    try {
      await ipc.mailAccountSave({ ...a, space: name })
      await load()
    } catch (e) {
      setErr(String(e))
    }
  }

  const localPart = (a: MailAccount) => a.address.split('@')[0]?.toLowerCase() ?? ''

  return (
    <BizFrame step="mail" view={view} nav={nav} onClose={onClose}>
      <Header
        icon="mail"
        title={`Where ${name}'s mail is`}
        text={`Every mailbox on ${domain || 'the business domain'} belongs to ${name}. Add the shared ones and your own. After the first, each one only needs its address and password.`}
      />

      <div className="rounded-[10px] border border-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <span className="font-mono text-[12.5px] text-ink">{domain || 'no website yet'}</span>
          <span className="rounded-full bg-indigo-500/15 px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider text-indigo-400">
            {name}
          </span>
          <span className="flex-1" />
          {server && (
            <span className="text-[10.5px] text-faint">
              server from the first mailbox · IMAP {server.imap_port} · SMTP {server.smtp_port}
            </span>
          )}
        </div>
        {mine.length === 0 && (
          <div className="border-t border-line px-4 py-2.5 text-[12px] text-muted">No mailboxes yet.</div>
        )}
        {mine.map((a) => (
          <MailboxRow
            key={a.id}
            account={a}
            business={name}
            kind={SHARED.includes(localPart(a)) ? 'shared' : 'a person'}
            busy={busy === a.id}
            disabled={busy !== 0}
            result={result[a.id]}
            onFetch={() => void fetchMail(a)}
            onTie={a.space.toLowerCase() !== name.toLowerCase() ? () => void tie(a) : undefined}
            onChanged={load}
            onForget={() => forget(a.id)}
          />
        ))}
        <div className="flex flex-col gap-2 border-t border-line bg-raise px-4 py-3">
          <div className="grid grid-cols-[minmax(0,1fr)_190px_auto] items-center gap-2">
            <div className="flex items-center rounded border border-line2 bg-page px-2 py-1">
              <input
                className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-faint"
                placeholder={mine.length ? 'sales' : 'info'}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
              />
              {!local.includes('@') && domain && <span className="font-mono text-[12px] text-muted">@{domain}</span>}
            </div>
            <input
              className="input text-[12px]"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="btn-ghost text-[11.5px]"
              disabled={!local.trim() || busy !== 0 || (first && !imapHost.trim())}
              onClick={() => void add()}
            >
              <Icon name="add" size={12} /> Add
            </button>
          </div>
          {first ? (
            <div className="grid grid-cols-[minmax(0,1fr)_70px_minmax(0,1fr)_70px] items-center gap-2">
              <input className="input font-mono text-[11.5px]" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="IMAP server" />
              <input className="input text-[11.5px]" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value) || 993)} />
              <input className="input font-mono text-[11.5px]" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="SMTP server" />
              <input className="input text-[11.5px]" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value) || 465)} />
            </div>
          ) : (
            <span className="text-[10.5px] text-faint">same server as {server?.address}, so nothing else to fill in</span>
          )}
        </div>
        {!first && (
          <button
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[12px] text-dim hover:bg-hover"
            onClick={() => setOther(true)}
          >
            <Icon name="add" size={13} className="text-muted" />
            A mailbox on another server
            <span className="text-[10.5px] text-faint">host, port and username</span>
          </button>
        )}
        {err && (
          <div className="border-t border-line px-4 py-2.5">
            <Err>{err}</Err>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-panel px-4 py-3">
        <Icon name="contacts" size={15} className="mt-0.5 shrink-0 text-viol" />
        <div>
          <div className="text-[12.5px] text-ink">Your partner&apos;s mailbox is theirs</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Add it only if they share it with you. Mail they copy to a shared mailbox is read either way.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary text-[12px]" onClick={() => next('learn')}>
          Next: learn
        </button>
        <button className="btn-ghost text-[12px]" onClick={() => nav.onGo('code')}>
          Back
        </button>
      </div>
      <Foot>
        Passwords go to Windows Credential Manager, never the database. This step only fetches. Nothing is
        sent to a model until you approve it in Learn.
      </Foot>
    </BizFrame>
  )
}
