import {createRoot} from 'react-dom/client'
import {SEED} from './seed'
import {RunView} from '../src/components/workers/RunPage'
import '../src/index.css'
const now=new Date().toISOString();const handlers=SEED as Record<string,(a:any)=>any>;
handlers.run_get=()=>({id:'fixture-run',worker:'agent:verifier',worker_name:'Verifier',title:'Verify the rendered design',space:'DevDeck',folder:'D:/fixture/devdeck',branch:'test',status:'done',started_at:now,seconds:12,minutes_limit:5,usd:0,usd_limit:0,ok:true,skills:['visual-review'],files:[],intent:'Check the actual rendered layout.',verdict:'Layout checked. Human review remains required.',steps:[{at:now,kind:'note',text:'Inspected the sidebar, focus order and status labels.'}]})
createRoot(document.getElementById('root')!).render(<div style={{width:380,height:850}}><RunView id='fixture-run' compact/></div>)