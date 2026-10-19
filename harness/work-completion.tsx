import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { useApp } from '../src/store'
import { WorkItemDetail } from '../src/components/work/WorkItemDetail'
import { MessageBoard } from '../src/components/MessageBoard'
import { useTeamNavigation } from '../src/lib/teamNavigation'
import type { WorkCard } from '../src/lib/workHub'
import '../src/index.css'
import '../src/components/work/work-page.css'
import '../src/components/agents/workforce.css'

const title='Plan progress and handoff documentation'
let card: WorkCard = {kind:'github', record:{id:'github:owner/devdeck:37',node:3,title,description:'Deliver a plan only; implementation is outside this request.',acceptance:'Plan reviewed with evidence.',goal:'',source_url:'https://github.com/owner/devdeck/issues/37',status:'working',revision:0,runs:[]},workflows:[{node:3,id:'test-plan',folder:'DevDeck',view:{raw:'v1',body:'',path:'',definition:{title,team:'factory',ticket_url:'https://github.com/owner/devdeck/issues/37',steps:['Plan','Build','Verify'].map((title,i)=>({id:title.toLowerCase(),title,worker:'lead',target:3,needs:i?['plan']:[],instructions:'Deliver the request',status:i?'pending':'done',run:i?'':'run-plan',claim:'',previous_runs:[],evidence:i?'':'Plan reviewed and accepted.'}))}}}]}
const nodes=[{id:3,parent_id:null,kind:'project' as const,name:'DevDeck',path:'.',rel_path:'.',dir:'.',sort:0,color:null,label:null}]
const teams=[{id:'factory',name:'Software Factory',description:'Build and verify',revision:1,roles:[]}]
const handlers=SEED as Record<string,(a:any)=>any>
const calls: any[]=[]
handlers.work_record_complete=({record,exclusions,reason})=>{calls.push({command:'complete',exclusions,reason});card={...card,record:{...record,status:'completed',revision:1,completion_note:reason,github_sync:'failed',github_sync_error:'Fixture: GitHub unavailable.'}};for(const s of card.workflows[0].view.definition.steps)if(exclusions.some((x:any)=>x.step===s.id)){s.status='skipped';s.evidence='Outside request scope: '+reason}return card.record}
handlers.work_record_sync=()=>{calls.push({command:'sync'});card={...card,record:{...card.record,revision:2,github_sync:'closed',github_sync_error:''}};return card.record}
handlers.work_records_list=()=>[]
handlers.reusable_teams_list=()=>teams
handlers.manager_team=()=>[]
handlers.message_board=()=>[{id:'factory-run',source:'workflow',kind:'activity',from:'agent:lead',agent_name:'Factory Manager',to:'work-item',subject:title+' · Plan',body:'Accepted planning report. No implementation was performed.',created_at:'2026-10-18T17:00:00Z',reply_to:null,depth:0,project_id:'3',team_id:'factory',task_id:card.record.id,task_title:title,activity_status:'done',outcome:'recorded',run_id:'run-plan'}]
useApp.setState({nodes,spaceScopeId:null})
useTeamNavigation.setState({team:'',teams})
Object.assign(window,{__completionCalls:calls})
function App(){const [version,setVersion]=useState(0);return <main className="workforce" key={version}><div className="wf-content">{location.search.includes('messages')?<MessageBoard embedded/>:<WorkItemDetail card={card} nodes={nodes} goals={[]} workers={[]} teams={teams} workflows={card.workflows} onClose={()=>{}} onGoal={()=>{}} onChanged={()=>setVersion(v=>v+1)}/>}</div></main>}
createRoot(document.getElementById('root')!).render(<App/> )
