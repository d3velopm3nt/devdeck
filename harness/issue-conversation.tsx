import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import {SEED} from './seed'
import {useApp} from '../src/store'
import {IssueConversation} from '../src/components/aiw/IssueConversation'
import {Bubble} from '../src/components/aiw/Chat'
import {useChatWorkspace} from '../src/lib/chatWorkspace'
import '../src/index.css'
const h=SEED as Record<string,(args:any)=>any>
const record={id:'issue-one',node:1,title:'Edit design systems beside Chat',status:'queued',source_url:'',description:'',acceptance:'',goal:'',revision:1,runs:[{node:1,workflow:'one',template:''}]}
h.team_board=()=>[];h.aiw_all_work=()=>[];h.aiw_claims=()=>[];h.aiw_agents=()=>[];h.workers_list=()=>[];h.reusable_teams_list=()=>[]
h.work_records_list=()=>[record]
h.issue_monitor_get=()=>({sources:[],bindings:[],dispatches:[]})
h.folder_workflow_list=()=>[{id:'one',title:record.title}]
h.folder_workflow_get=()=>({definition:{title:record.title,steps:[{id:'build',title:'Build editor',worker:'agent:builder',status:'blocked',evidence:'Provider request failed. Earlier work is preserved.',needs:[],previous_runs:[],run:'run-one'}]},raw:'',body:''})
h.message_board=()=>[{id:'report-one',task_id:'issue-one',agent_name:'Builder',from:'builder',source:'workflow',activity_status:'failed',created_at:'2026-10-19T18:00:00Z',subject:'Build editor',body:'The provider request failed. Files are preserved.',run_id:'run-one'},{id:'other',task_id:'issue-two',agent_name:'Verifier',from:'verifier',source:'workflow',activity_status:'done',created_at:'2026-10-19T18:00:00Z',subject:'Other issue report',body:'Other issue only'}]
useApp.setState({nodes:[{id:1,parent_id:null,kind:'project',name:'DevDeck',dir:'.',path:'.',rel_path:'',sort:0,color:null,label:null}]})
function App(){const [id,setId]=useState('issue-one');const w=useChatWorkspace();return <main className="p-4"><button onClick={()=>setId(id==='issue-one'?'issue-two':'issue-one')}>Switch issue</button><p data-testid="panel">{w.tab} {w.subjects[id]?.run?.id}</p><IssueConversation key={id} id={id} workItem={id} messages={[{from:'user',at:'2026-10-19T18:02:00Z',text:'What is blocking this issue?'}]} renderMessage={(m,key)=><Bubble key={key} m={m}/>} /></main>}
createRoot(document.getElementById('root')!).render(<App/> )
