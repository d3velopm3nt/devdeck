import {WorkPage} from '../src/components/work/WorkPage'
import {LegacyWorkRedirect} from '../src/components/team/TeamPage'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { ActivityBoard } from '../src/components/ActivityBoard'
import { useApp } from '../src/store'
import { SEED } from './seed'
import { emit } from './mockTauri'
import type { VisibilitySnapshot } from '../src/lib/visibility'
const fixture = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const now = new Date().toISOString()
const data: VisibilitySnapshot = {
  config_raw: 'version-1', warnings: [], products: [{ id:'devdeck',name:'DevDeck',space:'Develtech',folder:'Work/DevDeck',repository:'d3velopm3nt/devdeck',project_url:'https://github.com/users/d3velopm3nt/projects/17' }],
  sessions: [{ id:'chatgpt-visibility',assistant:'ChatGPT',product_id:'devdeck',space:'Develtech',folder:'Work/DevDeck',title:'Build visibility',status:'working',started_at:now,updated_at:now,ticket_url:'https://github.com/d3velopm3nt/devdeck/issues/8',conversation_url:'',step:'Browser verification',blocker:'',next_action:'Open review PR',checkpoints:[{at:now,summary:'Built board and session linkage',evidence:['https://github.com/d3velopm3nt/devdeck/issues/8']}] },{id:'claude-old',assistant:'Claude',product_id:'devdeck',space:'Develtech',folder:'Work/DevDeck',title:'Review onboarding',status:'working',started_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',ticket_url:'',conversation_url:'',step:'Review',blocker:'',next_action:'Resume review',checkpoints:[]}],
}
let remoteFails = false
let commentsFail = false
fixture.visibility_snapshot = () => structuredClone(data)
fixture.visibility_github_issues = () => { if (remoteFails) throw Error('Repository read failed'); return {fetched_at:now,truncated:false,sessions:[{...data.sessions[0],id:'github:checkpoint',title:'GitHub recorded task',checkpoints:[{at:now,summary:'GitHub checkpoint retained',evidence:[]}]}],warnings:commentsFail ? ['Issues loaded; checkpoint comments could not be refreshed: GitHub request timed out.'] : [],items:[{number:8,title:'Activity board',state:'open',url:'https://github.com/d3velopm3nt/devdeck/issues/8',updated_at:now,assignees:[],pull_request:false},{number:9,title:'Unclaimed GitHub issue',state:'open',url:'https://github.com/d3velopm3nt/devdeck/issues/9',updated_at:now,assignees:[],pull_request:false}]} }
fixture.visibility_products_save = args => { if(args?.expected!==data.config_raw) throw Error('Product links changed. Refresh before saving.'); data.products = args.products as typeof data.products; data.config_raw='version-2' }
fixture.aiw_all_work = () => [{project_id:'1',project_name:'Home',feature_id:'garden',feature_name:'Garden',status:'planned',items:[{id:'weeds',title:'Clear pool weeds',status:'blocked',areas:[]}] }]
fixture.aiw_sessions = () => []
fixture.aiw_agents = () => []
const peerMessages = [{id:'peer-1',from:'orchestrator',to:'reviewer',kind:'request',subject:'Review context loading',body:'Reuse the existing worker model.',reply_to:null,created_at:now,depth:0}]
fixture.manager_team = () => ['orchestrator','reviewer'].map(handle => ({bot:{handle,name:handle === 'orchestrator' ? 'Orchestrator' : 'Reviewer',node_id:1},profile:{peers:[handle === 'orchestrator' ? 'reviewer' : 'orchestrator']},pending:0}))
fixture.manager_messages = () => new URLSearchParams(location.search).has('slow-inbox') ? new Promise(() => {}) : structuredClone(peerMessages)
fixture.manager_message_send = args => { const draft = args?.draft as typeof peerMessages[0]; const message = {...draft,id:'peer-2',from:String(args?.from),created_at:now,depth:0}; peerMessages.push(message); return message }
let chatFails = false
const conversations: Record<string, {at:string;from:string;text:string;by?:string;tool?:string;ok?:boolean}[]> = {}
fixture.manager_conversation = args => structuredClone(conversations[String(args?.handle)] || [])
fixture.manager_turn = args => {
 if(chatFails) throw Error('Fixture manager unavailable')
 const handle = String(args?.handle)
 const appended = [{at:now,from:'user',text:String(args?.text)},{at:now,from:'assistant',by:handle,text:'I will check the existing activity flow. https://github.com/d3velopm3nt/devdeck/issues/11'}]
 conversations[handle] = [...(conversations[handle] || []), ...appended]
 return {conversation_id:handle,reply:appended[1].text,appended,delegated:[],turns:1}
}
Object.assign(window,{__chatFailure:()=>{chatFails=true}})
fixture.open_url = args => { (window as unknown as {__openedUrl:string}).__openedUrl=String(args?.url); return undefined }
useApp.setState({spaceScopeId:null,nodes:[{id:1,parent_id:null,kind:'workspace',name:'Home',rel_path:'Life/Home',dir:'/state/Life/Home',path:null,sort:1,color:null,label:'Personal'}]})
Object.assign(window,{__remoteFailure:()=>{remoteFails=true},__commentFailure:()=>{commentsFail=true},__externalEdit:()=>{data.config_raw='external-revision'},__checkpoint:async()=>{data.sessions[0].next_action='Verify Windows CI';data.sessions[0].checkpoints.push({at:now,summary:'Handoff ready for Claude',evidence:[]});await emit('aiw:event',{type:'session.checkpointed'})}})
if (new URLSearchParams(location.search).has('no-repositories')) data.products = []
if (new URLSearchParams(location.search).has('summary')) {
 data.sessions[0].checkpoints[0].evidence = ['https://github.com/d3velopm3nt/devdeck/pull/16', 'https://github.com/d3velopm3nt/devdeck/pull/19', 'https://github.com/d3velopm3nt/devdeck/pull/16#discussion', 'https://github.com/d3velopm3nt/devdeck/actions/runs/123']
 conversations.orchestrator = [{at:now,from:'user',text:'Verify linked work'}, {at:now,from:'tool',tool:'files.read',ok:true,text:'Read the requirements'}, {at:now,from:'tool',tool:'tests.run',ok:false,text:'One verification failed'}, {at:now,from:'assistant',by:'orchestrator',text:'Two checks recorded.'}]
}
const workMode=new URLSearchParams(location.search).has('work')
if(workMode){
 fixture.team_board=()=>[];fixture.work_records_list=()=>[];fixture.issue_monitor_get=()=>({bindings:[],sources:[],dispatches:[],warnings:[]});fixture.workers_list=()=>[];fixture.reusable_teams_list=()=>[];fixture.aiw_claims=()=>[];fixture.folder_workflow_list=()=>[];
 data.sessions.push({id:'external-unlinked',assistant:'External helper',product_id:'',space:'',folder:'',title:'Unlinked external research',status:'blocked',started_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',ticket_url:'',conversation_url:'https://example.invalid/conversation',step:'Research',blocker:'Waiting for context',next_action:'Review notes',checkpoints:[{at:now,summary:'Unlinked checkpoint retained',evidence:[]}]});
 fixture.aiw_sessions=()=>[{id:'native-run',agent_id:'builder',agent_name:'Builder',role:'worker',project_id:'1',feature_id:'background',status:'working',started_at:now,stale:false,turns:1,context_tokens:0,files_touched:[],summary:'Background native task',transcript:[{at:now,kind:'checkpoint',text:'Native checkpoint retained'}]}];
 if(new URLSearchParams(location.search).has('empty')){data.sessions=[];data.products=[];fixture.aiw_sessions=()=>[];fixture.manager_team=()=>[];fixture.manager_messages=()=>[];}
}
const bridge={navigate:(view:'sessions'|'activity'|'team'|'chat')=>useApp.getState().setRailView(view),direct:(view:'sessions'|'activity')=>useApp.setState({railView:view}),state:()=>({rail:useApp.getState().railView,tab:useApp.getState().teamTab}),empty:()=>{data.sessions=[];fixture.aiw_sessions=()=>[]},failVault:()=>{fixture.visibility_snapshot=()=>{throw Error('Fixture vault unavailable')}}};Object.assign(window,{__workNavigation:bridge});
function WorkFixture(){const rail=useApp(s=>s.railView);return <div style={{height:'100vh'}}>{rail==='sessions'||rail==='activity'?<LegacyWorkRedirect view={rail}/>:rail==='github'?<section><h1>GitHub destination fixture</h1><button onClick={()=>useApp.getState().setTeamTab('history')}>Back to Work history</button></section>:<WorkPage/>}</div>}
createRoot(document.getElementById('root')!).render(workMode?<WorkFixture/>:<ActivityBoard sessionsOnly={new URLSearchParams(location.search).has('sessions')} />)

fixture.chat_open_manager=args=>({id:'manager:'+args?.handle,title:String(args?.handle),messages:conversations[String(args?.handle)]||[]})
fixture.chat_settings=args=>({conversation:args?.conversation,agent_id:'assistant',provider:'fixture-provider',model:'fixture-model',revision:0,scope:'manager agent defaults',capabilities:['text']})
fixture.chat_send_input=args=>fixture.manager_turn({handle:String(args?.conversation).replace('manager:',''),text:(args?.input as any).text})
