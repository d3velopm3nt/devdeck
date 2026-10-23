import { useAiw } from '../lib/aiwStore'
import { initials } from '../lib/aiw'
import { useTeamNavigation, openTeamView } from '../lib/teamNavigation'
import { StateBadge } from './ui/DesignSystem'

/** The same live sessions used by the header; saved bot definitions are not activity. */
export function HomeActiveAgents() {
  const runtime = useAiw()
  const teams = useTeamNavigation(s => s.teams)
  const sessions = runtime.sessions.filter(s => s.status === 'working' || s.status === 'planning')
  const count = new Set(sessions.map(s => s.agent_id)).size
  return <section aria-label="Active agents" className="overflow-hidden rounded-xl border border-line bg-panel">
    <header className="flex items-center gap-2 border-b border-line px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">Active agents</h2>
      <span className="ds-state" data-tone="info">{count}</span>
      <span className="ml-auto text-xs text-muted">Live activity</span>
    </header>
    {runtime.error && <p role="alert" className="px-4 py-3 text-sm text-err">Agent activity could not refresh. Displayed activity may be out of date.</p>}
    {!sessions.length && <p className="px-4 py-5 text-sm text-muted">{!runtime.ready || runtime.loading ? 'Loading agent activity…' : runtime.error ? 'Live activity is unavailable.' : 'No agents are working right now.'}</p>}
    <div className="divide-y divide-line">
      {sessions.map(session => {
        const team = teams.find(t => t.roles.some(r => r.worker === session.agent_id || r.worker === `agent:${session.agent_id}`))
        const feature = runtime.features.find(f => f.id === session.feature_id)
        const project = runtime.projects.find(p => p.id === session.project_id)
        return <div key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-xs font-semibold text-info">{initials(session.agent_name)}</span>
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-sm font-semibold text-ink">{session.agent_name}</p>
            <p className="truncate text-xs text-muted">{[team?.name, project?.name].filter(Boolean).join(' · ') || session.role}</p>
            <p className="mt-1 truncate text-xs text-dim" title={feature?.name || session.summary}>{feature?.name || session.summary || 'Working on assigned steps'}</p>
          </div>
          <StateBadge state={session.status}/>
          <button className="rounded-md border border-line px-3 py-1.5 text-xs text-dim hover:bg-hover" onClick={() => openTeamView(team?.id || '', 'work')}>View work</button>
        </div>
      })}
    </div>
  </section>
}
