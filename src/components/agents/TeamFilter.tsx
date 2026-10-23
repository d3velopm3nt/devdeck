import { useTeamNavigation } from '../../lib/teamNavigation'

export function TeamFilter() {
  const { teams, team } = useTeamNavigation()
  return <label className="flex items-center gap-2 text-xs text-muted">Team<select className="input" aria-label="Filter by team" value={team} onChange={e => useTeamNavigation.setState({ team: e.target.value })}><option value="">All teams</option>{team && !teams.some(t => t.id === team) && <option value={team}>Unavailable team</option>}{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
}
