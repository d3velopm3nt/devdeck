// AI Workspace contextual sidebar: the module's sections, plus the projects it
// knows about. Fixed chrome, like the Explorer and the Connections sidebar —
// navigation is never a dock panel.

import { useEffect } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { useAiw, type AiwPage } from '../../lib/aiwStore'
import { aiw } from '../../lib/aiw'

const SECTIONS: Array<{ page: AiwPage; icon: IconName; label: string }> = [
  { page: 'overview', icon: 'layout', label: 'Overview' },
  { page: 'features', icon: 'list', label: 'Features' },
  { page: 'context', icon: 'context', label: 'Context' },
  { page: 'agents', icon: 'agent', label: 'Agents' },
  { page: 'activity', icon: 'history', label: 'Activity' },
  { page: 'conflicts', icon: 'conflict', label: 'Conflicts' },
  { page: 'decisions', icon: 'decision', label: 'Decisions' },
  { page: 'git', icon: 'commit', label: 'Git' },
  { page: 'tests', icon: 'ok', label: 'Tests' },
  { page: 'knowledge', icon: 'note', label: 'Knowledge' },
  { page: 'tools', icon: 'tool', label: 'Tools' },
]

export function AiwSidebar() {
  const a = useAiw()

  // Load once, and keep the live tail running while this view is mounted.
  useEffect(() => {
    if (!a.ready) void a.bootstrap()
    let stop: (() => void) | undefined
    void aiw.onEvent((e) => a.pushEvent(e)).then((un) => {
      stop = un
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeAgents = a.sessions.filter((s) => s.status === 'working' || s.status === 'planning').length
  const openConflicts = a.conflicts.filter((c) => !c.resolved).length

  const count = (p: AiwPage): { n: number; tone: string } | null => {
    if (p === 'features') return { n: a.features.length, tone: 'text-faint' }
    if (p === 'agents') return { n: activeAgents, tone: activeAgents ? 'text-ok' : 'text-faint' }
    if (p === 'conflicts')
      return { n: openConflicts, tone: openConflicts ? 'text-warn font-semibold' : 'text-faint' }
    if (p === 'decisions') return { n: a.decisions.length, tone: 'text-faint' }
    if (p === 'tests') return { n: a.testRuns.length, tone: 'text-faint' }
    return null
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Icon name="ai" size={14} className="text-indigo-400" />
        <span className="text-[12.5px] font-semibold text-ink">AI Workspace</span>
        <button
          className="btn-ghost ml-auto inline-flex items-center gap-1 text-[11px]"
          title="Reload projects, sessions, conflicts and activity"
          onClick={() => void a.refresh()}
        >
          <Icon name="update" size={11} /> Sync
        </button>
      </div>

      <div className="flex flex-col gap-px p-1.5">
        {SECTIONS.map((s) => {
          const c = count(s.page)
          const on = a.page === s.page
          return (
            <button
              key={s.page}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] ${
                on ? 'bg-raise font-semibold text-ink' : 'text-dim hover:bg-hover hover:text-ink'
              }`}
              onClick={() => a.setPage(s.page)}
            >
              <Icon name={s.icon} size={14} />
              {s.label}
              {c && c.n > 0 && <span className={`ml-auto text-[10.5px] ${c.tone}`}>{c.n}</span>}
            </button>
          )
        })}
      </div>

      <div className="mt-2 border-t border-line px-3 pb-1.5 pt-2.5">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Projects
        </div>
        {a.projects.length === 0 && (
          <div className="px-1 py-2 text-[11.5px] leading-5 text-muted">
            No projects yet. Run the demo to create two, or register a folder that has a
            <span className="font-mono"> .devdeck</span>.
          </div>
        )}
        {a.projects.map((p) => (
          <button
            key={p.id}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] ${
              a.projectId === p.id ? 'bg-raise text-ink' : 'text-dim hover:bg-hover hover:text-ink'
            }`}
            onClick={() => void a.selectProject(p.id)}
            title={p.root}
          >
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                p.active_agents > 0 ? 'bg-emerald-400' : 'bg-faint'
              }`}
            />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.open_conflicts > 0 && (
              <span className="text-[10px] font-semibold text-warn">{p.open_conflicts}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="border-t border-line p-2">
        <button
          className="btn-primary flex w-full items-center justify-center gap-1.5 text-[11.5px]"
          disabled={a.demoRunning}
          onClick={() => void a.runDemo()}
          title="Create the TyreX and AssetX fixture projects and run the full multi-agent scenario"
        >
          {a.demoRunning ? (
            <>
              <Icon name="spinner" size={12} className="animate-spin" /> Running…
            </>
          ) : (
            <>
              <Icon name="run" size={11} /> Run mock demo
            </>
          )}
        </button>
        <div className="mt-1.5 text-center text-[10px] leading-4 text-faint">
          No API key needed — the mock provider drives the real runtime.
        </div>
      </div>
    </div>
  )
}
