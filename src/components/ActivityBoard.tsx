import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiw, type FeatureWork, type Session, type AgentDef, type ChatMessage } from '../lib/aiw'
import { visibility, isStale, stage, type VisibilitySnapshot, type IssueSnapshot, type SessionRecord, type ProductLink } from '../lib/visibility'
import { BrandIcon, SenderMark } from './BrandIcon'
import { Markdown } from './thread/Markdown'
import { Icon, type IconName } from '../lib/icons'
import { useApp } from '../store'
import { subtreeIds } from '../lib/tree'
import { openBusiness } from './business/TodayBusinesses'
import * as ipc from '../lib/ipc'

interface Row { id: string; title: string; product: string; productId: string; space: string; folder: string; status: string; source: string; owners?: string[]; url?: string; updated: string; sessions: SessionRecord[] }
const field = 'rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent'
function bounded<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Request timed out. Check the connection and retry.')), 20_000)
    request.then(resolve, reject).finally(() => window.clearTimeout(timer))
  })
}
function mergeSessions(local: SessionRecord[], remote: SessionRecord[]) {
  const records = new Map(local.map(s => [s.id, s]))
  for (const s of remote) { const old = records.get(s.id); if (!old || Date.parse(s.updated_at) >= Date.parse(old.updated_at)) records.set(s.id, s) }
  return [...records.values()]
}
type BoardView = 'timeline' | 'local' | 'github'
function githubLabel(url: string) {
  const item = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/)
  if (item) return `${item[2]} #${item[4]}`
  if (/^https:\/\/github\.com\/(users|orgs)\/.+\/projects\//.test(url)) return 'Project board'
  const run = url.match(/^https:\/\/github\.com\/[^/]+\/([^/]+)\/actions\/runs\/(\d+)/)
  if (run) return `${run[1]} · Run #${run[2]}`
  return url.replace(/^https:\/\/github\.com\//, '').split('#')[0]
}
function linkedItems(entry: { url: string; evidence: string[]; body: string }) {
  const urls = [...new Set([entry.url, ...entry.evidence, ...(entry.body.match(/https:\/\/github\.com\/[^\s<>[\]"')]+/g) || [])].filter(Boolean).map(url => url.replace(/[.,;:!?]+$/, '').split('#')[0]))]
  return urls.filter(url => /^https:\/\/github\.com\//.test(url)).map(url => ({ url, kind: /\/pull\/\d+/.test(url) ? 'PR' : /\/issues\/\d+/.test(url) ? 'issue' : /\/actions\/runs\/\d+/.test(url) ? 'run' : 'link' }))
}
const columns = ['Queued', 'Working', 'Blocked', 'Review', 'Done']
const statusIcons: Record<string, IconName> = { Queued: 'inbox', Working: 'run', Blocked: 'alert', Review: 'view', Done: 'ok' }
const statusColors: Record<string, string> = { Queued: 'text-muted', Working: 'text-accent', Blocked: 'text-err', Review: 'text-warn', Done: 'text-ok' }
const empty: VisibilitySnapshot = { products: [], sessions: [], config_raw: '', warnings: [] }
function Link({ url, children }: { url: string; children: React.ReactNode }) {
  if (!/^https:\/\/github\.com\//.test(url)) return <span>{children}</span>
  return <button className="inline-flex items-center gap-1.5 rounded-full border border-line bg-soft px-2.5 py-1 text-xs text-info hover:bg-hover" onClick={() => void ipc.openUrl(url)}><BrandIcon brand="github" size={12} />{typeof children === 'string' && children.startsWith('https://') ? githubLabel(url) : children}</button>
}
export function ActivityBoard({ sessionsOnly = false }: { sessionsOnly?: boolean }) {
  const nodes = useApp(s => s.nodes)
  const scope = useApp(s => s.spaceScopeId)
  const [snapshot, setSnapshot] = useState(empty)
  const [view, setView] = useState<BoardView>('timeline')
  const [status, setStatus] = useState('')
  const [team, setTeam] = useState<ipc.TeamMember[]>([])
  const [messages, setMessages] = useState<ipc.ManagerMessage[]>([])
  const [work, setWork] = useState<FeatureWork[]>([])
  const [native, setNative] = useState<Session[]>([])
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [github, setGithub] = useState<Record<string, IssueSnapshot>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [businesses, setBusinesses] = useState<ipc.BusinessSummary[]>([])
  const [product, setProduct] = useState('')
  const [assistant, setAssistant] = useState('')
  const [session, setSession] = useState('')
  const [space, setSpace] = useState('')
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [layout, setLayout] = useState<'board' | 'list'>('board')
  const [chatTarget, setChatTarget] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatReady, setChatReady] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [messageBody, setMessageBody] = useState('')
  const [sending, setSending] = useState(false)
  const chatBusy = useRef(false)
  const [notice, setNotice] = useState('')
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
      const results = await Promise.allSettled([bounded(visibility.snapshot()), bounded(aiw.allWork()), bounded(aiw.sessions()), bounded(aiw.agents()), bounded(ipc.managerTeam())])
      if (!mounted.current) return
      const [s, w, n, a, t] = results
      if (s.status === 'fulfilled') { setSnapshot(s.value); error('Vault', '') } else error('Vault', String(s.reason))
      if (w.status === 'fulfilled') { setWork(w.value); error('Local work', '') } else error('Local work', String(w.reason))
      if (n.status === 'fulfilled') { setNative(n.value); error('Agent sessions', '') } else error('Agent sessions', String(n.reason))
      if (a.status === 'fulfilled') setAgents(a.value)
      setLoaded(true)
      const readMessages = async () => {
        if (t.status === 'fulfilled') {
          setTeam(t.value)
          const mailboxes = await Promise.allSettled(t.value.map(member => bounded(ipc.managerMessages(member.bot.handle))))
          if (!mounted.current) return
          if (mailboxes.every(r => r.status === 'fulfilled')) {
            setMessages([...new Map(mailboxes.flatMap(r => r.status === 'fulfilled' ? r.value : []).map(m => [m.id, m])).values()])
            error('Messages', '')
          } else error('Messages', 'Could not read all local messages. Showing the previous timeline.')
          error('Team', '')
        } else error('Team', String(t.reason))
      }
      const readGithub = async () => {
        if (!remote || s.status !== 'fulfilled') return
        await Promise.allSettled(s.value.products.map(async p => {
          try {
            const result = await bounded(visibility.issues(p.repository))
            if (!mounted.current) return
            setGithub(g => ({ ...g, [p.id]: { ...result, sessions: mergeSessions(g[p.id]?.sessions || [], result.sessions || []) } }))
            error(p.name, '')
          } catch (e) { if (mounted.current) error(p.name, String(e)) }
        }))
      }
      await Promise.allSettled([readMessages(), readGithub()])
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }, [error])
  useEffect(() => {
    void ipc.businessList().then(setBusinesses).catch(e => error('Businesses', String(e)))
    mounted.current = true
    void reload(true)
    const interval = window.setInterval(() => { if (document.visibilityState !== 'hidden') void reload(true) }, 60_000)
    const stop = aiw.onEvent(() => void reload())
    return () => { mounted.current = false; window.clearInterval(interval); void stop.then(un => un()) }
  }, [reload, error])

  useEffect(() => {
    let live = true
    setChat([]); setNotice(''); setChatReady(false); setChatLoading(!!chatTarget); error('Conversation', '')
    if (chatTarget) void ipc.managerConversation(chatTarget).then(messages => {
      if (live) { setChat(messages); setChatReady(true); error('Conversation', '') }
    }).catch(e => { if (live) error('Conversation', String(e)) }).finally(() => { if (live) setChatLoading(false) })
    return () => { live = false }
  }, [chatTarget, error])

  const remoteWarnings = Object.values(github).flatMap(g => g.warnings || [])
  const allSessions = useMemo(() => [
    ...mergeSessions(snapshot.sessions, snapshot.products.flatMap(p => (github[p.id]?.sessions || []).map(s => ({...s, product_id: p.id, space: p.space, folder: p.folder})))),
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
  ], [snapshot.sessions, snapshot.products, github, native, nodes, agents])
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
  const filteredSessions = allSessions.filter(s => (!source || (source === 'native' ? s.id.startsWith('native:') : !s.id.startsWith('native:'))) && (!product || s.product_id === product) && (!assistant || s.assistant === assistant) && (!session || s.id === session) && (!space || s.space === space) && (!query || `${s.title} ${s.folder} ${s.id}`.toLowerCase().includes(query.toLowerCase())) && (!status || stage(s.status) === status) && (showDone || stage(s.status) !== 'Done') && (scope == null || subtreeIds(nodes, scope).some(id => nodes.find(n => n.id === id)?.rel_path === s.folder)))
  const filtered = rows.filter(r => (view === 'local' ? r.source === 'DevDeck task' : view === 'github' ? r.source.startsWith('GitHub') : true) && (!status || r.status === status) && (!source || r.sessions.some(s => source === 'native' ? s.id.startsWith('native:') : !s.id.startsWith('native:'))) && (!product || r.productId === product) && (!space || r.space === space) && (!assistant || r.sessions.some(s => s.assistant === assistant)) && (!session || r.sessions.some(s => s.id === session)) && (!query || `${r.title} ${r.product} ${r.folder}`.toLowerCase().includes(query.toLowerCase())) && (showDone || r.status !== 'Done'))
  const timeline = useMemo(() => {
    const list = allSessions.flatMap(s => s.checkpoints.map((c, i) => ({
      id: `${s.id}:${i}`, title: s.title, body: c.summary, at: c.at, from: s.assistant, to: '',
      productId: s.product_id, product: snapshot.products.find(p => p.id === s.product_id)?.name || s.product_id,
      space: s.space, folder: s.folder, status: stage(s.status), sessionId: s.id,
      url: s.ticket_url, evidence: c.evidence, actions: [] as ChatMessage[], source: s.id.startsWith('native:') ? 'native' : 'external',
    })))
    for (const m of messages) {
      const sender = team.find(t => t.bot.handle === m.from)
      const recipient = team.find(t => t.bot.handle === m.to)
      // A manager home is a scope hint, not proof that a message concerns that project.
      const node = nodes.find(n => n.id === sender?.bot.node_id)
      const linked = snapshot.products.find(p => p.folder && p.folder === node?.rel_path)
      const workspace = node?.parent_id == null ? node : nodes.find(n => n.id === node.parent_id)
      list.push({ id: m.id, title: m.subject, body: m.body, at: m.created_at,
        from: sender?.bot.name || m.from, to: recipient?.bot.name || m.to,
        productId: '', product: '', space: linked?.space || workspace?.name || '',
        folder: node?.rel_path || '', status: '', sessionId: '', url: '', evidence: [], actions: [] as ChatMessage[], source: 'native' })
    }
    const manager = team.find(t => t.bot.handle === chatTarget)
    const chatNode = nodes.find(n => n.id === manager?.bot.node_id)
    const chatProduct = snapshot.products.find(p => p.folder && p.folder === chatNode?.rel_path)
    let pendingActions: ChatMessage[] = []
    for (const [i, message] of chat.entries()) {
      if (message.from === 'tool') { pendingActions.push(message); continue }
      const actions = message.from === 'assistant' ? pendingActions : []
      if (message.from === 'assistant') pendingActions = []
      list.push({ id: `chat:${chatTarget}:${i}`, title: 'Conversation', body: message.text, at: message.at,
        from: message.from === 'user' ? 'You' : manager?.bot.name || chatTarget, to: message.from === 'user' ? manager?.bot.name || chatTarget : 'You',
        productId: chatProduct?.id || '', product: chatProduct?.name || '', space: chatProduct?.space || chatNode?.name || '',
        folder: chatNode?.rel_path || '', status: '', sessionId: '', url: '', evidence: [], actions, source: 'native' })
    }
    return list.filter(e => (!chatTarget || e.id.startsWith(`chat:${chatTarget}:`) || e.from === manager?.bot.name || e.to === manager?.bot.name) && (!product || e.productId === product) && (!space || e.space === space)
      && (!assistant || e.from === assistant || e.to === assistant) && (!session || e.sessionId === session)
      && (!status || e.status === status) && (!source || e.source === source)
      && (showDone || e.status !== 'Done')
      && (!query || `${e.title} ${e.body} ${e.from} ${e.to} ${e.folder}`.toLowerCase().includes(query.toLowerCase()))
      && (scope == null || subtreeIds(nodes, scope).some(id => nodes.find(n => n.id === id)?.rel_path === e.folder)))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
  }, [allSessions, messages, team, chatTarget, chat, nodes, snapshot.products, product, space, assistant, session, status, source, showDone, query, scope])
  const timelineEntry = timeline.find(e => e.id === picked) || timeline[0]
  const chatManager = team.find(t => t.bot.handle === chatTarget)
  const sendMessage = async () => {
    if (!chatTarget || !chatReady || !messageBody.trim() || chatBusy.current) return
    chatBusy.current = true; setSending(true); setNotice(''); error('Chat', '')
    const text = messageBody.trim()
    try {
      const response = await ipc.managerTurn(chatTarget, text)
      setChat(current => [...current, ...response.appended])
      setMessageBody(''); setNotice('Reply received.'); await reload()
    } catch (e) { error('Chat', String(e)) } finally { chatBusy.current = false; setSending(false) }
  }
  const linkedIssue = Object.values(github).flatMap(g => g.items).find(i => i.url === timelineEntry?.url)
  const issueProduct = snapshot.products.find(p => p.id === product || p.id === timelineEntry?.productId)
  const draftIssue = () => {
    if (!issueProduct || !timelineEntry) return
    const body = `## Outcome\n${timelineEntry.title}\n\n## Local checkpoint\n${timelineEntry.body}\n\n## Context\nSpace: ${timelineEntry.space || 'Unscoped'}\nProject: ${issueProduct.name}\nRecorded by: ${timelineEntry.from}\nRecorded at: ${timelineEntry.at}\n\n## Acceptance criteria\n- [ ] Define completion criteria before execution.`
    void ipc.openUrl(`https://github.com/${issueProduct.repository}/issues/new?title=${encodeURIComponent(timelineEntry.title)}&body=${encodeURIComponent(body)}`).catch(e => error('Create issue', String(e)))
  }
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
    <header className="border-b border-line px-6 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">{sessionsOnly ? 'Sessions' : 'Activity board'}</h1><p className="mt-1 text-sm text-muted">{sessionsOnly ? 'External conversations and DevDeck agents, connected to their work.' : 'Local agent messages, DevDeck work and linked GitHub issues.'}</p></div>
        <div className="flex gap-2"><select aria-label="Add business or product" className={field} value="" onChange={e => { if(e.target.value === 'new') openBusiness(); else if(e.target.value) openBusiness({ nodeId: Number(e.target.value), step: 'sells' }) }}><option value="">Add business / product</option><option value="new">New business</option>{businesses.map(b => <option key={b.node_id} value={b.node_id}>Add product to {b.name}</option>)}</select><button className={field} disabled={busy} onClick={() => void reload(true)}><span className="inline-flex items-center gap-2"><span className={busy ? 'animate-spin' : ''}><Icon name="update" size={14} /></span>{busy ? 'Refreshing…' : 'Refresh'}</span></button><button className={field} onClick={() => { setDraft(snapshot.products); setEditing(v => !v) }}><span className="inline-flex items-center gap-2"><Icon name="settings" size={14} />Advanced connections</span></button></div></div>
      {!sessionsOnly && <div role="tablist" aria-label="Activity views" className="mt-4 flex gap-4 border-b border-line">
        {([['timeline', 'Timeline'], ['local', 'DevDeck issues'], ['github', 'GitHub issues']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} aria-controls="activity-view" className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors hover:bg-hover ${view === id ? 'border-accent text-accent' : 'border-transparent text-muted'}`} onClick={() => { setView(id); setPicked('') }}>{id === 'github' ? <BrandIcon brand="github" size={16} /> : <Icon name={id === 'local' ? 'inbox' : 'history'} size={16} />}{label}</button>)}
      </div>}
      <div className="mt-4 flex flex-wrap items-center gap-3" aria-label="Activity toolbar">
        <div className="relative min-w-56 flex-1">
          <span className="pointer-events-none absolute left-3 top-2.5 text-muted"><Icon name="search" size={16} /></span>
          <input type="search" className={`${field} w-full pl-9 pr-9`} placeholder={view === 'timeline' ? 'Search messages and checkpoints…' : 'Search issues…'} aria-label="Search activity" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button aria-label="Clear search" className="absolute right-3 top-2.5 text-muted" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}
        </div>
        <select className={`${field} max-w-48`} aria-label="Space filter" value={space} onChange={e => setSpace(e.target.value)}><option value="">All spaces</option>{choices([...rows.map(r => r.space), ...allSessions.map(s => s.space)]).map(v => <option key={v}>{v}</option>)}</select>
        <select className={`${field} max-w-56`} aria-label="Project filter" value={product} onChange={e => setProduct(e.target.value)}><option value="">All projects</option>{[...productChoices].filter(([id]) => id).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select className={`${field} max-w-48`} aria-label="Assistant filter" value={assistant} onChange={e => setAssistant(e.target.value)}><option value="">All assistants</option>{choices([...allSessions.map(s => s.assistant), ...team.map(t => t.bot.name)]).map(v => <option key={v}>{v}</option>)}</select>
        {sessionsOnly && <><select aria-label="Source filter" className={field} value={source} onChange={e => setSource(e.target.value)}><option value="">All sources</option><option value="native">DevDeck</option><option value="external">External</option></select><select className={`${field} max-w-60`} aria-label="Session filter" value={session} onChange={e => setSession(e.target.value)}><option value="">All sessions</option>{allSessions.map(s => <option key={s.id} value={s.id}>{s.assistant} · {s.id}</option>)}</select></>}
        {!sessionsOnly && view !== 'timeline' && <div className="flex rounded-lg border border-line bg-panel p-1" role="group" aria-label="Issue layout">{(['board', 'list'] as const).map(mode => <button key={mode} aria-pressed={layout === mode} onClick={() => setLayout(mode)} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${layout === mode ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-hover'}`}><Icon name={mode === 'board' ? 'layout' : 'list'} size={14} />{mode === 'board' ? 'Board' : 'List'}</button>)}</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Status filter">
        {['', ...columns].map(c => <button key={c} aria-pressed={status === c} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${status === c ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-hover'}`} onClick={() => { setStatus(c); if (c === 'Done') setShowDone(true) }}><span className={statusColors[c] || 'text-muted'}><Icon name={statusIcons[c] || 'layout'} size={13} /></span>{c || 'All statuses'}</button>)}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showDone} onChange={e => { setShowDone(e.target.checked); if (!e.target.checked && status === 'Done') setStatus('') }} />Show done</label>
        <span className="text-xs text-muted" role="status">{sessionsOnly ? filteredSessions.length : view === 'timeline' ? timeline.length : filtered.length} results</span>
      </div>
      {(query || space || product || assistant || session || source || status || showDone) && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {[[query, 'Search', () => setQuery('')], [space, 'Space', () => setSpace('')], [product, 'Project', () => setProduct('')], [assistant, 'Assistant', () => setAssistant('')], [session, 'Session', () => setSession('')], [source, 'Source', () => setSource('')], [status, 'Status', () => setStatus('')]].map(([value, label, clear]) => value ? <button key={String(label)} aria-label={`Remove filter: ${label}`} onClick={clear as () => void} className="flex max-w-64 items-center gap-2 rounded-full border border-line bg-soft px-3 py-1 text-body"><span className="truncate">{String(label)}: {label === 'Project' ? productChoices.get(String(value)) || String(value) : String(value)}</span><Icon name="close" size={12} /></button> : null)}
        <button className="text-accent hover:underline" onClick={() => { setQuery(''); setSpace(''); setProduct(''); setAssistant(''); setSession(''); setSource(''); setStatus(''); setShowDone(false) }}>Clear all filters</button>
      </div>}
      <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Refresh and status details</summary><p className="mt-2">GitHub checkpoints refresh every minute while this page is visible. Last recorded activity is not a live heartbeat. Sessions become stale after 15 minutes. Columns show reported activity; cards retain GitHub issue state.</p></details>
    </header>
    {Object.entries(errors).filter(([,v]) => v).map(([k,v]) => <p role="alert" key={k} className="border-b border-line px-6 py-2 text-sm text-err">{k}: {v}{snapshot.products.some(p => p.name === k && github[p.id]) ? ' Showing the previous GitHub snapshot.' : ''}</p>)}
    {[...snapshot.warnings, ...remoteWarnings].map(w => <p key={w} className="px-6 py-2 text-sm text-muted">{w}</p>)}
    {!sessionsOnly && view === 'github' && <section aria-label="GitHub connection status" className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-6 py-3 text-xs">
      <BrandIcon brand="github" size={16} />
      {!loaded ? <span>Reading repository connections…</span> : snapshot.products.length === 0 ? <><span className="text-muted">No repositories connected. Add a product repository to load its issues.</span><button className="text-accent" onClick={() => { setDraft(snapshot.products); setEditing(true) }}>Connect repository</button></> : snapshot.products.filter(p => !product || p.id === product).map(p => <span key={p.id} className="rounded-lg border border-line px-3 py-2"><b>{p.name}</b> · {p.repository} · {errors[p.name] ? <span className="text-err">Read failed{github[p.id] ? ' · showing saved results' : ''}</span> : github[p.id] ? <span className="text-muted">Read succeeded · {github[p.id].items.length} items{busy ? ' · checking for updates' : ''}</span> : busy ? 'Connecting…' : 'Not loaded'}</span>)}
    </section>}
    {snapshot.products.map(p => github[p.id] && <p key={p.id} className="px-6 py-1 text-xs text-muted">{p.name} · GitHub checked {new Date(github[p.id].fetched_at).toLocaleString()}{github[p.id].truncated ? ' · Showing the 500 most recently updated items' : ''}{p.project_url && <> · <Link url={p.project_url}>Product backlog</Link></>}</p>)}
    {editing && <section className="border-b border-line p-5"><h2 className="font-semibold">Product connections</h2><p className="my-2 text-sm text-muted">Connect a repository and optionally link its GitHub Project. Changes are saved in your vault; use Git sync to share them.</p>
      {draft.map((p,i) => <div key={i} className="my-2 flex flex-wrap gap-2">{(['id','name','space','folder','repository','project_url'] as const).map(k => <input key={k} className={`${field} w-40`} aria-label={`Product ${i+1} ${k}`} placeholder={k === 'repository' ? 'owner/repository' : k.replace('_',' ')} value={p[k]} onChange={e => setDraft(d => d.map((v,j) => j === i ? {...v,[k]: e.target.value} : v))} />)}<button className={field} onClick={() => setDraft(d => d.filter((_,j) => i !== j))}>Remove</button></div>)}
      <div className="mt-3 flex gap-2"><button className={field} onClick={() => setDraft(d => [...d,{id:'',name:'',space:'',folder:'',repository:'',project_url:''}])}>Add product</button><button className="btn-primary" disabled={busy} onClick={() => void save()}>Save connections</button></div>
    </section>}
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main id="activity-view" role={sessionsOnly ? undefined : "tabpanel"} aria-label={sessionsOnly ? undefined : view === "timeline" ? "Timeline" : view === "local" ? "DevDeck issues" : "GitHub issues"} className="min-w-0 flex-1 overflow-auto p-5">
        {!loaded && <p className="text-muted">Reading shared activity…</p>}
        {loaded && (sessionsOnly ? filteredSessions.length : view === 'timeline' ? timeline.length : filtered.length) === 0 && <p className="rounded-xl border border-line p-6 text-muted">No matching {sessionsOnly ? 'sessions' : view === 'timeline' ? 'messages or checkpoints' : 'work'}. Connect a product to read GitHub issues, or record a session in your shared vault.</p>}
        {!sessionsOnly && view === 'timeline' ? <div className="space-y-3">

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3"><h2 className="text-xl font-semibold">{chatManager ? `Chat with ${chatManager.bot.name}` : 'Team timeline'}</h2><select aria-label="Chat with manager" className={field} disabled={sending} value={chatTarget} onChange={e => { setChatTarget(e.target.value); setPicked(''); setMessageBody('') }}><option value="">All activity · choose a manager to chat</option>{team.map(t => <option key={t.bot.handle} value={t.bot.handle}>{t.bot.name}</option>)}</select></div>
          {timeline.map(e => <article key={e.id} className={`relative flex gap-3 rounded-lg border-l-2 px-3 py-4 transition-colors hover:bg-hover/50 ${picked === e.id ? 'border-accent bg-raise' : 'border-transparent'}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-body" aria-hidden="true"><SenderMark name={e.from} size={18} /></span><div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2"><button aria-label={`Select message from ${e.from}`} onClick={() => setPicked(e.id)} className="text-left text-sm font-semibold">{e.from}{e.to && <> → {e.to}</>}</button><time title="Recorded update, not a live heartbeat" className="text-xs text-muted" dateTime={e.at}>{new Date(e.at).toLocaleString()}</time></div>
            {!e.id.startsWith('chat:') && <button onClick={() => setPicked(e.id)} className="mt-1 text-left text-xs text-muted">{e.title}</button>}<div className="mt-2 text-sm leading-relaxed text-body"><Markdown text={e.body} linkLabel={href => /^https:\/\/github\.com\//.test(href) ? githubLabel(href) : undefined} /></div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              {(e.product || e.space) && <span className="inline-flex items-center gap-1.5"><Icon name="folder" size={12} />{[e.space, e.product].filter(Boolean).join(' / ')}</span>}
              {e.status && <span className={`inline-flex items-center gap-1.5 ${statusColors[e.status] || 'text-muted'}`}><Icon name={statusIcons[e.status] || 'info'} size={12} />Recorded: {e.status}</span>}
              <details className="basis-full"><summary className="cursor-pointer text-faint hover:text-body">Details</summary><div className="mt-1 space-y-1 text-muted"><p>Source: {e.id.startsWith('github:') ? 'GitHub checkpoint' : e.id.startsWith('native:') ? 'Local session' : e.id.startsWith('chat:') ? 'Local chat' : e.sessionId ? 'DevDeck state' : 'Local message'}</p>{!e.product && <p>Project not linked</p>}{!e.space && <p>Space not linked</p>}{e.folder && <p>Folder: {e.folder}</p>}{e.sessionId && <p>Session: {e.sessionId}</p>}</div></details>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {e.actions.length > 0 && <button onClick={() => setPicked(e.id)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-body hover:border-accent hover:text-accent"><Icon name="tool" size={12} />{e.actions.length} {e.actions.length === 1 ? 'action' : 'actions'} · {e.actions.filter(a => a.ok === false).length ? `${e.actions.filter(a => a.ok === false).length} failed` : 'recorded'}</button>}
              {['PR', 'issue', 'run', 'link'].map(kind => {
                const count = linkedItems(e).filter(item => item.kind === kind).length
                return count ? <button key={kind} onClick={() => setPicked(e.id)} aria-label={`Show ${count} ${kind}${count === 1 ? '' : 's'} in linked work`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-body hover:border-accent hover:text-accent"><BrandIcon brand="github" size={12} />{count} {kind}{count === 1 ? '' : 's'}</button> : null
              })}
            </div>
          </div></article>)}
          <form className="sticky bottom-0 rounded-xl border border-line bg-panel p-3 shadow-sm" onSubmit={e => { e.preventDefault(); void sendMessage() }}>
            <p className="mb-2 text-xs text-muted">{chatManager ? `Message ${chatManager.bot.name} directly. Existing context and permissions apply.` : 'Choose a manager above to start a conversation.'}</p>
            <textarea aria-label="Team message" placeholder={chatManager ? `Message ${chatManager.bot.name}…` : 'Choose a manager to chat…'} disabled={!chatTarget || !chatReady || sending} maxLength={6000} className={`${field} mt-2 w-full resize-y`} value={messageBody} onChange={e => setMessageBody(e.target.value)} />
            <div className="mt-2 flex items-center justify-between gap-3"><p role="status" className="text-xs text-muted">{notice}</p><button className="btn-primary" disabled={sending || chatLoading || !chatReady || !chatTarget || !messageBody.trim()}>{sending ? 'Replying…' : 'Send'}</button></div>
          </form>
        </div> : sessionsOnly ? <div className="space-y-3">{filteredSessions.map(s => <button key={s.id} onClick={() => setPicked(s.id)} className={`w-full rounded-xl border p-4 text-left ${picked === s.id ? 'border-accent bg-raise' : 'border-line bg-panel'}`}><div className="flex justify-between gap-3"><b>{s.title}</b><span className="text-xs text-muted">{stage(s.status)} · {isStale(s.updated_at) && stage(s.status) !== 'Done' ? 'Stale' : 'Recorded'}</span></div><p className="mt-2 text-sm text-muted">{s.assistant} · {s.id}</p><p className="mt-1 text-xs text-muted">{s.space} / {s.folder} · {new Date(s.updated_at).toLocaleString()}</p></button>)}</div> : layout === 'list' ? <div className="overflow-hidden rounded-xl border border-line bg-panel"><div className="grid grid-cols-[minmax(0,1fr)_100px_140px] gap-4 border-b border-line bg-soft px-4 py-3 text-xs font-semibold text-muted"><span>Issue / project</span><span>Status</span><span>Updated</span></div>{filtered.map(r => <button key={r.id} onClick={() => setPicked(r.id)} className={`grid w-full grid-cols-[minmax(0,1fr)_100px_140px] items-center gap-4 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-hover ${picked === r.id ? 'bg-accent/10' : ''}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{r.title}</span><span className="mt-1 block truncate text-xs text-muted">{r.product} · {r.source}{r.owners?.length ? ` · ${r.owners.join(', ')}` : ''}</span></span><span className={`inline-flex items-center gap-1.5 text-xs ${statusColors[r.status]}`}><Icon name={statusIcons[r.status]} size={13} />{r.status}</span><span className="text-xs text-muted">{r.updated ? new Date(r.updated).toLocaleString() : 'No update'}</span></button>)}</div> : <div className="grid min-w-[900px] grid-cols-5 gap-3">{columns.map(c => <section key={c}><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className={statusColors[c]}><Icon name={statusIcons[c]} size={15} /></span>{c} <span className="ml-auto rounded-full bg-soft px-2 py-0.5 text-xs text-muted">{filtered.filter(r => r.status === c).length}</span></h2><div className="space-y-3">{filtered.filter(r => r.status === c).map(r => <button key={r.id} onClick={() => setPicked(r.id)} className={`w-full rounded-xl border p-3 text-left ${picked === r.id ? 'border-accent bg-raise' : 'border-line bg-panel hover:border-accent/50 hover:bg-hover'}`}><p className="text-[11px] text-muted">{r.product} · {r.source}</p><p className="mt-2 text-sm font-medium">{r.title}</p><p className="mt-3 text-xs text-muted">{r.owners?.length ? `GitHub assignee: ${r.owners.join(', ')} · ` : ''}{r.sessions.length ? r.sessions.map(s => `${s.assistant} · ${stage(s.status)}${isStale(s.updated_at) && stage(s.status) !== 'Done' ? ' · Stale' : ''}`).join(', ') : 'No linked session'}</p><p className="mt-2 text-[11px] text-muted">{r.updated ? new Date(r.updated).toLocaleString() : 'No recorded update'}</p></button>)}</div></section>)}</div>}
      </main>
      {!sessionsOnly && view === 'timeline' && <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-panel p-5">
        <h2 className="text-lg font-semibold">Linked work</h2>
        <section className="mt-4 rounded-xl border border-line p-4"><h3 className="flex items-center gap-2 font-semibold">{timelineEntry?.url ? <BrandIcon brand="github" size={18} /> : <Icon name="inbox" size={18} />}{timelineEntry?.url ? githubLabel(timelineEntry.url) : 'Local discussion'}</h3><p className="mt-3 text-sm">{linkedIssue?.title || timelineEntry?.title || 'Select a message or checkpoint'}</p><p className="mt-2 text-xs text-muted">{timelineEntry?.space || 'Unscoped'} · {timelineEntry?.product || 'Project not linked'}</p>{timelineEntry?.status && <p className="mt-3 text-sm text-info">Recorded: {timelineEntry.status}</p>}{timelineEntry?.url && <p className="mt-4"><Link url={timelineEntry.url}>Open issue</Link></p>}</section>
        {timelineEntry && linkedItems(timelineEntry).length > 0 && <section className="mt-4 border-t border-line pt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">References</h3><div className="mt-3 space-y-2">{linkedItems(timelineEntry).map(item => <div key={item.url} className="rounded-lg border border-line bg-soft p-3"><p className="mb-1 text-[10px] uppercase text-muted">{item.kind === 'PR' ? 'Pull request' : item.kind === 'run' ? 'Workflow run' : item.kind}</p><Link url={item.url}>{githubLabel(item.url)}</Link></div>)}</div></section>}
        {timelineEntry && timelineEntry.actions.length > 0 && <section className="mt-4 border-t border-line pt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Recorded actions</h3>{timelineEntry.actions.map((action, index) => <details key={`${action.at}:${index}`} className="mt-2 rounded-lg border border-line bg-soft p-3"><summary className={`cursor-pointer text-xs ${action.ok === false ? 'text-err' : 'text-body'}`}>{action.tool || 'Tool action'} · {action.ok === false ? 'Failed' : action.ok === true ? 'Succeeded' : 'Recorded'}</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted">{action.text}</p></details>)}</section>}
        <section className="mt-4 rounded-xl border border-line p-4"><h3 className="font-semibold">Create a task</h3><p className="mt-2 text-xs text-muted">Open this checkpoint as a GitHub issue draft. Review and submit it on GitHub.</p><button className="btn-ghost mt-3 w-full" disabled={!issueProduct || !timelineEntry} onClick={draftIssue}>Create GitHub issue</button>{!issueProduct && <p className="mt-2 text-xs text-muted">Choose a connected project first.</p>}</section>
        <h3 className="mt-6 border-t border-line pt-4 font-semibold">Participants</h3>{choices(timeline.flatMap(e => [e.from, e.to])).map(name => <p key={name} className="mt-3 flex items-center gap-3 text-sm"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-soft text-body"><SenderMark name={name} size={16} /></span>{name}</p>)}
      </aside>}
      {(sessionsOnly || view !== 'timeline') && selected && <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-panel p-5"><button className="float-right text-muted" aria-label="Close activity details" onClick={() => setPicked('')}>×</button><h2 className="pr-5 font-semibold">{selected.title}</h2>{'url' in selected && selected.url && <p className="mt-3 text-sm"><Link url={selected.url}>Open GitHub item</Link></p>}
        <p className="mt-3 text-xs text-muted">{selected.space} / {selected.folder}</p>
        {details.length === 0 && <p className="mt-4 text-sm text-muted">No session has reported working on this item.</p>}
        {details.map(s => <section key={s.id} className="mt-5 border-t border-line pt-4"><h3 className="text-sm font-semibold">{s.assistant}</h3><p className="mt-1 break-all text-xs text-muted">{s.id}</p><p className="mt-2 text-sm">{s.status} · {isStale(s.updated_at) && stage(s.status) !== 'Done' ? 'Stale update' : 'Recorded update'}</p><p className="mt-1 text-xs text-muted">Started {new Date(s.started_at).toLocaleString()}<br/>Updated {new Date(s.updated_at).toLocaleString()}</p>{s.ticket_url && <p className="mt-2 text-sm"><Link url={s.ticket_url}>Linked GitHub item</Link></p>}{s.conversation_url && <p className="mt-2 break-all text-xs text-muted">Conversation: {s.conversation_url}</p>}{s.step && <p className="mt-3 text-sm"><b>Current step:</b> {s.step}</p>}{s.blocker && <p className="mt-3 text-sm text-err"><b>Blocker:</b> {s.blocker}</p>}{s.next_action && <p className="mt-3 text-sm"><b>Next action:</b> {s.next_action}</p>}<h4 className="mt-4 text-xs font-semibold text-muted">Checkpoint history</h4>{s.checkpoints.length === 0 && <p className="mt-2 text-xs text-muted">No checkpoints recorded.</p>}{s.checkpoints.map((h,i) => <div key={`${h.at}:${i}`} className="mt-3 border-l-2 border-line pl-3"><p className="text-xs text-muted">{new Date(h.at).toLocaleString()}</p><p className="mt-1 text-sm">{h.summary}</p>{h.evidence.map(e => <p key={e} className="mt-1 break-all text-xs"><Link url={e}>{e}</Link></p>)}</div>)}</section>)}
      </aside>}
    </div>
  </div>
}

