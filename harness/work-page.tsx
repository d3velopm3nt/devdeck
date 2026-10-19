import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { useApp } from '../src/store'
import { WorkPage } from '../src/components/work/WorkPage'
import type { WorkRecord, FolderWorkflow, Worker, ReusableTeam } from '../src/lib/ipc'
import '../src/index.css'

const calls: { command: string; args: Record<string, unknown> }[] = []
let records: WorkRecord[] = []
const workflows = new Map<string, FolderWorkflow>()
const roles = ['lead','builder','verifier','reviewer','pr-manager']
const team: ReusableTeam = { id:'factory', name:'Software Factory', description:'Build with independent verification', revision:1, roles:roles.map((name,i) => ({ name, worker:name, kind:i ? 'worker' : 'manager', reports_to:i ? 'lead' : '', handoffs:[], instructions:'' })) }
const workers = roles.map(handle => ({ handle, name:handle, skills:[], category:'worker', runner:'claude-code', model:'sonnet' })) as Worker[]
function makeWorkflow(title: string, entries = ['Plan','Build','Verify','Review','Prepare PR']): FolderWorkflow {
  const steps = entries.map((title,i) => ({ id:`step-${i}`, title, worker:roles[i], role:roles[i], target:3, needs:i === 0 ? [] : i === 3 ? ['step-1'] : i === 4 ? ['step-2','step-3'] : [`step-${i-1}`], instructions:`${title} the agreed request and record evidence.`, status:'pending' as const, claim:'', run:'', evidence:'', previous_runs:[] }))
  const definition = { title, team:'factory', steps }
  return { definition, body:'# Outcome\nDeliver the accepted request with evidence.', raw:`---\n${JSON.stringify(definition)}\n---\n\n# Outcome\nDeliver the accepted request with evidence.`, path:`fixture/${title}.md` }
}
workflows.set('3:factory', makeWorkflow('Deliver a feature'))
workflows.set('3:docs', makeWorkflow('Documentation review', ['Draft','Review']))
const handlers = SEED as Record<string, (args: Record<string, unknown>) => unknown>
handlers.team_board = () => [{ node_id:3, space:'DevDeck', workspace:'Product', feature_id:'goal-one', feature_name:'Improve delivery visibility', status:'planned', goal:'Make work understandable at a glance', on_it:[], participants:[], items_total:1, items_done:0, items_blocked:0, items_unclaimed:1, waiting:0, conflicts:0 }]
handlers.aiw_all_work = () => [{ project_id:'3', project_name:'DevDeck', feature_id:'goal-one', feature_name:'Improve delivery visibility', status:'planned', items:[{ id:'legacy-one', title:'Existing request survives', status:'pending', areas:[] }] }]
handlers.work_records_list = () => structuredClone(records)
handlers.workers_list = () => workers
handlers.reusable_teams_list = () => [team]
handlers.runs_list = () => []
handlers.issue_monitor_get = () => ({ raw:'{}', enabled:true, briefings:true, dispatch_enabled:false, warnings:[], bindings:[{repository:'owner/devdeck',node:3,issues:[36]}], dispatches:[{repository:'owner/devdeck',number:36,node:3,workflow:'',status:'pending',message:''}], sources:[{ repository:'owner/devdeck', items:[{ number:36, title:'Software Factory lifecycle pilot', state:'open', body:'## Request\nDocument the observed lifecycle.', url:'https://github.com/owner/devdeck/issues/36', updated_at:'', assignees:[], pull_request:false }], fetched_at:'', last_attempt:'', error:'', warnings:[], truncated:false }] })
handlers.folder_workflow_list = args => [...workflows.entries()].filter(([key]) => key.startsWith(`${args.node}:`)).map(([key,value]) => ({ id:key.split(':')[1], title:value.definition.title, steps:value.definition.steps.length, done:value.definition.steps.filter(s => s.status === 'done').length, error:null }))
handlers.folder_workflow_get = args => structuredClone(workflows.get(`${args.node}:${args.workflow}`) || { definition:{title:'',steps:[]}, raw:'',body:'',path:'' })
handlers.work_record_save = args => {
  calls.push({ command:'save', args })
  const item = structuredClone(args.record as WorkRecord)
  const old = records.find(r => r.id === item.id)
  if ((old?.revision || 0) !== args.expected) throw new Error('This work item changed. Reload before saving.')
  if (item.status === 'completed' && item.runs.some(link => workflows.get(`${link.node}:${link.workflow}`)?.definition.steps.some(s => s.status !== 'done'))) throw new Error('Accept or resolve the attached workflow steps before completing this work item.')
  item.revision = Number(args.expected) + 1; records = [...records.filter(r => r.id !== item.id), item]; return structuredClone(item)
}
handlers.work_record_attach = args => {
  calls.push({ command:'attach', args })
  const item = records.find(r => r.id === args.id)!
  if (item.revision !== args.expected) throw new Error('This work item changed. Reload before attaching.')
  const source = workflows.get(`${args.node}:${args.template}`)!
  if (source.raw !== args.templateExpected) throw new Error('The workflow template changed.')
  const name = `work-run-${args.request}`
  const copy = structuredClone(source); copy.definition.title = `${item.title} · ${copy.definition.title}`
  workflows.set(`${args.node}:${name}`, copy)
  item.runs.push({ node:Number(args.node), workflow:name, template:String(args.template) }); item.revision++
  return structuredClone(item)
}
handlers.folder_workflow_review = args => {
  calls.push({command:'review',args})
  const value=workflows.get(`${args.node}:${args.workflow}`)!
  if(value.raw!==args.expected)throw new Error('The workflow changed. Reload before reviewing.')
  const step=value.definition.steps.find(s=>s.id===args.step)!
  if(step.status!=='review'||!String(args.evidence).trim())throw new Error('Review evidence is required')
  step.status=args.accept?'done':'blocked'
  return structuredClone(value)
}
handlers.folder_workflow_parse = args => JSON.parse(String(args.raw).split('\n---\n')[0].slice(4))
handlers.folder_workflow_save = args => {
  calls.push({ command:'template-save', args })
  const key = `${args.node}:${args.workflow}`
  if ((workflows.get(key)?.raw || '') !== args.expected) throw new Error('This workflow changed. Reload before saving.')
  const definition = JSON.parse(String(args.raw).split('\n---\n')[0].slice(4))
  const value = { definition, raw:String(args.raw), body:String(args.raw).split('\n---\n').slice(1).join('\n---\n'), path:`fixture/${args.workflow}.md` }
  workflows.set(key,value); return structuredClone(value)
}
useApp.setState({ teamTab:'work', spaceScopeId:null, nodes:[{ id:3,parent_id:null,kind:'project',name:'DevDeck',path:'.',rel_path:'Product/DevDeck',dir:'.',sort:0,color:null,label:null }] })
Object.assign(window, { __workCalls:calls, __workRecords:() => records, __workFlows:() => [...workflows.entries()], __setRunState:async (status: string) => { for (const [key,value] of workflows) if (key.includes(':work-run-')) value.definition.steps.forEach((step,i) => { step.status = (status === 'done' || i === 0 ? status : 'pending') as typeof step.status }); const emit = (window as unknown as {__emit:(name:string,payload:unknown)=>Promise<void>}).__emit; await emit('aiw:event',{type:'FileChanged',project_id:'3',payload:{source:'folder_workflow'}}) } })
createRoot(document.getElementById('root')!).render(<WorkPage/>)
