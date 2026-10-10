import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../lib/ipc'
import { GitHubToken } from './GitHubToken'
import { SignInModal } from './SignInModal'

export function GitHubConnection({ onConnected }: { onConnected?: () => void }) {
  const [oauth, setOauth] = useState(false)
  const [login, setLogin] = useState('')
  const [error, setError] = useState('')
  const [signIn, setSignIn] = useState(false)
  const connectedRef = useRef(onConnected)
  connectedRef.current = onConnected
  const refresh = useCallback(async () => {
    setError('')
    try { const result = await ipc.githubStateRepos(); setLogin(result.signed_in ? result.login : ''); if (result.signed_in) connectedRef.current?.() }
    catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void ipc.githubOauthConfigured().then(setOauth).catch(() => setOauth(false)); void refresh() }, [refresh])
  return <section className="rounded-xl border border-line bg-panel p-4">
    <h2 className="font-semibold text-ink">GitHub connection</h2>
    <p className="my-2 text-sm text-muted">Connect once to select product repositories, read issues and receive session checkpoints. State storage can remain local.</p>
    {login && <p role="status" className="my-2 text-sm text-ok">Connected as {login}</p>}
    {oauth && <button className="btn-primary mb-3" onClick={() => setSignIn(true)}>Connect with GitHub</button>}
    {!oauth && <p className="mb-3 text-xs text-muted">GitHub browser sign-in is not configured in this build. Use a token to connect your account.</p>}
    <GitHubToken onSignedIn={() => void refresh()} />
    <button className="btn-ghost mt-3 text-sm" onClick={() => void refresh()}>Check connection</button>
    {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    {signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => { setSignIn(false); void refresh() }} />}
  </section>
}
