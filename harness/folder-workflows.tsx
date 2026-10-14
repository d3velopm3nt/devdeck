import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { FolderWorkflowPage } from '../src/components/FolderWorkflowPage'
import type { FolderWorkflow } from '../src/lib/ipc'
import { SEED } from './seed'
import { emit } from './mockTauri'

const fixture = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const calls: { command: string; args?: Record<string, unknown> }[] = []
const data: FolderWorkflow = {
  raw: 'revision-1', body: 'Keep the documentation accurate.', path: 'C:/State/Marketing/WORKFLOW.md',
  definition: { title: 'Campaign', steps: [
    { id: 'draft', title: 'Draft campaign', worker: 'writer', target: 7, needs: [], instructions: 'Draft the campaign and verify its claims.', status: 'pending', claim: '', run: '', evidence: '', previous_runs: [] },
    { id: 'docs', title: 'Update docs', worker: 'writer', target: 8, needs: ['draft'], instructions: 'Document the accepted campaign.', status: 'pending', claim: '', run: '', evidence: '', previous_runs: [] },
  ] },
}
let revision = 1
const copy = () => structuredClone(data)
const update = async () => {
  data.raw = `revision-${++revision}`
  await emit('aiw:event', { type: 'file.changed', project_id: '7', payload: { source: 'folder_workflow' } })
}
const named = new Map<string, FolderWorkflow>()
const web = copy(); web.definition.title = 'Web release'; web.path = 'C:/State/Marketing/.devdeck/workflows/web-release.md'; web.raw = 'web-revision'; web.definition.steps[0].status = 'done'; web.definition.steps[0].evidence = 'Web evidence only'; named.set('web-release', web)
fixture.folder_workflow_get = args => args?.workflow && args.workflow !== 'default' ? structuredClone(named.get(String(args.workflow)) || { raw: '', definition: { title: '', steps: [] }, body: '', path: `C:/State/Marketing/.devdeck/workflows/${args.workflow}.md` }) : copy()
fixture.folder_workflow_list = () => [{ id: 'default', title: data.definition.title, steps: 2, done: data.definition.steps.filter(s => s.status === 'done').length, error: null }, ...[...named].map(([id, d]) => ({ id, title: d.definition.title, steps: d.definition.steps.length, done: d.definition.steps.filter(s => s.status === 'done').length, error: null }))]
fixture.visibility_snapshot = () => ({ products: [{ id: 'devdeck', name: 'DevDeck', repository: 'owner/devdeck' }], warnings: [], sessions: [], config_raw: '' })
fixture.visibility_github_issues = () => ({ items: [{ number: 23, title: 'Orb test', state: 'open', pull_request: false, assignees: [] }], warnings: [], truncated: false })
fixture.folder_workflow_route = args => {
  calls.push({ command: 'route', args })
  if (args?.expected !== data.raw) throw new Error('The workflow template changed. Reload before routing.')
  const id = 'issue-fixture-23', duplicate = named.has(id)
  if (!duplicate) { const run = copy(); run.definition.title = '#23 · Orb test'; run.definition.ticket_url = 'https://github.com/owner/devdeck/issues/23'; run.raw = 'issue-revision'; named.set(id, run) }
  return { id, duplicate, workflow: structuredClone(named.get(id)) }
}
let monitor = { raw: '', enabled: false, sources: [{ repository: 'owner/devdeck', items: [], fetched_at: '', last_attempt: '', error: '', warnings: [], truncated: false }], warnings: [] }
fixture.issue_monitor_get = () => structuredClone(monitor)
fixture.issue_monitor_save = args => { if (args?.expected !== monitor.raw) throw new Error('Issue monitor settings changed. Reload before saving.'); monitor = { ...monitor, raw: 'monitor-revision', enabled: !!args.enabled }; return structuredClone(monitor) }
fixture.issue_monitor_refresh = () => { monitor.sources[0].fetched_at = '2026-10-14T18:00:00Z'; return structuredClone(monitor) }
fixture.workers_list = () => [{ handle: 'writer', name: 'Writer' }]
fixture.worker_plan = args => {
  calls.push({ command: 'plan', args })
  return { worker: { handle: 'writer', name: 'Writer' }, folder: 'C:/State/Marketing', skills: [], minutes: 10, usd: 2, is_repo: false, ready: true, note: '' }
}
fixture.folder_workflow_start = args => {
  calls.push({ command: 'start', args })
  if (args?.expected !== data.raw) throw new Error('The workflow changed. Reload before starting.')
  const step = data.definition.steps.find(s => s.id === args?.step)!
  step.status = 'running'; step.run = `run-${step.id}`
  void update()
  return copy()
}
fixture.folder_workflow_review = args => {
  calls.push({ command: 'review', args })
  const step = data.definition.steps.find(s => s.id === args?.step)!
  step.status = args?.accept ? 'done' : 'blocked'; step.evidence = String(args?.evidence)
  void update()
  return copy()
}
fixture.folder_workflow_checkpoint = args => {
  calls.push({ command: 'checkpoint', args })
  if (args?.expected !== data.raw) throw new Error('The workflow changed. Reload before recording progress.')
  const step = data.definition.steps.find(s => s.id === args?.step)!
  step.actor = String(args?.actor); step.evidence = String(args?.evidence); step.next_action = String(args?.nextAction)
  step.status = args?.submit ? 'review' : 'blocked'
  void update()
  return copy()
}
fixture.folder_workflow_save = args => {
  calls.push({ command: 'save', args })
  if (args?.expected !== data.raw) throw new Error('This workflow changed. Reload before saving.')
  return copy()
}
Object.assign(window, {
  __workflowCalls: calls,
  __complete: async () => { data.definition.steps[0].status = 'review'; data.definition.steps[0].evidence = 'Draft and checks ready.'; await update() },
  __externalEdit: update,
})
createRoot(document.getElementById('root')!).render(<FolderWorkflowPage node={7} name="Marketing" onDashboard={() => {}} />)
