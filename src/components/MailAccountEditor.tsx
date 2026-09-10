// The mail account editor: a slide-over, like the connection editor.
//
// The password field is the interesting part, and it behaves exactly like the
// connection editor's — it writes straight to Windows Credential Manager and
// is never read back, so this form can tell you a password *exists* but can
// never show you one.

import { useEffect, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import type { MailAccount, MailKind, MailTestResult } from '../lib/types'

/** Gmail is IMAP + SMTP with Google's hosts filled in — the transport is
 *  identical, so it is a preset rather than a separate code path. */
const PRESETS: Record<MailKind, { label: string; hint: string; fill: Partial<MailAccount> }> = {
  gmail: {
    label: 'Gmail',
    hint: 'Google hosts, prefilled',
    fill: {
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 465,
    },
  },
  imap: {
    label: 'IMAP + SMTP',
    hint: 'Any mail host',
    fill: { imap_port: 993, smtp_port: 465 },
  },
}

const BLANK: MailAccount = {
  id: 0,
  name: '',
  address: '',
  kind: 'imap',
  imap_host: '',
  imap_port: 993,
  smtp_host: '',
  smtp_port: 465,
  username: '',
  signature: '',
  is_default: false,
  sort: 0,
  created_at: 0,
  last_sync: 0,
  last_error: '',
  has_password: false,
}

export function MailAccountEditor() {
  const { mailAccountEditing, mailAccounts, openMailAccountEditor, refreshMailAccounts, syncMail } =
    useApp()

  const [def, setDef] = useState<MailAccount>(BLANK)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<MailTestResult | null>(null)

  useEffect(() => {
    if (mailAccountEditing == null) return
    const found = mailAccounts.find((a) => a.id === mailAccountEditing)
    setDef(found ? { ...found } : { ...BLANK })
    setPassword('')
    setError('')
    setTest(null)
  }, [mailAccountEditing, mailAccounts])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openMailAccountEditor(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openMailAccountEditor])

  if (mailAccountEditing == null) return null
  const close = () => openMailAccountEditor(null)

  const pickKind = (kind: MailKind) =>
    setDef((d) => ({ ...d, kind, ...PRESETS[kind].fill }))

  /** Saves, then stores the password. Order matters: a new account has no id
   *  to hang a credential on until it exists. */
  const persist = async (): Promise<number> => {
    if (!def.address.trim()) throw new Error('An account needs an email address.')
    const id = await ipc.mailAccountSave({ ...def, address: def.address.trim() })
    // Only touch the credential when you typed something — an untouched field
    // must never wipe a stored password.
    if (password) {
      await ipc.mailAccountSetPassword(id, def.username.trim() || def.address.trim(), password)
    }
    await refreshMailAccounts()
    return id
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const id = await persist()
      close()
      // A freshly configured account should show mail, not an empty list.
      if (id > 0) void syncMail(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runTest = async () => {
    setBusy(true)
    setError('')
    setTest(null)
    try {
      const id = await persist()
      setDef((d) => ({ ...d, id }))
      setTest(await ipc.mailAccountTest(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (def.id <= 0) return close()
    await ipc.mailAccountDelete(def.id)
    await refreshMailAccounts()
    close()
  }

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      {node}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )

  return (
    <>
      <div className="sheet-scrim" onClick={close} />
      <div className="sheet-panel flex flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="mail" size={15} className="text-indigo-400" />
          <span className="text-[13.5px] font-semibold text-ink">
            {def.id > 0 ? 'Edit mail account' : 'Add mail account'}
          </span>
          <button className="ml-auto rounded p-1 text-muted hover:text-ink" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-err">
              {error}
            </div>
          )}

          {field(
            'Provider',
            <div className="flex gap-1.5">
              {(Object.keys(PRESETS) as MailKind[]).map((k) => (
                <button
                  key={k}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-left ${
                    def.kind === k
                      ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                      : 'border-line2 text-dim hover:border-line3 hover:text-ink'
                  }`}
                  onClick={() => pickKind(k)}
                >
                  <span className="block text-[12px]">{PRESETS[k].label}</span>
                  <span className="block text-[10.5px] text-muted">{PRESETS[k].hint}</span>
                </button>
              ))}
            </div>,
          )}

          <div className="flex gap-2.5">
            {field(
              'Display name',
              <input
                className="input w-full"
                value={def.name}
                placeholder="Dewald · DevelTech"
                onChange={(e) => setDef((d) => ({ ...d, name: e.target.value }))}
              />,
            )}
            {field(
              'Email address',
              <input
                className="input w-full"
                value={def.address}
                placeholder="you@example.com"
                onChange={(e) => setDef((d) => ({ ...d, address: e.target.value }))}
              />,
            )}
          </div>

          {field(
            'Incoming — IMAP',
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={def.imap_host}
                placeholder="imap.example.com"
                onChange={(e) => setDef((d) => ({ ...d, imap_host: e.target.value }))}
              />
              <input
                className="input w-20"
                type="number"
                value={def.imap_port}
                onChange={(e) => setDef((d) => ({ ...d, imap_port: Number(e.target.value) }))}
              />
            </div>,
            'TLS on 993. DevDeck does not speak plaintext IMAP.',
          )}

          {field(
            'Outgoing — SMTP',
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={def.smtp_host}
                placeholder="smtp.example.com"
                onChange={(e) => setDef((d) => ({ ...d, smtp_host: e.target.value }))}
              />
              <input
                className="input w-20"
                type="number"
                value={def.smtp_port}
                onChange={(e) => setDef((d) => ({ ...d, smtp_port: Number(e.target.value) }))}
              />
            </div>,
            '465 is implicit TLS, 587 is STARTTLS — picking the wrong one is why mail clients hang.',
          )}

          {field(
            'Username',
            <input
              className="input w-full"
              value={def.username}
              placeholder="defaults to the email address"
              onChange={(e) => setDef((d) => ({ ...d, username: e.target.value }))}
            />,
          )}

          {field(
            'Password',
            <input
              className="input w-full"
              type="password"
              value={password}
              placeholder={def.has_password ? '•••••••• (stored)' : 'not stored yet'}
              onChange={(e) => setPassword(e.target.value)}
            />,
            def.kind === 'gmail'
              ? 'Gmail needs an app password, not your Google password. Written straight to Windows Credential Manager and never read back.'
              : 'Written straight to Windows Credential Manager and never read back — this form can tell you a password exists, but can never show you one.',
          )}

          {field(
            'Signature',
            <textarea
              className="input h-16 w-full resize-none"
              value={def.signature}
              onChange={(e) => setDef((d) => ({ ...d, signature: e.target.value }))}
            />,
          )}

          <label className="flex items-center gap-2 text-[12px] text-body">
            <input
              type="checkbox"
              checked={def.is_default}
              onChange={(e) => setDef((d) => ({ ...d, is_default: e.target.checked }))}
            />
            Send new mail from this account by default
          </label>

          {/* Reported per half: IMAP can work while SMTP does not, and one
              blanket "failed" helps nobody. */}
          {test && (
            <div className="space-y-1.5 rounded-lg border border-line bg-panel px-3.5 py-3">
              {(
                [
                  ['IMAP', test.imap_ok, test.imap_detail],
                  ['SMTP', test.smtp_ok, test.smtp_detail],
                ] as const
              ).map(([label, ok, detail]) => (
                <div
                  key={label}
                  className={`flex items-start gap-2 font-mono text-[11px] ${ok ? 'text-ok' : 'text-err'}`}
                >
                  <Icon name={ok ? 'ok' : 'alert'} size={12} className="mt-[1px] shrink-0" />
                  <span>
                    {label} — {detail}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button className="btn-ghost text-[12px]" disabled={busy} onClick={() => void runTest()}>
            {busy ? 'Working…' : 'Test connection'}
          </button>
          {def.id > 0 && (
            <button className="btn-danger text-[12px]" onClick={() => void remove()}>
              Remove
            </button>
          )}
          <span className="flex-1" />
          <button className="btn-ghost text-[12px]" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary text-[12px]" disabled={busy} onClick={() => void save()}>
            {def.id > 0 ? 'Save' : 'Add account'}
          </button>
        </div>
      </div>
    </>
  )
}
