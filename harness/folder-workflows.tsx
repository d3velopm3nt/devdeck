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
fixture.folder_workflow_get = copy
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
