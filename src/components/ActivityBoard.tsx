import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiw, type FeatureWork, type Session, type AgentDef } from '../lib/aiw'
import { visibility, isStale, stage, type VisibilitySnapshot, type IssueSnapshot, type SessionRecord, type ProductLink } from '../lib/visibility'
import { useApp } from '../store'
import { subtreeIds } from '../lib/tree'
import * as ipc from '../lib/ipc'

interface Row { id: string; title: string; product: string; productId: string; space: string; folder: string; status: string; source: string; owners?: string[]; url?: string; updated: string; sessions: SessionRecord[] }
const field = 'rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink'
const columns = ['Queued', 'Working', 'Blocked', 'Review', 'Done']
const empty: VisibilitySnapshot = { products: [], sessions: [], config_raw: '', warnings: [] }
function Link({ url, children }: { url: string; children: React.ReactNode }) {
  if (!/^https:\/\/github\.com\//.test(url)) return <span>{children}</span>
  return <button className="text-info underline" onClick={() => void ipc.openUrl(url)}>{children}</button>
}
export function ActivityBoard({ sessionsOnly = false }: { sessionsOnly?: boolean }) {
  const nodes = useApp(s => s.nodes)
  const scope = useApp(s => s.spaceScopeId)
  const [snapshot, setSnapshot] = useState(empty)
  const [work, setWork] = useState<FeatureWork[]>([])
  const [native, setNative] = useState<Session[]>([])
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [github, setGithub] = useState<Record<string, IssueSnapshot>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [product, setProduct] = useState('')
  const [assistant, setAssistant] = useState('')
  const [session, setSession] = useState('')
  const [space, setSpace] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ProductLink[]>([])
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const error = useCallback((key: string, value: string) => setErrors(e => ({ ...e, [key]: value })), [])
  const reload = useCallback(async (remote = false) => {
    if (inFlight.current) return
    inFlight.current = true
    if (remote) setBusy(true)
    try {
      const results = await Promise.allSettled([visibility.snapshot(), aiw.allWork(), aiw.sessions(), aiw.agents()])
      if (!mounted.current) return
      const [s, w, n, a] = results
      if (s.status === 'fulfilled') { setSnapshot(s.value); error('Vault', '') } else error('Vault', String(s.reason))
      if (w.status === 'fulfilled') { setWork(w.value); error('Local work', '') } else error('Local work', String(w.reason))
      if (n.status === 'fulfilled') { setNative(n.value); error('Agent sessions', '') } else error('Agent sessions', String(n.reason))
      if (a.status === 'fulfilled') setAgents(a.value)
      setLoaded(true)
      if (remote && s.status === 'fulfilled') {
        const links = s.value.products
        const reads = await Promise.allSettled(links.map(p => visibility.issues(p.repository)))
        if (!mounted.current) return
        reads.forEach((r, i) => {
          const p = links[i]
          if (r.status === 'fulfilled') { setGithub(g => ({ ...g, [p.id]: r.value })); error(p.name, '') }
          else error(p.name, String(r.reason))
        })
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }, [error])
  useEffect(() => {
    mounted.current = true
    void reload(true)
    const interval = window.setInterval(() => void reload(), 30_000)
    const stop = aiw.onEvent(() => void reload())
    return () => { mounted.current = false; window.clearInterval(interval); void stop.then(un => un()) }
  }, [reload])

  const allSessions = useMemo(() => [
    ...snapshot.sessions,
    ...native.map(s => {
      const node = nodes.find(n => String(n.id) === s.project_id)
      return {
        id: `native:${s.id}`, assistant: s.agent_name || agents.find(a => a.id === s.agent_id)?.name || s.agent_id,
        product_id: s.project_id, space: node?.name || s.project_id, folder: node?.rel_path || '',
        title: s.summary || s.feature_id, status: s.status,
        started_at: s.started_at, updated_at: s.ended_at || s.transcript.at(-1)?.at || s.checkpoint?.taken_at || s.started_at,
        ticket_url: '', conversation_url: '', step: s.feature_id, blocker: s.status === 'blocked' ? s.summary || 'Waiting for resolution' : '',
        next_action: '', checkpoints: s.transcript.filter(t => ['checkpoint', 'summary', 'completed'].includes(t.kind)).map(t => ({ at: t.at, summary: t.text, evidence: [] })),
      } satisfies SessionRecord
    }),
  ], [snapshot.sessions, native, nodes, agents])
  const rows = useMemo(() => {
    const external = allSessions.filter(s => !s.id.startsWith('native:'))
    const linked = new Set<string>()
    const list: Row[] = snapshot.products.flatMap(p => (github[p.id]?.items || []).map(i => {
      const sessions = external.filter(s => s.ticket_url === i.url)
      sessions.forEach(s => linked.add(s.id))
      const current = [...sessions].filter(s => !isStale(s.updated_at)).sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
      return { id: i.url, title: `#${i.number} ${i.title}`, product: p.name, productId: p.id, space: p.space, folder: p.folder,
        // GitHub issue state remains authoritative; session activity is a separate signal.
        status: i.state === 'closed' ? 'Done' : current && stage(current.status) !== 'Done' ? stage(current.status) : i.pull_request ? 'Review' : 'Queued',
        source: `${i.pull_request ? 'GitHub PR' : 'GitHub issue'} · ${i.state}`, owners: i.assignees, url: i.url, updated: i.updated_at, sessions }
    }))
    const scopeIds = scope == null ? null : new Set(subtreeIds(nodes, scope))
    for (const f of work) {
      const node = nodes.find(n => String(n.id) === f.project_id)
      if (scopeIds && (!node || !scopeIds.has(node.id))) continue
      // Linked products show their GitHub backlog, not a second editable backlog.
      if (snapshot.products.some(p => p.folder && p.folder === node?.rel_path)) continue
      for (const item of f.items) {
        const sessions = allSessions.filter(s => s.id.startsWith('native:') && native.find(n => `native:${n.id}` === s.id)?.project_id === f.project_id && native.find(n => `native:${n.id}` === s.id)?.work_item_id === item.id)
        list.push({ id: `local:${f.project_id}:${f.feature_id}:${item.id}`, title: item.title, product: f.project_name, productId: f.project_id,
          space: node?.name || f.project_name, folder: node?.rel_path || '', status: stage(item.status), source: 'DevDeck task', updated: sessions[0]?.updated_at || '', sessions })
      }
    }
    for (const s of external.filter(s => !linked.has(s.id))) {
      const p = snapshot.products.find(p => p.id === s.product_id)
      list.push({ id: `session:${s.id}`, title: s.title, product: p?.name || s.product_id || 'Personal', productId: s.product_id,
        space: s.space, folder: s.folder, status: stage(s.status), source: 'Session record', url: s.ticket_url || undefined, updated: s.updated_at, sessions: [s] })
    }
    // Apply the shell's space scope consistently to GitHub and external rows too.
    return scope == null ? list : list.filter(r => {
      const n = nodes.find(n => n.rel_path === r.folder)
      return !!n && !!scopeIds?.has(n.id)
    })
  }, [snapshot.products, github, allSessions, work, native, nodes, scope])
  const filteredSessions = allSessions.filter(s => (!product || s.product_id === product) && (!assistant || s.assistant === assistant) && (!session || s.id === session) && (!space || s.space === space) && (!query || `${s.title} ${s.folder} ${s.id}`.toLowerCase().includes(query.toLowerCase())) && (showDone || stage(s.status) !== 'Done') && (scope == null || subtreeIds(nodes, scope).some(id => nodes.find(n => n.id === id)?.rel_path === s.folder)))
  const filtered = rows.filter(r => (!product || r.productId === product) && (!space || r.space === space) && (!assistant || r.sessions.some(s => s.assistant === assistant)) && (!session || r.sessions.some(s => s.id === session)) && (!query || `${r.title} ${r.product} ${r.folder}`.toLowerCase().includes(query.toLowerCase())) && (showDone || r.status !== 'Done'))
  const selected = sessionsOnly ? filteredSessions.find(s => s.id === picked) : filtered.find(r => r.id === picked)
  const details = selected ? 'sessions' in selected ? selected.sessions : [selected] : []
  const choices = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
  const productChoices = new Map([...rows.map(r => [r.productId, r.product] as const), ...snapshot.products.map(p => [p.id, p.name] as const), ...allSessions.map(s => [s.product_id, snapshot.products.find(p => p.id === s.product_id)?.name || s.product_id] as const)])
  const save = async () => {
    setBusy(true)
    try { await visibility.saveProducts(snapshot.config_raw, draft); setEditing(false); error('Save', ''); await reload(true) }
    catch (e) { error('Save', String(e)) }
    finally { setBusy(false) }
  }
  return <div className="flex h-full min-h-0 flex-col bg-page text-ink">
    <header className="border-b border-line px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">{sessionsOnly ? 'Sessions' : 'Activity board'}</h1><p className="mt-1 text-sm text-muted">{sessionsOnly ? 'External conversations and DevDeck agents, connected to their work.' : 'Product issues from GitHub, Life and Personal tasks from DevDeck.'}</p></div>
        <div className="flex gap-2"><button className={field} disabled={busy} onClick={() => void reload(true)}>{busy ? 'Refreshing…' : 'Refresh'}</button><button className={field} onClick={() => { setDraft(snapshot.products); setEditing(v => !v) }}>Product connections</button></div></div>
      <nav className="mt-4 flex gap-4 text-sm" aria-label="Visibility views"><button className={!sessionsOnly ? 'text-info' : 'text-muted'} onClick={() => useApp.getState().setRailView('activity')}>Activity board</button><button className={sessionsOnly ? 'text-info' : 'text-muted'} onClick={() => useApp.getState().setRailView('sessions')}>Sessions</button></nav>
      <div className="mt-4 flex flex-wrap gap-2">
        <select className={field} aria-label="Product filter" value={product} onChange={e => setProduct(e.target.value)}><option value="">All products</option>{[...productChoices].filter(([id]) => id).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select className={field} aria-label="Space filter" value={space} onChange={e => setSpace(e.target.value)}><option value="">All spaces</option>{choices([...rows.map(r => r.space), ...allSessions.map(s => s.space)]).map(v => <option key={v}>{v}</option>)}</select>
        <select className={field} aria-label="Assistant filter" value={assistant} onChange={e => setAssistant(e.target.value)}><option value="">All assistants</option>{choices(allSessions.map(s => s.assistant)).map(v => <option key={v}>{v}</option>)}</select>
        <select className={`${field} max-w-60`} aria-label="Session filter" value={session} onChange={e => setSession(e.target.value)}><option value="">All sessions</option>{allSessions.map(s => <option key={s.id} value={s.id}>{s.assistant} · {s.id}</option>)}</select>
        <input className={field} placeholder="Search work or folders" aria-label="Search activity" value={query} onChange={e => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Show done</label>
      </div>
      <p className="mt-3 text-xs text-muted">Last recorded activity is not a live heartbeat. Sessions become stale after 15 minutes. Columns show reported activity; cards retain GitHub issue state.</p>
    </header>
    {Object.entries(errors).filter(([,v]) => v).map(([k,v]) => <p role="alert" key={k} className="border-b border-line px-6 py-2 text-sm text-err">{k}: {v}{snapshot.products.some(p => p.name === k && github[p.id]) ? ' Showing the previous GitHub snapshot.' : ''}</p>)}
    {snapshot.warnings.map(w => <p key={w} className="px-6 py-2 text-sm text-muted">{w}</p>)}
    {snapshot.products.map(p => github[p.id] && <p key={p.id} className="px-6 py-1 text-xs text-muted">{p.name} · GitHub checked {new Date(github[p.id].fetched_at).toLocaleString()}{github[p.id].truncated ? ' · Showing the 500 most recently updated items' : ''}{p.project_url && <> · <Link url={p.project_url}>Product backlog</Link></>}</p>)}
    {editing && <section className="border-b border-line p-5"><h2 className="font-semibold">Product connections</h2><p className="my-2 text-sm text-muted">Connect a repository and optionally link its GitHub Project. Changes are saved in your vault; use Git sync to share them.</p>
      {draft.map((p,i) => <div key={i} className="my-2 flex flex-wrap gap-2">{(['id','name','space','folder','repository','project_url'] as const).map(k => <input key={k} className={`${field} w-40`} aria-label={`Product ${i+1} ${k}`} placeholder={k === 'repository' ? 'owner/repository' : k.replace('_',' ')} value={p[k]} onChange={e => setDraft(d => d.map((v,j) => j === i ? {...v,[k]: e.target.value} : v))} />)}<button className={field} onClick={() => setDraft(d => d.filter((_,j) => i !== j))}>Remove</button></div>)}
      <div className="mt-3 flex gap-2"><button className={field} onClick={() => setDraft(d => [...d,{id:'',name:'',space:'',folder:'',repository:'',project_url:''}])}>Add product</button><button className="btn-primary" disabled={busy} onClick={() => void save()}>Save connections</button></div>
    </section>}
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className="min-w-0 flex-1 overflow-auto p-5">
        {!loaded && <p className="text-muted">Reading shared activity…</p>}
        {loaded && (sessionsOnly ? filteredSessions.length : filtered.length) === 0 && <p className="rounded-xl border border-line p-6 text-muted">No matching {sessionsOnly ? 'sessions' : 'work'}. Connect a product to read GitHub issues, or record a session in your shared vault.</p>}
        {sessionsOnly ? <div className="space-y-3">{filteredSessions.map(s => <button key={s.id} onClick={() => setPicked(s.id)} className={`w-full rounded-xl border p-4 text-left ${picked === s.id ? 'border-indigo-500 bg-raise' : 'border-line bg-panel'}`}><div className="flex justify-between gap-3"><b>{s.title}</b><span className="text-xs text-muted">{stage(s.status)} · {isStale(s.updated_at) && stage(s.status) !== 'Done' ? 'Stale' : 'Recorded'}</span></div><p className="mt-2 text-sm text-muted">{s.assistant} · {s.id}</p><p className="mt-1 text-xs text-muted">{s.space} / {s.folder} · {new Date(s.updated_at).toLocaleString()}</p></button>)}</div> : <div className="grid min-w-[900px] grid-cols-5 gap-3">{columns.map(c => <section key={c}><h2 className="mb-3 text-sm font-semibold">{c} <span className="text-muted">{filtered.filter(r => r.status === c).length}</span></h2><div className="space-y-3">{filtered.filter(r => r.status === c).map(r => <button key={r.id} onClick={() => setPicked(r.id)} className={`w-full rounded-xl border p-3 text-left ${picked === r.id ? 'border-indigo-500 bg-raise' : 'border-line bg-panel'}`}><p className="text-[11px] text-muted">{r.product} · {r.source}</p><p className="mt-2 text-sm font-medium">{r.title}</p><p className="mt-3 text-xs text-muted">{r.owners?.length ? `GitHub assignee: ${r.owners.join(', ')} · ` : ''}{r.sessions.length ? r.sessions.map(s => `${s.assistant} · ${stage(s.status)}${isStale(s.updated_at) && stage(s.status) !== 'Done' ? ' · Stale' : ''}`).join(', ') : 'No linked session'}</p><p className="mt-2 text-[11px] text-muted">{r.updated ? new Date(r.updated).toLocaleString() : 'No recorded update'}</p></button>)}</div></section>)}</div>}
      </main>
      {selected && <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-panel p-5"><button className="float-right text-muted" aria-label="Close activity details" onClick={() => setPicked('')}>×</button><h2 className="pr-5 font-semibold">{selected.title}</h2>{'url' in selected && selected.url && <p className="mt-3 text-sm"><Link url={selected.url}>Open GitHub item</Link></p>}
        <p className="mt-3 text-xs text-muted">{selected.space} / {selected.folder}</p>
        {details.length === 0 && <p className="mt-4 text-sm text-muted">No session has reported working on this item.</p>}
        {details.map(s => <section key={s.id} className="mt-5 border-t border-line pt-4"><h3 className="text-sm font-semibold">{s.assistant}</h3><p className="mt-1 break-all text-xs text-muted">{s.id}</p><p className="mt-2 text-sm">{s.status} · {isStale(s.updated_at) && stage(s.status) !== 'Done' ? 'Stale update' : 'Recorded update'}</p><p className="mt-1 text-xs text-muted">Started {new Date(s.started_at).toLocaleString()}<br/>Updated {new Date(s.updated_at).toLocaleString()}</p>{s.ticket_url && <p className="mt-2 text-sm"><Link url={s.ticket_url}>Linked GitHub item</Link></p>}{s.conversation_url && <p className="mt-2 break-all text-xs text-muted">Conversation: {s.conversation_url}</p>}{s.step && <p className="mt-3 text-sm"><b>Current step:</b> {s.step}</p>}{s.blocker && <p className="mt-3 text-sm text-err"><b>Blocker:</b> {s.blocker}</p>}{s.next_action && <p className="mt-3 text-sm"><b>Next action:</b> {s.next_action}</p>}<h4 className="mt-4 text-xs font-semibold text-muted">Checkpoint history</h4>{s.checkpoints.length === 0 && <p className="mt-2 text-xs text-muted">No checkpoints recorded.</p>}{s.checkpoints.map((h,i) => <div key={`${h.at}:${i}`} className="mt-3 border-l-2 border-line pl-3"><p className="text-xs text-muted">{new Date(h.at).toLocaleString()}</p><p className="mt-1 text-sm">{h.summary}</p>{h.evidence.map(e => <p key={e} className="mt-1 break-all text-xs"><Link url={e}>{e}</Link></p>)}</div>)}</section>)}
      </aside>}
    </div>
  </div>
}
