import {createRoot} from 'react-dom/client'
import {useApp} from '../src/store'
import {MachineSetup} from '../src/components/MachineSetup'
import {ConnectionsView} from '../src/components/ConnectionsView'
import {SpaceDetailPage} from '../src/components/SpaceDetailPage'
import {CommunityView} from '../src/components/CommunityView'
import {CalendarPage} from '../src/components/CalendarPage'
import {MailView} from '../src/components/MailView'
import {ContactsView} from '../src/components/ContactsView'
import '../src/index.css'
import '../src/components/ui/design-system.css'
const view=new URLSearchParams(location.search).get('view')||'machine'
useApp.setState({nodes:[{id:1,parent_id:null,kind:'project',name:'Demo space',path:null,rel_path:'',sort:0,color:null,label:null,dir:'',archived:false}] as never,services:[],commands:[],profiles:[],machineLoadedAt:Date.now(),machineAvail:{winget:true,scoop:true},machinePkgs:[],machineWinget:[],machineScoop:[],loadMachine:async()=>{},connections:[{id:1,project_id:1,name:'Demo database',engine:'sqlite',host:'',port:null,database:':memory:',username:'',sort:0,created_at:0,has_password:false}],connSelectedId:1,connSql:'select 1',connStatus:{1:'ok'}})
if(view==='mail'||view==='contacts'){await useApp.getState().refreshMailAccounts();await useApp.getState().refreshMailContacts();await useApp.getState().refreshMail()}
const ui=view==='machine'?<MachineSetup/>:view==='sql'?<ConnectionsView/>:view==='spaces'?<SpaceDetailPage {...({params:{id:1}} as never)}/>:view==='community'?<CommunityView/>:view==='calendar'?<CalendarPage/>:view==='mail'?<MailView/>:<ContactsView/>
createRoot(document.getElementById('root')!).render(<div style={{height:'100vh',minWidth:0}}>{ui}</div>)
