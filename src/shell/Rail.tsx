// The app's primary navigation, and the solution picker.
//
// Solutions live here rather than in the Explorer for one reason: with a
// switcher in both places the current solution was named twice on screen a few
// pixels apart — the same mistake the workspace dropdown made before the tabs
// replaced it. The rail names it; the tree just shows what is in it.
//
// Around them: Home above, the other destinations below, and the app's own
// pages (clipboard, machine, settings) pinned to the bottom, since they are the
// ones you reach for least.
//
// It collapses to icons or expands to labels, and remembers which you chose.
// The two states are tuned separately — collapsed keeps 52px and 40px targets;
// expanded is tighter, because a labelled menu at icon-rail spacing reads as
// padding rather than hierarchy. Collapsed, a solution keeps a slot of its own
// as an initialled avatar: a flyout would hide which solution you are in, which
// is the question this rail exists to answer.

import { useEffect, useMemo, useState } from 'react'
import { useApp, type RailView } from '../store'
import { Icon, type IconName } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds } from '../lib/tree'
import type { TreeNode } from '../lib/types'

type Item = { view: RailView; icon: IconName; label: string }

/// Destinations that are not solutions.
const WORK: Item[] = [
  { view: 'aiworkspace', icon: 'ai', label: 'Assistant' },
  { view: 'connections', icon: 'database', label: 'Connections' },
]

/// The app itself, anchored to the bottom.
const APP: Item[] = [
  { view: 'stash', icon: 'stash', label: 'Stash' },
  { view: 'machine', icon: 'machine', label: 'Machine' },
  { view: 'settings', icon: 'settings', label: 'Settings' },
]

const KEY = 'devdeck.rail.expanded'

function RailButton({
  label,
  icon,
  avatar,
  active,
  expanded,
  mini,
  dot,
  onClick,
}: {
  label: string
  icon?: IconName
  /// A solution's identity when there is no room for its name.
  avatar?: { text: string; color: string }
  active: boolean
  expanded: boolean
  /// Secondary rows (New solution, Collapse) sit a little shorter.
  mini?: boolean
  dot?: boolean
  onClick: () => void
}) {
  const height = mini ? (expanded ? 'h-7' : 'h-8') : expanded ? 'h-8' : 'h-10'

  return (
    <button
      className={`relative flex items-center rounded-lg transition-colors ${height} ${
        expanded ? 'w-full gap-2 px-2 text-[12px]' : 'w-10 justify-center'
      } ${active ? 'bg-raise text-ink' : 'text-muted hover:bg-hover/50 hover:text-dim'}`}
      // Expanded, the label is on screen — a tooltip repeating it is noise.
      title={expanded ? undefined : label}
      onClick={onClick}
    >
      {active && (
        <span
          className={`absolute w-[2.5px] rounded bg-indigo-500 ${
            expanded ? '-left-[5px] top-1.5 bottom-1.5' : '-left-[7px] top-2 bottom-2'
          }`}
        />
      )}
      {avatar ? (
        <span
          className={`flex shrink-0 items-center justify-center rounded font-bold ${
            expanded ? 'h-[19px] w-[19px] text-[8px]' : 'h-[22px] w-[22px] text-[8.5px]'
          } ${active ? 'text-white' : 'bg-hover text-muted'}`}
          // Its own colour only while active: a rail of saturated squares
          // competes with the running-service dot for the same glance.
          style={active ? { background: avatar.color } : undefined}
        >
          {avatar.text}
        </span>
      ) : (
        <Icon name={icon ?? 'project'} size={expanded ? 15 : 17} className="shrink-0" />
      )}
      {expanded && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {dot && (
        <span
          className={
            expanded
              ? 'ml-auto h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-400'
              : 'absolute right-1 top-1 h-[7px] w-[7px] rounded-full border-2 border-app bg-emerald-400'
          }
        />
      )}
    </button>
  )
}

function Rule({ expanded }: { expanded: boolean }) {
  return <div className={`my-1 h-px self-center bg-line ${expanded ? 'w-full' : 'w-[26px]'}`} />
}

export function Rail() {
  const {
    railView,
    setRailView,
    svcStates,
    nodes,
    activeWorkspaceId,
    activeSolutionId,
    setActiveSolution,
    recent,
    recentLimit,
    touchRecent,
  } = useApp()
  const anyRunning = Object.values(svcStates).some((s) => s.status === 'running')

  const [expanded, setExpanded] = useState(() => localStorage.getItem(KEY) === '1')
  useEffect(() => localStorage.setItem(KEY, expanded ? '1' : '0'), [expanded])

  // The folders you opened most recently, in this workspace.
  //
  // This slot used to list solutions. Since folders became real there is no
  // `solution` kind for it to match — kind is derived, and only ever workspace,
  // project or folder — so the list was permanently empty. Recency keeps what
  // the slot was good for (a short jump list beside Home) without needing a
  // category anyone has to maintain.
  const recentNodes = useMemo(() => {
    if (activeWorkspaceId == null || recentLimit === 0) return []
    const inWorkspace = new Set(subtreeIds(nodes, activeWorkspaceId))
    return recent
      .map((id) => findNode(nodes, id))
      .filter((n): n is TreeNode => !!n && n.id !== activeWorkspaceId && inWorkspace.has(n.id))
      .slice(0, recentLimit)
  }, [recent, recentLimit, nodes, activeWorkspaceId])

  // Picking a solution is also navigating: the tree it scopes lives on the
  // projects view, so landing anywhere else would scope something you cannot see.
  const go = (id: number | null) => {
    setActiveSolution(id)
    setRailView('projects')
  }



  const onProjects = railView === 'projects'

  return (
    <nav
      className={`flex shrink-0 flex-col border-r border-line bg-app ${
        expanded ? 'w-[160px] items-stretch gap-px px-1.5 py-1.5' : 'w-[52px] items-center gap-1 py-2'
      }`}
    >
      <RailButton
        label="Home"
        icon="home"
        active={railView === 'home'}
        expanded={expanded}
        onClick={() => setRailView('home')}
      />

      <RailButton
        label="Inbox"
        icon="inbox"
        active={railView === 'inbox'}
        expanded={expanded}
        onClick={() => setRailView('inbox')}
      />

      <Rule expanded={expanded} />

      {expanded && recentNodes.length > 0 && (
        <div className="px-2 pb-px pt-1 text-[9px] font-semibold uppercase tracking-[0.07em] text-faint">
          Recent
        </div>
      )}

      {/* Repos belonging to no solution still have to be reachable, so the
          unscoped view keeps a slot. With no solutions yet it is simply
          "Projects", which is what this rail has always said. */}
      <RailButton
        label="All projects"
        icon="project"
        active={onProjects && activeSolutionId == null}
        expanded={expanded}
        dot={anyRunning}
        onClick={() => go(null)}
      />

      {recentNodes.map((n) => (
        <RailButton
          key={n.id}
          label={n.name}
          avatar={{ text: avatarLabel(n.name), color: nodeColor(n) }}
          active={onProjects && activeSolutionId === n.id}
          expanded={expanded}
          onClick={() => {
            touchRecent(n.id)
            go(n.id)
          }}
        />
      ))}

      <Rule expanded={expanded} />

      <RailButton
        label="Bots"
        icon="bot"
        active={railView === 'bots'}
        expanded={expanded}
        onClick={() => setRailView('bots')}
      />

      <RailButton
        label="Scheduler"
        icon="schedule"
        active={railView === 'scheduler'}
        expanded={expanded}
        onClick={() => setRailView('scheduler')}
      />

      {WORK.map((it) => (
        <RailButton
          key={it.view}
          label={it.label}
          icon={it.icon}
          active={railView === it.view}
          expanded={expanded}
          onClick={() => setRailView(it.view)}
        />
      ))}

      <div className="flex-1" />

      {/* A hairline rather than a gap: the two groups are different kinds of
          destination, and with only whitespace between them the bottom three
          read as the ones that happened to overflow. */}
      <Rule expanded={expanded} />

      {APP.map((it) => (
        <RailButton
          key={it.view}
          label={it.label}
          icon={it.icon}
          active={railView === it.view}
          expanded={expanded}
          onClick={() => setRailView(it.view)}
        />
      ))}

      {/* The toggle is chrome, not a destination, so it sits below the
          hairline that separates destinations from the app itself. */}
      <button
        className={`mt-0.5 flex items-center rounded-lg text-muted transition-colors hover:bg-hover/50 hover:text-dim ${
          expanded ? 'h-7 w-full gap-2 px-2' : 'h-8 w-10 justify-center'
        }`}
        title={expanded ? 'Collapse to icons' : 'Expand the menu'}
        aria-label={expanded ? 'Collapse the navigation' : 'Expand the navigation'}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <Icon
          name={expanded ? 'chevron-left' : 'chevron-right'}
          size={expanded ? 14 : 16}
          className="shrink-0"
        />
        {expanded && <span className="min-w-0 flex-1 truncate text-left text-[11.5px]">Collapse</span>}
      </button>
    </nav>
  )
}
