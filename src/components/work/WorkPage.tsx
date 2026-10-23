import { StepProgress } from './StepProgress'
import { useEffect, useMemo, useState } from 'react'
import { MessageBoard } from '../MessageBoard'
import { TeamFilter } from '../agents/TeamFilter'
import { useTeamNavigation } from '../../lib/teamNavigation'
import { useApp } from '../../store'
import { subtreeIds } from '../../lib/tree'
import type { GoalRow } from '../../lib/aiw'
import type { WorkCard } from '../../lib/workHub'
import { aiw } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import { assembleWork, goalKey, workState, workDisplayState, isExecutionGoal } from '../../lib/workHub'
import { FilterTabs, StateBadge } from '../ui/DesignSystem'
import { Icon } from '../../lib/icons'
import { GoalPage } from '../team/GoalPage'
import { WorkItemDetail } from './WorkItemDetail'
import { WorkItemEditor } from './WorkItemEditor'
import { useWorkData } from './useWorkData'
import { IssueMonitorPanel } from '../IssueMonitorPanel'
import './work-page.css'
import '../agents/workforce.css'

const columns = [{ id:'intake', label:'Intake' }, { id:'queued', label:'Queued' }, { id:'working', label:'Working' }, { id:'review', label:'Review' }, { id:'completed', label:'Completed' }] as const
export function WorkPage() {
  const teamFilter = useTeamNavigation(s => s.team)
  const reloadTeams = useTeamNavigation(s => s.reload)
  useEffect(() => { void reloadTeams() }, [reloadTeams])
  const nodes = useApp(s => s.nodes)
  const scope = useApp(s => s.spaceScopeId)
  const rawTab = useApp(s => s.teamTab)
  const focusedItem = useApp(s => s.workItemFocusId)
  const setTab = useApp(s => s.setTeamTab)
  const tab = rawTab === 'messages' ? 'messages' : rawTab === 'goals' || rawTab === 'features' ? 'goals' : 'work'
  const { data, reload } = useWorkData(nodes)
  const [search, setSearch] = useState('')
  const [goalFilter, setGoalFilter] = useState('all')
  const [picked, setPicked] = useState<string | null>(null)
  const [stepTarget, setStepTarget] = useState<{node: number; id: string; step: string} | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [creating, setCreating] = useState<ipc.WorkRecord | null>(null)
  const [creatingGoal, setCreatingGoal] = useState(false)
  const [showMonitor, setShowMonitor] = useState(false)
  useEffect(() => { if (focusedItem) { setStepTarget(null); setFocusVersion(value => value + 1); setPicked(focusedItem); setSearch(''); setGoalFilter('all'); useApp.setState({ workItemFocusId:null }) } }, [focusedItem])
  const allowed = useMemo(() => scope == null ? null : new Set(subtreeIds(nodes, scope)), [nodes, scope])
  const folders = nodes.filter(n => !allowed || allowed.has(n.id))
  const goals = data.goals.filter(g => !isExecutionGoal(g) && (!allowed || allowed.has(g.node_id)))
  const cards = assembleWork(data.records, data.legacy, data.monitor, data.workflows, data.claims).filter(c => !allowed || allowed.has(c.record.node))
  const shown = cards.filter(c => (!teamFilter || c.workflows.some(w => w.view.definition.team === teamFilter)) && `${c.record.title} ${c.record.description} ${c.record.source_url}`.toLowerCase().includes(search.toLowerCase()) && (goalFilter === 'all' || c.record.goal === goalFilter))
  const focusedSource = picked?.match(/^github:(.+):(\d+)$/)
  const current = shown.find(c => c.record.id === picked) || (focusedSource ? shown.find(c => c.record.source_url.toLowerCase() === `https://github.com/${focusedSource[1]}/issues/${focusedSource[2]}`.toLowerCase()) : undefined)
  const goal = goals.find(g => goalKey(g) === selectedGoal)
  const openGoal = (id: string) => { setSelectedGoal(id); setTab('goals') }
  const createItem = () => setCreating({ id:`local:${crypto.randomUUID()}`, node:folders.find(n => n.kind === 'project')?.id || folders[0]?.id || 0, title:'', description:'', acceptance:'', goal:'', source_url:'', status:'queued', revision:0, runs:[] })
  return <div className="workforce wh-page"><header className="wh-header"><div><p className="wh-kicker">{nodes.find(n => n.id === scope)?.name || 'All spaces'}</p><h1>Work</h1><p>Outcomes, requests and the processes that move them forward.</p></div>{tab !== 'messages' && <div className="wh-actions"><button className="wf-secondary" aria-label="Refresh Work" onClick={() => void reload()}><Icon name="update" size={14}/>{data.loading ? 'Refreshing…' : 'Refresh'}</button><button className="wf-secondary" onClick={() => setShowMonitor(value => !value)}>Issue intake</button><button className="wf-primary" disabled={!folders.length} onClick={tab === 'goals' ? () => setCreatingGoal(true) : createItem}><Icon name="add" size={14}/>{tab === 'goals' ? 'New goal' : 'New work item'}</button></div>}</header>
    <nav className="wh-nav" aria-label="Work sections"><FilterTabs label="Work views" value={tab} onChange={setTab} appearance="compact" options={[{ id:'goals', label:'Goals', icon:'focus', count:goals.length }, { id:'work', label:'Work Items', icon:'list', count:cards.length }, { id:'messages', label:'Messages', icon:'mail' }]}/><span>{cards.filter(c => ['review','blocked'].includes(workState(c))).length} need attention</span></nav>
    {data.errors.length > 0 && <details className="wh-read-errors"><summary role="alert">Some work could not be read · {data.errors.length} sources</summary>{data.errors.map((error, index) => <p key={index}>{error}</p>)}</details>}
    {showMonitor && <IntakeStatus monitor={data.monitor} onRefresh={reload}/>}
    {tab === 'messages' ? <MessageBoard embedded/>
    : tab === 'goals' ? <div className="wh-goals-layout"><section className="wh-goals" aria-label="Goals"><div className="wh-section-heading"><h2>Goals</h2><span>Outcomes your work contributes to</span></div>{!goals.length && !data.loading && <div className="wh-empty"><Icon name="focus" size={24}/><h3>Give your team an outcome</h3><p>Work items can contribute to a goal or stand alone.</p><button className="wf-primary" onClick={() => setCreatingGoal(true)}>Create goal</button></div>}<div className="wh-goal-grid">{goals.map(g => <GoalVisual key={goalKey(g)} goal={g} items={cards.filter(c => c.record.goal === goalKey(g))} selected={selectedGoal === goalKey(g)} onOpen={() => setSelectedGoal(goalKey(g))}/>)}</div></section>{goal && <section className="wh-goal-detail"><div className="wh-run-breadcrumb"><button className="wf-secondary" onClick={() => setSelectedGoal(null)}>Close goal</button><button className="wf-secondary" onClick={() => { setGoalFilter(goalKey(goal)); setTab('work') }}>View its work items</button></div><GoalWorkMap items={cards.filter(c => c.record.goal === goalKey(goal))} onOpen={id => { setStepTarget(null); setPicked(id); setTab('work') }}/><details className="wh-goal-controls"><summary>Goal settings and execution history</summary><GoalPage goal={goal} board={{ rows:goals, loaded:!data.loading, error:null }}/></details></section>}</div>
    : <><div className="wh-toolbar"><TeamFilter/><label className="wh-search"><Icon name="search" size={15}/><input aria-label="Search work items" placeholder="Find a request, source or outcome…" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Filter work items by goal" value={goalFilter} onChange={e => setGoalFilter(e.target.value)}><option value="all">All goals</option>{goals.map(g => <option key={goalKey(g)} value={goalKey(g)}>{g.feature_name}</option>)}</select><span>{shown.length} work items</span></div><div className="wh-main" data-detail={!!current}><section className="wh-board" aria-label="Work item board">{columns.map(column => { const items = shown.filter(c => { if (c.intake) return column.id === 'intake'; if (column.id === 'intake') return false; const status = workState(c); return column.id === 'working' ? status === 'working' || status === 'blocked' : status === column.id }); return <div className="wh-column" key={column.id}><header><span className="wh-column-dot" data-state={column.id}/><h2>{column.label}</h2><span>{items.length}</span></header><div className="wh-column-items">{items.map(card => { const steps = card.workflows.flatMap(w => w.view.definition.steps); const active = steps.find(s => ['running','starting','review','blocked'].includes(s.status)); const team = card.workflows.map(w => data.teams.find(t => t.id === w.view.definition.team)?.name || w.view.definition.team).filter(Boolean); return <article className="wh-item-card" data-selected={picked === card.record.id} key={card.record.id}><button className="wh-item-open" aria-pressed={picked === card.record.id} onClick={() => { setStepTarget(null); setPicked(card.record.id); setFocusVersion(v => v + 1) }}><div><span className="wh-kicker">{card.kind === 'github' || card.record.source_url.includes('github.com') ? 'GitHub request' : card.kind === 'legacy' ? 'Existing work' : 'Work item'}</span><StateBadge state={workDisplayState(card)} label={card.intake ? 'Intake' : card.dispatch?.status === 'selecting' && !card.workflows.length ? 'Planning work' : undefined}/></div><h3>{card.record.title}</h3>{card.record.goal && <p>{goals.find(g => goalKey(g) === card.record.goal)?.feature_name || 'Linked goal'}</p>}<div className="wh-card-meta">{card.intake && <span>{card.intake}</span>}{card.dispatch?.status === 'selecting' && !card.workflows.length && <span>Dev is planning the work</span>}{card.dispatch?.status === 'blocked' && card.dispatch.message && <span title={card.dispatch.message}>{card.dispatch.message.slice(0,220)}</span>}{card.claim && <span>Picked up by {card.claim.agent_id}</span>}<span>{[...new Set(team)].join(', ') || 'No plan recorded'}</span>{active && <span>{data.workers.find(w => w.handle === active.worker)?.name || active.worker} · {active.title}</span>}<span>{card.workflows.length ? `${card.workflows.length} plan${card.workflows.length === 1 ? '' : 's'} · ${steps.filter(s => s.status === 'done').length}/${steps.length} steps accepted` : 'No steps recorded yet'}</span></div></button>{card.workflows.map(entry => <StepProgress key={`${entry.node}:${entry.id}`} steps={entry.view.definition.steps} onSelect={step => { setStepTarget({node:entry.node,id:entry.id,step:step.id}); setPicked(card.record.id); setFocusVersion(v => v + 1) }}/>)}</article> })}{!items.length && <p className="wh-column-empty">{data.loading ? 'Reading work…' : 'No items here'}</p>}</div></div> })}</section>{current && <WorkItemDetail key={`${current.record.id}:${focusVersion}`} card={current} initialRun={stepTarget} goals={goals} nodes={folders} workflows={data.workflows} workers={data.workers} teams={data.teams} onClose={() => setPicked(null)} onChanged={reload} onGoal={openGoal}/>}</div></>}
    {creating && <WorkItemEditor record={creating} goals={goals} nodes={folders} onClose={() => setCreating(null)} onSaved={saved => { setCreating(null); setPicked(saved.id); setTab('work'); void reload() }}/>} {creatingGoal && <NewGoal nodes={folders} onClose={() => setCreatingGoal(false)} onSaved={() => { setCreatingGoal(false); void reload() }}/>}</div>
}

function NewGoal({ nodes, onClose, onSaved }: { nodes: ReturnType<typeof useApp.getState>['nodes']; onClose: () => void; onSaved: () => void }) {
  const [node, setNode] = useState(nodes.find(n => n.kind === 'project')?.id || nodes[0]?.id || 0)
  const [name, setName] = useState(''); const [outcome, setOutcome] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); setError(''); try { await aiw.createFeature(String(node), name, outcome, []); onSaved() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <div className="wh-overlay"><section className="wh-dialog" role="dialog" aria-modal="true" aria-label="New goal"><header><h2>New goal</h2><button className="wf-secondary" disabled={busy} onClick={onClose}>Cancel</button></header><div className="wh-form"><label>Name<input aria-label="Goal name" value={name} onChange={e => setName(e.target.value)}/></label><label>Outcome · Markdown<textarea aria-label="Goal outcome" value={outcome} onChange={e => setOutcome(e.target.value)} rows={5}/></label><label>Folder<select aria-label="Goal folder" value={node} onChange={e => setNode(Number(e.target.value))}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>{error && <p role="alert" className="wh-error">{error}</p>}<button className="wf-primary" disabled={busy || !name.trim() || !outcome.trim() || !node} onClick={() => void save()}>{busy ? 'Saving…' : 'Create goal'}</button></div></section></div>
}
function IntakeStatus({ monitor, onRefresh }: { monitor: ipc.IssueMonitorView | null; onRefresh: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const refresh = async () => { setBusy(true); try { await ipc.issueMonitorRefresh(); onRefresh() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <section className="wh-intake"><div><strong>GitHub issue intake</strong><p>{monitor?.enabled ? 'Monitoring on' : 'Monitoring paused'} · {monitor?.dispatch_enabled ? 'Automatic execution enabled' : 'Automatic execution off'} · {monitor?.sources.length || 0} repositories</p><p className="wh-note">New tickets appear as work items. Assignment and runtime permissions still determine whether work starts. Inbox and notifications retain attention requests.</p><details><summary>Configure intake and dispatch</summary><IssueMonitorPanel/></details></div><button className="wf-secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh issues'}</button>{error && <p role="alert" className="wh-error">{error}</p>}</section>
}

function GoalVisual({ goal, items, selected, onOpen }: { goal: GoalRow; items: WorkCard[]; selected: boolean; onOpen: () => void }) {
  const done = items.filter(item => workState(item) === 'completed').length
  const percent = items.length ? Math.round(done / items.length * 100) : 0
  const states = ['queued', 'working', 'review', 'blocked', 'completed'] as const
  return <button className="wf-card wh-goal-card wh-goal-visual" aria-pressed={selected} onClick={onOpen}>
    <div><span className="wh-goal-symbol"><Icon name="focus" size={20}/></span><StateBadge state={goal.status}/></div>
    <strong>{goal.feature_name}</strong><p>{goal.goal || goal.space}</p>
    <div className="wh-goal-meter"><div className="wh-goal-ring" style={{ background:`conic-gradient(var(--c-ok) ${percent}%, var(--c-line) 0)` }}><span>{percent}%</span></div><div><b>{done} / {items.length}</b><span>work items completed</span></div></div>
    <div className="wh-goal-segments" aria-label="Work item status distribution">{states.map(state => { const count = items.filter(item => workState(item) === state).length; return count > 0 && <span key={state} data-state={state} style={{ flex:count }} title={`${count} ${state}`}/> })}</div>
    <div className="wh-goal-states">{states.map(state => { const count = items.filter(item => workState(item) === state).length; return count > 0 && <span key={state}><i data-state={state}/>{count} {state}</span> })}{!items.length && <span>No work items linked yet</span>}</div>
    <footer><span>{goal.managed_by || 'Unassigned'}</span><span>Explore goal →</span></footer>
  </button>
}
function GoalWorkMap({ items, onOpen }: { items: WorkCard[]; onOpen: (id: string) => void }) {
  return <section className="wh-goal-map" aria-label="Goal delivery map"><div className="wh-section-heading"><h2>Delivery map</h2><span>Goal → work items → progress</span></div>{!items.length && <p className="wh-note">Link a work item to this goal to see its delivery path here.</p>}<div className="wh-goal-branches">{items.map(item => <button key={item.record.id} onClick={() => onOpen(item.record.id)} className="wh-goal-branch"><div><Icon name="list" size={15}/><strong>{item.record.title}</strong><StateBadge state={workState(item)}/></div><div className="wh-goal-run-path">{item.workflows.map(run => <span key={`${run.node}:${run.id}`}><Icon name="context" size={12}/>{run.view.definition.title}<small>{run.view.definition.steps.filter(step => step.status === 'done').length}/{run.view.definition.steps.length} accepted</small></span>)}{!item.workflows.length && <span className="wh-note">No plan recorded</span>}</div></button>)}</div></section>
}
