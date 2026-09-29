import { useEffect, useState, type MouseEvent } from 'react'
import { Icon, type IconName } from '../lib/icons'
import * as ipc from '../lib/ipc'
import type { DeckSettings } from '../lib/deck'
import type { DeckUpdate } from '../lib/deckUpdates'
import { useApp } from '../store'

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

export function DeckPanel({ view, settings, updates, side, onLauncherMouseDown, onIcon, onView, onFull, onSettings, onDock }: {
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
      const start = new Date(); start.setHours(0, 0, 0, 0)
      void ipc.calendarRange(start.getTime(), start.getTime() + 86_400_000 - 1).then(setItems).catch(() => setItems([]))
      void ipc.focusCurrent().then(setFocus).catch(() => setFocus(null))
    }
    refresh()
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    const refreshTimer = window.setInterval(refresh, 30_000)
    return () => { window.clearInterval(clock); window.clearInterval(refreshTimer) }
  }, [view])

  useEffect(() => {
    if (!focusId) { setPauseAt(null); setPausedMs(0); return }
    void ipc.settingGet('deck.focus.timer').then((raw) => {
      try {
        const saved = JSON.parse(raw ?? '{}') as { id?: number; pauseAt?: number | null; pausedMs?: number }
        if (saved.id === focusId) { setPauseAt(saved.pauseAt ?? null); setPausedMs(saved.pausedMs ?? 0) }
      } catch { /* an older setting should not break the timer */ }
    })
  }, [focusId])

  const saveTimer = (f: ipc.Focus, at: number | null, elapsed: number) =>
    ipc.settingSet('deck.focus.timer', JSON.stringify({ id: f.id, pauseAt: at, pausedMs: elapsed }))

  const startFocus = async () => {
    setError('')
    try {
      const next = await ipc.focusStart(goal.trim() || 'Focus session', null)
      await saveTimer(next, null, 0)
      setFocus(next); setPauseAt(null); setPausedMs(0); onView('focus')
    } catch (e) { setError(String(e)) }
  }
  const togglePause = async () => {
    if (!focus) return
    const nextPaused = pauseAt === null ? Date.now() : pausedMs + Date.now() - pauseAt
    const at = pauseAt === null ? Date.now() : null
    setPauseAt(at); setPausedMs(nextPaused)
    await saveTimer(focus, at, nextPaused)
  }
  const finishFocus = async () => {
    try { await ipc.focusEnd(0); setFocus(null); onView('today') }
    catch (e) { setError(String(e)) }
  }
  const elapsed = focus ? Math.max(0, (pauseAt ?? now) - focus.started_at - pausedMs) : 0
  const left = Math.max(0, settings.focusMinutes * 60_000 - elapsed)
  const remaining = `${pad(Math.floor(left / 60_000))}:${pad(Math.floor(left / 1000) % 60)}`
  const inWorkspace = (space: string | undefined) => workspaceId === null || projects.some((p) => p.name === space && p.parent_id === workspaceId)
  const upcoming = items.filter((i) => i.at >= now - 5 * 60_000 && i.kind !== 'deadline' && inWorkspace(i.space)).sort((a, b) => a.at - b.at).slice(0, 3)
  const filteredUpdates = updates.filter((u) => inWorkspace(u.space))

  const launcher = <button className="deck-launcher" onMouseDown={onLauncherMouseDown} title="Deck · drag to move" aria-label="Deck">
    <span className="font-bold text-[24px] leading-none">D</span>
  </button>

  if (view === 'menu') return <div className={`deck-menu-shell deck-side-${side}`}>
    <nav className="deck-menu" aria-label="Deck navigation">
      {MENU.map((item) => <button key={item.label} className="deck-menu-button" onClick={() => {
        if (item.view === 'today' || item.view === 'spaces' || item.view === 'updates') onView(item.view)
        else if (item.view === 'ask' || item.view === 'apps') onFull()
        else { void ipc.emitDeckNavigate(item.view); onView('today') }
      }}><Icon name={item.icon} size={16} /><span>{item.label}</span></button>)}
    </nav>
    {launcher}
  </div>

  return <div className={`deck-card-shell deck-side-${side}`}>
    <div className="deck-card">
      <div className="deck-card-header"><div className="font-semibold text-ink">Deck</div>
        <div className="flex items-center gap-2"><button title="Dock position" onClick={onDock}><Icon name="workspace" size={15} /></button><button title="Deck settings" onClick={onSettings}><Icon name="settings" size={15} /></button><button title="Commands and services" onClick={onFull}><Icon name="terminal" size={15} /></button><button title="Collapse" onClick={onIcon}><Icon name="close" size={15} /></button></div>
      </div>
      {view === 'spaces' ? <div className="deck-card-body">
        <div className="mb-3 font-semibold text-ink">Spaces</div>
        {workspaces.map((w) => <div key={w.id} className="mb-3 rounded-lg border border-line bg-raise p-2"><div className="mb-1 text-[12px] font-semibold text-ink">{w.name}</div>
          {projects.filter((p) => p.parent_id === w.id).map((p) => <button key={p.id} className="deck-space-row" onClick={() => { setWorkspaceId(w.id); onView('today') }}><span>{p.name}</span><Icon name="external" size={12} /></button>)}
        </div>)}
        {!workspaces.length && <p className="py-5 text-center text-[12px] text-dim">Your spaces will appear here.</p>}
      </div> : view === 'updates' ? <div className="deck-card-body">
        <div className="mb-3 flex justify-between"><div className="font-semibold text-ink">Updates</div><button className="deck-link" onClick={() => void ipc.emitDeckNavigate('updates')}>Open Inbox</button></div>
        <div className="deck-space-tabs"><button className={workspaceId === null ? 'active' : ''} onClick={() => setWorkspaceId(null)}>All spaces</button>{workspaces.map((w) => <button key={w.id} className={workspaceId === w.id ? 'active' : ''} onClick={() => setWorkspaceId(w.id)}>{w.name}</button>)}</div>
        {filteredUpdates.length ? filteredUpdates.slice(0, 12).map((u) => <div key={u.id} className="deck-schedule-row"><span className="min-w-0 flex-1 truncate text-ink">{u.title}</span><span className="shrink-0 text-muted">{u.space} · {u.kind}</span></div>) : <p className="py-5 text-center text-[12px] text-dim">No recent updates.</p>}
      </div> : view === 'focus' && focus ? <div className="deck-card-body">
        <div className="text-[11px] text-dim">Focus · {focus.goal}</div>
        <div className="my-4 text-center text-[40px] font-semibold tabular-nums text-ink">{remaining}</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full bg-[var(--c-accent)]" style={{ width: `${Math.min(100, 100 * (1 - left / (settings.focusMinutes * 60_000)))}%` }} /></div>
        <div className="mt-4 flex gap-2"><button className="deck-action" onClick={() => void togglePause()}><Icon name={pauseAt ? 'run' : 'pause'} size={14} />{pauseAt ? 'Resume' : 'Pause'}</button><button className="deck-action" onClick={() => void finishFocus()}><Icon name="stop" size={14} />Finish</button></div>
        <p className="mt-3 text-[11px] text-muted">Ordinary updates wait. {left === 0 ? 'Session time is up.' : 'Approval and blockers may interrupt if enabled.'}</p>
      </div> : <div className="deck-card-body">
        <div className="mb-3 flex items-center justify-between"><div><div className="font-semibold text-ink">Today</div><div className="text-[11px] text-dim">{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(now)}</div></div><button className="deck-link" onClick={() => void ipc.emitDeckNavigate('today')}>Calendar <Icon name="external" size={12} /></button></div>
        <div className="deck-space-tabs"><button className={workspaceId === null ? 'active' : ''} onClick={() => setWorkspaceId(null)}>All spaces</button>{workspaces.map((w) => <button key={w.id} className={workspaceId === w.id ? 'active' : ''} onClick={() => setWorkspaceId(w.id)}>{w.name}</button>)}</div>
        <div className="space-y-1">{upcoming.length ? upcoming.map((i) => <div key={i.id} className="deck-schedule-row"><span className="w-12 shrink-0 text-dim">{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(i.at)}</span><span className="min-w-0 flex-1 truncate text-ink">{i.title}</span><span className="max-w-24 truncate text-muted">{i.space || 'Personal'}</span></div>) : <p className="py-5 text-center text-[12px] text-dim">Nothing else scheduled today.</p>}</div>
        <div className="mt-3 border-t border-line pt-3">{focus ? <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[12px] font-medium text-ink">Focus in progress</div><div className="truncate text-[11px] text-dim">{focus.goal}</div></div><button className="deck-primary" onClick={() => onView('focus')}>View timer</button></div> : <><div className="mb-2 text-[12px] font-medium text-ink">Start Focus</div><div className="flex gap-2"><input className="deck-input" value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void startFocus() }} placeholder="What are you working on?" /><button className="deck-primary" onClick={() => void startFocus()}>{settings.focusMinutes} min</button></div></>}</div>
        <div className="mt-3 border-t border-line pt-3"><div className="mb-1 text-[12px] font-medium text-ink">Recent updates</div>
          {filteredUpdates.length ? filteredUpdates.slice(0, 2).map((u) => <div key={u.id} className="deck-schedule-row"><span className="min-w-0 flex-1 truncate text-ink">{u.title}</span><span className="text-muted">{u.space}</span></div>) : <div className="py-2 text-[11px] text-dim">Your spaces are quiet.</div>}
        </div>
        <div className="mt-3 flex justify-between border-t border-line pt-2"><button className="deck-link" onClick={() => onView('updates')}>All updates</button><button className="deck-link" onClick={onFull}>Commands &amp; services</button></div>
      </div>}
      {error && <p role="alert" className="px-4 pb-3 text-[11px] text-err">{error}</p>}
    </div>
    {launcher}
  </div>
}
