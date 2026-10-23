import { useWorkData } from '../components/work/useWorkData'
import { assembleWork, workState } from '../lib/workHub'
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
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useApp, type RailView } from '../store'
import { approvalItem, conflictItem, unread, unreadFailures } from '../lib/inbox'
import { openBot, openNodeThread } from '../lib/dock'
import { useAiw } from '../lib/aiwStore'
import { Icon, type IconName } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds } from '../lib/tree'
import type { TreeNode } from '../lib/types'
import { SpaceSwitcher } from './SpaceSwitcher'
import { DEFAULT_RAIL_WIDTH, MIN_RAIL_WIDTH, useRailWidth } from './useRailWidth'
import './rail.css'
import { TeamsNavigation } from './TeamsNavigation'
import { useChatWorkspace } from '../lib/chatWorkspace'
import { openTeamView, useTeamNavigation } from '../lib/teamNavigation'

type Item = { view: RailView; icon: IconName; label: string }

// Shared destinations remain available regardless of the selected space.
const SHARED: Item[] = [
  { view: 'connectors', icon: 'puzzle', label: 'Connectors' },
  { view: 'github', icon: 'github', label: 'GitHub' },

  { view: 'calendar', icon: 'schedule', label: 'Calendar' },
  { view: 'mail', icon: 'mail', label: 'Mail' },
]

// Advanced surfaces stay behind one expandable entry.
const TOOLS: Item[] = [
  { view: 'workers', icon: 'agent', label: 'Agent Library' },
  { view: 'activity', icon: 'history', label: 'Activity history' },
  { view: 'sessions', icon: 'agent', label: 'Sessions' },
  { view: 'home', icon: 'home', label: 'Operations' },
  { view: 'connections', icon: 'database', label: 'Connections' },
  { view: 'analytics', icon: 'history', label: 'Analytics' },
  { view: 'stash', icon: 'stash', label: 'Stash' },
  { view: 'machine', icon: 'machine', label: 'Machine' },
]

const KEY = 'devdeck.rail.expanded'
/// Whether the Tools sub-menu is open. Closed by default — the point of the
/// group is that those five are not in front of you all day.
const TOOLS_OPEN_KEY = 'devdeck.rail.toolsOpen'
/// Which tool the collapsed icon opens.
const LAST_TOOL_KEY = 'devdeck.rail.lastTool'
/// Whether Team's sub-menu is open. Remembered, because a menu that springs
/// open on every launch is one you learn to close before reading.


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
  workCounts,
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
  workCounts?: { blocked: number; review: number; working: number }
  onClick: () => void
}) {
  const height = mini ? (expanded ? 'h-7' : 'h-8') : expanded ? 'h-9' : 'h-10'

  return (
    <button
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`ds-navigation-item relative flex items-center rounded-lg transition-colors ${height} ${
        expanded ? 'w-full gap-2.5 px-2.5 text-[13px]' : 'w-10 justify-center'
      } ${active ? 'bg-raise text-ink' : 'text-muted hover:bg-hover/50 hover:text-dim'}`}
      // Expanded, the label is on screen — a tooltip repeating it is noise.
      title={expanded ? undefined : label}
      onClick={onClick}
    >
      {active && (
        <span
          className={`absolute w-[2.5px] rounded bg-accent ${
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
      {workCounts && <span className={expanded ? 'ml-auto flex items-center gap-1' : 'absolute -right-1 -top-0.5'}>
        {(['blocked', 'review', 'working'] as const).filter(state => workCounts[state] > 0).slice(0, expanded ? 3 : 1).map(state => <span key={state}
          className="rail-work-count" data-state={state} title={`${workCounts[state]} ${state === 'review' ? 'awaiting review' : state} work items`} aria-label={`${workCounts[state]} ${state} work items`}>
          {workCounts[state] > 99 ? '99+' : workCounts[state]}
        </span>)}
      </span>}
      {!!count && count > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 text-[9.5px] font-bold text-white ${
            alarm ? 'bg-err text-page' : 'bg-accent text-page'
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
  const { ref, width, max, setWidth } = useRailWidth()
  const [dragging, setDragging] = useState(false)
  const {
    railView,
    setRailView,
    svcStates,
    mailCounts,
    nodes,
    activeWorkspaceId,
    spaceScopeId,
    setSpaceScope,
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
  } = useApp()
  const aiw = useAiw()
  const [requestCount, setRequestCount] = useState(0)
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try { const rows = await invoke<{ status: string }[]>('inbox_requests'); if (alive) setRequestCount(rows.filter(r => r.status === 'needs-you').length) }
      catch { if (alive) setRequestCount(0) }
    }
    setRequestCount(0)
    const off = listen('devdeck:inbox', () => { void refresh() })
    void off.then(() => refresh()).catch(() => { if (alive) setRequestCount(0) })
    return () => { alive = false; void off.then(fn => fn()) }
  }, [activeWorkspaceId])
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
  const unreadCount = waiting + broken + requestCount
  // Work counts describe work-item states; team entries show live agents.
  const { data: workData } = useWorkData(nodes)
  const workScope = spaceScopeId == null ? null : new Set(subtreeIds(nodes, spaceScopeId))
  const workCounts = { blocked: 0, review: 0, working: 0 }
  for (const card of assembleWork(workData.records, workData.legacy, workData.monitor, workData.workflows, workData.claims)) {
    if (workScope && !workScope.has(card.record.node)) continue
    const state = workState(card)
    if (state === 'blocked' || state === 'review' || state === 'working') workCounts[state]++
  }

  const [expanded, setExpanded] = useState(() => localStorage.getItem(KEY) !== '0')
  useEffect(() => localStorage.setItem(KEY, expanded ? '1' : '0'), [expanded])
  const [toolsOpen, setToolsOpen] = useState(() => localStorage.getItem(TOOLS_OPEN_KEY) === '1')
  useEffect(() => localStorage.setItem(TOOLS_OPEN_KEY, toolsOpen ? '1' : '0'), [toolsOpen])
  const [lastTool, setLastTool] = useState<RailView>(() => {
    const v = localStorage.getItem(LAST_TOOL_KEY) as RailView | null
    return v && TOOLS.some((t) => t.view === v) ? v : 'home'
  })

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
      ref={ref}
      aria-label="Primary navigation"
      style={{ width: expanded ? width : 52 }}
      className={`app-rail flex shrink-0 flex-col border-r border-line bg-app ${
        expanded ? 'items-stretch py-3' : 'items-center py-2'
      }`}
    >
      <div className={`app-rail-scroll w-full ${expanded ? 'px-3' : 'items-center'}`}>
      <div className="mb-3 w-full shrink-0">
        <SpaceSwitcher spaces={nodes.filter(n => n.parent_id == null)} value={spaceScopeId} expanded={expanded} onChange={setSpaceScope} />
      </div>
      <RailButton
        label="Today"
        icon="schedule"
        active={railView === 'today'}
        expanded={expanded}
        onClick={() => setRailView('today')}
      />

      <RailButton label="Work" icon="check" active={railView === 'team'} expanded={expanded} workCounts={workCounts}
        onClick={() => openTeamView('', 'work')} />
      <RailButton label="Chat" icon="ai" active={railView === 'chat'} expanded={expanded}
        onClick={() => setRailView('chat')} />
      <TeamsNavigation expanded={expanded}/>

      {/* The tree of everything: areas, folders, clients and projects. Called
          Spaces again now the workspace tabs are gone — the word meant two
          things while they existed, and it means one now. */}
      <RailButton
        label="Spaces"
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
              if (bot) openBot(bot.node_id, bot.name, false, bot.handle)
              else openNodeThread(n.id, n.name)
            }}
          />
        )
      })}

      <Rule expanded={expanded} />
      {expanded && <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Shared</div>}
      <RailButton
        label="Inbox"
        icon="inbox"
        active={railView === 'inbox'}
        expanded={expanded}
        count={unreadCount}
        alarm={broken > 0}
        onClick={() => setRailView('inbox')}
      />

      {SHARED.map((it) => (
        <RailButton
          key={it.view}
          label={it.label}
          icon={it.icon}
          active={railView === it.view}
          expanded={expanded}
          // A dot rather than a count: unread mail is worth noticing and is
          // not something the team is waiting on you for, which is what the
          // numbered badge above means.
          dot={it.view === 'mail' && (mailCounts?.unread ?? 0) > 0}
          onClick={() => { setRailView(it.view); if (it.view === 'workers') useTeamNavigation.setState({ directory:'library' }) }}
        />
      ))}

      <div className="rail-spacer" />

      {/* A hairline rather than a gap: the two groups are different kinds of
          destination, and with only whitespace between them the bottom rows
          read as the ones that happened to overflow. */}
      <Rule expanded={expanded} />

      {/* Tools, as a sub-menu. Collapsed to icons there is no room for one, so
          the icon opens whichever tool was last used — the same fallback Team
          makes, and for the same reason: an icon that does nothing is worse
          than an icon that guesses well. */}
      <div className="relative">
        <RailButton
          label="Tools"
          icon="tool"
          active={TOOLS.some((t) => t.view === railView)}
          expanded={expanded}
          onClick={() => {
            if (expanded) setToolsOpen((o) => !o)
            else setRailView(lastTool)
          }}
        />
        {expanded && (
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:bg-hover hover:text-dim"
            title={toolsOpen ? 'Hide the tools' : 'Show the tools'}
            aria-label={toolsOpen ? 'Collapse Tools' : 'Expand Tools'}
            onClick={(e) => {
              e.stopPropagation()
              setToolsOpen((o) => !o)
            }}
          >
            <Icon name={toolsOpen ? 'chevron-down' : 'chevron-right'} size={13} />
          </button>
        )}
      </div>
      {expanded &&
        toolsOpen &&
        TOOLS.map((t) => (
          <button
            key={t.view}
            className={`flex h-7 w-full items-center gap-2 rounded-lg pl-8 pr-2 text-[11.5px] ${
              railView === t.view ? 'text-ink' : 'text-muted hover:bg-hover/50 hover:text-dim'
            }`}
            onClick={() => {
              localStorage.setItem(LAST_TOOL_KEY, t.view)
              setLastTool(t.view)
              if (t.view === 'workers') { useChatWorkspace.setState({ designerTeam:undefined }); useTeamNavigation.setState({ directory:'library' }) }
              setRailView(t.view)
            }}
          >
            <Icon name={t.icon} size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{t.label}</span>
            {t.view === 'home' && anyRunning && (
              <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-emerald-400" />
            )}
          </button>
        ))}

      <RailButton
        label="Settings"
        icon="settings"
        active={railView === 'settings'}
        expanded={expanded}
        onClick={() => setRailView('settings')}
      />

      </div>

      {/* The toggle is chrome, not a destination, so it sits below the
          hairline that separates destinations from the app itself. */}
      <button
        className={`mt-1 flex shrink-0 items-center rounded-lg text-muted transition-colors hover:bg-hover/50 hover:text-dim ${
          expanded ? 'mx-3 h-7 gap-2 px-2' : 'h-8 w-10 justify-center'
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
      {expanded && <div role="separator" aria-label="Resize navigation sidebar" aria-orientation="vertical"
        aria-valuemin={MIN_RAIL_WIDTH} aria-valuemax={max} aria-valuenow={width} aria-valuetext={width + ' pixels'}
        tabIndex={0} className="rail-resizer" data-dragging={dragging}
        title="Drag to resize · double-click to reset"
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(event.clientX - (ref.current?.getBoundingClientRect().left ?? 0))
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
        }}
        onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
        onDoubleClick={() => setWidth(DEFAULT_RAIL_WIDTH)}
        onKeyDown={event => {
          const next = event.key === 'ArrowLeft' ? width - (event.shiftKey ? 32 : 8)
            : event.key === 'ArrowRight' ? width + (event.shiftKey ? 32 : 8)
            : event.key === 'Home' ? MIN_RAIL_WIDTH : event.key === 'End' ? max : null
          if (next !== null) { event.preventDefault(); setWidth(next) }
        }}
      />}
    </nav>
  )
}
