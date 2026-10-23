import type { AgentDef, FeatureWork, GoalRow, WorkClaim } from './aiw'
import type { FolderWorkflow, IssueDispatch, IssueMonitorView, WorkRecord, Worker } from './ipc'

export interface WorkflowEntry { node: number; id: string; folder: string; view: FolderWorkflow }
/** Presentation levels only; the native validator owns dependency validity. */
export function stepLevels(steps: FolderWorkflow['definition']['steps']): Map<string, number> {
  const levels = new Map<string, number>()
  for (let pass = 0; pass < steps.length; pass++) for (const item of steps) {
    if (levels.has(item.id) || item.needs.some(id => !levels.has(id))) continue
    levels.set(item.id, item.needs.length ? Math.max(...item.needs.map(id => levels.get(id)!)) + 1 : 0)
  }
  return levels
}
export interface WorkCard {
  record: WorkRecord; kind: 'local' | 'legacy' | 'github' | 'workflow'; externalState?: string
  legacy?: { project: string; feature: string; item: string }; workflows: WorkflowEntry[]
  claim?: WorkClaim
  intake?: string
  dispatch?: IssueDispatch
}
export const goalKey = (goal: GoalRow) => `${goal.node_id}:${goal.feature_id}`
export function isTemplate(entry: WorkflowEntry): boolean {
  return !entry.id.startsWith('work-run-') && !entry.view.definition.ticket_url && entry.view.definition.steps.length > 0 && entry.view.definition.steps.every(s => s.status === 'pending' && !s.run && !s.claim && !s.previous_runs?.length)
}
function base(id: string, node: number, title: string): WorkRecord { return { id, node, title, description:'', acceptance:'', goal:'', source_url:'', status:'queued', revision:0, runs:[] } }
export function workState(card: WorkCard): WorkRecord['status'] {
  if (card.record.status === 'completed' || card.record.status === 'blocked') return card.record.status
  if (card.claim) return 'working'
  const steps = card.workflows.flatMap(w => w.view.definition.steps)
  if (steps.some(s => s.status === 'starting' || s.status === 'running')) return 'working'
  if (steps.some(s => s.status === 'review')) return 'review'
  if (steps.some(s => s.status === 'blocked')) return 'blocked'
  // Accepted runs do not by themselves satisfy a work item's acceptance criteria.
  if (steps.some(s => s.status === 'done')) return 'working'
  if (!steps.length && card.dispatch) {
    if (card.dispatch.status === 'blocked') return 'blocked'
    if (card.dispatch.status === 'review') return 'review'
    if (['selecting','running','done'].includes(card.dispatch.status)) return 'working'
  }
  return card.record.status
}
export function assembleWork(records: WorkRecord[], legacy: FeatureWork[], monitor: IssueMonitorView | null, workflows: WorkflowEntry[], claims: WorkClaim[] = []): WorkCard[] {
  const cards = new Map<string, WorkCard>()
  for (const feature of legacy) for (const item of feature.items) {
    const record = base(`legacy:${feature.project_id}:${feature.feature_id}:${item.id}`, Number(feature.project_id), item.title)
    record.goal = `${feature.project_id}:${feature.feature_id}`
    record.status = item.status === 'done' ? 'completed' : item.status === 'blocked' ? 'blocked' : ['in-progress','working','running'].includes(item.status) ? 'working' : 'queued'
    const claim = claims.find(c => c.status === 'active' && c.project_id === feature.project_id && c.feature_id === feature.feature_id && c.work_item_id === item.id)
    cards.set(record.id, { record, kind:'legacy', claim, legacy:{ project:feature.project_id, feature:feature.feature_id, item:item.id }, workflows:[] })
  }
  for (const source of monitor?.sources || []) for (const issue of source.items) {
    const url = `https://github.com/${source.repository}/issues/${issue.number}`
    const stored = records.find(r => r.source_url === url)
    const linked = workflows.some(w => w.view.definition.ticket_url === url)
    const dispatch = monitor?.dispatches.find(d => d.repository === source.repository && d.number === issue.number)
    // Discovery is visible before assignment; closed unassigned issues and PRs are not intake.
    if (!stored && !linked && (issue.pull_request || issue.state.toLowerCase() !== 'open')) continue
    const binding = monitor?.bindings.find(b => b.repository === source.repository)
    const intake = !stored && !linked && !dispatch?.workflow
      ? dispatch?.message || (!binding ? 'Waiting for project assignment' : !monitor?.enabled ? 'Issue monitoring paused' : !monitor?.dispatch_enabled ? 'Automatic pickup paused' : binding.issues?.length && !binding.issues.includes(issue.number) ? 'Outside the configured issue scope' : dispatch?.status === 'selecting' ? 'Dev is selecting the planning process' : 'Waiting for automatic pickup')
      : undefined
    const record = base(stored?.id || `github:${source.repository.toLowerCase()}:${issue.number}`, dispatch?.node || monitor?.bindings.find(b => b.repository === source.repository)?.node || 0, issue.title)
    record.source_url = url
    record.description = issue.body || `Imported request from ${source.repository}. GitHub state: ${issue.state}.`
    cards.set(record.id, { record, kind:'github', intake, dispatch, externalState:issue.state, workflows:[] })
  }
  for (const record of records) {
    const previous = cards.get(record.id)
    cards.set(record.id, { ...previous, record:previous?.kind === 'legacy' ? { ...record, status:previous.record.status } : record, kind:previous?.kind || 'local', workflows:[] })
  }
  const linked = new Set<string>()
  for (const card of cards.values()) {
    card.workflows = workflows.filter(w => card.record.id === `workflow:${w.node}:${w.id}` || card.record.runs.some(r => r.node === w.node && r.workflow === w.id) || (!!card.record.source_url && w.view.definition.ticket_url === card.record.source_url))
    for (const w of card.workflows) linked.add(`${w.node}:${w.id}`)
  }
  for (const workflow of workflows) {
    if (isTemplate(workflow) || linked.has(`${workflow.node}:${workflow.id}`)) continue
    const source = workflow.view.definition.ticket_url || ''
    const previous = source ? [...cards.values()].find(c => c.record.source_url === source) : undefined
    if (previous) { previous.workflows.push(workflow); continue }
    const github = source.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/i)
    const record = base(github ? `github:${github[1].toLowerCase()}:${github[2]}` : `workflow:${workflow.node}:${workflow.id}`, workflow.node, workflow.view.definition.title)
    record.source_url = workflow.view.definition.ticket_url || ''
    record.description = workflow.view.body
    cards.set(record.id, { record, kind:github ? 'github' : 'workflow', workflows:[workflow] })
  }
  return [...cards.values()]
}

/** Native workflow steps create private feature records to host their runtime. */
export function isExecutionGoal(goal: GoalRow): boolean {
  return /^native_[a-z0-9-]+$/i.test(goal.feature_name) && !!goal.goal?.includes('Execute this workflow step using your existing model connection and native DevDeck tools.')
}

/** Read-only projection for team and workflow selectors; native editing stays in Library. */
export function modelWorker(agent: AgentDef): Worker {
  return {handle:`agent:${agent.id}`,name:agent.name,what:agent.role,brief:'',skills:agent.skills,kit:'',runner:agent.provider,model:agent.model,writes:agent.permissions.files === 'full' ? 'folder' : 'read',minutes:5,usd:0,spaces:[],unattended:false,allow:[],allow_until:'',created_at:'',body:agent.system}
}

export function stepState(step: FolderWorkflow['definition']['steps'][number]): string {
  return step.status === 'blocked' && step.next_action === 'Address the review notes and submit again.' ? 'changes_requested' : step.status
}

export function workDisplayState(card: WorkCard): string {
  const state = workState(card)
  const blocked = card.workflows.flatMap(w => w.view.definition.steps).filter(s => s.status === 'blocked')
  return state === 'blocked' && blocked.length > 0 && blocked.every(s => stepState(s) === 'changes_requested') ? 'changes_requested' : state
}
