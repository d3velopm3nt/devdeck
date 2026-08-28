// The active project, and its sections.
//
// This row is what makes "the AI Workspace and Projects are one thing" true in
// the UI rather than only in the database. A project's terminals, its services,
// its git history and its agents are all the same project seen from different
// angles, and until now three of them lived in one rail destination and the
// rest in another — so moving between them meant navigating the app rather
// than navigating the work.
//
// The sections still land in two different surfaces (the dock for documents,
// the AI Workspace for the agent views). That seam is deliberate for now: this
// row unifies the *navigation* first, which is the part you feel. Collapsing
// the surfaces underneath is a bigger change and does not have to happen at
// the same time.

import { useMemo } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { Icon, type IconName } from '../lib/icons'
import { openSpace } from '../lib/dock'
import { nodeColor } from '../lib/spaces'
import type { AiwPage } from '../lib/aiwStore'
import type { SessionStatus } from '../lib/aiw'

type Section = {
  key: string
  label: string
  icon: IconName
  /// Where it lives. `space` opens the project's page in the dock; `aiw`
  /// switches to the AI Workspace on that page, for the same project.
  to: { kind: 'space' } | { kind: 'aiw'; page: AiwPage }
  /// A count worth showing in the tab, or null for nothing.
  count?: (c: Counts) => { n: number; tone: string } | null
}

/// A session that has not finished. Mirrors `SessionStatus::active` in the
/// backend — the two must agree, or a count here contradicts the page it
/// links to.
const LIVE: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'planning',
  'working',
  'waiting',
  'reviewing',
  'blocked',
])

type Counts = {
  services: number
  running: number
  agents: number
  conflicts: number
  features: number
}

const SECTIONS: Section[] = [
  { key: 'overview', label: 'Overview', icon: 'layout', to: { kind: 'aiw', page: 'overview' } },
  { key: 'assistant', label: 'Assistant', icon: 'ai', to: { kind: 'aiw', page: 'chat' } },
  {
    key: 'space',
    label: 'Services',
    icon: 'service',
    to: { kind: 'space' },
    count: (c) => (c.running > 0 ? { n: c.running, tone: 'bg-emerald-500/14 text-ok' } : null),
  },
  {
    key: 'features',
    label: 'Features',
    icon: 'list',
    to: { kind: 'aiw', page: 'features' },
    count: (c) => (c.features > 0 ? { n: c.features, tone: 'bg-slate-500/16 text-dim' } : null),
  },
  { key: 'context', label: 'Context', icon: 'context', to: { kind: 'aiw', page: 'context' } },
  {
    key: 'agents',
    label: 'Agents',
    icon: 'agent',
    to: { kind: 'aiw', page: 'agents' },
    count: (c) => (c.agents > 0 ? { n: c.agents, tone: 'bg-indigo-500/16 text-indigo-300' } : null),
  },
  { key: 'git', label: 'Git', icon: 'commit', to: { kind: 'aiw', page: 'git' } },
  {
    key: 'conflicts',
    label: 'Conflicts',
    icon: 'conflict',
    to: { kind: 'aiw', page: 'conflicts' },
    count: (c) => (c.conflicts > 0 ? { n: c.conflicts, tone: 'bg-amber-500/16 text-warn' } : null),
  },
  { key: 'activity', label: 'Activity', icon: 'history', to: { kind: 'aiw', page: 'activity' } },
]

export function SectionTabs() {
  const app = useApp()
  const a = useAiw()
  const project = app.selectedProject()

  const counts: Counts = useMemo(() => {
    if (!project) return { services: 0, running: 0, agents: 0, conflicts: 0, features: 0 }
    const svc = app.services.filter((s) => s.project_id === project.id)
    // The AI Workspace speaks in node ids as strings now, which is the whole
    // point of the merge — the same project, named the same way on both sides.
    const pid = String(project.id)
    return {
      services: svc.length,
      running: svc.filter((s) => app.svcStates[s.id]?.status === 'running').length,
      agents: a.sessions.filter((s) => s.project_id === pid && LIVE.has(s.status)).length,
      conflicts: a.conflicts.filter((c) => c.project_id === pid && !c.resolved).length,
      features: a.projectId === pid ? a.features.length : 0,
    }
  }, [project, app.services, app.svcStates, a.sessions, a.conflicts, a.features, a.projectId])

  // Nothing selected: say so rather than rendering an empty strip that looks
  // like a bug.
  if (!project) {
    return (
      <div className="flex h-[33px] shrink-0 items-center gap-2 border-b border-line bg-page px-3 text-[11.5px] text-muted">
        <Icon name="project" size={13} className="text-faint" />
        Pick a project in the Explorer to see its sections
      </div>
    )
  }

  const pid = String(project.id)
  const activeKey = (() => {
    if (app.railView !== 'aiworkspace') return app.railView === 'projects' ? 'space' : null
    if (a.projectId !== pid) return null
    return SECTIONS.find((s) => s.to.kind === 'aiw' && s.to.page === a.page)?.key ?? null
  })()

  const go = (s: Section) => {
    if (s.to.kind === 'space') {
      openSpace(project.id, project.name)
      return
    }
    // Point the AI Workspace at this project before changing the page, or the
    // page renders against whatever was selected last.
    if (a.projectId !== pid) void a.selectProject(pid)
    a.setPage(s.to.page)
    app.setRailView('aiworkspace')
  }

  return (
    <div className="flex h-[33px] shrink-0 items-stretch border-b border-line bg-page">
      <div className="flex shrink-0 items-center gap-1.5 pl-3 pr-2.5">
        <span style={{ color: nodeColor(project) }}>
          <Icon name="project" size={13} />
        </span>
        <span className="max-w-[180px] truncate text-[12.5px] font-semibold text-ink">
          {project.name}
        </span>
      </div>
      <div className="my-2 w-px shrink-0 bg-line" />

      <div className="flex min-w-0 items-stretch overflow-x-auto">
        {SECTIONS.map((s) => {
          const badge = s.count?.(counts) ?? null
          const active = activeKey === s.key
          return (
            <button
              key={s.key}
              className={`flex shrink-0 items-center gap-1.5 px-2.5 text-[12px] ${
                active
                  ? 'font-semibold text-ink shadow-[inset_0_-2px_0_theme(colors.indigo.500)]'
                  : 'text-dim hover:text-ink'
              }`}
              onClick={() => go(s)}
            >
              <Icon name={s.icon} size={13} className={active ? 'text-indigo-400' : 'text-muted'} />
              {s.label}
              {badge && (
                <span className={`rounded px-1 text-[10px] font-semibold ${badge.tone}`}>
                  {badge.n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Where the project actually is. The local path is stored; the remote is
          read from git, because a URL kept in our own database is one that can
          disagree with the one you actually push to. */}
      <div className="ml-auto flex shrink-0 items-center gap-2 px-3 text-[10.5px] text-muted">
        {project.path && (
          <span className="max-w-[240px] truncate font-mono" title={project.path}>
            {project.path}
          </span>
        )}
        {app.gitByNode[project.id]?.branch && (
          <>
            <span className="text-line2">|</span>
            <span className="flex items-center gap-1">
              <Icon name="commit" size={11} />
              {app.gitByNode[project.id].branch}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
