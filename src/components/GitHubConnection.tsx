import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../lib/ipc'
import { BrandIcon } from './BrandIcon'
import { Icon } from '../lib/icons'
import { GitHubToken } from './GitHubToken'
import { GITHUB_REFRESH_OPTIONS, loadGithubRefresh, saveGithubRefresh } from '../lib/githubRefresh'
import { SignInModal } from './SignInModal'

export function GitHubConnection({ onConnected, showRefreshSettings = false }: { onConnected?: () => void; showRefreshSettings?: boolean }) {
  const [oauth, setOauth] = useState(false)
  const [login, setLogin] = useState('')
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [refreshMinutes, setRefreshMinutes] = useState(1)
  const [refreshReady, setRefreshReady] = useState(false)
  const [savingRefresh, setSavingRefresh] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState('')
  const [error, setError] = useState('')
  const [signIn, setSignIn] = useState(false)
  const connectedRef = useRef(onConnected)
  connectedRef.current = onConnected
  const refresh = useCallback(async () => {
    setError(''); setChecking(true)
    try { const result = await ipc.githubStateRepos(); setLogin(result.signed_in ? result.login : ''); if (result.signed_in) connectedRef.current?.() }
    catch (e) { setError(String(e)) }
    finally { setChecking(false); setChecked(true) }
  }, [])
  useEffect(() => { void ipc.githubOauthConfigured().then(setOauth).catch(() => setOauth(false)); void refresh() }, [refresh])
  useEffect(() => {
    if (!showRefreshSettings) return
    let active = true
    void loadGithubRefresh().then(value => { if (active) { setRefreshMinutes(value); setRefreshReady(true) } }).catch(e => { if (active) setRefreshNotice(String(e)) })
    return () => { active = false }
  }, [showRefreshSettings])
  const saveRefresh = async () => {
    setSavingRefresh(true); setRefreshNotice('')
    try { await saveGithubRefresh(refreshMinutes); setRefreshNotice('Refresh preference saved.') }
    catch (e) { setRefreshNotice(String(e)) }
    finally { setSavingRefresh(false) }
  }
  return <section className="rounded-lg border border-line bg-panel px-4 py-3">
    <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink"><BrandIcon brand="github" size={15} />Account connection</h2>
    <p className="my-2 text-[12px] leading-relaxed text-muted">Connect once to select product repositories, read issues and receive session checkpoints. State storage can remain local.</p>
    <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2 text-[12px]">
      <Icon name={checking ? 'update' : error ? 'alert' : login ? 'ok' : 'info'} size={14} spin={checking} />
      <span className={error ? 'text-err' : login ? 'text-ok' : 'text-muted'}>{checking ? 'Checking account connection…' : error ? 'Connection check failed' : login ? `Connected as ${login}` : checked ? 'No signed-in account detected' : 'Connection not checked'}</span>
    </div>
    {oauth && <button className="btn-primary mb-3" onClick={() => setSignIn(true)}><BrandIcon brand="github" size={14} />Connect with GitHub</button>}
    {!oauth && <p className="mb-3 text-xs text-muted">GitHub browser sign-in is not configured in this build. Use a token to connect your account.</p>}
    <GitHubToken onSignedIn={() => void refresh()} onSignedOut={() => { setLogin(''); setChecked(true) }} />
    <button className="btn-ghost mt-3 text-[12px]" disabled={checking} onClick={() => void refresh()}><Icon name="update" size={13} />Check connection</button>
    {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    {showRefreshSettings && <section className="mt-5 border-t border-line pt-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Icon name="update" size={14} />Issues &amp; pull requests</h3>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">Choose when Activity checks connected repositories for issue, PR and checkpoint updates.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-[12px] text-body">Automatic refresh<select aria-label="GitHub automatic refresh" disabled={!refreshReady || savingRefresh} className="input mt-1 block min-w-48 text-[12px]" value={refreshMinutes} onChange={e => setRefreshMinutes(Number(e.target.value))}>{GITHUB_REFRESH_OPTIONS.map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? 'Manual only' : `Every ${minutes} minute${minutes === 1 ? '' : 's'}`}</option>)}</select></label><button className="btn-primary text-[12px]" disabled={!refreshReady || savingRefresh} onClick={() => void saveRefresh()}><Icon name="check" size={13} />{savingRefresh ? 'Saving…' : 'Save refresh preference'}</button></div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">Automatic checks run while Activity is open and visible. Refresh remains available manually. Background monitoring across the app is not enabled here.</p>
      {refreshNotice && <p role="status" className="mt-2 text-[12px] text-muted">{refreshNotice}</p>}
    </section>}
    {signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => { setSignIn(false); void refresh() }} />}
  </section>
}
