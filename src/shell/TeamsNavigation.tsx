import { useAiw } from '../lib/aiwStore'
import { useEffect } from 'react'
import { Icon } from '../lib/icons'
import { aiw } from '../lib/aiw'
import { openTeams, openTeamView, useTeamNavigation, type TeamView } from '../lib/teamNavigation'
import { useApp } from '../store'

export function TeamsNavigation({ expanded }: { expanded: boolean }) {
  const sessions = useAiw(s => s.sessions)
  const state = useTeamNavigation()
  const rail = useApp(s => s.railView)
  const workTab = useApp(s => s.teamTab)
  useEffect(() => {
    const reload = () => { void useTeamNavigation.getState().reload() }
    reload()
    window.addEventListener('focus', reload)
    const stop = aiw.onEvent(event => { if (event.type.startsWith('team.') || event.type.startsWith('library.')) reload() })
    return () => { window.removeEventListener('focus', reload); void stop.then(off => off()).catch(() => {}) }
  }, [])
  if (!expanded) return <button className="ds-navigation-item w-10 h-10 flex items-center justify-center" title="Teams" aria-label="Teams" onClick={() => openTeams()}><Icon name="contacts" size={17}/></button>
  const options: {id: TeamView; label: string; icon: 'check' | 'mail' | 'contacts'}[] = [{id:'work',label:'Work',icon:'check'},{id:'messages',label:'Messages',icon:'mail'}]
  return <section className="rail-teams" aria-label="Teams"><header><button onClick={() => openTeams()}>Teams</button><button aria-label="Manage teams" title="Manage teams" onClick={() => openTeams()}><Icon name="settings" size={14}/></button><button aria-label="Refresh teams" title="Refresh teams" onClick={() => void state.reload()}><Icon name="update" size={14}/></button></header>
    {state.error && <p role="alert">Teams could not be read. Refresh to retry.</p>}
    {!state.teams.length && !state.error && <p>{state.loading ? 'Loading teams…' : 'No saved teams yet.'}</p>}
    {state.teams.map(team => { const open = state.expanded.includes(team.id); const active = new Set(sessions.filter(session => ['working','planning'].includes(session.status) && team.roles.some(role => role.worker === 'agent:' + session.agent_id || role.worker === session.agent_id)).map(session => session.agent_id)).size; return <div key={team.id}><div className="flex items-center"><button className="p-1" title={open ? 'Collapse ' + team.name : 'Expand ' + team.name} aria-label={open ? 'Collapse ' + team.name : 'Expand ' + team.name} aria-expanded={open} onClick={() => useTeamNavigation.setState({ expanded: open ? state.expanded.filter(id => id !== team.id) : [...state.expanded, team.id] })}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={12}/></button><button className="rail-team-name" onClick={() => openTeams(team)}><Icon name="contacts" size={15}/><span>{team.name}</span>{active > 0 && <span className="rail-work-count" data-state="working" title={`${active} active agents`} aria-label={`${active} active agents`}>{active > 99 ? '99+' : active}</span>}</button></div>{open && <div className="rail-team-views">{options.map(view => <button key={view.id} aria-current={state.team === team.id && rail === 'team' && workTab === view.id ? 'page' : undefined} onClick={() => openTeamView(team.id, view.id)}><Icon name={view.icon} size={14}/>{view.label}</button>)}</div>}</div> })}
  </section>
}
