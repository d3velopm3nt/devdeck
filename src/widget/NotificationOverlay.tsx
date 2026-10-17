import { DeckLogo } from './DeckLogo'
import { Icon } from '../lib/icons'
import { NoticeIdentity, noticeIdentity } from '../components/NoticeIdentity'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { focusMain } from '../lib/ipc'
import type { Notice } from '../components/NotificationCenter'
import '../components/notifications.css'

export function NotificationOverlay() {
  const [cards,setCards]=useState<Notice[]>([])
  const panel=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    let alive=true;let off:undefined|(()=>void)
    const deadlines=new Map<string,number>()
    const refresh=async()=>{
      const next=await invoke<Notice[]>('notification_popup_list')
      if(!alive)return
      for(const n of next)if(!deadlines.has(n.event_id))deadlines.set(n.event_id,Date.now()+15_000)
      setCards(next)
    }
    void listen('devdeck:popup-changed',()=>void refresh()).then(fn=>{
      if(!alive){fn();return}off=fn;void refresh()
    })
    const timer=setInterval(()=>{
      for(const [event,deadline] of deadlines)if(Date.now()>deadline){
        deadlines.delete(event)
        // Match the event as well as the group so an update gets its full lifetime.
        void invoke<Notice[]>('notification_popup_list').then(rows=>{
          const n=rows.find(n=>n.event_id===event)
          if(n)void invoke('notification_popup_dismiss',{id:n.id})
        })
      }
    },500)
    return()=>{alive=false;off?.();clearInterval(timer)}
  },[])
  useEffect(()=>{
    const element=panel.current;if(!element)return
    const resize=()=>void invoke('notification_popup_layout',{height:element.scrollHeight+16})
    const observer=new ResizeObserver(resize);observer.observe(element);resize()
    return()=>observer.disconnect()
  },[cards])
  const open=async(n:Notice)=>{
    await emitTo('main','devdeck:notification-open',n)
    await focusMain()
    await invoke('notification_popup_dismiss',{id:n.id})
  }
  return <div className="notification-root notification-overlay" ref={panel}>
    <div className="notification-stack" aria-live="polite">{cards.map(n=><article key={n.id}>
      <button className="notification-dismiss" aria-label="Dismiss alert" onClick={()=>void invoke('notification_popup_dismiss',{id:n.id})} title="Dismiss alert"><Icon name="close" size={14} /></button>
      <div className="notice-byline"><DeckLogo size={17} /><span>Dev</span><span className="notice-kind">{(noticeIdentity[n.kind] || noticeIdentity.info).label}</span></div><div className="notice-title"><NoticeIdentity kind={n.kind} /><strong>{n.title}</strong></div><p>{n.body}</p><small className="notice-source">{n.source}</small>
      <button className="notice-action" onClick={()=>void open(n)}>{(noticeIdentity[n.kind] || noticeIdentity.info).action}<Icon name="chevron-right" size={13} /></button>
    </article>)}</div>
  </div>
}
