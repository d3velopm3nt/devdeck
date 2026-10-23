import { NotificationOverlay } from '../src/widget/NotificationOverlay'
import { createRoot } from 'react-dom/client'
import { NotificationCenter } from '../src/components/NotificationCenter'
import { SEED } from './seed'
import { emit } from './mockTauri'
import '../src/index.css'
const f=SEED as Record<string,(a?:Record<string,unknown>)=>unknown>
let rows=JSON.parse(localStorage.getItem('test-notices')||'[]')
let popups:any[]=[]
f.notification_popup_list=()=>structuredClone(popups)
f.notification_popup_push=async a=>{const n=a?.notice as any;popups=[n,...popups.filter(x=>x.id!==n.id)].slice(0,3);await emit('devdeck:popup-changed',null)}
f.notification_popup_dismiss=async a=>{popups=a?.id?popups.filter(n=>n.id!==a.id):[];await emit('devdeck:popup-changed',null)}
f.notification_popup_layout=()=>{}
f.notifications_list=()=>structuredClone(rows)
f.notification_read=a=>{rows=rows.map((n:any)=>n.id===a?.id&&n.event_id===a?.eventId?{...n,unread:false}:n);localStorage.setItem('test-notices',JSON.stringify(rows))}
f.setting_get=a=>localStorage.getItem(String(a?.key))
f.setting_set=a=>localStorage.setItem(String(a?.key),String(a?.value))
;(window as any).pushNotice=async(kind='approval',source='example/project')=>{const n={id:source+':'+kind,event_id:crypto.randomUUID(),source,title:kind==='info'?'Dev started work':'Work is ready for review',body:'Documentation changes passed checks and await your review.',kind,target:'inbox',at:new Date().toISOString(),count:1,unread:true};rows=[n,...rows.filter((x:any)=>x.id!==n.id)];localStorage.setItem('test-notices',JSON.stringify(rows));await emit('devdeck:notification',n)}
f.notification_test=()=> (window as any).pushNotice()
createRoot(document.getElementById('root')!).render(<div style={{padding:24,display:'flex',justifyContent:'flex-end'}}><NotificationCenter /><div style={{position:"fixed",bottom:16,right:16,width:370}}><NotificationOverlay /></div></div>)
