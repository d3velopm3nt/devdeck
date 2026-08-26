// The app's primary navigation: a slim fixed icon rail. Every pillar of the
// app is a rail item (Home, Projects, Machine, Settings — Connections and
// Stash land here later), so new features never add new tab containers.

import { useApp, type RailView } from '../store'
import { Icon, type IconName } from '../lib/icons'

const ITEMS: Array<{ view: RailView; icon: IconName; label: string }> = [
  { view: 'home', icon: 'home', label: 'Home' },
  { view: 'projects', icon: 'project', label: 'Projects' },
  { view: 'stash', icon: 'stash', label: 'Stash' },
  { view: 'connections', icon: 'database', label: 'Connections' },
  { view: 'machine', icon: 'machine', label: 'Machine' },
]

function RailButton({
  view,
  icon,
  label,
  active,
  dot,
  onClick,
}: {
  view: RailView
  icon: IconName
  label: string
  active: boolean
  dot?: boolean
  onClick: (v: RailView) => void
}) {
  return (
    <button
      className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
        active ? 'bg-raise text-ink' : 'text-muted hover:bg-hover/50 hover:text-dim'
      }`}
      title={label}
      onClick={() => onClick(view)}
    >
      {active && <span className="absolute -left-[7px] top-2 bottom-2 w-[2.5px] rounded bg-indigo-500" />}
      <Icon name={icon} size={17} />
      {dot && (
        <span className="absolute right-1 top-1 h-[7px] w-[7px] rounded-full border-2 border-app bg-emerald-400" />
      )}
    </button>
  )
}

export function Rail() {
  const { railView, setRailView, svcStates } = useApp()
  const anyRunning = Object.values(svcStates).some((s) => s.status === 'running')

  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-app py-2">
      {ITEMS.map((it) => (
        <RailButton
          key={it.view}
          {...it}
          active={railView === it.view}
          dot={it.view === 'projects' && anyRunning}
          onClick={setRailView}
        />
      ))}
      <div className="flex-1" />
      <RailButton
        view="settings"
        icon="settings"
        label="Settings"
        active={railView === 'settings'}
        onClick={setRailView}
      />
    </nav>
  )
}
