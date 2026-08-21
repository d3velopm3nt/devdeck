// Full-width status bar under the top bar for DevDeck's self-update: shows
// whether you're up to date or an update is available, and an animated progress
// line while checking or updating (via scoop).

export type UpState = 'checking' | 'uptodate' | 'available' | 'updating' | 'done' | 'error'

const THEME: Record<UpState, { fg: string; bg: string; accent: string }> = {
  checking: { fg: 'text-indigo-200', bg: 'bg-indigo-500/[0.07]', accent: '#818cf8' },
  updating: { fg: 'text-indigo-200', bg: 'bg-indigo-500/[0.07]', accent: '#818cf8' },
  uptodate: { fg: 'text-emerald-300', bg: 'bg-emerald-500/[0.06]', accent: '#4ade80' },
  done: { fg: 'text-emerald-300', bg: 'bg-emerald-500/[0.06]', accent: '#4ade80' },
  available: { fg: 'text-amber-200', bg: 'bg-amber-500/[0.08]', accent: '#fbbf24' },
  error: { fg: 'text-red-300', bg: 'bg-red-500/[0.07]', accent: '#f87171' },
}

export function UpdateBar({
  state,
  current,
  latest,
  viaScoop,
  status,
  onUpdate,
  onRecheck,
  onDismiss,
}: {
  state: UpState
  current: string
  latest: string
  viaScoop: boolean
  status: string
  onUpdate: () => void
  onRecheck: () => void
  onDismiss: () => void
}) {
  const t = THEME[state]
  const busy = state === 'checking' || state === 'updating'

  const icon =
    state === 'checking' || state === 'updating' ? '⟳'
      : state === 'available' ? '⬆'
      : state === 'error' ? '⚠'
      : '✓'

  const title =
    state === 'checking' ? 'Checking for updates…'
      : state === 'updating' ? 'Updating DevDeck…'
      : state === 'available' ? `Update available — v${latest}`
      : state === 'done' ? `Updated to v${latest} — restart DevDeck to apply`
      : state === 'error' ? 'Update problem'
      : `DevDeck v${current} is up to date`

  const sub =
    status ||
    (state === 'available'
      ? viaScoop
        ? `You're on v${current}. Installs via scoop update devdeck.`
        : `You're on v${current}. Opens the download page.`
      : state === 'uptodate'
        ? 'You have the latest release.'
        : '')

  return (
    <div className={`flex flex-col border-b border-slate-800 ${t.bg}`}>
      <div className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]">
        <span className={`text-[13px] ${t.fg} ${busy ? 'inline-block animate-spin' : ''}`}>{icon}</span>
        <span className={`font-medium ${t.fg}`}>{title}</span>
        {sub && <span className="min-w-0 truncate font-mono text-[11px] text-slate-500">{sub}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {state === 'available' && (
            <button
              className="rounded bg-amber-500/20 px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-200 hover:bg-amber-500/30"
              onClick={onUpdate}
            >
              {viaScoop ? '⤓ Update now' : '↗ Get update'}
            </button>
          )}
          {state === 'done' && (
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">Restart to finish</span>
          )}
          {(state === 'uptodate' || state === 'error') && (
            <button className="rounded px-2 py-0.5 text-[11.5px] text-slate-400 hover:bg-slate-700 hover:text-white" onClick={onRecheck}>
              ↻ Re-check
            </button>
          )}
          {!busy && (
            <button className="rounded px-1.5 py-0.5 text-[13px] text-slate-500 hover:bg-slate-700 hover:text-white" title="Dismiss" onClick={onDismiss}>
              ✕
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
