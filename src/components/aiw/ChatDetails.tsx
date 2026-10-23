import { useEffect, useId, useRef, useState } from 'react'
import { useChatWorkspace, type PanelView } from '../../lib/chatWorkspace'
import { useAiw } from '../../lib/aiwStore'
import { aiw } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import { ProposalChart } from '../agents/TeamBuild'
import { StateBadge } from '../ui/DesignSystem'
import '../agents/team-builder.css'
import '../agents/workforce.css'
import { ContextBar } from '../thread/ContextBar'
import { Icon, type IconName } from '../../lib/icons'
import { useApp } from '../../store'
import { ChatWorkflow } from './ChatWorkflow'
import { RunView } from '../workers/RunPage'

function TeamDetails({ id }: { id: string }) {
  const w = useChatWorkspace()
  const subject = w.subjects[id] ?? {}
  const [teams, setTeams] = useState<ipc.ReusableTeam[]>([])
  const [agents, setAgents] = useState<ipc.LibraryAgent[]>([])
  const [saving, setSaving] = useState(false)
  const memberDetails = useRef<Record<string, HTMLDetailsElement | null>>({})
  const inspect = (role: string) => { const detail = memberDetails.current[role]; if (detail) { detail.open = true; detail.scrollIntoView({ block: 'nearest' }); detail.querySelector('summary')?.focus() } }
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let live = true
    Promise.all([ipc.reusableTeamsList(), ipc.libraryAgents()]).then(([t, a]) => { if (live) { setTeams(t); setAgents(a) } }).catch(e => { if (live) setLoadError(String(e)) })
    return () => { live = false }
  }, [subject.saved])
  const proposal = subject.proposal
  const attached = subject.team
  const busy = saving || w.pending !== null
  const save = async () => {
    if (!proposal || busy) return
    setSaving(true); w.patch(id, { error: '' })
    try {
      const team = await ipc.teamBuilderCreate(proposal)
      w.patch(id, { team, saved: true })
    } catch (e) { w.patch(id, { error: String(e) }) }
    finally { setSaving(false) }
  }
  return <div className="chat-detail-content">
    <label className="block text-dim">Attach a saved team<select aria-label="Attach a saved team" className="input mt-1 w-full" disabled={busy} value={attached?.id ?? ''} onChange={e => w.patch(id, { team: teams.find(t => t.id === e.target.value), proposal: null, planning: true, saved: false })}><option value="">New team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name} · revision {t.revision}</option>)}</select></label>
    <button className="chat-icon-button mt-2" title={subject.planning ? "Team planning enabled" : "Discuss a team with Dev"} aria-label={subject.planning ? "Team planning enabled" : "Discuss a team with Dev"} aria-pressed={!!subject.planning} disabled={busy} onClick={() => w.patch(id, { planning: !subject.planning })}><Icon name="agent" size={17}/></button>
    {loadError && <p role="alert" className="text-err">{loadError}</p>}
    {!proposal && !attached && <p className="text-muted mt-3">Describe the work in the conversation. Start with one agent and skills, or add specialists when useful.</p>}
    {attached && !proposal && <><h3 className="mt-3 font-semibold">{attached.name}</h3><p>{attached.description}</p><ProposalChart onSelect={inspect} proposal={{id:attached.id,name:attached.name,description:attached.description,members:attached.roles.map(r => ({role:r.name,name:r.name,kind:r.kind ?? 'worker',reports_to:r.reports_to ?? '',instructions:r.instructions ?? '',worker:r.worker}))}}/>{attached.roles.map(role => {
      const key = role.worker.startsWith('agent:') ? 'runtime:' + role.worker.slice(6) : 'worker:' + role.worker
      const agent = agents.find(a => a.id === key)
      return <details className="chat-member" ref={el => { memberDetails.current[role.name] = el }} key={role.name}><summary>{role.name} · {role.reports_to || 'Lead'}</summary><p>{role.instructions}</p><p>{role.worker}</p>{agent ? <><p>{agent.instructions}</p><p>Attached skills: {agent.skills.join(', ') || 'None'}</p><details><summary>Model and permissions</summary><pre>{JSON.stringify(agent.configuration, null, 2)}</pre></details></> : <p>Member definition unavailable</p>}</details>
    })}</>}
    {attached && <button className="chat-icon-button mt-2" title="Open full designer" aria-label="Open full designer" onClick={() => { useChatWorkspace.setState({ designerTeam: attached }); useApp.getState().setRailView('workers') }}><Icon name="external" size={17}/></button>}
    {proposal && <section aria-label="Review team proposal">
      <div><h3 className="mt-3 font-semibold">{proposal.name}</h3><p>{proposal.description}</p>
      {subject.saved && <StateBadge state="completed" label="Team saved" />}
      <ProposalChart onSelect={inspect} proposal={proposal} />
      {proposal.members.map((member, index) => {
        const original = attached?.roles.find(r => r.name === member.role)
        const change = !original ? 'Addition' : original.worker !== member.worker ? 'Reassigned' : original.kind !== member.kind || original.reports_to !== member.reports_to || original.instructions !== member.instructions ? 'Changed' : 'Retained'
        return <details className="chat-member" ref={el => { memberDetails.current[member.role] = el }} key={member.role}><summary>{member.name} · {change}</summary><p>{member.kind} · {member.reports_to ? 'Reports to ' + member.reports_to : 'Team lead'}</p><label>Role instructions<textarea aria-label={'Instructions for ' + member.role} className="input w-full" value={member.instructions} disabled={busy || subject.saved} onChange={e => w.patch(id, { proposal: { ...proposal, members: proposal.members.map((m,i) => i === index ? { ...m, instructions: e.target.value } : m) } })}/></label><label>Library agent<select aria-label={'Agent for ' + member.role} className="input w-full" disabled={busy || subject.saved} value={member.worker} onChange={e => w.patch(id, { proposal: { ...proposal, members: proposal.members.map((m,i) => i === index ? { ...m, worker: e.target.value } : m) } })}><option value="">Create new agent</option>{member.worker && !agents.some(a => (a.id.startsWith('runtime:') ? 'agent:' + a.id.slice(8) : a.id.replace(/^worker:/,'')) === member.worker) && <option value={member.worker}>{member.worker}</option>}{agents.filter(a => a.execution === 'model' || a.execution === 'cli').map(a => <option key={a.id} value={a.id.startsWith('runtime:') ? 'agent:' + a.id.slice(8) : a.id.replace(/^worker:/,'')}>{a.name}</option>)}</select></label></details>
      })}
      {attached?.roles.filter(r => !proposal.members.some(m => m.role === r.name)).map(r => <p key={r.name} className="text-warn">Removed role: {r.name}. Shared agent retained.</p>)}
      <p className="my-3 text-muted">New agents use {proposal.connection?.provider || 'the selected connection'} / {proposal.connection?.model || 'default'}. Reused agents keep their skills, model and permissions. Saving starts no work.</p>
      <button className="btn-primary" disabled={busy || subject.saved} onClick={() => void save()}>{saving ? 'Saving…' : subject.saved ? 'Saved' : proposal.target ? 'Save reviewed revision' : 'Create team'}</button>
    </div></section>}
    {attached && subject.error && <button className="chat-icon-button mt-2" title="Refresh attached team" aria-label="Refresh attached team" disabled={busy} onClick={() => { void ipc.reusableTeamsList().then(teams => { const current = teams.find(t => t.id === attached.id); if (!current) throw new Error('This team was removed.'); w.patch(id, { team: current, error: 'Team refreshed. Ask Dev for a fresh proposal before saving.' }) }).catch(e => w.patch(id, { error: String(e) })) }}><Icon name="update" size={17}/></button>}
    {subject.error && <p role="alert" className="mt-3 text-err">{subject.error}</p>}
  </div>
}

function ContextDetails({ id }: { id: string }) {
  const a = useAiw()
  const subject = useChatWorkspace(s => s.subjects[id])
  const [context, setContext] = useState('Reading context…')
  useEffect(() => {
    let live = true
    aiw.assistantContext(id).then(text => { if (live) setContext(text) }).catch(e => { if (live) setContext(String(e)) })
    return () => { live = false }
  }, [id, a.conversation?.messages.length])
  const assistant = a.agents.find(a => a.id === 'assistant')
  const project = a.projects.find(p => p.id === a.conversation?.project_id)
  return <div className="chat-detail-content"><h3>Participants</h3><p>You · {assistant?.name || 'Dev'}{subject?.team ? ' · ' + subject.team.name : ''}</p><p>{a.conversation?.participants?.map(id => a.agents.find(agent => agent.id === id)?.name ?? id).join(' · ')}</p><h3>Attached skills</h3><p>{assistant?.skills.join(', ') || 'None on the main agent'}</p><p className="text-muted">Team member skills appear under Team. An attachment alone does not activate a skill or grant permissions.</p><ContextBar conversationId={id}/><h3>Active context</h3><pre className="whitespace-pre-wrap break-words">{context}</pre><h3>Tools and permissions</h3>{a.tools.map(tool => <details key={tool.id}><summary>{tool.name}</summary><p>{tool.description}</p><pre>{JSON.stringify(assistant?.permissions[tool.id] ?? 'No explicit permission', null, 2)}</pre></details>)}<h3>Repository and environment</h3><p>{project?.root || 'No project attached'}</p><p>Branch: {project?.branch || 'Unavailable'}</p><p>Environment: local workspace</p></div>
}

const views: { id: PanelView; label: string; icon: IconName; description: string }[] = [
  { id: 'workflow', label: 'Progress', icon: 'list', description: 'Follow work item steps, progress and evidence.' },
  { id: 'team', label: 'Team', icon: 'agent', description: 'Plan a team and review its members.' },
  { id: 'browser', label: 'Browser', icon: 'globe', description: 'A place for websites and previews.' },
  { id: 'files', label: 'Files', icon: 'folder', description: 'A place to explore project files.' },
  { id: 'canvas', label: 'Canvas', icon: 'palette', description: 'A place for documents and visual work.' },
  { id: 'context', label: 'Context', icon: 'context', description: 'Inspect skills, permissions and context.' },
  { id: 'activity', label: 'Activity', icon: 'list', description: 'Review recorded communications and results.' },
  { id: 'run', label: 'Agent details', icon: 'agent', description: 'Inspect the selected agent run.' },
  { id: 'home', label: 'New tab', icon: 'add', description: '' },
]
function openView(tab: PanelView) {
  useChatWorkspace.setState(w => ({ split: true, tab, tabs: [...new Set([...w.tabs, w.tab, tab])] }))
}

export function ChatInspector({ id }: { id: string }) {
  const a = useAiw()
  const subject = useChatWorkspace(s => s.subjects[id])
  const assistant = a.agents.find(agent => agent.id === 'assistant')
  const project = a.projects.find(p => p.id === a.conversation?.project_id)
  return <aside style={{ width: useChatWorkspace(s => s.inspectorWidth) }} className="chat-inspector" aria-label="Conversation details">
    <div className="chat-inspector-heading"><strong>Conversation details</strong><button className="chat-icon-button" title="Hide conversation details" aria-label="Hide conversation details" onClick={() => useChatWorkspace.setState({ inspector: false })}><Icon name="close" size={14}/></button></div>
    <details open><summary>Environment</summary><p><Icon name="machine" size={14}/> Local workspace</p><p>{project?.name || 'No project attached'}</p>{project && <><p className="text-muted">{project.root}</p><p>Branch: {project.branch || 'Unavailable'}</p></>}</details>
    <details open><summary>Context</summary><p>{assistant?.skills.length ?? 0} attached skills</p><button className="chat-icon-button" title="Inspect context" aria-label="Inspect context" onClick={() => openView('context')}><Icon name="external" size={12}/></button></details>
    <details open><summary>Connection</summary><p>{assistant?.provider || 'No connection selected'}</p><p className="text-muted">{assistant?.model || 'Default model'}</p><p>{a.tools.length} configured tools</p></details>
    <ChatWorkflow key={id} id={id} compact onOpen={() => openView('workflow')}/>
    <details open><summary>Outputs</summary>{subject?.proposal || subject?.team ? <button className="btn-ghost" onClick={() => openView('team')}><Icon name="agent" size={14}/>{subject.proposal?.name || subject.team?.name}</button> : <p className="text-muted">No team artifact yet.</p>}</details>
    <details><summary>Activity</summary><p>{a.conversation?.messages.filter(m => m.from !== 'user').length ?? 0} recorded entries</p><button className="chat-icon-button" title="Open activity" aria-label="Open activity" onClick={() => openView('activity')}><Icon name="external" size={12}/></button></details>
  </aside>
}

export function ChatDetails({ id }: { id: string }) {
  const w = useChatWorkspace()
  const a = useAiw()
  const panelId = useId()
  const selectedRun = w.subjects[id]?.run
  const messages = a.conversation?.messages.filter(m => m.from !== 'user') ?? []
  // Include views opened by existing team entry points as well as the tab launcher.
  const tabs = [...new Set([...w.tabs, w.tab])]
  const current = views.find(view => view.id === w.tab)!
  const close = (closed: PanelView) => {
    const index = tabs.indexOf(closed)
    const remaining = tabs.filter(tab => tab !== closed)
    const next = closed === w.tab ? remaining[Math.min(index, remaining.length - 1)] ?? 'home' : w.tab
    useChatWorkspace.setState({ tabs: remaining.length ? remaining : ['home'], tab: next })
    requestAnimationFrame(() => document.getElementById(panelId + '-tab-' + next)?.focus())
  }
  return <><div className="chat-panel-toolbar"><div className="chat-panel-tabs" role="tablist" aria-label="Workspace views">
    {tabs.map((tab, index) => {
      const view = views.find(view => view.id === tab)!
      return <div className="chat-editor-tab" data-active={tab === w.tab} key={tab} role="presentation">
        <button type="button" role="tab" id={panelId + '-tab-' + tab} aria-controls={panelId} aria-selected={tab === w.tab} tabIndex={tab === w.tab ? 0 : -1} title={view.label} onClick={() => openView(tab)} onKeyDown={event => {
          if (event.key === 'Delete') { event.preventDefault(); close(tab); return }
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : null
          if (nextIndex === null) return
          event.preventDefault(); openView(tabs[nextIndex]); document.getElementById(panelId + '-tab-' + tabs[nextIndex])?.focus()
        }}><Icon name={view.icon} size={15}/><span>{view.label}</span></button>
        <button type="button" className="chat-editor-tab-close" aria-label={'Close ' + view.label + ' tab'} title={'Close ' + view.label + ' tab'} onClick={() => close(tab)}><Icon name="close" size={13}/></button>
      </div>
    })}
    </div><button className="chat-icon-button" title="New workspace tab" aria-label="New workspace tab" onClick={() => openView('home')}><Icon name="add" size={15}/></button><button className="chat-icon-button" title="Hide workspace" aria-label="Hide workspace" onClick={() => useChatWorkspace.setState({ split: false, ...(window.innerWidth <= 760 ? { inspector: false } : {}) })}><Icon name="layout" size={15}/></button></div>
    <div className="min-h-0 flex-1 overflow-auto" id={panelId} role="tabpanel" aria-labelledby={panelId + '-tab-' + w.tab}>
    {w.tab === 'home' ? <div className="chat-panel-home"><h2>Workspace</h2><p className="text-muted">Open a view beside your conversation.</p><div className="chat-panel-launcher">{views.filter(view => view.id !== 'home' && view.id !== 'run').map(view => <button key={view.id} onClick={() => openView(view.id)}><Icon name={view.icon} size={20}/><span><strong>{view.label}</strong><small>{view.description}</small></span></button>)}</div></div>
    : w.tab === 'run' ? (selectedRun ? <RunView key={selectedRun.id} id={selectedRun.id} compact/> : <div className="chat-detail-content"><h3>Agent details</h3><p>Open a run from this conversation’s Progress view.</p><button className="btn-ghost" onClick={() => openView('workflow')}>Open Progress</button></div>)
    : w.tab === 'workflow' ? <ChatWorkflow key={id} id={id}/> : w.tab === 'team' ? <TeamDetails key={id} id={id}/> : w.tab === 'context' ? <ContextDetails key={id} id={id}/>
    : w.tab === 'activity' ? <div className="chat-detail-content"><h3>Communications and results</h3>{messages.map((m,i) => <details className="chat-member" key={i}><summary>{m.tool || (m.by ? a.agents.find(agent => agent.id === m.by)?.name ?? m.by : 'Dev response')} · {m.ok === false ? 'Failed' : m.from === 'tool' ? 'Recorded activity' : 'Result'}</summary><pre className="whitespace-pre-wrap break-words">{m.text}</pre></details>)}{!messages.length && <p className="text-muted">No recorded activity yet.</p>}{(a.sendingConversationId === id || w.pending === id) && <StateBadge state="working" label="Working"/>}</div>
    : <div className="chat-panel-placeholder"><Icon name={current.icon} size={32}/><h2>{current.label}</h2><p>{current.description}</p><p className="text-muted">This view is ready for a future integration.</p><button className="chat-icon-button" title="Explore workspace views" aria-label="Explore workspace views" onClick={() => openView('home')}><Icon name="layout" size={17}/></button></div>}
    </div></>
}
