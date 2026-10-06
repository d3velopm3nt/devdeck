import { useState } from 'react'
import { useApp } from '../../store'
import * as ipc from '../../lib/ipc'
import { openNodeThread } from '../../lib/dock'

const areas=[{name:'Life',label:'Personal',note:'Priorities & commitments'},{name:'Personal',label:'Personal',note:'Home, family & personal goals'},{name:'Business',label:'Business',note:'Companies, products & delivery'}]
export function LifeSpaces(){
  const nodes=useApp(s=>s.nodes)
  const refresh=useApp(s=>s.refreshTree)
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const create=async(area:typeof areas[number])=>{
    setBusy(area.name);setError('')
    try{const n=await ipc.vaultCreate(null,area.name);await ipc.vaultSetMeta(n.id,{label:area.label});await refresh();openNodeThread(n.id,n.name)}catch(e){setError(String(e))}finally{setBusy('')}
  }
  return <section className="mb-5" aria-label="Life, personal and business spaces"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">Your spaces</h2><button className="text-xs text-viol" onClick={()=>useApp.getState().setRailView('workers')}>Manage your agents</button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-3">{areas.map(a=>{const n=nodes.find(n=>n.parent_id==null&&n.name.toLowerCase()===a.name.toLowerCase());return <button key={a.name} disabled={!!busy} className="rounded-xl border border-line bg-panel p-4 text-left hover:bg-hover" onClick={()=>n?(useApp.getState().setSpaceScope(n.id),openNodeThread(n.id,n.name)):void create(a)}><span className="text-sm font-semibold text-ink">{a.name}</span><p className="mt-1 text-xs text-muted">{a.note}</p><span className="mt-3 block text-xs text-viol">{n?'Open space':busy===a.name?'Creating…':'Create space'}</span></button>})}</div>{error&&<p role="alert" className="mt-2 text-sm text-err">{error}</p>}</section>
}
