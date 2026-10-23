import {ScopedChat} from '../src/components/thread/ScopedChat'
import {useApp} from '../src/store'
import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { useAiw } from '../src/lib/aiwStore'
import { AssistantThread } from '../src/components/thread/AssistantThread'
import factory from '../factories/software-factory/team.json'
import '../src/index.css'
const now = new Date().toISOString()
const convs = [{ id:'existing-build',title:'Existing team discussion',started_at:now,updated_at:now,messages:[{at:now,from:'assistant',text:'Let us refine the team.'}] },{id:'research',title:'Research discussion',started_at:now,updated_at:now,messages:[]}]
const team = {id:'saved-team',name:'Research team',description:'One agent with skills',revision:7,roles:[{name:'lead',kind:'manager',worker:'agent:researcher',reports_to:'',instructions:'Research carefully'}]}
const handlers = SEED as Record<string,(a:any)=>any>
handlers.aiw_conversations=()=>convs.map(c=>({...c,preview:c.messages.at(-1)?.text || ''}))
handlers.aiw_conversation=({id})=>convs.find(c=>c.id===id)
handlers.aiw_new_conversation=()=>{ const c={id:crypto.randomUUID(),title:'New conversation',started_at:now,updated_at:now,messages:[]};convs.push(c);return c }
handlers.aiw_personal_root=()=> 'Personal workspace'
handlers.thread_context=()=>({parts:[],tools:[],system_tokens:0,context_tokens:0,tool_tokens:0,history_turns:0,history_tokens:0,total_tokens:0})
handlers.aiw_assistant_context=()=> 'Active skills: evidence-driven-testing. Repository: devdeck. Branch: testing/desktop. Environment: local. Team attachment does not grant permissions.'
handlers.reusable_teams_list=()=>[team,factory]
handlers.library_agents=()=>[{id:'runtime:researcher',name:'Researcher',execution:'model',instructions:'Research carefully',skills:['evidence-driven-testing'],configuration:{provider:'chatgpt-subscription',model:'default',permissions:{shell:'ask'}}}]
handlers.aiw_team_planner_send=async ({conversationId,text,team:attached})=>{ await new Promise(r=>setTimeout(r,250));const reply=JSON.stringify({message:attached === factory.id ? 'Keep the five roles and review their handoffs.' : 'Keep the existing researcher and clarify its responsibility.',choices:['Refine the role','Add a specialist'],proposal:{name:attached === factory.id ? 'Software Factory refinement' : 'Refined research team',description:attached === factory.id ? factory.description : 'Research and report',members:attached === factory.id ? factory.roles.map(r => ({role:r.name,name:r.name,kind:r.kind,reports_to:r.reports_to,instructions:r.instructions,worker:r.worker})) : [{role:'lead',name:'Researcher',kind:'manager',reports_to:'',instructions:'Research and produce sourced reports',worker:attached ? 'agent:researcher' : ''}]}});const c=convs.find(c=>c.id===conversationId)!;c.messages.push({at:now,from:'user',text},{at:now,from:'assistant',text:reply});return {reply,delegated:[]} }
handlers.aiw_send_message=async ({conversationId,text})=>{await new Promise(r=>setTimeout(r,600));const c=convs.find(c=>c.id===conversationId)!;c.messages.push({at:now,from:'user',text},{at:now,from:'assistant',text:'Work is recorded in this conversation.'});return {reply:'Work is recorded in this conversation.',delegated:[]}}
let stale = false
Object.assign(window,{setStale:(value:boolean)=>{stale=value},getTeam:()=>team})
handlers.team_builder_create=({proposal})=>{Object.assign(window,{lastSave:proposal});if(stale || (proposal.target && proposal.target.revision!==team.revision))throw new Error('This team changed. Reload it and review a fresh proposal before saving.');if(proposal.target) {team.name=proposal.name;team.revision++;team.roles=proposal.members.map((m:any)=>({name:m.role,...m}));return team}return {...team,id:proposal.id,name:proposal.name,revision:1} }
useAiw.setState({ready:true,agents:[{id:'assistant',name:'Dev',role:'assistant',provider:'chatgpt-subscription',model:'default',system:'',skills:['evidence-driven-testing'],permissions:{shell:'ask'}}],tools:[{id:'shell',name:'Shell',description:'Run commands with approval'}],projects:[{id:'devdeck',name:'DevDeck',root:'D:/devdeck',branch:'testing/desktop',features:0,active_agents:0,open_conflicts:0}]})
createRoot(document.getElementById('root')!).render(<>{new URLSearchParams(location.search).has('scope')&&<ScopedChat node={7} name="Fixture project"/>}<AssistantThread/></>)

const workflowSteps = [
 {id:'build',title:'Build the change',worker:'Builder',target:1,needs:[],instructions:'',status:'done',claim:'',run:'',evidence:'Implementation complete.',previous_runs:[]},
 {id:'verify',title:'Verify the rendered design',worker:'Verifier',target:1,needs:['build'],instructions:'',status:'running',claim:'',run:'fixture-run',evidence:'Inspecting sidebar layout and keyboard navigation.',previous_runs:[]},
 {id:'review',title:'Review evidence',worker:'Reviewer',target:1,needs:['verify'],instructions:'',status:'pending',claim:'',run:'',evidence:'',previous_runs:[]},
]
handlers.work_records_list=()=>[{id:'workflow-test',node:1,title:'Verify Teams navigation',description:'',acceptance:'',goal:'',source_url:'',status:'working',revision:1,runs:[{node:1,workflow:'navigation',template:'factory'}]}]
useApp.setState({nodes:[{id:1,parent_id:null,kind:'project',name:'DevDeck',path:null,rel_path:'DevDeck',dir:'fixture',sort:0,color:null,label:null}]})
handlers.folder_workflow_list=()=>[{id:'navigation',title:'Teams navigation review',steps:3,done:1,error:''}]
handlers.folder_workflow_get=()=>({raw:'',body:'',path:'fixture',definition:{title:'Teams navigation review',steps:workflowSteps}})
Object.assign(window,{finishWorkflow:()=>workflowSteps.forEach(step=>{step.status='done';step.evidence='Fixture review accepted.'})})

handlers.worker_asks=()=>[]
handlers.run_get=()=>({id:'fixture-run',worker:'agent:verifier',worker_name:'Verifier',title:'Verify the rendered design',space:'DevDeck',folder:'D:/fixture/devdeck',branch:'test',status:'done',started_at:now,seconds:12,minutes_limit:5,usd:0,usd_limit:0,ok:true,skills:['visual-review'],files:[],intent:'Check the actual rendered layout.',verdict:'Layout checked. Human review remains required.',steps:[{at:now,kind:'note',text:'Inspected the sidebar, focus order and status labels.'}]})

// Unified chat boundary fixtures: no account access, probes or agent-default writes.
const settings=new Map<string,any>(JSON.parse(localStorage.getItem('unified-fixture-settings')||'[]')),requests:any[]=[]
let failSend=false,failSelection=false
const config=(id:string)=>settings.get(id)||{conversation:id,agent_id:'assistant',provider:'fixture-provider',model:'pinned-model',revision:0,scope:'agent defaults / pinned conversation',capabilities:['text','user-selected-text-files','url-reference','installed-skills']}
handlers.chat_settings=({conversation})=>structuredClone(config(conversation))
handlers.aiw_providers=()=>[['fixture-provider','Fixture provider']]
handlers.aiw_models=()=>({models:[{id:'pinned-model',name:'Pinned model'},{id:'new-model',name:'New model'}],live:false,note:'Fixture catalogue'})
handlers.aiw_skills=()=>[{name:'review-evidence',description:'Fixture installed skill',body:'Verify actual evidence.'}]
handlers.chat_select_model=({conversation,expected,provider,model})=>{if(failSelection)throw Error('Fixture selection failure');const old=config(conversation);if(expected!==old.revision)throw Error('Conversation settings changed');const value={...old,provider:provider||'fixture-provider',model:model||'agent-default-model',revision:old.revision+1,scope:provider?'conversation':'agent defaults'};settings.set(conversation,value);localStorage.setItem('unified-fixture-settings',JSON.stringify([...settings]));return value}
handlers.chat_send_input=async({conversation,input})=>{requests.push(structuredClone({conversation,input}));if(failSend)throw Error('Fixture send failure');if(input.context.some((c:any)=>c.kind==='image'))throw Error('Unsupported image');if(input.skills.some((s:string)=>s!=='review-evidence'))throw Error('Installed skill unavailable');return handlers.aiw_send_message({conversationId:conversation,text:input.text})}
handlers.node_thread=()=>{requests.push({kind:'scope-open'});let c=convs.find(c=>c.id==='scoped-project');if(!c){c={id:'scoped-project',title:'Fixture project discussion',started_at:now,updated_at:now,messages:[]} as any;Object.assign(c!,{node:7,project_id:'7'});convs.push(c!)}return c}
Object.assign(window,{__unified:{requests,settings,failSend:(value:boolean)=>{failSend=value},failSelection:(value:boolean)=>{failSelection=value},agent:()=>useAiw.getState().agents.find(a=>a.id==='assistant')}})

useAiw.setState(state=>({agents:[...state.agents,{id:'verifier',name:'Verifier',role:'worker',provider:'fixture-provider',model:'agent-default-model',system:'',skills:[],permissions:{}}]}))
