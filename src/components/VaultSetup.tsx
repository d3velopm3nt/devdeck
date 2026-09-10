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

export function VaultSetup({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState('')
  const [gitInit, setGitInit] = useState(true)
  const [adoptExisting, setAdoptExisting] = useState(true)
  const [busy, setBusy] = useState(false)

  // What the old, folder-less tree still holds. Asked of the backend rather
  // than the store: with no root a scan returns nothing, so the rows about to
  // be deleted are invisible from here.
  const [legacy, setLegacy] = useState<ipc.VaultLegacy | null>(null)
  useEffect(() => {
    void ipc.vaultLegacy().then(setLegacy).catch(() => setLegacy(null))
    // Pre-filled, so the common case is one click rather than a file dialog.
    void ipc.vaultDefaultRoot().then((d) => setPath((p) => p || d)).catch(() => {})
  }, [])
  const legacyOwned = (legacy?.commands ?? 0) + (legacy?.services ?? 0)
  const [error, setError] = useState('')

  const choose = async () => {
    const dir = await openDialog({ directory: true, title: 'Where should DevDeck keep its folders?' })
    if (typeof dir === 'string') {
      setPath(dir)
      setError('')
    }
  }

  const confirm = () => {
    if (!path.trim()) return
    setBusy(true)
    setError('')
    void ipc
      .vaultSetRoot(path.trim(), gitInit, adoptExisting)
      .then(() => onDone())
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full items-center justify-center bg-app p-8">
      <div className="w-full max-w-[520px]">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <Icon name="folder" size={20} />
          </span>
          <div>
            <h1 className="text-[17px] font-semibold text-ink">Where should DevDeck keep things?</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              One folder holds every workspace, project and topic you make.
            </p>
          </div>
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-body">
          Everything in the Explorer is a real folder inside this one, so you can open it in File
          Explorer, edit it by hand, and back it up like anything else. Your code repositories stay
          where they already are — a project here just points at one.
        </p>

        <div className="flex items-center gap-2 rounded-lg border border-line bg-raise px-3.5 py-2.5">
          <Icon name="folder" size={15} className={path ? 'text-ok' : 'text-faint'} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body">
            {path || 'No folder chosen'}
          </span>
          <button className="btn-ghost text-[11.5px]" disabled={busy} onClick={() => void choose()}>
            Choose…
          </button>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2.5">
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
        </label>

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
          disabled={!path.trim() || busy}
          onClick={confirm}
        >
          {busy ? 'Setting up…' : 'Use this folder'}
        </button>
      </div>
    </div>
  )
}
