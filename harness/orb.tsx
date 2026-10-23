import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { OrbSettings } from '../src/components/orb/OrbSettings'
import { AssistantThread } from '../src/components/thread/AssistantThread'
import { SEED } from './seed'
const fixture=SEED as Record<string,(args?:Record<string,unknown>)=>unknown>
const messages=[{from:'assistant',text:'Ready for your next idea.',at:new Date().toISOString()}]
const calls:unknown[]=[]
Object.assign(window,{__orbCalls:calls})
fixture.setting_get=args=>localStorage.getItem(String(args?.key))
fixture.setting_set=args=>{localStorage.setItem(String(args?.key),String(args?.value));return null}
fixture.aiw_agents=()=>[{id:'assistant',name:'Dev',provider:'chatgpt-subscription',model:'default',role:'orchestrator',skills:[],permissions:{},system:''}]
fixture.thread_context=()=>({parts:[],tools:[],system_tokens:0,context_tokens:0,tool_tokens:0,history_turns:0,history_tokens:0,total_tokens:0})
fixture.aiw_conversations=()=>[{id:'orb-thread',title:'Dev',preview:'Ready',node:null,bot_node:null,feature:null}]
fixture.aiw_conversation=()=>({id:'orb-thread',title:'Dev',participants:[],messages:[...messages]})
fixture.aiw_send_message=async args=>{calls.push(args);messages.push({from:'user',text:String(args?.text),at:new Date().toISOString()});await new Promise(r=>setTimeout(r,120));messages.push({from:'assistant',text:'Received '+args?.text,at:new Date().toISOString()});return {}}
function App(){const [appearance,setAppearance]=useState(true);return <main className="h-screen bg-page p-6 text-body"><div className="mb-4 flex gap-3"><button className="btn-ghost" onClick={()=>setAppearance(true)}>Appearance</button><button className="btn-ghost" onClick={()=>setAppearance(false)}>Conversation</button></div><div className="h-[calc(100%-55px)]">{appearance?<OrbSettings/>:<AssistantThread/>}</div></main>}
createRoot(document.getElementById('root')!).render(<App/>);
