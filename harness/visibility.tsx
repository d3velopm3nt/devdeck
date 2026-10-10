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
fixture.visibility_snapshot = () => structuredClone(data)
fixture.visibility_github_issues = () => { if (remoteFails) throw Error('Repository read failed'); return {fetched_at:now,truncated:false,sessions:[],warnings:[],items:[{number:8,title:'Activity board',state:'open',url:'https://github.com/d3velopm3nt/devdeck/issues/8',updated_at:now,assignees:[],pull_request:false},{number:9,title:'Unclaimed GitHub issue',state:'open',url:'https://github.com/d3velopm3nt/devdeck/issues/9',updated_at:now,assignees:[],pull_request:false}]} }
fixture.visibility_products_save = args => { if(args?.expected!==data.config_raw) throw Error('Product links changed. Refresh before saving.'); data.products = args.products as typeof data.products; data.config_raw='version-2' }
fixture.aiw_all_work = () => [{project_id:'1',project_name:'Home',feature_id:'garden',feature_name:'Garden',status:'planned',items:[{id:'weeds',title:'Clear pool weeds',status:'blocked',areas:[]}] }]
fixture.aiw_sessions = () => []
fixture.aiw_agents = () => []
useApp.setState({spaceScopeId:null,nodes:[{id:1,parent_id:null,kind:'workspace',name:'Home',rel_path:'Life/Home',dir:'/state/Life/Home',path:null,sort:1,color:null,label:'Personal'}]})
Object.assign(window,{__remoteFailure:()=>{remoteFails=true},__externalEdit:()=>{data.config_raw='external-revision'},__checkpoint:async()=>{data.sessions[0].next_action='Verify Windows CI';data.sessions[0].checkpoints.push({at:now,summary:'Handoff ready for Claude',evidence:[]});await emit('aiw:event',{type:'session.checkpointed'})}})
createRoot(document.getElementById('root')!).render(<ActivityBoard sessionsOnly={new URLSearchParams(location.search).has('sessions')} />)
