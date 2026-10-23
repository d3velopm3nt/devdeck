import { assembleWork } from '../../lib/workHub'
import { useWorkData } from '../work/useWorkData'
import { useApp } from '../../store'
import { stepState } from '../../lib/workHub'
import { useEffect } from 'react'
import { openChatRun, useChatWorkspace } from '../../lib/chatWorkspace'
import { StateBadge } from '../ui/DesignSystem'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'

export function ChatWorkflow({ id, compact = false, onOpen }: { id: string; compact?: boolean; onOpen?: () => void }) {
  const agents = useAiw(s => s.agents)
  const storedLink = useAiw(s => s.conversation?.id === id ? s.conversation.work_item : undefined)
  const localLink = useChatWorkspace(s => s.subjects[id]?.workItem)
  const linked = storedLink ?? localLink
  const nodes = useApp(s => s.nodes)
  const {data, reload} = useWorkData(nodes)
  useEffect(() => { const timer = setInterval(() => void reload(), 5000); return () => clearInterval(timer) }, [reload])
  const cards = assembleWork(data.records,data.legacy,data.monitor,data.workflows,data.claims)
  const items = cards.map(c => ({...c.record, runs:c.workflows.map(w => ({node:w.node,workflow:w.id,template:''}))}))
  const card = cards.find(c => c.record.id === linked)
  const item = items.find(record => record.id === linked)
  const flows = card?.workflows.map(w => w.view) ?? []
  const error = data.errors.join('; ')
  const loading = data.loading && !card
  const steps = flows.flatMap(flow => flow.definition.steps)
  const done = steps.filter(step => step.status === 'done').length
  const current = steps.find(step => ['running', 'starting', 'review', 'blocked'].includes(step.status)) ?? steps.find(step => step.status === 'pending')
  const state = steps.some(step => step.status === 'blocked') ? stepState(steps.find(step => step.status === 'blocked')!) : steps.some(step => step.status === 'running' || step.status === 'starting') ? 'working' : steps.some(step => step.status === 'review') ? 'review' : steps.length && steps.every(step => ['done', 'skipped'].includes(step.status)) ? 'completed' : 'queued'
  if (compact) {
    if (!linked || (!loading && !error && !item?.runs.length)) return null
    return <details open><summary>Plan and progress</summary>
      {error ? <p role="alert" className="text-err">Progress refresh failed.</p> : loading ? <p>Loading progress…</p> : <><p>{flows.map(flow => flow.definition.title).join(' · ')}</p><StateBadge state={state}/><p>{done}/{steps.length} steps accepted</p>{current && <p>{current.title}</p>}</>}
      <button className="chat-icon-button" title="Open progress" aria-label="Open progress" onClick={onOpen}><Icon name="external" size={14}/></button>
    </details>
  }
  return <div className="chat-detail-content">
    <label className="block text-dim">Work item<select disabled={!!storedLink} aria-label="Conversation work item" className="input mt-1 w-full" value={linked ?? ''} onChange={e => useChatWorkspace.getState().patch(id, { workItem: e.target.value || undefined })}><option value="">Choose a work item</option>{linked && !item && <option value={linked}>Linked work item unavailable</option>}{items.map(record => <option key={record.id} value={record.id}>{record.title}</option>)}</select></label>
    {error && <p role="alert" className="text-err mt-3">Could not refresh progress: {error}. Displayed information may be out of date.</p>}
    {loading ? <p className="text-muted mt-3">Loading…</p> : !linked ? <p className="text-muted mt-3">Link the work item discussed in this conversation to follow its progress.</p> : !item ? <p className="text-muted mt-3">This work item is unavailable.</p> : !flows.length && !error ? <p className="text-muted mt-3">No steps have been recorded for this work item yet.</p> : null}
    {flows.map((flow, index) => <section key={index} aria-label={flow.definition.title} className="mt-4">
      <h3>{flow.definition.title}</h3><p className="text-muted">{flow.definition.steps.filter(step => step.status === 'done').length}/{flow.definition.steps.length} steps accepted</p>
      {flow.definition.steps.map(step => <details className="chat-member" key={step.id} open={['running', 'starting', 'review', 'blocked'].includes(step.status)}>
        <summary><StateBadge state={stepState(step)}/><span className="ml-2">{step.title}</span></summary>
        <p>Agent: {agents.find(agent => 'agent:' + agent.id === step.worker)?.name || step.role || step.actor || step.worker || 'Unassigned'}{step.role ? ` · ${step.role}` : ''}</p>
        {step.needs.length > 0 && <p className="text-muted">After: {step.needs.map(need => flow.definition.steps.find(candidate => candidate.id === need)?.title ?? need).join(', ')}</p>}
        {step.next_action && <p>Next: {step.next_action}</p>}
        {step.evidence ? <div className="chat-progress-evidence whitespace-pre-wrap break-words">{step.evidence}</div> : <p className="text-muted">No evidence recorded yet.</p>}
        {step.run && <button className="chat-icon-button" title="Open run details" aria-label={'Open run for ' + step.title} onClick={() => openChatRun(id, step.run, step.title)}><Icon name="external" size={14}/></button>}
      </details>)}
    </section>)}
  </div>
}
