import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { useApp } from '../src/store'
import { TeamsNavigation } from '../src/shell/TeamsNavigation'
import { openTeamView } from '../src/lib/teamNavigation'
import { AgentDirectory } from '../src/components/agents/AgentDirectory'
import { WorkPage } from '../src/components/work/WorkPage'
import '../src/index.css'
import '../src/shell/rail.css'
const handlers = SEED as Record<string,(a:any)=>any>
const teams = [{id:'factory',name:'Software Factory',description:'Build and verify',revision:1,roles:[{name:'lead',worker:'lead',instructions:'Coordinate delivery'}]},{id:'research',name:'Research',description:'Investigate',revision:1,roles:[{name:'researcher',worker:'agent:researcher',instructions:'Find evidence'}]}]
const base = {created_at:'2026-10-18T10:00:00Z',kind:'request',reply_to:null,depth:0,from:'lead',to:'reviewer',body:'Review the evidence'}
let messages = JSON.parse(localStorage.getItem('fixture-messages') || 'null') || [{...base,id:'factory-request',subject:'Verify delivery',team_id:'factory',task_id:'task-factory'},{...base,id:'research-request',subject:'Research sources',team_id:'research',task_id:'task-research'},{...base,id:'legacy-request',subject:'Older unlinked request'}]
const tasks = teams.map(t => ({id:'task-'+t.id,node:t.id==='factory'?1:2,title:t.id==='factory'?'Build dashboard':'Research competitors',description:'',acceptance:'',goal:'',source_url:'',status:'queued',revision:1,runs:[{node:t.id==='factory'?1:2,workflow:'run-'+t.id,template:''}]}))
handlers.reusable_teams_list=()=>teams
handlers.library_agents=()=>[{id:'worker:lead',name:'Lead',instructions:'Coordinate',skills:['planning'],execution:'cli',configuration:{}},{id:'runtime:researcher',name:'Researcher',instructions:'Investigate',skills:['research'],execution:'model',configuration:{}}]
handlers.manager_team=()=>['lead','reviewer'].map(handle=>({bot:{handle,name:handle==='lead'?'Lead':'Reviewer'},profile:{peers:[handle==='lead'?'reviewer':'lead']}}))
handlers.message_board=()=>[...messages,...(new URLSearchParams(location.search).has('dev-activity') ? [{...base,id:'dev-delegation',source:'conversation',from:'assistant',to:'work-thread',kind:'activity',subject:'Agent delegation · Documentation check',body:'Started verifier on documentation check.',project_id:'1',conversation_id:'test-chat',outcome:'recorded'},{...base,id:'dev-failed',source:'conversation',from:'verifier',to:'work-thread',kind:'activity',subject:'Agent report · Documentation check',body:'Verifier could not finish.',project_id:'1',conversation_id:'test-chat',outcome:'failed'}] : [])]
handlers.work_records_list=()=>tasks
handlers.manager_message_send=({from,draft})=>{const parent=messages.find((m:any)=>m.id===draft.reply_to);const m={...base,...draft,from,id:crypto.randomUUID(),team_id:parent?.team_id||draft.team_id,task_id:parent?.task_id||draft.task_id};messages.push(m);localStorage.setItem('fixture-messages',JSON.stringify(messages));return m}
handlers.team_board=()=>[];handlers.aiw_all_work=()=>[];handlers.aiw_claims=()=>[];handlers.aiw_agents=()=>[];handlers.workers_list=()=>[]
handlers.issue_monitor_get=()=>({sources:[],bindings:[],dispatches:[],warnings:[],raw:'',enabled:false})
handlers.folder_workflow_list=({node})=>[{id:node===1?'run-factory':'run-research',title:'Delivery',steps:1,done:0,error:null}]
handlers.folder_workflow_get=({node})=>({definition:{title:'Delivery',team:node===1?'factory':'research',steps:[{id:'one',title:'Plan',worker:'lead',role:'lead',needs:[],status:'pending',run:'',claim:'',previous_runs:[]}]},body:'',raw:'',path:''})
useApp.setState({railView:'team',spaceScopeId:null,teamTab:'messages',nodes:[{id:1,parent_id:null,kind:'project',name:'DevDeck',path:'.',rel_path:'.',dir:'.',sort:0,color:null,label:null},{id:2,parent_id:null,kind:'project',name:'Research project',path:'.',rel_path:'.',dir:'.',sort:1,color:null,label:null}]})
export function App(){const view=useApp(s=>s.railView);return <div className="flex h-full"><nav className="border-r border-line p-3 shrink-0" style={{width:230}}><button className="btn-ghost" onClick={()=>openTeamView('','messages')}>All messages</button><TeamsNavigation expanded/></nav><div className="min-w-0 flex-1 overflow-auto">{view==='workers'?<AgentDirectory/>:<WorkPage/>}</div></div>}
createRoot(document.getElementById('root')!).render(<App/> )
