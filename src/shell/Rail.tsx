// The app's primary navigation: a slim fixed icon rail. Every pillar of the
// app is a rail item, so new features never add new tab containers.
//
// Split into two groups. The top three are where you *work* — a project, the
// agents across all of them, a database. The bottom three are the app itself:
// your clipboard, this machine, the settings. They sit against the bottom
// edge because they are the ones you reach for least, and pinning them there
// keeps the working set at the top where the eye starts.

import { useApp, type RailView } from '../store'
import { Icon, type IconName } from '../lib/icons'

type Item = { view: RailView; icon: IconName; label: string }

/// Where the work happens.
const WORK: Item[] = [
  { view: 'home', icon: 'home', label: 'Home' },
  { view: 'projects', icon: 'project', label: 'Projects' },
  { view: 'aiworkspace', icon: 'ai', label: 'AI Workspace' },
  { view: 'connections', icon: 'database', label: 'Connections' },
]

/// The app itself, anchored to the bottom.
const APP: Item[] = [
  { view: 'stash', icon: 'stash', label: 'Stash' },
  { view: 'machine', icon: 'machine', label: 'Machine' },
  { view: 'settings', icon: 'settings', label: 'Settings' },
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
      {WORK.map((it) => (
        <RailButton
          key={it.view}
          {...it}
          active={railView === it.view}
          dot={it.view === 'projects' && anyRunning}
          onClick={setRailView}
        />
      ))}

      <div className="flex-1" />

      {/* A hairline rather than a gap: the two groups are different kinds of
          destination, and with only whitespace between them the bottom three
          read as the ones that happened to overflow. */}
      <div className="my-1 h-px w-[26px] bg-line" />

      {APP.map((it) => (
        <RailButton
          key={it.view}
          {...it}
          active={railView === it.view}
          onClick={setRailView}
        />
      ))}
    </nav>
  )
}
