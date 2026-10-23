import {createRoot} from 'react-dom/client'
import {CommunityView} from '../src/components/CommunityView'
import {useAiw} from '../src/lib/aiwStore'
import {SEED} from './seed'
import '../src/index.css'
import '../src/components/ui/design-system.css'
const rows=['memory','filesystem'].map(name=>({id:name,kind:'tool',name:'MCP '+name,summary:'Fixture '+name+' tool',author:'Fixture publisher',source:'fixture',licence:'permissive',version:'1.0.0',body:'',role:'',tool_id:'mcp.'+name,command:'',stars:null,gained:null,installed:true,standing:{id:name,kind:'tool',name:'MCP '+name,version:'1.0.0',source:'fixture',licence:'permissive',at:0,files:[],reach:[],days:0,idle:false,blocked:''}}))
const calls:unknown[]=[]
Object.assign(window,{permissionCalls:calls})
Object.assign(SEED,{community_catalog:()=>rows,community_arrange:()=>rows,community_servers:()=>[],community_index:()=>[],community_grant:(args:unknown)=>{calls.push(args)},library_list:()=>[]})
useAiw.setState({agents:new URLSearchParams(location.search).has('empty')?[]:[{id:'demo-agent',name:'Demo agent'}] as never})
document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'vercel'
createRoot(document.getElementById('root')!).render(<div style={{height:'100vh'}}><CommunityView/></div>)
