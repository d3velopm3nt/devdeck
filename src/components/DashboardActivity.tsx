import { useShallow } from 'zustand/react/shallow'
import { FilterTabs, StateBadge } from './ui/DesignSystem'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../lib/icons'
import { useApp } from '../store'
import { useRepositoryActivity } from './GitHubPage'
import { openRun } from '../lib/dock'
import { ago } from '../lib/aiw'
import type { Run } from '../lib/ipc'

const activityFilters: { id: string; label: string; icon: IconName }[] = [
 {id:'all',label:'All',icon:'history'}, {id:'github',label:'GitHub',icon:'github'},
 {id:'tasks',label:'Tasks',icon:'check'}, {id:'mail',label:'Mail',icon:'mail'},
]
type Entry={id:string;title:string;source:string;group:string;at:string;icon:IconName;status:string;open:()=>void}
export function DashboardActivity({runs}:{runs:Run[]}){
 const {data,error}=useRepositoryActivity()
 const app=useApp(useShallow(s=>({mailCounts:s.mailCounts,mailAccounts:s.mailAccounts,refreshMailAccounts:s.refreshMailAccounts,setRailView:s.setRailView})));const [filter,setFilter]=useState('all')
 const refreshMailAccounts=app.refreshMailAccounts
 useEffect(()=>{void refreshMailAccounts().catch(()=>{})},[refreshMailAccounts])
 const entries:Entry[]=[]
 for(const s of data?.sources||[]){
  for(const i of s.items){const d=data?.dispatches.find(d=>d.repository===s.repository&&d.number===i.number);entries.push({id:s.repository+':'+i.number,title:i.title,source:s.repository+' · '+(i.pull_request?'Pull request':'Issue'),group:'github',at:i.updated_at,icon:'github',status:d?.status||i.state,open:()=>{sessionStorage.setItem('devdeck.github.selection',s.repository+':'+i.number);app.setRailView('github')}})}
  for(const pull of s.activity?.pulls||[]){const id=s.repository+':'+pull.number;const existing=entries.findIndex(e=>e.id===id);if(existing>=0)entries.splice(existing,1);entries.push({id,title:pull.title,source:s.repository+' · Pull request',group:'github',at:pull.updated_at,icon:'github',status:pull.checks==='failed'?'failed':pull.state,open:()=>{sessionStorage.setItem('devdeck.github.selection',id);app.setRailView('github')}})}
  for(const c of s.activity?.commits||[])entries.push({id:s.repository+':'+c.sha,title:c.title.split('\n')[0],source:s.repository+' · Commit',group:'github',at:c.updated_at,icon:'commit',status:'committed',open:()=>{sessionStorage.setItem('devdeck.github.selection',s.repository+':'+c.sha);app.setRailView('github')}})
 }
 for(const r of runs)entries.push({id:'run:'+r.id,title:r.title,source:r.worker_name+' · '+r.space,group:'tasks',at:r.ended_at||r.started_at,icon:'check',status:r.status,open:()=>openRun(r.id,r.title)})
 if(app.mailCounts)entries.push({id:'mail-summary',title:app.mailCounts.unread+' unread messages',source:'Mail · Open your inbox',group:'mail',at:'',icon:'mail',status:'inbox',open:()=>app.setRailView('mail')})
 const visible=entries.filter(e=>filter==='all'||e.group===filter).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0))
 return <section className="today-activity"><header><h2><Icon name="history" size={18}/>Activity</h2><FilterTabs label="Activity source" options={activityFilters} value={filter} onChange={setFilter}/></header>{error&&<p role="status" className="today-note">Repository activity unavailable. Other activity remains available.</p>}{<div className="today-activity-scroll" role="region" aria-label="Activity list" tabIndex={0}>{visible.map(e=><button className="today-activity-row" key={e.id} onClick={e.open}><Icon name={e.icon} size={18}/><span><strong>{e.title}</strong><small>{e.source}</small></span><StateBadge state={e.status}/><time>{e.at?ago(e.at):'Inbox'}</time><Icon name="chevron-right" size={14}/></button>)}</div>}{!visible.length&&<div className="today-empty"><Icon name={filter==='mail'?'mail':'history'} size={22}/><strong>{filter==='mail'?'Your mail, in one place':'No activity to show yet'}</strong><p>{filter==='mail'?'Open Mail to connect or sync your inbox.':'Saved repository updates and task runs will appear here.'}</p>{filter==='mail'&&<button onClick={()=>app.setRailView('mail')}>Open Mail <Icon name="chevron-right" size={13}/></button>}</div>}</section>
}
export function DashboardConnections(){
 const {data}=useRepositoryActivity();const app=useApp(useShallow(s=>({mailCounts:s.mailCounts,mailAccounts:s.mailAccounts,refreshMailAccounts:s.refreshMailAccounts,setRailView:s.setRailView})))
 return <section className="today-connections"><h2>Connections</h2>{[{icon:'github' as IconName,label:'GitHub',detail:data?`${data.sources.length} repositories · ${data.enabled?'monitoring':'paused'}`:'Loading…',view:'github' as const},{icon:'mail' as IconName,label:'Mail',detail:app.mailAccounts.length?`${app.mailAccounts.length} accounts`:'Connect an account',view:'mail' as const},{icon:'check' as IconName,label:'DevDeck tasks',detail:'Your work and goals',view:'team' as const}].map(c=><button key={c.label} onClick={()=>app.setRailView(c.view)}><Icon name={c.icon} size={18}/><span><strong>{c.label}</strong><small>{c.detail}</small></span><Icon name="chevron-right" size={13}/></button>)}</section>
}
