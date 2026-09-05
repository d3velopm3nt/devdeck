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
import { useApp, type RailView, type TeamTab } from '../store'
import { approvalItem, conflictItem, unread, unreadFailures } from '../lib/inbox'
import { openBot, openNodeThread } from '../lib/dock'
import { useAiw } from '../lib/aiwStore'
import { Icon, type IconName } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds } from '../lib/tree'
import type { TreeNode } from '../lib/types'

type Item = { view: RailView; icon: IconName; label: string }

/// Team's views, as the sub-menu under it.
///
/// Bots is here rather than beside Team: who does the work and what the work
/// is are two questions about one team, and having them in different corners
/// of the rail meant a trip through navigation to answer either one.
const TEAM: { id: TeamTab; icon: IconName; label: string }[] = [
  { id: 'goals', icon: 'project', label: 'Goals' },
  { id: 'features', icon: 'list', label: 'Features' },
  { id: 'work', icon: 'check', label: 'Work' },
  { id: 'bots', icon: 'bot', label: 'Bots' },
]

/// Destinations that are neither the team nor the tree.
///
/// The Assistant is not here: it is the first contact on Bots, because it is
/// one of the things you talk to rather than a place you go. What is left of
/// its old surface is configuration, under Settings.
const WORK: Item[] = [
  // Time sits with the places you go rather than with the app's own settings:
  // a calendar is a thing you work out of, not a thing you configure.
  { view: 'calendar', icon: 'schedule', label: 'Calendar' },
  { view: 'connections', icon: 'database', label: 'Connections' },
]

/// The app itself, anchored to the bottom.
const APP: Item[] = [
  { view: 'analytics', icon: 'history', label: 'Analytics' },
  { view: 'stash', icon: 'stash', label: 'Stash' },
  { view: 'machine', icon: 'machine', label: 'Machine' },
  { view: 'settings', icon: 'settings', label: 'Settings' },
]

const KEY = 'devdeck.rail.expanded'
/// Whether Team's sub-menu is open. Remembered, because a menu that springs
/// open on every launch is one you learn to close before reading.
const TEAM_OPEN_KEY = 'devdeck.rail.teamOpen'

function RailButton({
  label,
  icon,
  avatar,
  active,
  expanded,
  mini,
  dot,
  count,
  alarm,
  live,
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
  /// How many things are waiting. Shown as a number rather than a dot: whether
  /// it is one reminder or nine changes whether you stop what you are doing.
  count?: number
  /// Whether that count is something broken rather than something waiting.
  /// Red is reserved for it, here as everywhere else.
  alarm?: boolean
  /// How many are working right now. Green, because it is good news, and a
  /// number for the same reason `count` is.
  live?: number
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
      {!!live && live > 0 && (
        <span
          className={`shrink-0 text-[10px] font-semibold text-ok ${
            expanded ? 'ml-auto' : 'absolute right-1 top-0.5'
          }`}
        >
          {live}
        </span>
      )}
      {!!count && count > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 text-[9.5px] font-bold text-white ${
            alarm ? 'bg-red-500' : 'bg-indigo-500'
          } ${
            expanded ? 'ml-auto' : 'absolute right-0.5 top-1 border-2 border-app'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
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
    activity,
    inboxRead,
    inboxFloor,
    inboxLoaded,
    bots,
    teamTab,
    setTeamTab,
  } = useApp()
  const aiw = useAiw()
  const anyRunning = Object.values(svcStates).some((s) => s.status === 'running')
  // What the Inbox holds, which is only what needs you: an agent stopped on a
  // clock, work that cannot continue, something that ran and failed.
  //
  // Counting what merely happened would light the rail every time a reminder
  // fired, and a badge that is always lit is one you stop reading — so the
  // morning an agent is genuinely stuck would look like every other morning.
  //
  // Read state is per row now, so the count is what you have not looked at
  // rather than what has arrived since you last glanced at the page.
  const marks = { read: inboxRead, floor: inboxFloor, loaded: inboxLoaded }
  const waiting =
    aiw.approvals.filter((r) => unread(approvalItem(r.id), Date.now(), marks)).length +
    aiw.conflicts.filter((c) => !c.resolved && unread(conflictItem(c.id), Date.now(), marks))
      .length
  const broken = unreadFailures(activity, marks).length
  const unreadCount = waiting + broken
  // What is moving, so the rail says so without being opened: items held by
  // a live claim under Work, agents mid-session under Bots. Green counts
  // rather than the Inbox's badge, because these are good news.
  const moving = aiw.claims.filter((c) => c.status === 'active').length
  const working = new Set(
    aiw.sessions.filter((s) => s.status === 'working' || s.status === 'planning').map((s) => s.agent_id),
  ).size

  const [expanded, setExpanded] = useState(() => localStorage.getItem(KEY) === '1')
  useEffect(() => localStorage.setItem(KEY, expanded ? '1' : '0'), [expanded])
  const [teamOpen, setTeamOpen] = useState(() => localStorage.getItem(TEAM_OPEN_KEY) !== '0')
  useEffect(() => localStorage.setItem(TEAM_OPEN_KEY, teamOpen ? '1' : '0'), [teamOpen])

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

      {/* Team, with what it holds as a sub-menu rather than as tabs on the
          page — one navigation, not two. Collapsed to icons there is no room
          for sub-items, so the icon opens whichever was last used. */}
      <div className="relative">
        <RailButton
          label="Team"
          icon="agent"
          active={railView === 'team'}
          expanded={expanded}
          // Collapsed there is no sub-menu, so a bot at work has to say so
          // here or not at all.
          live={working}
          onClick={() => setRailView('team')}
        />
        {expanded && (
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:bg-hover hover:text-dim"
            title={teamOpen ? 'Hide what Team holds' : 'Show what Team holds'}
            aria-label={teamOpen ? 'Collapse Team' : 'Expand Team'}
            onClick={(e) => {
              e.stopPropagation()
              setTeamOpen((o) => !o)
            }}
          >
            <Icon name={teamOpen ? 'chevron-down' : 'chevron-right'} size={13} />
          </button>
        )}
      </div>
      {expanded &&
        teamOpen &&
        TEAM.map((t) => (
          <button
            key={t.id}
            className={`flex h-7 w-full items-center gap-2 rounded-lg pl-8 pr-2 text-[11.5px] ${
              railView === 'team' && teamTab === t.id
                ? 'text-ink'
                : 'text-muted hover:bg-hover/50 hover:text-dim'
            }`}
            onClick={() => setTeamTab(t.id)}
          >
            <Icon name={t.icon} size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{t.label}</span>
            {t.id === 'work' && moving > 0 && (
              <span className="shrink-0 text-[10px] font-semibold text-ok">{moving}</span>
            )}
            {t.id === 'bots' && working > 0 && (
              <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-emerald-400" />
            )}
          </button>
        ))}

      <RailButton
        label="Inbox"
        icon="inbox"
        active={railView === 'inbox'}
        expanded={expanded}
        count={unreadCount}
        alarm={broken > 0}
        onClick={() => setRailView('inbox')}
      />

      <Rule expanded={expanded} />

      {/* The tree of everything inside the current workspace. Called Explorer
          because that is what it is; the workspaces themselves are the tabs
          across the top, and "Spaces" here made one word mean both. */}
      <RailButton
        label="Explorer"
        icon="workspace"
        active={onProjects && activeSolutionId == null}
        expanded={expanded}
        dot={anyRunning}
        onClick={() => go(null)}
      />

      {expanded && recentNodes.length > 0 && (
        <div className="px-2 pb-px pt-1 text-[9px] font-semibold uppercase tracking-[0.07em] text-faint">
          Recent
        </div>
      )}

      {/* A recent folder opens its bot's page when it has one — the bot is
          how you talk to a space that is being managed — and its thread when
          it does not, which is where "New bot here" lives. */}
      {recentNodes.map((n) => {
        const bot = bots.find((b) => b.node_id === n.id)
        return (
          <RailButton
            key={n.id}
            label={n.name}
            avatar={{ text: avatarLabel(n.name), color: nodeColor(n) }}
            active={false}
            expanded={expanded}
            onClick={() => {
              touchRecent(n.id)
              if (bot) openBot(bot.node_id, bot.name)
              else openNodeThread(n.id, n.name)
            }}
          />
        )
      })}

      <Rule expanded={expanded} />

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
