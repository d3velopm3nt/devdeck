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
import { CAPTURE_MAIL_ACCOUNT } from '../lib/devCapture'
import { GoogleButton } from './GoogleMark'

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

/** Where Google actually keeps these. Both are stable, documented entry
 *  points rather than deep links into a flow that moves. */
const GMAIL_2SV_URL = 'https://myaccount.google.com/signinoptions/twosv'
const GMAIL_APP_PW_URL = 'https://myaccount.google.com/apppasswords'

const BLANK: MailAccount = {
  id: 0,
  name: '',
  address: '',
  kind: 'imap',
  auth: 'password',
  space: '',
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

/** Screenshot harness: start a new account on a given provider, because this
 *  session cannot click the provider buttons. Empty in normal use. */
function blankForCapture(): Partial<MailAccount> {
  const k = CAPTURE_MAIL_ACCOUNT as MailKind
  if (!k || !PRESETS[k]) return {}
  return { kind: k, ...PRESETS[k].fill }
}

export function MailAccountEditor() {
  const { mailAccountEditing, mailAccounts, openMailAccountEditor, refreshMailAccounts, syncMail } =
    useApp()

  const [def, setDef] = useState<MailAccount>(() => ({ ...BLANK, ...blankForCapture() }))
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<MailTestResult | null>(null)
  const [googleReady, setGoogleReady] = useState(false)
  const [googleWhy, setGoogleWhy] = useState('')
  // Hosts, ports and a password are Google's business once you sign in with
  // it. They stay available for anyone who would rather use an app password,
  // behind a link, rather than sitting there implying a decision to make.
  const [manual, setManual] = useState(false)

  // Asked once, not guessed: a build with no client configured must not show
  // a button whose only possible answer is an apology.
  //
  // A failure here is reported rather than read as "no". Swallowing it makes a
  // broken call look exactly like a build with no client, which is the failure
  // this project has a rule about.
  useEffect(() => {
    let live = true
    void ipc
      .mailGoogleAvailable()
      .then((ok) => {
        if (!live) return
        setGoogleReady(ok)
        setGoogleWhy('')
      })
      .catch((e) => {
        if (!live) return
        setGoogleReady(false)
        setGoogleWhy(String(e))
      })
    return () => {
      live = false
    }
  }, [])

  /**
   * Connect with Google.
   *
   * A new account asks Google nothing about itself first: the token reply
   * names whoever consented, and everything else about Gmail is already known.
   * Making someone type an address they are about to pick from a chooser is
   * both redundant and a way to end up with an account whose row says one
   * mailbox and whose token opens another.
   *
   * An existing account keeps its own identity and only swaps how it logs in.
   */
  const signInWithGoogle = async () => {
    setError('')
    setBusy(true)
    try {
      if (def.id === 0) {
        const account = await ipc.mailGoogleConnect()
        setDef({ ...account })
      } else {
        await ipc.mailGoogleSignIn(def.id, def.address.trim())
        setDef((d) => ({ ...d, auth: 'oauth', has_password: false }))
      }
      setTest(null)
      await refreshMailAccounts()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const forgetGoogle = async () => {
    setError('')
    setBusy(true)
    try {
      await ipc.mailGoogleSignOut(def.id)
      setDef((d) => ({ ...d, auth: 'password' }))
      setTest(null)
      await refreshMailAccounts()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (mailAccountEditing == null) return
    const found = mailAccounts.find((a) => a.id === mailAccountEditing)
    setDef(found ? { ...found } : { ...BLANK, ...blankForCapture() })
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
  /**
   * Whether to draw hosts, ports and a password at all.
   *
   * A connected Google account never does: Gmail's settings are not a choice
   * anyone makes, and leaving empty boxes there implies the connection is
   * incomplete when it is finished.
   */
  // Spaces are the workspaces in the tree. Read straight from the store
  // rather than fetched: the tree is already loaded by the time a mail
  // account sheet can be opened.
  const spaces = useApp((s) => s.nodes).filter((n) => n.kind === 'workspace')

  const googlePath = def.kind === 'gmail' && googleReady
  const showFields = def.auth !== 'oauth' && (!googlePath || manual)

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

          {/* One click when this build carries a Google client, and the app
              password walkthrough when it does not. Only one of these two
              panels ever shows: the walkthrough is three steps at Google, and
              nobody should be reading it while a button sits above it doing
              the same job. The password field itself stays either way, because
              someone who already has an app password should not be made to
              sign in to use it. */}
          {def.kind === 'gmail' && googleReady && (
            <div className="rounded-lg border border-line2 bg-raise/50 px-3 py-3">
              {def.auth === 'oauth' ? (
                <>
                  <div className="flex items-center gap-2 text-[12px] text-ink">
                    <Icon name="check" size={14} className="text-ok" />
                    Connected with Google
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    DevDeck holds a token, never your password. Revoking it here only forgets
                    the local copy — remove DevDeck under your Google account's third-party
                    connections to end it at their side too.
                  </p>
                  <button
                    className="mt-2 rounded border border-line2 px-2 py-1 text-[11px] text-dim hover:border-line3 hover:text-ink"
                    disabled={busy}
                    onClick={() => void forgetGoogle()}
                  >
                    Forget this sign-in
                  </button>
                </>
              ) : (
                <>
                  <div className="text-[11.5px] font-semibold text-ink">Sign in with Google</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Opens your browser. Your password never reaches DevDeck, and you can revoke
                    the access from your Google account at any time without changing it.
                  </p>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
                    Google will say it has not verified this app. That is expected for a build
                    signing in with its own client — click Advanced, then continue.
                  </p>
                  <div className="mt-2.5">
                    <GoogleButton
                      onClick={() => void signInWithGoogle()}
                      disabled={busy}
                      label={busy ? 'Waiting for your browser...' : 'Continue with Google'}
                    />
                  </div>
                  <button
                    className="mt-2 text-[11px] text-muted underline decoration-dotted hover:text-ink"
                    onClick={() => setManual((m) => !m)}
                  >
                    {manual ? 'Hide the manual settings' : 'Set it up by hand instead'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Gmail is the one provider where a correct password is still
              refused, and the server's own message does not say why. Everyone
              hits this once; the difference is whether it costs a minute or an
              evening. The two links are the two walls, in the order you meet
              them — app passwords do not exist until 2-Step is on. */}
          {googleWhy && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-warn">
              Could not ask whether Google sign-in is available: {googleWhy}
            </div>
          )}

          {def.kind === 'gmail' && !googleReady && (
            <div className="rounded-lg border border-line2 bg-raise/50 px-3 py-2.5">
              <div className="text-[11.5px] font-semibold text-ink">
                Gmail needs an app password, not your Google password
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Google stopped accepting account passwords over IMAP in 2022. An app password is 16
                characters, generated once, and revocable on its own without touching your account.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  className="rounded border border-line2 px-2 py-1 text-[11px] text-dim hover:border-line3 hover:text-ink"
                  onClick={() => void ipc.openUrl(GMAIL_2SV_URL).catch((e) => setError(String(e)))}
                >
                  1 · Turn on 2-Step Verification
                </button>
                <button
                  className="rounded border border-indigo-500/50 bg-indigo-500/10 px-2 py-1 text-[11px] text-ink hover:border-indigo-500"
                  onClick={() =>
                    void ipc.openUrl(GMAIL_APP_PW_URL).catch((e) => setError(String(e)))
                  }
                >
                  2 · Make an app password
                </button>
              </div>
              <p className="mt-1.5 text-[10.5px] text-faint">
                Step 2 is a 404 until step 1 is done — that page only exists on accounts with
                2-Step on.
              </p>
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

          {/* Hosts, ports, username and password are Google's business once you
              sign in with it, so they are not shown at all on that path. An
              account already connected never shows them; a new Gmail account
              shows them only if you ask for the manual route. */}
          {showFields && (
          <>
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

          {def.auth !== 'oauth' &&
            field(
            'Password',
            <input
              className="input w-full"
              type="password"
              value={password}
              placeholder={def.has_password ? '•••••••• (stored)' : 'not stored yet'}
              onChange={(e) => setPassword(e.target.value)}
            />,
            def.kind === 'gmail'
              ? googleReady
                ? 'Only if you would rather use an app password than sign in above. Written straight to Windows Credential Manager and never read back.'
                : 'Paste the 16 characters from Google here. Written straight to Windows Credential Manager and never read back.'
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

          </>
          )}

          {/* Board 5 of the design: which business a mailbox belongs to.
              A suggestion, not a rule -- it becomes the default destination on
              each fact learned from this account, correctable in one click on
              the one card that is wrong. A business inbox is full of ordinary
              life, so a rule would file two facts in the wrong company where
              nobody would notice. */}
          {field(
            'Belongs to',
            <select
              className="input w-full"
              value={def.space}
              onChange={(e) => setDef((d) => ({ ...d, space: e.target.value }))}
            >
              <option value="">Nothing in particular</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>,
            'Where a fact learned from this mailbox is filed by default. Never hides mail — every mailbox is still one inbox.',
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
