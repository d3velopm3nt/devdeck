import { DeckLogo } from '../widget/DeckLogo'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { Icon } from '../lib/icons'
import { IssueMonitorPanel } from './IssueMonitorPanel'
import './github-workspace.css'

const attention = (d: ipc.IssueDispatch) => ['blocked', 'failed', 'review'].includes(d.status)
const statusLabel = (status: string) => status === 'review' ? 'Needs review' : status.replaceAll('_', ' ')
const date = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not checked yet'
type BriefingProps = { taskAttention?: number; working?: number; unreadMail?: number | null }

export function GitHubBriefing({ taskAttention = 0, working = 0, unreadMail = null }: BriefingProps) {
  const { data, error } = useRepositoryActivity()
  const navigate = useApp(s => s.setRailView)
  const waiting = data?.dispatches.filter(attention) || []
  const failures = data?.sources.filter(s => s.error) || []
  return <section className="dev-briefing" aria-label="Dev’s briefing">
    <div className="gh-byline"><span className="gh-dev"><DeckLogo size={22} /></span><h2>Dev’s briefing</h2><span className="gh-subtle">From your saved activity</span></div>
    <p className="gh-lead">{waiting.length+taskAttention ? `${waiting.length+taskAttention} item${waiting.length+taskAttention===1?' needs':'s need'} your attention.` : 'Your day, with Dev.'}</p>
    <p className="gh-muted">{taskAttention ? `${taskAttention} task approvals or blockers need you. ` : ''}{working ? `${working} agent run${working === 1 ? ' is' : 's are'} active.` : 'Review what needs you, then pick up your next task.'}</p>
    {error && <p role="alert" className="text-err">Repository activity unavailable: {error}</p>}
    {data?.sources.filter(s => s.briefing?.text).sort((a,b) => (b.briefing?.generated_at || '').localeCompare(a.briefing?.generated_at || '')).slice(0, 2).map(s => <div className="gh-brief-row" key={`brief:${s.repository}`}><Icon name="ai" size={16} /><div><strong>{s.repository} {s.briefing?.unread && <span className="gh-status">New</span>}</strong><p className="gh-detail-copy">{s.briefing?.text}</p><small>{date(s.briefing?.generated_at || '')}{s.briefing?.error ? ' · Latest assessment unavailable; showing saved briefing' : ''}</small></div><button className="gh-action" onClick={() => { sessionStorage.setItem('devdeck.github.selection', `${s.repository}:briefing`); navigate('github') }}>Open briefing <Icon name="chevron-right" size={13} /></button></div>)}
    {waiting.slice(0, 2).map(d => <div className="gh-brief-row" key={`${d.repository}:${d.number}`}><Icon name={d.status === 'review' ? 'view' : 'alert'} size={16} /><div><strong>{d.repository} #{d.number}</strong><small>{statusLabel(d.status)}{d.message ? ` · ${d.message}` : ''}</small></div><button className="gh-action" onClick={() => { sessionStorage.setItem('devdeck.github.selection', `${d.repository}:${d.number}`); navigate('github') }}>View details <Icon name="chevron-right" size={13} /></button></div>)}
    {!!failures.length && <p className="text-warn">{failures.length} repository refresh{failures.length === 1 ? '' : 'es'} failed. Previously saved activity is retained.</p>}
    <div className="gh-brief-links">
      <button onClick={() => navigate('mail')}><Icon name="mail" size={15} /><span>Mail<small>{unreadMail == null ? 'Open inbox' : `${unreadMail} unread`}</small></span><Icon name="chevron-right" size={13} /></button>
      <button onClick={() => navigate('team')}><Icon name="check" size={15} /><span>DevDeck tasks<small>{taskAttention ? `${taskAttention} need attention` : 'View work and goals'}</small></span><Icon name="chevron-right" size={13} /></button>
      <button onClick={() => navigate('github')}><Icon name="github" size={15} /><span>Repositories<small>{data ? `${data.sources.length} connected · ${data.enabled ? 'monitoring on' : 'paused'}` : 'Loading…'}</small></span><Icon name="chevron-right" size={13} /></button>
    </div>
    <button className="gh-chat-link" onClick={() => navigate('chat')}><Icon name="ai" size={15} /> Talk to Dev <span className="gh-muted">Continue in your main chat</span><Icon name="chevron-right" size={13} /></button>
  </section>
}

type Activity = { id: string; repository: string; number: number; title: string; kind: 'issues' | 'pulls' | 'commits' | 'briefing' | 'health'; status: string; updated: string; dispatch?: ipc.IssueDispatch; message: string; sha?: string }

export function GitHubPage() {
  const { data, error, setData } = useRepositoryActivity()
  const [query, setQuery] = useState('')
  const [repo, setRepo] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(() => sessionStorage.getItem('devdeck.github.selection') || '')
  const [settings, setSettings] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useApp(s => s.setRailView)
  const sources = data?.sources || []
  const entries: Activity[] = sources.flatMap(s => {
    const items: Activity[] = s.items.map(i => {
      const dispatch = data?.dispatches.find(d => d.repository === s.repository && d.number === i.number)
      return { id: `${s.repository}:${i.number}`, repository: s.repository, number: i.number, title: i.title, kind: i.pull_request ? 'pulls' : 'issues', status: dispatch?.status || i.state, updated: i.updated_at, dispatch, message: dispatch?.message || '' }
    })
    for (const d of data?.dispatches.filter(d => d.repository === s.repository) || []) {
      if (!items.some(i => i.number === d.number)) items.push({ id: `${s.repository}:${d.number}`, repository: s.repository, number: d.number, title: `Issue #${d.number}`, kind: 'issues', status: d.status, updated: '', dispatch: d, message: d.message })
    }
    for (const p of s.activity?.pulls || []) {
      const prior = items.findIndex(i => i.number === p.number)
      if (prior >= 0) items.splice(prior, 1)
      items.push({ id: `${s.repository}:${p.number}`, repository: s.repository, number: p.number, title: p.title, kind: 'pulls', status: p.checks === 'failed' ? 'failed' : p.reviewers.length ? 'review requested' : p.state, updated: p.updated_at, message: `Checks: ${p.checks.replaceAll('_', ' ')}${p.check_error ? ` (${p.check_error})` : ''}\nRequested reviewers: ${p.reviewers.join(', ') || 'none'}${p.draft ? '\nDraft PR' : ''}` })
    }
    for (const c of s.activity?.commits || []) items.push({ id: `${s.repository}:${c.sha}`, repository: s.repository, number: 0, title: c.title.split('\n')[0], kind: 'commits', status: 'committed', updated: c.updated_at, sha: c.sha, message: `${c.author}\n${c.sha}\n${c.title}` })
    if (s.briefing?.text || s.briefing?.error) items.unshift({ id: `${s.repository}:briefing`, repository: s.repository, number: 0, title: 'Dev’s repository briefing', kind: 'briefing', status: s.briefing.error ? 'assessment unavailable' : s.briefing.unread ? 'new briefing' : 'briefing', updated: s.briefing.generated_at || s.briefing.attempted_at, message: s.briefing.text || s.briefing.error })
    if (s.activity?.error) items.unshift({ id: `${s.repository}:activity-health`, repository: s.repository, number: 0, title: 'PR and commit refresh failed', kind: 'health', status: 'failed', updated: s.activity.last_attempt, message: s.activity.error })
    if (s.error) items.unshift({ id: `${s.repository}:health`, repository: s.repository, number: 0, title: 'Repository refresh failed', kind: 'health', status: 'failed', updated: s.last_attempt, message: s.error })
    return items
  }).sort((a, b) => Number(['review', 'failed', 'blocked', 'new briefing', 'review requested'].includes(b.status)) - Number(['review', 'failed', 'blocked', 'new briefing', 'review requested'].includes(a.status)) || (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0))
  const visible = entries.filter(e => (!repo || repo === e.repository) && (filter === 'all' || (filter === 'attention' ? ['review', 'failed', 'blocked', 'new briefing', 'review requested'].includes(e.status) : filter === 'work' ? !!e.dispatch || e.kind === 'briefing' : filter === e.kind)) && `${e.repository} ${e.title} ${e.number}`.toLowerCase().includes(query.toLowerCase()))
  const picked = visible.find(e => e.id === selected) || visible[0]
  const source = sources.find(s => s.repository === (picked?.repository || repo))
  const openIssue = async () => {
    if (!picked || (!picked.number && !picked.sha)) return
    setActionError('')
    try { await ipc.openUrl(`https://github.com/${picked.repository}/${picked.sha ? `commit/${picked.sha}` : `${picked.kind === 'pulls' ? 'pull' : 'issues'}/${picked.number}`}`) } catch (e) { setActionError(String(e)) }
  }
  const briefingAction = async (retry: boolean) => {
    if (!source) return
    if (picked) setSelected(picked.id)
    setBusy(true); setActionError('')
    try { setData(await ipc.repositoryBriefingRead(source.repository, retry, source.briefing?.generated_at || '')) } catch(e) { setActionError(String(e)) } finally { setBusy(false) }
  }
  return <div className="gh-workspace">
    <header className="gh-heading"><div><h1>GitHub</h1><p>Repository activity and Dev’s work · current vault</p></div><button className="gh-action" onClick={() => setSettings(v => !v)} aria-expanded={settings}><Icon name="settings" size={15} /> Monitoring</button></header>
    {settings && <IssueMonitorPanel />}
    {error && <p className="gh-banner text-err" role="alert">{error} {data ? 'Showing the last loaded snapshot.' : ''}</p>}
    {data?.warnings.map(w => <p className="gh-banner text-warn" key={w}>{w}</p>)}
    <div className="gh-layout">
      <aside className="gh-repositories" aria-label="Repositories"><span className="gh-eyebrow">Repositories</span><button className={!repo ? 'selected' : ''} onClick={() => setRepo('')}>All repositories <small>{sources.length}</small></button>{sources.map(s => <button key={s.repository} title={s.repository} className={repo === s.repository ? 'selected' : ''} onClick={() => setRepo(s.repository)}><Icon name="github" size={14} /><span>{s.repository.split('/').pop()}<small>{s.repository.split('/')[0]}</small></span>{s.error && <Icon name="alert" size={13} />}</button>)}<div className="gh-coverage"><span className="gh-eyebrow">Coverage</span><p>Issues · PRs · Commits</p><small>Recent activity and sampled PR checks.</small></div></aside>
      <section className="gh-feed" aria-label="Repository activity"><div className="gh-toolbar"><label className="gh-search"><Icon name="search" size={14} /><input aria-label="Search repository activity" placeholder="Search activity…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="gh-filters" aria-label="Activity filters">{[['all', 'All activity'], ['attention', 'Needs you'], ['work', 'Dev’s work'], ['issues', 'Issues'], ['pulls', 'PRs'], ['commits', 'Commits']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
      <div className="gh-feed-body"><div className="gh-entries">{visible.map(e => <button className={`gh-entry ${picked?.id === e.id ? 'selected' : ''}`} key={e.id} aria-pressed={picked?.id === e.id} onClick={() => { setSelected(e.id); sessionStorage.setItem('devdeck.github.selection', e.id); setActionError('') }}><Icon name={e.kind === 'health' ? 'alert' : e.kind === 'briefing' ? 'ai' : e.kind === 'commits' ? 'commit' : e.status === 'review' ? 'view' : 'github'} size={16} /><span><strong>{e.title}</strong><small>{e.repository}{e.number ? ` #${e.number}` : ''} · {statusLabel(e.status)}</small></span><Icon name="chevron-right" size={12} /></button>)}{!visible.length && <div className="gh-empty"><Icon name="github" size={22} /><h2>{!data ? error ? 'Activity unavailable' : 'Loading activity…' : !sources.length ? 'Connect your repositories' : 'No matching activity'}</h2><p>{!sources.length && data ? 'Connect a GitHub project to follow its issues and Dev’s work here.' : 'Try another repository or filter.'}</p>{!sources.length && data && <button className="gh-action" onClick={() => navigate('activity')}>Connect in Activity <Icon name="chevron-right" size={13} /></button>}</div>}</div>
      <aside className="gh-detail" aria-label="Selected activity"><div className="gh-byline"><span className="gh-dev"><Icon name="ai" size={16} /></span><h2>Dev’s work</h2></div>{picked ? <><p className="gh-detail-title">{picked.title}</p><span className="gh-status">{statusLabel(picked.status)}</span><p className="gh-detail-copy">{picked.message || (picked.status === 'review' ? 'This workflow is waiting for human review. Open the activity board to inspect its evidence.' : picked.dispatch ? 'This issue is linked to a DevDeck workflow. Follow its progress in Activity.' : 'Saved GitHub activity. Dev has not recorded an assessment for this item.')}</p>{picked.dispatch?.workflow && <small className="gh-wrap">Workflow · {picked.dispatch.workflow}</small>}<div className="gh-detail-actions">{picked.kind === 'briefing' && <><button className="gh-action" disabled={busy || !source?.briefing?.unread} onClick={() => void briefingAction(false)}>Mark read</button><button className="gh-action" disabled={busy || !data?.briefings} onClick={() => void briefingAction(true)}>{busy ? 'Asking Dev…' : 'Retry briefing'}</button></>}{picked.dispatch && <button className="gh-action" onClick={() => navigate('activity')}>Open activity board <Icon name="chevron-right" size={13} /></button>}{(!!picked.number || !!picked.sha) && <button className="gh-action" onClick={() => void openIssue()}>Open on GitHub <Icon name="external" size={13} /></button>}</div>{actionError && <p role="alert" className="text-err">{actionError}</p>}<div className="gh-freshness"><small>Last successful check</small><p>{date((picked.kind === 'commits' || picked.kind === 'pulls' ? source?.activity?.fetched_at : source?.fetched_at) || '')}</p>{source?.error && <p className="text-warn">Refresh failed; showing saved activity.</p>}{source?.activity?.warnings.map(w => <p className="gh-muted" key={w}>{w}</p>)}{source?.briefing?.error && picked.kind === 'briefing' && <p className="text-warn">{source.briefing.error}</p>}{source?.truncated && <p className="text-warn">Partial history</p>}{source?.warnings.map(w => <p className="text-warn" key={w}>{w}</p>)}</div>{picked.kind === 'pulls' && <small>Checks reflect the last sampled head commit. Requested reviewers are shown by name.</small>}</> : <p className="gh-muted">Select activity to see its details and recorded progress.</p>}</aside></div></section>
    </div><footer className="gh-footer"><span>{data ? `${sources.length} connected · Repository monitoring ${data.enabled ? 'on' : 'paused'}` : 'Loading monitor…'}</span><span>Saved activity · automatic execution {data?.dispatch_enabled ? 'enabled' : 'off'}</span></footer>
  </div>
}

// Both surfaces read the monitor's persisted snapshot, never a second GitHub poller.
function useRepositorySnapshot(enabled = true) {
  const [data, setData] = useState<ipc.IssueMonitorView | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let active = true
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try { const next = await ipc.issueMonitorGet(); if (active) { setData(next); setError('') } }
      catch (e) { if (active) setError(String(e)) }
      finally { loading = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    const off = listen('aiw:event', () => void load())
    void off.catch(() => {})
    return () => { active = false; clearInterval(timer); void off.then(f => f()).catch(() => {}) }
  }, [enabled])
  return { data, error, setData }
}

const RepositoryContext=createContext<ReturnType<typeof useRepositorySnapshot>|null>(null)
export function RepositoryActivityProvider({children}:{children:ReactNode}) {
 const snapshot=useRepositorySnapshot()
 return <RepositoryContext.Provider value={snapshot}>{children}</RepositoryContext.Provider>
}
export function useRepositoryActivity(){
 const shared=useContext(RepositoryContext)
 const local=useRepositorySnapshot(!shared)
 return shared||local
}
