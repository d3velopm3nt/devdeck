import { FilterTabs, StateBadge, StateIcon } from './ui/DesignSystem'
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Icon } from '../lib/icons'
import { openSpace } from '../lib/dock'
import { useApp } from '../store'

interface Request {
  id: string; version: string; source: string; title: string; evidence: string
  recommendation: string; kind: string; target: string; status: string; at: string; resolution: string
}
/** Requests survive read/dismiss. Resolution records an outcome, never authorizes execution. */
export function InboxRequests() {
  const [rows, setRows] = useState<Request[]>([])
  const [view, setView] = useState<'needs-you' | 'resolved'>('needs-you')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const marks = useApp(s => s.inboxRead)
  const mark = useApp(s => s.markInbox)
  const refresh = useCallback(async () => {
    try { setRows(await invoke<Request[]>('inbox_requests')); setError('') }
    catch(e) { setError(String(e)) }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => {
    const off = listen('devdeck:inbox', () => { void refresh() })
    void off.then(() => refresh()).catch(e => { setError(String(e)); setLoaded(true) })
    return () => { void off.then(fn => fn()) }
  }, [refresh])
  const resolve = async (r: Request) => {
    setBusy(true)
    try {
      await invoke('inbox_request_resolve', { id: r.id, version: r.version, resolution: note })
      setEditing(''); setNote(''); await refresh()
    } catch(e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section className="border-b border-line bg-panel" aria-label="Dev requests">
    <div className="flex flex-wrap items-center gap-2 px-5 py-3">
      <Icon name="inbox" size={16}/><h3 className="text-sm font-semibold">Dev requests</h3>
      <FilterTabs label="Request status" value={view} onChange={setView} options={[{id:'needs-you',label:'Needs you',icon:'view',count:rows.filter(r=>r.status==='needs-you').length},{id:'resolved',label:'Resolved',icon:'ok',count:rows.filter(r=>r.status==='resolved').length}]}/>
      <button className="ml-auto btn-ghost text-xs" onClick={()=>void refresh()} aria-label="Refresh Dev requests"><Icon name="update" size={13}/></button>
    </div>
    <p className="px-5 pb-2 text-xs text-muted">Decisions stay here until resolved. Reading an alert does not close a request.</p>
    {error && <div role="alert" className="px-5 py-2 text-xs text-err">{error}</div>}
    {!loaded && <p className="px-5 pb-3 text-xs text-muted">Loading requests…</p>}
    {loaded && !error && !rows.some(r=>r.status===view) && <p className="px-5 pb-3 text-xs text-muted">{view==='needs-you'?'No saved requests need your decision.':'No resolved requests yet.'}</p>}
    {rows.filter(r=>r.status===view).map(r=><article key={r.id} className="border-t border-line px-5 py-3">
      <div className="flex items-center gap-2"><StateIcon state={r.status==='resolved'?'resolved':r.kind==='review'?'review':'blocked'} size={15}/><h4 className="text-[13px] font-semibold">{r.title}</h4><StateBadge state={r.status==='resolved'?'resolved':r.kind==='review'?'review':'blocked'} label={r.status==='resolved'?'Resolved':r.kind==='review'?'Review needed':'Blocked'}/></div>
      <p className="mt-1 text-xs text-muted">{r.source}</p>
      <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{r.evidence}</p>
      <p className="mt-2 text-xs text-dim">{r.recommendation}</p>
      {r.resolution && <p className="mt-2 text-xs text-dim">Outcome: {r.resolution}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-ghost text-xs" onClick={()=>{const id=Number(r.target.replace('space:','')); const issue=r.id.match(/:([\w.-]+\/[\w.-]+):(\d+)$/); if(r.target.startsWith('work-item:')) useApp.getState().focusWorkItem(r.target.slice(10)); else if(issue) useApp.getState().focusWorkItem(`github:${issue[1].toLowerCase()}:${issue[2]}`); else if(r.target.startsWith('space:')&&id>0) openSpace(id,r.source); void mark([`request:${r.id}:${r.version}`],true)}}>Open work item</button>
        <button className="btn-ghost text-xs" onClick={()=>void mark([`request:${r.id}:${r.version}`],!marks[`request:${r.id}:${r.version}`])}>{marks[`request:${r.id}:${r.version}`]?'Mark unread':'Mark read'}</button>
        {r.status==='needs-you' && <button className="btn-ghost text-xs" onClick={()=>{setEditing(r.id);setNote('')}}>Record resolution</button>}
      </div>
      {editing===r.id && <form className="mt-3" onSubmit={e=>{e.preventDefault();void resolve(r)}}>
        <label className="block text-xs text-muted">Decision or confirmed outcome<textarea className="mt-1 w-full rounded border border-line bg-page p-2 text-ink" aria-label="Decision or confirmed outcome" value={note} maxLength={4000} onChange={e=>setNote(e.target.value)} disabled={busy}/></label>
        <p className="mb-2 text-xs text-muted">Records your outcome only. Use the source workflow to approve, retry, or review work.</p>
        <button className="btn-primary text-xs" disabled={busy||!note.trim()}>Save resolution</button><button type="button" className="btn-ghost text-xs" disabled={busy} onClick={()=>setEditing('')}>Cancel</button>
      </form>}
    </article>)}
  </section>
}
