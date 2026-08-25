// Full-width status bar under the top bar for DevDeck's self-update: shows
// whether you're up to date or an update is available, and an animated progress
// line while checking or updating (via scoop).

import { Icon, type IconName } from '../lib/icons'

export type UpState = 'checking' | 'uptodate' | 'available' | 'updating' | 'done' | 'error'

const THEME: Record<UpState, { fg: string; bg: string; accent: string }> = {
  checking: { fg: 'text-indigo-400', bg: 'bg-indigo-500/[0.07]', accent: '#818cf8' },
  updating: { fg: 'text-indigo-400', bg: 'bg-indigo-500/[0.07]', accent: '#818cf8' },
  uptodate: { fg: 'text-ok', bg: 'bg-emerald-500/[0.06]', accent: '#4ade80' },
  done: { fg: 'text-ok', bg: 'bg-emerald-500/[0.06]', accent: '#4ade80' },
  available: { fg: 'text-warn', bg: 'bg-amber-500/[0.08]', accent: '#fbbf24' },
  error: { fg: 'text-err', bg: 'bg-red-500/[0.07]', accent: '#f87171' },
}

export function UpdateBar({
  state,
  current,
  latest,
  viaScoop,
  scoopAvailable,
  scoopInstalling,
  status,
  onUpdate,
  onInstallScoop,
  onRecheck,
  onDismiss,
}: {
  state: UpState
  current: string
  latest: string
  viaScoop: boolean
  scoopAvailable: boolean
  scoopInstalling: boolean
  status: string
  onUpdate: () => void
  onInstallScoop: () => void
  onRecheck: () => void
  onDismiss: () => void
}) {
  const t = THEME[state]
  const busy = state === 'checking' || state === 'updating' || scoopInstalling
  // Offer scoop when it's missing and we're not mid-update — it enables the
  // one-click update path (and CLI tools).
  const offerScoop = !scoopAvailable && (state === 'uptodate' || state === 'available' || state === 'error')

  const icon: IconName = scoopInstalling
    ? 'spinner'
    : state === 'checking' || state === 'updating' ? 'spinner'
      : state === 'available' ? 'update'
      : state === 'error' ? 'alert'
      : 'ok'

  const title = scoopInstalling
    ? 'Installing scoop…'
    : state === 'checking' ? 'Checking for updates…'
      : state === 'updating' ? 'Updating DevDeck…'
      : state === 'available' ? `Update available — v${latest}`
      : state === 'done' ? `Updated to v${latest} — restart DevDeck to apply`
      : state === 'error' ? (latest ? 'Update problem' : "Couldn't check for updates")
      : `DevDeck v${current} is up to date`

  const sub =
    status ||
    (offerScoop
      ? 'Install scoop to manage CLI tools and packages.'
      : state === 'available'
        ? viaScoop
          ? `You're on v${current}. Installs via scoop update devdeck.`
          : `You're on v${current}. Downloads and runs the installer.`
        : state === 'uptodate'
          ? 'You have the latest release.'
          : '')

  return (
    <div className={`flex flex-col border-b border-line ${t.bg}`}>
      <div className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]">
        <Icon name={icon} size={14} className={t.fg} spin={busy} />
        <span className={`font-medium ${t.fg}`}>{title}</span>
        {sub && <span className="min-w-0 truncate font-mono text-[11px] text-muted">{sub}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {offerScoop && (
            <button
              className="flex items-center gap-1 rounded bg-sky-500/20 px-2.5 py-1 text-[11.5px] font-semibold text-info hover:bg-sky-500/30 disabled:opacity-60"
              title="Install scoop (per-user, no admin) — enables one-click updates"
              disabled={scoopInstalling}
              onClick={onInstallScoop}
            >
              <Icon name="download" size={13} /> Install scoop
            </button>
          )}
          {state === 'available' && !scoopInstalling && (
            <button
              className="flex items-center gap-1 rounded bg-amber-500/20 px-2.5 py-1 text-[11.5px] font-semibold text-warn hover:bg-amber-500/30"
              onClick={onUpdate}
            >
              <Icon name="download" size={13} /> Update now
            </button>
          )}
          {state === 'done' && (
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] text-ok">Restart to finish</span>
          )}
          {(state === 'uptodate' || state === 'error') && (
            <button className="flex items-center gap-1 rounded px-2 py-1 text-[11.5px] text-dim hover:bg-hover hover:text-ink" onClick={onRecheck}>
              <Icon name="restart" size={12} /> Re-check
            </button>
          )}
          {!busy && (
            <button className="flex items-center rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-ink" title="Dismiss" onClick={onDismiss}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>
      {/* progress line */}
      {busy ? (
        <div className="dd-track h-[3px] bg-white/5">
          <div className="dd-move" style={{ background: t.accent }} />
        </div>
      ) : (
        <div className="h-[3px] w-full" style={{ background: t.accent, opacity: 0.5 }} />
      )}
    </div>
  )
}
