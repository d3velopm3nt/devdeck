import { createRoot } from 'react-dom/client'
import { ProcessDashboard } from '../src/components/ProcessDashboard'
import { ServiceDetailPage } from '../src/components/ServiceDetailPage'
import { useApp } from '../src/store'
import { useLive } from '../src/liveStore'
import type { IDockviewPanelProps } from 'dockview-react'
import type { SvcState } from '../src/lib/types'
import { onSvcStatus } from '../src/lib/ipc'
import { emit } from './mockTauri'
import '../src/index.css'
const service = {id:91001, project_id:null, name:'Outside worker', command:'node worker.cjs', cwd:'C:/example',env:'{}',auto_restart:true,health_port:null,shell:''}
const state: SvcState = {id:service.id,name:service.name,pid:42123,status:'running',exit_code:null,started_at:Math.floor(Date.now()/1000)-45,ephemeral:false,external:true}
useApp.setState({services:[service],nodes:[],svcStates:{[service.id]:state},recents:[]})
useLive.setState({stats:[{kind:'service',id:service.id,name:service.name,pid:42123,cpu:2.5,mem_mb:32,uptime_secs:45,ports:[43127],procs:1,cwd:service.cwd,tool:'node'}]})
void onSvcStatus(s=>useApp.getState().updateSvcState(s))
Object.assign(window,{externalStopped:async()=>{useLive.setState({stats:[]});await emit('svc:status',{...state,status:'stopped',pid:null,started_at:null,external:false})}})
createRoot(document.getElementById('root')!).render(<main><section style={{height:260}}><ProcessDashboard /></section><ServiceDetailPage {...({params:{id:service.id}} as IDockviewPanelProps<{id:number}>)} /></main>)
