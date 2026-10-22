import { useCallback, useEffect, useState } from 'react'
import { legacyControls, type LegacyControl, type OwnerCheck } from '../../lib/connectors'

export function LegacyControls({ connectionKey, onUpdated }: { connectionKey: string; onUpdated: () => void }) {
  const [control,setControl]=useState<LegacyControl>(), [saved,setSaved]=useState<LegacyControl>(), [check,setCheck]=useState<OwnerCheck>()
  const [coverage,setCoverage]=useState(''), [uses,setUses]=useState<string[]>([]), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const load=useCallback(async()=>{ const [rows,checks,deps]=await Promise.all([legacyControls.list(),legacyControls.checks(),legacyControls.dependencies(connectionKey)]); const next=rows.find(c=>c.key===connectionKey)??{key:connectionKey,state:'active' as const,agents:null,projects:null,spaces:null,revision:0,activity:[]};setControl(next);setSaved(next);setCheck(checks.find(c=>c.key===connectionKey));setCoverage(deps.coverage);setUses(deps.uses) },[connectionKey])
  useEffect(()=>{void load().catch(e=>setError(String(e)))},[load])
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();await load();onUpdated()}catch(e){setError(String(e))}finally{setBusy(false)}}
  return <section className="mt-4 border-t border-line pt-3" aria-label="Shared connection controls">
    <h5 className="text-sm font-semibold text-ink">DevDeck use</h5>
    <p className="mt-2 text-xs text-muted">Pause or disconnect blocks new supported operations. In-flight work may finish. Credentials, existing grants, mappings and cached data stay with their owners. External gh/git sessions are unaffected.</p>
    {connectionKey.startsWith('ai:') && <p className="mt-2 text-xs text-muted">Testing an API provider sends a small model request and may incur provider charges. CLI health checks establish local readiness only.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-warn">{error}</p>}
    {control && <><div className="mt-3 flex flex-wrap gap-2">
      {control.state==='active' ? <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>legacyControls.save({...saved!,state:'paused'}))}>Pause use</button> : <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>legacyControls.save({...saved!,state:'active'}))}>Resume use</button>}
      {control.state!=='disconnected' && <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>legacyControls.save({...saved!,state:'disconnected'}))}>Disconnect DevDeck use</button>}
      <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>legacyControls.test(connectionKey))}>Test existing owner</button>
      <button className="btn-ghost" disabled={busy} onClick={()=>void run(async()=>{})}>Refresh controls</button>
    </div>
    {connectionKey.startsWith('ai:') && <fieldset disabled={busy} className="mt-3"><legend className="text-xs font-semibold text-dim">Additional access restrictions</legend><p className="mt-1 text-xs text-muted">These limits never grant access. Empty restricted lists deny everyone. Runtime paths without a trusted matching identity are denied.</p>{(['agents','projects'] as const).map(scope=><label key={scope} className="mt-2 block text-xs"><input type="checkbox" checked={control[scope]!==null} onChange={e=>setControl({...control,[scope]:e.target.checked?[]:null})}/> Restrict {scope}{control[scope]!==null && <input aria-label={scope+' exact identifiers'} className="input mt-1 block w-full" placeholder="Exact IDs, comma separated" value={control[scope]!.join(',')} onChange={e=>setControl({...control,[scope]:e.target.value.split(',').map(s=>s.trim())})}/>}</label>)}<button className="btn-ghost mt-2" onClick={()=>void run(()=>legacyControls.save({...control,agents:control.agents?.filter(Boolean)??null,projects:control.projects?.filter(Boolean)??null}))}>Save restrictions</button></fieldset>}
    <p className="mt-2 text-xs text-muted">Space restrictions require trusted runtime identity and currently deny all use when present. GitHub repository operations currently have no agent/project context; central GitHub controls apply globally.</p>
    {check && <p className="mt-3 text-xs text-muted">Owner check: {check.ok?'passed':'failed'} · {new Date(check.at*1000).toLocaleString()}. {check.summary}</p>}
    <details className="mt-3 text-xs text-muted"><summary>Known dependencies ({uses.length})</summary><p className="mt-2">{coverage}</p><ul>{uses.map(u=><li key={u}>{u}</li>)}</ul></details>
    <details className="mt-3 text-xs text-muted"><summary>Redacted control activity ({control.activity.length})</summary><ol>{control.activity.map((a,i)=><li key={i}>{a}</li>)}</ol></details></>}
  </section>
}
