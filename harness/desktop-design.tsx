import { createRoot } from 'react-dom/client'
import { Today } from '../src/components/Today'
import { ConfigPage } from '../src/components/ConfigPage'
import { DeckLogo } from '../src/widget/DeckLogo'
import { Rail } from '../src/shell/Rail'
import { useApp } from '../src/store'
import { useAiw } from '../src/lib/aiwStore'
import { SEED } from './seed'
import '../src/index.css'
const f=SEED as Record<string,(a?:Record<string,unknown>)=>unknown>
f.issue_monitor_get=()=>({enabled:true,briefings:true,dispatch_enabled:false,dispatches:[{repository:'example/product',number:33,node:1,status:'review',workflow:'Documentation',message:'Ready for human review.'}],sources:[{repository:'example/product',items:[{number:33,title:'Documentation is ready for review',state:'open',pull_request:true,updated_at:'2026-10-17T13:00:00Z'}],fetched_at:'2026-10-17T13:00:00Z',last_attempt:'',error:'',warnings:[],truncated:false,activity:{commits:[],pulls:[],warnings:[],error:''},briefing:{text:'The documentation update is ready for your review. No work will be merged automatically.',generated_at:'2026-10-17T13:00:00Z',unread:true}}],warnings:[],bindings:[],raw:''})
f.runs_list=()=>[];f.calendar_range=()=>[];f.schedules_list=()=>[]
f.setting_get=a=>localStorage.getItem(String(a?.key))
f.setting_set=a=>localStorage.setItem(String(a?.key),String(a?.value))
f.notification_test=a=>{(window as any).lastTest=a}
useAiw.setState({ready:true,approvals:[],conflicts:[],sessions:[]})
useApp.setState({railView:'today',nodes:[],mailCounts:{unread:3} as any})
function Preview(){const view=useApp(s=>s.railView);return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><header style={{height:40,display:'flex',alignItems:'center',gap:8,padding:'0 16px',borderBottom:'1px solid var(--c-line)',flexShrink:0}}><DeckLogo size={21}/><strong>DevDeck</strong><span style={{marginLeft:'auto',fontSize:10,color:'var(--c-muted)'}}>DESIGN VERIFICATION · SAMPLE DATA</span><button onClick={()=>useApp.setState({railView:'settings',settingsTab:'notifications'})}>Notifications</button></header><div style={{display:'flex',flex:1,minHeight:0}}><Rail/><div style={{flex:1,minWidth:0}}>{view==='today'?<Today/>:view==='settings'?<ConfigPage/>:<div style={{padding:30}}>{view}<button onClick={()=>useApp.setState({railView:'today'})}>Back to Today</button></div>}</div></div></div>}
createRoot(document.getElementById('root')!).render(<Preview/>);
