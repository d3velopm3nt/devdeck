// Choosing where the vault lives — the one thing that has to happen before
// anything else works.
//
// This is asked once, on first run, because every folder you make from here on
// lives inside the answer. It is not a settings screen you can skip past: with
// no root there is no tree, so the app says so plainly rather than showing an
// empty Explorer that looks broken.

import { useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { SignInModal } from './SignInModal'
import { GitHubToken } from './GitHubToken'

export function VaultSetup({ onDone }: { onDone: () => void }) {
  const [source, setSource] = useState<'github' | 'local'>('github')
  const [oauth, setOauth] = useState<boolean | null>(null)
  const [signIn, setSignIn] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [repos, setRepos] = useState<ipc.RepoList | null>(null)
  const [repo, setRepo] = useState('')
  const [listing, setListing] = useState(false)
  const [cloned, setCloned] = useState<{ url: string; parent: string; path: string } | null>(null)
  const [path, setPath] = useState('')
  const [gitInit, setGitInit] = useState(true)
  const [adoptExisting, setAdoptExisting] = useState(true)
  const [busy, setBusy] = useState(false)

  // What the old, folder-less tree still holds. Asked of the backend rather
  // than the store: with no root a scan returns nothing, so the rows about to
  // be deleted are invisible from here.
  const [legacy, setLegacy] = useState<ipc.VaultLegacy | null>(null)
  useEffect(() => {
    void ipc.githubOauthConfigured().then(setOauth).catch(() => setOauth(false))
    void ipc.githubTokenStored().then((stored) => { if (stored) void loadRepos() }).catch((e) => setError(String(e)))
    void ipc.vaultLegacy().then(setLegacy).catch(() => setLegacy(null))
    // Pre-filled, so the common case is one click rather than a file dialog.
    void ipc.vaultDefaultRoot().then((d) => setPath((p) => p || d)).catch(() => {})
  }, [])
  const legacyOwned = (legacy?.commands ?? 0) + (legacy?.services ?? 0)
  const [error, setError] = useState('')

  const loadRepos = async () => {
    setListing(true)
    setError('')
    try {
      const list = await ipc.githubStateRepos()
      setRepos(list)
    } catch (e) { setError(String(e)) }
    finally { setListing(false) }
  }

  const choose = async () => {
    const dir = await openDialog({ directory: true, title: source === 'github' ? 'Choose where to clone your state repository' : 'Choose your state folder or existing local clone' })
    if (typeof dir === 'string') {
      setPath(dir)
      setError('')
    }
  }

  const confirm = async () => {
    if (!path.trim()) return
    setBusy(true)
    setError('')
    try {
      let root = path.trim()
      if (source === 'github') {
        if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(repo.trim())) {
          throw new Error('Choose a GitHub repository or enter its HTTPS URL.')
        }
        const parent = root
        root = cloned?.url === repo.trim() && cloned.parent === parent
          ? cloned.path : await ipc.cloneRepo(repo.trim(), parent)
        setCloned({ url: repo.trim(), parent, path: root })
      }
      await ipc.vaultSetRoot(root, source === 'local' && gitInit, adoptExisting)
      void ipc.emitDeckSettingsChanged()
      onDone()
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto bg-app p-8">
      <div className="w-full max-w-[520px]">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <Icon name="folder" size={20} />
          </span>
          <div>
            <h1 className="text-[17px] font-semibold text-ink">Connect your DevDeck state</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              One state repository holds your spaces, context and work.
            </p>
          </div>
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-body">
          Connect the GitHub repository that keeps your DevDeck state. The desktop reads a local
          clone of it, and Deck watches that same clone for updates. Your code repositories stay
          where they are.
        </p>

        <div className="mb-4 flex gap-2" role="group" aria-label="State storage">
          <button className={source === 'github' ? 'btn-primary' : 'btn-ghost'} disabled={busy}
            onClick={() => setSource('github')}><Icon name="github" size={15} /> GitHub repository</button>
          <button className={source === 'local' ? 'btn-primary' : 'btn-ghost'} disabled={busy}
            onClick={() => setSource('local')}><Icon name="folder" size={15} /> Existing clone or local folder</button>
        </div>

        {source === 'github' && <div className="mb-4 space-y-3 rounded-lg border border-line bg-panel p-4">
          <button className="btn-primary w-full justify-center" disabled={oauth !== true || busy || listing}
            onClick={() => setSignIn(true)}><Icon name="github" size={15} /> Connect with GitHub</button>
          {oauth === false && <p className="text-[11.5px] text-muted">
            GitHub sign-in is not configured in this build. Use a personal access token below,
            or select an existing local clone.
          </p>}
          <button className="btn-ghost text-[12px]" disabled={busy} aria-expanded={showToken}
            onClick={() => setShowToken(!showToken)}>Use a personal access token instead</button>
          {showToken && <GitHubToken onSignedIn={() => void loadRepos()} />}
          {repos && <>
            <p className="text-[12px] text-body">Connected as {repos.login}</p>
            <label className="block text-[12px] text-body">State repository
              <select className="input mt-1 w-full" value={repo} disabled={busy || listing}
                onChange={(e) => setRepo(e.target.value)}>
                <option value="">Choose a repository…</option>
                {repos.repos.map((r) => <option key={r.full_name} value={r.clone_url}>{r.full_name}{r.private ? ' (private)' : ''}</option>)}
              </select>
            </label>
            <button className="btn-ghost text-[11.5px]" disabled={busy || listing} onClick={() => void loadRepos()}>Refresh repositories</button>
          </>}
          {listing && <p role="status" className="text-[12px] text-muted">Loading repositories…</p>}
          <label className="block text-[12px] text-body">Repository URL
            <input className="input mt-1 w-full text-[12px]" value={repo} disabled={busy}
              placeholder="https://github.com/you/devdeck-state.git" onChange={(e) => setRepo(e.target.value)} />
          </label>
          <p className="text-[11.5px] text-muted">Choose your state repository. Private repositories need an account with access.</p>
        </div>}

        <p className="mb-1 text-[12px] text-body">{source === 'github' ? 'Clone into this folder' : 'State folder or existing local clone'}</p>

        <div className="flex items-center gap-2 rounded-lg border border-line bg-raise px-3.5 py-2.5">
          <Icon name="folder" size={15} className={path ? 'text-ok' : 'text-faint'} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body">
            {path || 'No folder chosen'}
          </span>
          <button className="btn-ghost text-[11.5px]" disabled={busy} onClick={() => void choose()}>
            Choose…
          </button>
        </div>

        {source === 'local' && <label className="mt-3 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={gitInit}
            onChange={(e) => setGitInit(e.target.checked)}
          />
          <span className="text-[12px] leading-relaxed text-body">
            Make it a git repository
            <span className="block text-[11px] text-muted">
              Runs <span className="font-mono">git init</span> so you can push it to GitHub later and
              have the same setup on another machine. You can do this yourself any time instead.
            </span>
          </span>
        </label>}

        {(legacy?.nodes ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-line2 bg-raise px-3.5 py-2.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={adoptExisting}
                onChange={(e) => setAdoptExisting(e.target.checked)}
              />
              <span className="text-[12px] leading-relaxed text-body">
                Bring my existing setup across
                <span className="block text-[11px] text-muted">
                  You have {legacy?.nodes} item{legacy?.nodes === 1 ? '' : 's'} from before. Each one
                  gets a folder here, keeping the {legacyOwned} command
                  {legacyOwned === 1 ? '' : 's'} and service{legacyOwned === 1 ? '' : 's'} attached to
                  it, and any repository it points at. Untick to start empty — which deletes
                  {' '}{legacyOwned} configured thing{legacyOwned === 1 ? '' : 's'}.
                </span>
              </span>
            </label>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2">
            <Icon name="alert" size={14} className="mt-px shrink-0 text-err" />
            <span className="text-[11.5px] leading-relaxed text-body">{error}</span>
          </div>
        )}

        <button
          className="btn-primary mt-5 w-full justify-center py-2 text-[13px]"
          disabled={!path.trim() || (source === 'github' && !repo.trim()) || busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Setting up…' : source === 'github' ? 'Connect state repository' : 'Use this state folder'}
        </button>
      </div>
      {signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => { setSignIn(false); void loadRepos() }} />}
    </div>
  )
}
