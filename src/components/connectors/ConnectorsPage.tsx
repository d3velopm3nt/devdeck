import { useCallback, useEffect, useState } from 'react'
import { feeds, inventory, services, type FeedAccess, type Inventory } from '../../lib/connectors'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'

export function ConnectorsPage() {
  const navigate = useApp(s => s.setRailView)
  const [data,setData] = useState<Inventory>({ connections: [], feedConnections: [], errors: [], unavailable: [] })
  const [selected,setSelected] = useState('feed'), [query,setQuery] = useState(''), [category,setCategory] = useState('All')
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [loading,setLoading] = useState(true)
  const [name,setName] = useState(''), [url,setUrl] = useState('')
  const [scope,setScope] = useState<FeedAccess['scope']>('project'), [resource,setResource] = useState('')
  const refresh = useCallback(async () => { try { setData(await inventory()) } catch { setError('Connector inventory unavailable.') } finally { setLoading(false) } }, [])
  useEffect(() => { void refresh() }, [refresh])
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch(e) { setError(String(e)) } finally { await refresh(); setBusy(false) } }
  const service = services.find(s => s.id === selected) ?? services[0]
  const existing = data.connections.filter(c => c.service === service.id)
  const catalog = services.filter(s => (category === 'All' || s.category === category) && `${s.name} ${s.capabilities.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => Number(data.connections.some(c => c.service === b.id)) - Number(data.connections.some(c => c.service === a.id)))
  return <div className="h-full overflow-auto bg-page p-5 text-body">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-lg font-semibold text-ink">Connectors</h1><p className="mt-1 text-xs text-muted">Accounts, capabilities and access across your workspace.</p></div><button className="btn-ghost shrink-0" disabled={busy || loading} onClick={() => void refresh()}><Icon name="update" size={14} />Refresh inventory</button></header>
    {error && <p role="alert" className="mb-3 rounded border border-line p-3 text-sm text-err">{error}</p>}
    {data.errors.map(e => <p key={e} role="alert" className="mb-2 text-xs text-warn">{e}</p>)}
    <div className="mb-4 flex flex-wrap gap-3"><input className="input min-w-56 flex-1" aria-label="Search connectors" placeholder="Search connectors or capabilities" value={query} onChange={e=>setQuery(e.target.value)} /><select className="input" aria-label="Connector category" value={category} onChange={e=>setCategory(e.target.value)}>{['All','Development','AI','Communication','Information'].map(c=><option key={c}>{c}</option>)}</select></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(360px,2fr)]">
      <nav aria-label="Connector catalogue" className="space-y-2">{loading && <p role="status" className="text-xs text-muted">Reading existing connections…</p>}{catalog.map(s => <button key={s.id} aria-pressed={s.id === selected} className={`w-full rounded-lg border p-3 text-left ${selected === s.id ? 'border-accent bg-raise' : 'border-line bg-panel hover:bg-hover'}`} onClick={()=>setSelected(s.id)}><span className="block text-sm font-medium text-ink">{s.name}</span><span className="mt-1 block text-xs text-muted">{s.category} · {data.unavailable.includes(s.id) ? 'Inventory unavailable' : String(data.connections.filter(c=>c.service === s.id).length) + ' saved connections'}</span></button>)}{catalog.length === 0 && <p className="text-sm text-muted">No matching connectors.</p>}</nav>
      <section aria-label="Connector details" className="min-w-0 rounded-lg border border-line bg-panel p-4">
        <h2 className="text-base font-semibold text-ink">{service.name}</h2><p className="mt-2 text-xs leading-relaxed text-muted">{service.note}</p>
        <h3 className="mt-4 text-xs font-semibold text-dim">Supported capabilities</h3><div className="mt-2 flex flex-wrap gap-2">{service.capabilities.map(c=><span key={c} className="rounded bg-raise px-2 py-1 font-mono text-xs">{c}</span>)}</div>
        <p className="mt-3 text-xs text-muted">Requirements: {service.requirements}</p>
        {service.manage && <button className="btn-primary mt-4" onClick={()=>navigate(service.manage!)}>{service.id === 'mcp' ? 'Manage / custom MCP' : `Manage ${service.name}`}</button>}
        <h3 className="mt-5 border-t border-line pt-4 text-sm font-semibold text-ink">Existing connections</h3>
        {data.unavailable.includes(service.id) && <p className="mt-2 text-xs text-warn">Saved connections could not be read. Refresh inventory to retry.</p>}
        {!loading && !data.unavailable.includes(service.id) && existing.length === 0 && <p className="mt-2 text-xs text-muted">No saved connections found for this service.</p>}
        {existing.map(c => { const feed = data.feedConnections.find(f=>`feed:${f.id}` === c.id); return <article key={c.id} className="mt-3 rounded-lg border border-line bg-soft p-3">
          <div className="flex flex-wrap justify-between gap-2"><h4 className="text-sm font-medium text-ink">{c.name}</h4><span className={`text-xs ${c.state === 'verified' ? 'text-ok' : c.state === 'degraded' || c.state === 'missing-dependency' ? 'text-warn' : 'text-muted'}`}>{c.state}</span></div>
          {c.note && <p className="mt-2 text-xs text-muted">{c.note}</p>}
          <p className="mt-2 text-xs text-muted">Last check: {c.lastCheck ? new Date(c.lastCheck < 1e12 ? c.lastCheck * 1000 : c.lastCheck).toLocaleString() : 'Not checked'}</p>
          {c.credentialRef && <p className="mt-1 break-all text-xs text-muted">Credential reference: {c.credentialRef}</p>}
          <p className="mt-1 text-xs text-muted">Used by / bindings: {c.usedBy.join(', ') || 'None reported'}</p>
          {feed && <><p className="mt-2 text-xs text-muted">Connection ID: {feed.id}</p><p className="mt-2 break-all text-xs text-dim">{feed.url}</p><div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={busy || ['paused','disconnected'].includes(c.state)} onClick={()=>void run(()=>feeds.read(feed.id))}>Test / read feed</button>
            {c.state !== 'disconnected' && c.state !== 'paused' && <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>feeds.action(feed.id,'pause'))}>Pause</button>}
            {['paused','disconnected','degraded'].includes(c.state) && <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>feeds.action(feed.id,'reconnect'))}>Reconnect</button>}
            {c.state !== 'disconnected' && <button className="btn-ghost" disabled={busy} onClick={()=>void run(()=>feeds.action(feed.id,'disconnect'))}>Disconnect</button>}
            <button className="btn-ghost" disabled={busy || feed.entries.length === 0} onClick={()=>void run(()=>feeds.action(feed.id,'delete-cache'))}>Delete cached titles</button>
          </div><p className="mt-2 text-xs text-muted">Disconnect revokes scoped bindings and keeps cached titles. Reconnect does not restore grants.</p>
          <fieldset disabled={busy || c.state === 'disconnected'} className="mt-3"><legend className="text-xs font-semibold text-dim">Scoped feed.read binding</legend><div className="mt-2 flex flex-wrap gap-2"><select aria-label={`Access scope ${feed.id}`} className="input" value={scope} onChange={e=>setScope(e.target.value as FeedAccess['scope'])}>{['project','space','agent'].map(s=><option key={s}>{s}</option>)}</select><input aria-label={`Resource identifier ${feed.id}`} placeholder="Exact identifier" className="input min-w-0 flex-1" value={resource} onChange={e=>setResource(e.target.value)} /><button className="btn-ghost" disabled={!resource.trim()} onClick={()=>void run(()=>feeds.access(feed.id,scope,resource.trim(),true))}>Add binding</button></div>
            {feed.access.map(a=><div key={`${a.scope}:${a.id}`} className="mt-2 flex items-center justify-between text-xs"><span>{a.scope}: {a.id} · {a.capability}</span><button className="btn-ghost" onClick={()=>void run(()=>feeds.access(feed.id,a.scope,a.id,false))}>Revoke</button></div>)}
          </fieldset><p className="mt-2 text-xs text-muted">Agent/project bindings enable cached reads only when the agent also has Feed cache tool permission. Space bindings are reserved.</p>
          {feed.entries.length > 0 && <details className="mt-3 text-xs"><summary>{feed.entries.length} cached titles</summary><ul className="mt-2 space-y-1">{feed.entries.map((e,i)=><li key={i}>{e.title}</li>)}</ul></details>}
          <details className="mt-3 text-xs text-muted"><summary>Redacted activity ({feed.activity.length})</summary><ol className="mt-2 space-y-1">{feed.activity.map((a,i)=><li key={i}>{a}</li>)}</ol></details></>}
        </article> })}
        {service.id === 'feed' && <form className="mt-5 border-t border-line pt-4" onSubmit={e=>{e.preventDefault(); void run(async()=>{await feeds.add(name,url);setName('');setUrl('')})}}><h3 className="text-sm font-semibold text-ink">Add public feed</h3><label className="mt-3 block text-xs">Name<input className="input mt-1 block w-full" required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label><label className="mt-3 block text-xs">Public HTTPS feed URL<input className="input mt-1 block w-full" type="url" required placeholder="https://example.org/feed.xml" value={url} onChange={e=>setUrl(e.target.value)} /></label><p className="mt-2 text-xs text-muted">No credentials, query strings or redirects. Adding saves configuration; Test performs the first network read. No access is granted automatically.</p><button className="btn-primary mt-3" disabled={busy}>Add feed</button></form>}
      </section>
    </div>
  </div>
}
