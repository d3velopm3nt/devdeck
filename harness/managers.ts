// Synthetic Life/Personal/Business scenario. Imported ONLY by the browser harness.
import { SEED } from './seed'
import type { Bot, ManagerMessage, ManagerProfile, TeamMember, Worker } from '../src/lib/ipc'
const now=new Date().toISOString()
const node=(id:number,name:string,parent_id:number|null,label:string)=>({id,name,parent_id,label,kind:parent_id==null?'workspace':'project',path:null,rel_path:'',sort:id,color:null,dir:`/sandbox/${name}`})
const nodes=[node(101,'Life',null,'Personal'),node(102,'Personal',null,'Personal'),node(103,'Business',null,'Business'),node(104,'Northstar Studio',103,'Company')]
const bot=(handle:string,name:string,node_id:number,goal:string):Bot=>({handle,name,node_id,node_name:nodes.find(n=>n.id===node_id)!.name,dir:'/sandbox',goal,every:'',at_min:480,days:'',body:'',skills:[],template:'',feature:'weekly-plan',agent:'orchestrator',team:['orchestrator'],wake_intent:'',stop_at:[],schedule_id:null,last_woke:null,worker:''})
const profile=(domain:string,role:string,responsibilities:string[],peers:string[]):ManagerProfile=>({revision:1,domain,role,responsibilities,boundaries:['Ask before spending, sending externally or changing commitments.','Share summaries only; do not copy private records across spaces.'],peers,workers:domain==='business'?['builder','reviewer']:[]})
const team:TeamMember[]=[
 {bot:bot('life','Life coordinator',101,'Keep a realistic balance between commitments, family time and business delivery.'),profile:profile('life','Life coordinator',['Prepare the daily top three priorities','Identify conflicting commitments','Coordinate agreed summaries with other managers'],['business','personal']),pending:0},
 {bot:bot('personal','Personal manager',102,'Keep home, family and learning tasks moving at a sustainable pace.'),profile:profile('personal','Home & personal manager',['Maintain the home task list','Protect family commitments','Track learning routines'],['life']),pending:0},
 {bot:bot('business','Business manager',104,'Deliver the weekly product milestone with reviewed evidence.'),profile:profile('business','Delivery manager',['Break outcomes into small tasks','Route work to specialists','Review results and escalate blockers'],['life']),pending:0},
]
const worker=(handle:string,name:string,what:string):Worker=>({handle,name,what,brief:'',skills:[],kit:'',runner:'claude-code',model:'sonnet',writes:'branch',minutes:20,usd:2,spaces:[103],unattended:false,allow:[],allow_until:'',created_at:now,body:''})
const workers=[worker('builder','Builder','Implement small, testable product changes'),worker('reviewer','Reviewer','Verify acceptance criteria and inspect evidence')]
let messages:ManagerMessage[]=[{id:'seed-1',from:'life',to:'business',kind:'request',subject:'Protect tomorrow’s family time',body:'Can the product review finish by 16:00? Share timing and blockers only.',reply_to:null,created_at:now,depth:0}]
const chats:Record<string,unknown[]>={}
const publish=(type:string,payload:unknown)=>{void (window as unknown as {__emit:(name:string,payload:unknown)=>Promise<void>}).__emit('aiw:event',{id:`event-${Date.now()}`,seq:1,type,category:'Workspace',timestamp:now,depth:0,payload})}
const send=(from:string,draft:Omit<ManagerMessage,'id'|'from'|'created_at'|'depth'>)=>{
 const a=team.find(t=>t.bot.handle===from)!,b=team.find(t=>t.bot.handle===draft.to)!
 if(!a?.profile.peers.includes(draft.to)||!b?.profile.peers.includes(from))throw new Error('Both managers must list each other as communication peers. Nothing was sent.')
 const msg={...draft,from,id:`mock-${messages.length+1}`,created_at:new Date().toISOString(),depth:draft.reply_to?1:0}
 messages.push(msg);publish('manager.message.delivered',{message_id:msg.id,from,to:msg.to});return msg
}
Object.assign(SEED,{
 tree_list:()=>nodes,vault_scan:()=>nodes,focus_current:()=>null,
 bots_list:()=>team.map(t=>t.bot),bot_get:({handle}:any)=>team.find(t=>t.bot.handle===handle)?.bot??null,
 bot_for_node:({nodeId}:any)=>team.find(t=>t.bot.node_id===nodeId)?.bot??null,
 manager_team:()=>team.map(t=>({...t,pending:messages.filter(m=>m.to===t.bot.handle&&m.kind!=='acknowledgement'&&!messages.some(r=>r.reply_to===m.id)).length})),
 manager_profile_save:({handle,profile}:any)=>{const t=team.find(t=>t.bot.handle===handle)!;if(profile.revision!==t.profile.revision)throw new Error('This manager changed. Reload before saving.');if(!profile.role.trim()||!profile.responsibilities.length)throw new Error('Give this manager a role and at least one responsibility.');t.profile={...profile,revision:profile.revision+1};publish('manager.profile.changed',{handle});return t.profile},
 manager_messages:({handle}:any)=>messages.filter(m=>m.from===handle||m.to===handle),
 manager_message_send:({from,draft}:any)=>send(from,draft),
 manager_conversation:({handle}:any)=>chats[handle]??[],
 manager_turn:({handle,text}:any)=>{
  const pending=messages.find(m=>m.to===handle&&m.kind!=='acknowledgement'&&!messages.some(r=>r.reply_to===m.id))
  const reply=pending?'Mock agent: the review can finish by 15:00. Builder and reviewer remain within their task budgets.':'Mock agent: I will prepare three priorities and ask before changing commitments.'
  const appended=[{at:now,from:'user',text},{at:now,from:'assistant',by:`bot:${handle}`,text:reply}]
  chats[handle]=[...(chats[handle]??[]),...appended]
  if(pending)send(handle,{to:pending.from,kind:'reply',subject:`Re: ${pending.subject}`,body:reply,reply_to:pending.id})
  return {conversation_id:handle,reply,appended,delegated:[],turns:1}
 },
 bot_set_worker:({handle,worker}:any)=>{team.find(t=>t.bot.handle===handle)!.bot.worker=worker},
 workers_list:()=>workers,worker_starters:()=>[],runs_list:()=>[],library_list:()=>[],
 bot_create:({nodeId,name,goal}:any)=>{const b=bot(name.toLowerCase().replace(/\W+/g,'-'),name,nodeId,goal);team.push({bot:b,profile:{revision:0,domain:'',role:'',responsibilities:[],boundaries:[],peers:[],workers:[]},pending:0});return b},
 bot_plan:()=> 'weekly-plan',
 team_board:()=>[],
 stash_counts:()=>({all:0,pinned:0,notes:0,screenshots:0,clips:0,code:0,links:0,errors:0,secrets:0,types:[],projects:[],tags:[]}),
 calls_usage:()=>({since:0,calls:0,unreported:0,input:0,output:0,cache_read:0,cache_write:0,by_space:[],by_speaker:[],by_model:[],by_day:[]}),
})
;(window as any).__managerScenario={team,send,resetMessages:()=>{messages=[]},pending:()=>messages}
