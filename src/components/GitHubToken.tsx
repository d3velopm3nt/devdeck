// Signing in to GitHub by pasting a token.
//
// The device flow next door is the nicer path and it is not available: this
// build has no registered OAuth App, so `github_oauth_configured` answers
// false and the Sign in button dead-ends. Until that app exists, this screen
// *is* GitHub authentication in DevDeck — for cloning private repos, and for
// the push button on the Git page.
//
// Three rules it keeps:
//
//  * The token is never read back. It goes to Windows Credential Manager and
//    the field is cleared; there is no "show" toggle, because the only way to
//    offer one is to hold the secret in the renderer.
//  * The scopes are checked at paste time. The box people forget is `repo`,
//    and forgetting it fails at the first private clone — a long way from the
//    screen where the mistake was made.
//  * `gh` not taking the token is said out loud. It means the app is signed in
//    and `git push` is not, which is a worse lie than showing nothing.
//
// The four facts are held apart on purpose. Folding them into one `state`
// union made a failed save hide the "a token is saved" banner, which told
// someone whose existing token still worked that they had none.

import { useEffect, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'

/** github.com's own "new token" page, with our scopes pre-ticked. */
const NEW_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org,gist&description=DevDeck'

export function GitHubToken() {
  /** Whether a token is in Credential Manager. `null` until we know — which
   *  is not the same as "no", and must not be drawn as one. */
  const [stored, setStored] = useState<boolean | null>(null)
  const [result, setResult] = useState<ipc.TokenPasted | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')

  useEffect(() => {
    let alive = true
    ipc
      .githubTokenStored()
      .then((has) => alive && setStored(has))
      // A failed check is not "no token" — saying so would invite someone to
      // paste over one that is already working. It stays unknown and says so.
      .catch((e) => alive && setError(errText(e)))
    return () => {
      alive = false
    }
  }, [])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await ipc.githubTokenPaste(token)
      // Cleared on success only: a rejected token is usually a wrong-token
      // problem, and wiping the field makes it harder to see what went in.
      setToken('')
      setResult(r)
      setStored(true)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setError(null)
    try {
      await ipc.githubSignOut(true)
      setStored(false)
      setResult(null)
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        GitHub account
      </h3>

      {stored === null && !error && (
        <div className="flex items-center gap-1.5 text-[12px] text-muted">
          <Icon name="update" size={12} spin /> Checking…
        </div>
      )}

      {stored === true && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-raise px-3 py-2">
          <Icon name="github" size={14} className="shrink-0 text-ok" />
          <span className="min-w-0 flex-1 text-[12px] text-body">
            {result ? (
              <>
                Signed in as <span className="text-ink">{result.login}</span>
              </>
            ) : (
              'A GitHub token is saved on this machine.'
            )}
          </span>
          <button className="btn-ghost text-[11.5px]" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}

      {result && <Verdict result={result} />}

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {stored === false && (
        <p className="mt-1 text-[11.5px] leading-5 text-muted">
          DevDeck has no OAuth app registered yet, so sign-in is a token you make yourself. It is
          stored in Windows Credential Manager — never in DevDeck&apos;s database, never in a log,
          and never shown back to you.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input
          className="input min-w-0 flex-1 font-mono text-[11.5px]"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            stored ? 'Paste a new token to replace the saved one' : 'ghp_… or github_pat_…'
          }
          value={token}
          disabled={busy}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && token.trim() && !busy) void save()
          }}
        />
        <button
          className="btn-primary shrink-0 text-[12px]"
          disabled={busy || token.trim() === ''}
          onClick={() => void save()}
        >
          <Icon name={busy ? 'update' : 'check'} size={12} spin={busy} />
          {busy ? 'Checking…' : 'Save'}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <button
          className="inline-flex shrink-0 items-center gap-1 text-indigo-400 hover:underline"
          onClick={() => void ipc.openUrl(NEW_TOKEN_URL)}
        >
          <Icon name="external" size={11} /> Create a token on GitHub
        </button>
        <span>
          Opens with <code>repo</code>, <code>read:org</code> and <code>gist</code> already ticked.
        </span>
      </div>
    </section>
  )
}

/// What the token turned out to be — said now, while the person can still fix it.
function Verdict({ result }: { result: ipc.TokenPasted }) {
  return (
    <div className="mt-2 space-y-1.5">
      {result.missing.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-5 text-warn">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          <span>
            This token is missing <code>{result.missing.join(', ')}</code>.
            {result.missing.includes('repo')
              ? ' Without repo it can read public repositories only — cloning or pushing a private one will fail.'
              : ' Some features will fail until you make a token with it ticked.'}
          </span>
        </div>
      )}
      {!result.scopes_known && (
        <p className="text-[11px] leading-5 text-muted">
          GitHub did not report this token&apos;s permissions, which is normal for a fine-grained
          token. Make sure it grants Contents (read and write) on the repositories you use here.
        </p>
      )}
      {!result.gh && (
        <p className="text-[11px] leading-5 text-muted">
          The <code>gh</code> CLI did not take this token, so DevDeck is signed in but{' '}
          <code>git push</code> from a terminal may not be. Install GitHub CLI, or run{' '}
          <code>gh auth login</code> yourself.
        </p>
      )}
    </div>
  )
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
