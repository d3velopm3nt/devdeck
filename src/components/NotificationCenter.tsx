import { Icon } from '../lib/icons'
import { NoticeIdentity } from './NoticeIdentity'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { onDeckSettingsChanged } from '../lib/ipc'
import { loadDeckSettings, saveDeckSettings, inQuietHours } from '../lib/deck'
import { playDeckSound } from '../lib/deckUpdates'
import type { DeckEventKind } from '../lib/deck'
import { useApp } from '../store'
import { openRun } from '../lib/dock'
import { NeedsYouBell } from '../shell/TopBarStatus'
import './notifications.css'

export interface Notice { id:string; event_id:string; source:string; title:string; body:string; kind:string; target:string; at:string; count:number; unread:boolean }

const workKey=(n:Notice)=>'work:'+n.id.slice(0,n.id.lastIndexOf(':'))

export function NotificationCenter() {
  const [rows,setRows]=useState<Notice[]>([])
  const [open,setOpen]=useState(false)
  const [error,setError]=useState('')
  const [testKind,setTestKind]=useState('approval')
  const [testStatus,setTestStatus]=useState('')
  const [level,setLevel]=useState('attention')
  const [muted,setMuted]=useState<string[]>([])
  const pending=useRef(new Map<string,Notice>())
  const panel=useRef<HTMLDivElement>(null)
  const load=async()=>setRows(await invoke<Notice[]>('notifications_list'))
  useEffect(()=>{
    let alive=true
    let dispose:undefined|(()=>void)
    let revision=0
    const lastAlert=new Map<string,number>()
    let disposeSettings:undefined|(()=>void)
    const deliver=async(n:Notice,summary=false)=>{
      const settings=await loadDeckSettings()
      if(!alive || settings.notificationLevel==='off' || inQuietHours(settings) || settings.mutedNotifications.includes(n.source) || settings.mutedNotifications.includes(workKey(n)) || settings.mutedSpaces.includes(n.source)) return
      if(settings.notificationLevel==='attention' && n.kind==='info') return
      if(Date.now()-(lastAlert.get(n.id)??0)<30_000)return
      lastAlert.set(n.id,Date.now())
      if(settings.notificationLevel==='summary' && !summary) {pending.current.set(n.id,n);return}
      if(settings.popups) await invoke('notification_popup_push',{notice:n})
      const kind:DeckEventKind=['info','alert','approval','blocker'].includes(n.kind)?n.kind as DeckEventKind:'info'
      if(settings.sounds[kind]) playDeckSound(kind)
      if(!settings.popups && settings.windowsNotifications && !document.hasFocus() && await isPermissionGranted()) sendNotification({title:n.title,body:n.body.slice(0,240)})
    }
    void (async()=>{
      dispose=await listen<Notice>('devdeck:notification',e=>{
        if(!alive)return
        revision++
        setRows(old=>[e.payload,...old.filter(n=>n.id!==e.payload.id)].slice(0,300))
        void deliver(e.payload).catch(e=>alive&&setError(String(e)))
      })
      if(!alive){dispose();return}
      disposeSettings=await onDeckSettingsChanged(()=>{void loadDeckSettings().then(s=>{if(alive){setLevel(s.notificationLevel);setMuted(s.mutedNotifications);void invoke('notification_popup_dismiss',{id:null});pending.current.clear()}}).catch(e=>alive&&setError(String(e)))})
      if(!alive){disposeSettings();return}
      const initialRevision=revision
      const [saved,settings]=await Promise.all([invoke<Notice[]>('notifications_list'),loadDeckSettings()])
      if(alive){if(initialRevision===revision)setRows(saved);setLevel(settings.notificationLevel);setMuted(settings.mutedNotifications)}
    })().catch(e=>alive&&setError(String(e)))
    const timer=window.setInterval(()=>{
      const notices=[...pending.current.values()];pending.current.clear()
      if(notices.length) void deliver({...notices[0],id:'summary',title:`${notices.length} DevDeck updates`,body:'Open the notification centre to review your updates.',target:'notifications'},true).catch(e=>alive&&setError(String(e)))
    },15*60_000)
    return()=>{alive=false;dispose?.();disposeSettings?.();clearInterval(timer)}
  },[])
  useEffect(()=>{
    if(!open)return
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)}
    const outside=(e:MouseEvent)=>{if(!panel.current?.contains(e.target as Node))setOpen(false)}
    document.addEventListener('keydown',escape);document.addEventListener('mousedown',outside)
    return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('mousedown',outside)}
  },[open])
  const read=async(n:Notice)=>{await invoke('notification_read',{id:n.id,eventId:n.event_id});await load()}
  const visit=(n:Notice)=>{
    void invoke('notification_popup_dismiss',{id:n.id})
    if(n.target==='notifications'){setOpen(true);return}
    void read(n).catch(e=>setError(String(e)))
    setOpen(false)
    if(n.target.startsWith('run:'))openRun(n.target.slice(4),n.title)
    else if(n.target.startsWith('repo:')){sessionStorage.setItem('devdeck.github.selection',n.target.slice(5)+':briefing');useApp.getState().setRailView('github')}
    else useApp.getState().setRailView('inbox')
  }
  useEffect(()=>{
    let disposed=false;let off:undefined|(()=>void)
    void listen<Notice>('devdeck:notification-open',e=>visit(e.payload)).then(fn=>{if(disposed)fn();else off=fn})
    return()=>{disposed=true;off?.()}
  },[])
  const changeLevel=async(value:string)=>{
    const s=await loadDeckSettings();s.notificationLevel=value as typeof s.notificationLevel
    await saveDeckSettings(s);setLevel(value);void invoke('notification_popup_dismiss',{id:null});pending.current.clear()
  }
  const mute=async(source:string)=>{
    const s=await loadDeckSettings();s.mutedNotifications=s.mutedNotifications.includes(source)?s.mutedNotifications.filter(x=>x!==source):[...s.mutedNotifications,source]
    await saveDeckSettings(s);setMuted(s.mutedNotifications);await invoke('notification_popup_dismiss',{id:null})
  }
  const run=(action:Promise<unknown>)=>void action.catch(e=>setError(String(e)))
  return <div className="notification-root" ref={panel}>
    <NeedsYouBell />
    <button aria-label="Notifications" aria-expanded={open} onClick={()=>setOpen(!open)} title="Notification centre"><Icon name="history" size={16} />{rows.some(n=>n.unread)&&<b>{rows.filter(n=>n.unread).length}</b>}</button>
    {open&&<section className="notification-panel" aria-label="Notification centre">
      <header><strong>Dev’s updates</strong><span>Saved history</span><button aria-label="Close notifications" onClick={()=>setOpen(false)}>×</button></header>
      <div className="notification-controls"><select aria-label="Notification level" value={level} onChange={e=>run(changeLevel(e.target.value))}><option value="off">Off</option><option value="attention">Needs my attention</option><option value="summary">Summary · 15 minutes</option><option value="all">All activity</option></select><button onClick={()=>{setOpen(false);useApp.getState().setSettingsTab('notifications');useApp.getState().setRailView('settings')}}>Settings</button></div>
      <small><select aria-label="Test alert category" value={testKind} onChange={e=>setTestKind(e.target.value)}><option value="info">Information</option><option value="alert">Failure</option><option value="approval">Approval</option><option value="blocker">Blocker</option></select> <button onClick={()=>run(invoke('notification_test',{kind:testKind}))}>Test alert</button> <button onClick={()=>run(invoke('notification_test',{kind:testKind,delaySeconds:5}).then(()=>setTestStatus('Test scheduled in 5 seconds. You can minimize DevDeck.')))}>Test in 5s</button><span role="status">{testStatus}</span> History stays available when alerts are muted. <button onClick={()=>run(requestPermission().then(result=>{if(result!=='granted')setError('Windows notifications are not permitted. History and in-app alerts remain available.')}))}>Enable Windows alerts</button></small>
      {error&&<p role="alert">{error}</p>}
      <div className="notification-history">{!rows.length&&<p>No updates yet. Dev’s work will appear here.</p>}{rows.map(n=><article key={n.id} data-unread={n.unread}>
        <div><NoticeIdentity kind={n.kind} size={16} /><strong>{n.title}</strong><time>{new Date(n.at).toLocaleString()}</time></div><small>{n.source}{n.count>1?` · ${n.count} updates`:''}</small><p>{n.body}</p>
        <footer><button onClick={()=>visit(n)}>Open details</button>{n.unread&&<button onClick={()=>run(read(n))}>Mark read</button>}<button onClick={()=>run(mute(n.source))}>{muted.includes(n.source)?'Unmute source':'Mute source'}</button><button onClick={()=>run(mute(workKey(n)))}>{muted.includes(workKey(n))?'Unmute work':'Mute work'}</button></footer>
      </article>)}</div>
    </section>}

  </div>
}
