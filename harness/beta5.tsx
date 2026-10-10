import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SEED } from './seed'
import { AgentDirectory } from '../src/components/agents/AgentDirectory'
import { ProductGitHub } from '../src/components/business/ProductGitHub'
import { DefaultProvider } from '../src/components/aiw/DefaultProvider'
import { useApp } from '../src/store'
import { useAiw } from '../src/lib/aiwStore'
import { emit } from './mockTauri'
import './managers'
const f = SEED as Record<string,(a?: Record<string,unknown>) => unknown>
const fixtureNodes = f.vault_scan() as ReturnType<typeof useApp.getState>["nodes"]
const scenario = new URLSearchParams(location.search).get('scenario')
const calls: {command:string,args?:Record<string,unknown>}[]=[]
Object.assign(window,{__beta5Calls:calls,__event:emit})
const record = (command:string, result:unknown) => (args?:Record<string,unknown>) => {calls.push({command,args}); return result}
const repo = {full_name:'fixture/demo',name:'demo',owner:'fixture',description:'',private:true,updated_at:'',language:'',clone_url:'https://github.com/fixture/demo.git',html_url:'https://github.com/fixture/demo'}
f.visibility_snapshot = () => ({products:[],sessions:[],warnings:[],config_raw:''})
f.product_github_projects = () => { if(scenario === 'project-denied') throw Error('Projects permission denied'); return [{id:'p1',title:'Demo backlog',url:'https://github.com/users/fixture/projects/1'}] }
f.product_github_create_repo = record('create-repo',repo)
f.product_github_create_project = () => { throw Error('Project write permission denied') }
f.product_github_connect = record('connect-product',{node_id:100,name:'demo',path:'/demo',reused:false,commands:0,services:0})
f.vault_scan = () => useApp.getState().nodes
f.aiw_providers = () => [['mock','Mock',{configured:true,detail:''}],['openai','Fixture model',{configured:true,detail:''}]]
f.aiw_models = () => ({models:[], cached:false, source:'fixture'})
f.aiw_model_check = () => ({ok:scenario !== 'model-failed',detail:'Fixture verification failed'})
f.aiw_provider_defaults = () => ({provider:'openai',model:'fixture-model',inherited:[]})
f.aiw_default_provider_set = record('default-provider',null)
f.library_list = () => []
f.library_kits = () => []
f.runs_list = () => []
f.aiw_agents = () => [{id:'assistant',name:'Assistant',role:'Assistant',provider:'openai',model:'fixture-model',system:'',permissions:{},skills:[]},{id:'qa',name:'QA agent',role:'QA',provider:'openai',model:'fixture-model',system:'',permissions:{},skills:[]}]
f.aiw_sessions = () => []
useApp.setState({nodes:fixtureNodes,spaceScopeId:null})
useAiw.setState({agents:f.aiw_agents() as ReturnType<typeof useAiw.getState>['agents'],sessions:[]})
const workers = f.workers_list() as unknown[]
f.worker_save = args => {calls.push({command:'save-worker',args}); const w=args?.worker as {name:string,handle:string}; w.handle=w.name.toLowerCase().replace(/\W+/g,'-'); workers.push(w); return w}
const botCreate = f.bot_create
f.bot_create = args => {calls.push({command:'create-manager',args}); return botCreate(args)}
createRoot(document.getElementById('root')!).render(scenario?.startsWith('model') ? <DefaultProvider /> : scenario === 'agents' ? <AgentDirectory /> : <ProductGitHub business={103} product={104} name="Demo" login="fixture" repos={[repo]} onChanged={() => {}} />)
