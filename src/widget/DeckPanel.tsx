import { useEffect, useState, type MouseEvent } from 'react'
import { Icon, type IconName } from '../lib/icons'
import * as ipc from '../lib/ipc'
import type { DeckSettings } from '../lib/deck'
import type { DeckUpdate } from '../lib/deckUpdates'
import { useApp } from '../store'
import { DeckLogo } from './DeckLogo'

export type DeckView = 'menu' | 'today' | 'focus' | 'spaces' | 'updates'
const MENU: { label: string; icon: IconName; view: string }[] = [
  { label: 'Spaces', icon: 'workspace', view: 'spaces' },
  { label: 'Today', icon: 'schedule', view: 'today' },
  { label: 'Apps', icon: 'package', view: 'apps' },
  { label: 'Mail', icon: 'mail', view: 'mail' },
  { label: 'Updates', icon: 'update', view: 'updates' },
  { label: 'Ask', icon: 'ai', view: 'ask' },
]

const pad = (n: number) => String(n).padStart(2, '0')

export function DeckPanel({
  view,
  settings,
  updates,
  side,
  onLauncherMouseDown,
  onIcon,
  onView,
  onFull,
  onSettings,
  onDock,
}: {
  view: DeckView
  settings: DeckSettings
  updates: DeckUpdate[]
  side: 'left' | 'right'
  onLauncherMouseDown: (event: MouseEvent) => void
  onIcon: () => void
  onView: (view: DeckView) => void
  onFull: () => void
  onSettings: () => void
  onDock: () => void
}) {
  const [items, setItems] = useState<ipc.CalendarItem[]>([])
  const [focus, setFocus] = useState<ipc.Focus | null>(null)
  const [goal, setGoal] = useState('')
  const [now, setNow] = useState(Date.now())
  const [pauseAt, setPauseAt] = useState<number | null>(null)
  const [pausedMs, setPausedMs] = useState(0)
  const [error, setError] = useState('')
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const nodes = useApp((s) => s.nodes)
  const workspaces = nodes.filter((n) => n.kind === 'workspace')
  const projects = nodes.filter((n) => n.kind === 'project')
  const focusId = focus?.id

  useEffect(() => {
    if (view === 'menu') return
    const refresh = () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      void ipc
        .calendarRange(start.getTime(), start.getTime() + 86_400_000 - 1)
        .then(setItems)
        .catch(() => setItems([]))
      void ipc
        .focusCurrent()
        .then(setFocus)
        .catch(() => setFocus(null))
    }
    refresh()
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    const refreshTimer = window.setInterval(refresh, 30_000)
    return () => {
      window.clearInterval(clock)
      window.clearInterval(refreshTimer)
    }
  }, [view])

  useEffect(() => {
    if (!focusId) {
      setPauseAt(null)
      setPausedMs(0)
      return
    }
    void ipc.settingGet('deck.focus.timer').then((raw) => {
      try {
        const saved = JSON.parse(raw ?? '{}') as {
          id?: number
          pauseAt?: number | null
          pausedMs?: number
        }
        if (saved.id === focusId) {
          setPauseAt(saved.pauseAt ?? null)
          setPausedMs(saved.pausedMs ?? 0)
        }
      } catch {
        /* an older setting should not break the timer */
      }
    })
  }, [focusId])

  const saveTimer = (f: ipc.Focus, at: number | null, elapsed: number) =>
    ipc.settingSet(
      'deck.focus.timer',
      JSON.stringify({ id: f.id, pauseAt: at, pausedMs: elapsed }),
    )

  const startFocus = async () => {
    setError('')
    try {
      const next = await ipc.focusStart(goal.trim() || 'Focus session', null)
      await saveTimer(next, null, 0)
      setFocus(next)
      setPauseAt(null)
      setPausedMs(0)
      onView('focus')
    } catch (e) {
      setError(String(e))
    }
  }
  const togglePause = async () => {
    if (!focus) return
    const nextPaused =
      pauseAt === null ? pausedMs : pausedMs + Date.now() - pauseAt
    const at = pauseAt === null ? Date.now() : null
    setPauseAt(at)
    setPausedMs(nextPaused)
    await saveTimer(focus, at, nextPaused)
  }
  const finishFocus = async () => {
    try {
      await ipc.focusEnd(0)
      setFocus(null)
      onView('today')
    } catch (e) {
      setError(String(e))
    }
  }
  const elapsed = focus
    ? Math.max(0, (pauseAt ?? now) - focus.started_at - pausedMs)
    : 0
  const left = Math.max(0, settings.focusMinutes * 60_000 - elapsed)
  const remaining = `${pad(Math.floor(left / 60_000))}:${pad(Math.floor(left / 1000) % 60)}`
  const inWorkspace = (space: string | undefined) =>
    workspaceId === null ||
    projects.some((p) => p.name === space && p.parent_id === workspaceId)
  const upcoming = items
    .filter(
      (i) =>
        i.at >= now - 5 * 60_000 &&
        i.kind !== 'deadline' &&
        inWorkspace(i.space),
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
  const filteredUpdates = updates.filter((u) => inWorkspace(u.space))

  const progress = Math.min(1, elapsed / (settings.focusMinutes * 60_000))
  const navigate = (destination: string) => {
    void ipc.emitDeckNavigate(destination)
    void ipc.focusMain()
  }
  const launcher = (
    <button
      className="deck-launcher"
      onMouseDown={onLauncherMouseDown}
      title="Deck · drag to move"
      aria-label="Deck"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (view === 'menu') onIcon()
          else onView('menu')
        }
      }}
    >
      <DeckLogo />
      {updates.length > 0 && (
        <span className="deck-badge">{updates.length}</span>
      )}
    </button>
  )
  const tabs = (
    <div className="deck-space-tabs">
      <button
        className={workspaceId === null ? 'active' : ''}
        onClick={() => setWorkspaceId(null)}
      >
        <Icon name="layout" size={17} />
        All spaces
      </button>
      {workspaces.map((w) => (
        <button
          key={w.id}
          className={workspaceId === w.id ? 'active' : ''}
          onClick={() => setWorkspaceId(w.id)}
        >
          <Icon name="layout" size={17} />
          {w.name}
        </button>
      ))}
    </div>
  )
  const updateRows = (limit: number) =>
    filteredUpdates.length ? (
      filteredUpdates.slice(0, limit).map((u) => (
        <div key={u.id} className="deck-update-row">
          <span className="deck-update-dot" />
          <span className="deck-avatar">{u.space.slice(0, 1)}</span>
          <div className="deck-update-copy">
            <strong>{u.title}</strong>
            <small>
              {u.space} · {u.kind}
            </small>
          </div>
          <small className="deck-update-age">
            {Math.max(0, Math.floor((now - u.at) / 60000))} min ago
          </small>
          <button className="deck-primary" onClick={() => navigate('updates')}>
            Review
          </button>
        </div>
      ))
    ) : (
      <p className="deck-empty">
        Your spaces are quiet. New updates will appear here.
      </p>
    )

  if (view === 'menu')
    return (
      <div className={`deck-menu-shell deck-side-${side}`}>
        <nav className="deck-menu" aria-label="Deck navigation">
          {MENU.map((item) => (
            <button
              key={item.label}
              className={`deck-menu-button ${item.view === 'today' ? 'deck-menu-today' : ''}`}
              onClick={() => {
                if (
                  item.view === 'today' ||
                  item.view === 'spaces' ||
                  item.view === 'updates'
                )
                  onView(item.view)
                else if (item.view === 'ask' || item.view === 'apps') onFull()
                else navigate(item.view)
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        {launcher}
      </div>
    )

  if (view === 'focus' && focus)
    return (
      <div className={`deck-card-shell deck-focus-shell deck-side-${side}`}>
        <section
          className="deck-card deck-focus-card"
          aria-label="Focus session"
        >
          <div className="deck-focus-heading">
            <Icon name="schedule" size={18} />
            <span>
              Focus · <span>{focus.goal}</span>
            </span>
            <button aria-label="Focus settings" onClick={onSettings}>
              <Icon name="settings" size={16} />
            </button>
            <button aria-label="Collapse focus" onClick={onIcon}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="deck-focus-clock">
            <div>
              <strong>{remaining}</strong>
              <small>
                {pauseAt !== null
                  ? 'Session paused'
                  : left === 0
                    ? 'Session complete'
                    : `${settings.focusMinutes} minute session`}
              </small>
            </div>
            <div
              className="deck-timer-ring"
              style={{
                background: `conic-gradient(#8758ff ${progress * 360}deg, #32384c 0deg)`,
              }}
            >
              <span>
                <Icon name={pauseAt !== null ? 'pause' : 'stop'} size={20} />
              </span>
            </div>
          </div>
          <div className="deck-progress">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="deck-focus-actions">
            <button
              className="deck-action deck-action-accent"
              onClick={() => void togglePause()}
            >
              <Icon name={pauseAt !== null ? 'run' : 'pause'} size={16} />
              {pauseAt !== null ? 'Resume' : 'Pause'}
            </button>
            <button className="deck-action" onClick={() => void finishFocus()}>
              <Icon name="stop" size={15} />
              Finish
            </button>
          </div>
          <div className="deck-focus-status">
            <Icon name="update" size={16} />
            Focus active · {updates.length} updates waiting
          </div>
          {error && <p role="alert">{error}</p>}
        </section>
        {launcher}
      </div>
    )

  return (
    <div className={`deck-card-shell deck-panel-shell deck-side-${side}`}>
      <section className="deck-card" aria-label="DevDeck">
        <header className="deck-card-header">
          <div className="deck-wordmark" data-tauri-drag-region>
            <DeckLogo />
            <strong>DevDeck</strong>
          </div>
          <div className="deck-header-actions">
            <button className="deck-count" onClick={() => onView('updates')}>
              {updates.length} updates
            </button>
            <button title="Dock position" onClick={onDock}>
              <Icon name="workspace" size={16} />
            </button>
            <button title="Deck settings" onClick={onSettings}>
              <Icon name="settings" size={16} />
            </button>
            <button title="Collapse" onClick={onIcon}>
              <Icon name="close" size={20} />
            </button>
          </div>
        </header>
        {tabs}
        <nav className="deck-view-tabs" aria-label="Panel views">
          {(['today', 'updates', 'spaces'] as const).map((v) => (
            <button
              key={v}
              className={view === v ? 'active' : ''}
              onClick={() => onView(v)}
            >
              <Icon
                name={
                  v === 'today'
                    ? 'schedule'
                    : v === 'updates'
                      ? 'update'
                      : 'workspace'
                }
                size={19}
              />
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        <div className="deck-card-body">
          {view === 'spaces' ? (
            <>
              <h2>Your spaces</h2>
              {workspaces
                .filter((w) => workspaceId === null || w.id === workspaceId)
                .map((w) => (
                  <div key={w.id} className="deck-workspace">
                    <h3>{w.name}</h3>
                    {projects
                      .filter((p) => p.parent_id === w.id)
                      .map((p) => (
                        <button
                          key={p.id}
                          className="deck-space-row"
                          onClick={() => {
                            setWorkspaceId(w.id)
                            onView('today')
                          }}
                        >
                          <Icon name="layout" size={17} />
                          {p.name}
                          <Icon name="external" size={15} />
                        </button>
                      ))}
                  </div>
                ))}
              {!workspaces.length && (
                <p className="deck-empty">Your spaces will appear here.</p>
              )}
            </>
          ) : view === 'updates' ? (
            <>
              <div className="deck-section-heading">
                <h2>Recent updates</h2>
                <button
                  className="deck-link"
                  onClick={() => navigate('updates')}
                >
                  Open Inbox <Icon name="external" size={15} />
                </button>
              </div>
              {updateRows(12)}
            </>
          ) : (
            <>
              <div className="deck-day-heading">
                <div>
                  <h2>
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    }).format(now)}
                  </h2>
                  <p>
                    {upcoming.length} upcoming · {filteredUpdates.length}{' '}
                    updates
                  </p>
                </div>
                <button
                  className="deck-outline"
                  onClick={() => navigate('today')}
                >
                  Open calendar <Icon name="external" size={15} />
                </button>
              </div>
              <div className="deck-timeline">
                {upcoming.length ? (
                  upcoming.map((i, index) => (
                    <div
                      key={i.id}
                      className={`deck-event deck-event-${index}`}
                    >
                      <time>
                        {new Intl.DateTimeFormat(undefined, {
                          hour12: false, hour: '2-digit',
                          minute: '2-digit',
                        }).format(i.at)}
                      </time>
                      <span className="deck-event-marker" />
                      <div className="deck-event-copy">
                        <strong>{i.title}</strong>
                        <small>
                          {i.end > i.at
                            ? `${Math.round((i.end - i.at) / 60000)} min · `
                            : ''}
                          {i.feature || i.sort}
                        </small>
                      </div>
                      <span className="deck-space-chip">
                        <Icon name="layout" size={14} />
                        {i.space || 'Personal'}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="deck-empty">Nothing else scheduled today.</p>
                )}
              </div>
              <div className="deck-focus-start">
                <div className="deck-focus-symbol">
                  <Icon name="schedule" size={25} />
                </div>
                <div className="deck-focus-description">
                  <strong>
                    {focus ? 'Focus in progress' : 'Start a focus session'}
                  </strong>
                  {focus ? (
                    <small>{focus.goal}</small>
                  ) : (
                    <input
                      aria-label="Focus goal"
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void startFocus()
                      }}
                      placeholder="What would you like to work on?"
                    />
                  )}
                </div>
                <button
                  className="deck-primary"
                  onClick={() => (focus ? onView('focus') : void startFocus())}
                >
                  {focus ? 'View timer' : 'Start focus'}
                </button>
              </div>
              <div className="deck-recent">
                <div className="deck-section-heading">
                  <h3>Recent updates</h3>
                  <button
                    className="deck-link"
                    onClick={() => onView('updates')}
                  >
                    View all <Icon name="external" size={15} />
                  </button>
                </div>
                {updateRows(1)}
              </div>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="deck-error">
            {error}
          </p>
        )}
        <footer className="deck-footer">
          <button className="deck-command-search" onClick={onFull}>
            <Icon name="search" size={20} />
            <span>Run a command or open a project…</span>
            <Icon name="chevron-right" size={16} />
          </button>
          <div>
            <button className="deck-action" onClick={onFull}>
              <Icon name="terminal" size={18} />
              Terminal
            </button>
            <button className="deck-action" onClick={onFull}>
              <Icon name="profile" size={18} />
              Services
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
