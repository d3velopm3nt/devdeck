import { openRun } from '../lib/dock'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { subtreeIds } from '../lib/tree'
import { aiw } from '../lib/aiw'
import { useAiw } from '../lib/aiwStore'
import { useTeamNavigation } from '../lib/teamNavigation'
import { Icon } from '../lib/icons'
import { FilterTabs, StateBadge } from './ui/DesignSystem'
import { TeamFilter } from './agents/TeamFilter'
import './agents/workforce.css'

export function MessageBoard({ embedded = false }: { embedded?: boolean }) {
  const { teams, team, reload: reloadTeams } = useTeamNavigation()
  const [messages, setMessages] = useState<ipc.ManagerMessage[]>([])
  const [managers, setManagers] = useState<ipc.TeamMember[]>([])
  const [tasks, setTasks] = useState<ipc.WorkRecord[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [task, setTask] = useState('')
  const [project, setProject] = useState('')
  const nodes = useApp(s => s.nodes)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [compose, setCompose] = useState(false)
  const [reply, setReply] = useState<ipc.ManagerMessage | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draftTeam, setDraftTeam] = useState('')
  const [draftTask, setDraftTask] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const reload = useCallback(async () => {
    const version = ++generation.current
    setLoading(true)
    const results = await Promise.allSettled([ipc.messageBoard(), ipc.managerTeam(), ipc.workRecordsList()])
    if (version !== generation.current) return
    const [mail, people, work] = results
    if (mail.status === 'fulfilled') setMessages(mail.value)
    if (people.status === 'fulfilled') setManagers(people.value)
    if (work.status === 'fulfilled') setTasks(work.value)
    setError(results.flatMap(r => r.status === 'rejected' ? [String(r.reason)] : []).join('; '))
    setLoading(false)
  }, [])
  useEffect(() => {
    void reload(); void reloadTeams()
    const stop = aiw.onEvent(e => { if (e.type === 'manager.message.delivered' || e.type === 'ManagerMessageDelivered') void reload() })
    const refreshTimer = setInterval(() => void reload(), 5000)
    return () => { clearInterval(refreshTimer); invalidate(); void stop.then(off => off()).catch(() => {}) }
  }, [reload, reloadTeams, invalidate])
  const taskOptions = [...new Map([...tasks.map(t => [t.id, {id:t.id,title:t.title}] as const), ...messages.filter(m => m.task_id && m.task_title).map(m => [m.task_id!, {id:m.task_id!,title:m.task_title!}] as const)]).values()]
  const answered = new Set(messages.flatMap(m => m.reply_to ? [m.reply_to] : []))
  const state = (m: ipc.ManagerMessage) => (m.source === 'conversation' || m.source === 'workflow') ? (m.outcome === 'failed' ? 'failed' : 'recorded') : m.kind === 'acknowledgement' ? 'closed' : answered.has(m.id) ? 'answered' : 'pending'
  const projectNodes = project ? new Set(subtreeIds(nodes, Number(project))) : null
  const shown = messages.filter(m => (!team || m.team_id === team) && (!task || m.task_id === task) && (!projectNodes || (m.project_id && projectNodes.has(Number(m.project_id))) || tasks.some(t => t.id === m.task_id && projectNodes.has(t.node))) && (status === 'all' || state(m) === status) && `${m.subject} ${m.body} ${m.from} ${m.to}`.toLowerCase().includes(query.toLowerCase())).toSorted((a,b) => b.created_at.localeCompare(a.created_at))
  const name = (handle: string) => handle === 'assistant' ? 'Dev' : handle === 'work-item' ? 'Work item' : handle === 'work-thread' ? 'Work conversation' : managers.find(m => m.bot.handle === handle)?.bot.name || handle
  const begin = (message: ipc.ManagerMessage | null) => {
    setReply(message); setFrom(message?.to || ''); setTo(message?.from || ''); setSubject(message ? 'Re: ' + message.subject : ''); setBody(''); setDraftTeam(message?.team_id || team); setDraftTask(message?.task_id || task); setCompose(true); setNotice('')
  }
  const send = async () => {
    if (sending) return
    setSending(true); setError('')
    try {
      await ipc.managerMessageSend(from, { to, subject, body, kind: reply ? 'reply' : 'request', reply_to:reply?.id || null, team_id:draftTeam || null, task_id:draftTask || null })
      setCompose(false); setBody(''); setNotice('Delivered to the manager mailbox. The recipient reads it on their next turn.'); await reload()
    } catch (e) { setError(String(e)) } finally { setSending(false) }
  }
  const controls = <div className="flex gap-2"><button className="wf-icon-button" title="Refresh messages" aria-label="Refresh messages" onClick={() => void reload()}><Icon name="update" size={18}/></button><button className="wf-icon-button" title="New message" aria-label="New message" onClick={() => begin(null)}><Icon name="add" size={18}/></button></div>
  return <div className={embedded ? "min-h-0 flex-1 overflow-auto" : "workforce"}>{!embedded && <header className="wf-header">{!embedded && <div className="wf-brand"><Icon name="mail" size={20}/><h1>Messages</h1></div>}{controls}</header>}<main className="wf-content"><div className="message-filters flex flex-wrap gap-3 mb-3"><TeamFilter/><label className="flex items-center gap-2 text-xs text-muted">Project<select className="input" aria-label="Filter messages by project" value={project} onChange={e => setProject(e.target.value)}><option value="">All projects</option>{nodes.filter(n => n.kind === 'project').map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label className="flex items-center gap-2 text-xs text-muted">Task<select className="input" aria-label="Filter messages by task" value={task} onChange={e => setTask(e.target.value)}><option value="">All tasks</option>{taskOptions.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><label className="wh-search"><Icon name="search" size={16}/><input aria-label="Search messages" placeholder="Search messages or agents…" value={query} onChange={e => setQuery(e.target.value)}/></label>{embedded && controls}<button className="wf-icon-button" aria-label="Clear message filters" title="Clear filters" onClick={() => { useTeamNavigation.setState({ team:'' }); setTask(''); setProject(''); setStatus('all'); setQuery('') }}><Icon name="close" size={16}/></button></div><FilterTabs label="Message status" value={status} onChange={setStatus} options={[{id:'all',label:'All',icon:'mail'},{id:'pending',label:'Awaiting reply',icon:'history'},{id:'answered',label:'Answered',icon:'check'},{id:'closed',label:'Closed',icon:'ok'},{id:'recorded',label:'Activity',icon:'list'},{id:'failed',label:'Failed',icon:'alert'}]}/><p className="text-xs text-muted my-3">Requests, handoffs and agent reports. Activity without an explicit team link appears in All teams. Ordinary chat stays in its conversation.</p>{error && <p role="alert" className="text-err">{error}</p>}{notice && <p role="status">{notice}</p>}
    {compose && <section className="rounded-lg border border-line p-4 mb-4" aria-label="Compose manager message"><h2 className="font-semibold mb-3">{reply ? 'Reply' : 'New manager request'}</h2><div className="grid gap-3"><label>From<select className="input w-full" aria-label="Message sender" disabled={!!reply || sending} value={from} onChange={e => { setFrom(e.target.value); setTo('') }}><option value="">Choose a manager</option>{managers.map(m => <option key={m.bot.handle} value={m.bot.handle}>{m.bot.name}</option>)}</select></label><label>To<select className="input w-full" aria-label="Message recipient" disabled={!!reply || sending} value={to} onChange={e => setTo(e.target.value)}><option value="">Choose a connected manager</option>{managers.filter(m => m.bot.handle !== from && managers.find(s => s.bot.handle === from)?.profile.peers.includes(m.bot.handle) && m.profile.peers.includes(from)).map(m => <option key={m.bot.handle} value={m.bot.handle}>{m.bot.name}</option>)}</select></label><label>Team<select className="input w-full" aria-label="Message team" disabled={!!reply || sending} value={draftTeam} onChange={e => setDraftTeam(e.target.value)}><option value="">No team link</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Task<select className="input w-full" aria-label="Message task" disabled={!!reply || sending} value={draftTask} onChange={e => setDraftTask(e.target.value)}><option value="">No task link</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><input className="input" aria-label="Message subject" placeholder="Subject" maxLength={200} disabled={sending} value={subject} onChange={e => setSubject(e.target.value)}/><textarea className="input" aria-label="Message body" placeholder="Write a focused request…" maxLength={6000} rows={4} disabled={sending} value={body} onChange={e => setBody(e.target.value)}/><div className="flex gap-2"><button className="wf-primary" disabled={sending || !from || !to || !subject.trim() || !body.trim()} onClick={() => void send()}>Send request</button><button className="wf-secondary" disabled={sending} onClick={() => setCompose(false)}>Cancel</button></div><p className="text-xs text-muted">Sending queues a message; it does not start a run or grant permissions.</p></div></section>}
    <section className="space-y-3" aria-label="Message board">{shown.map(m => <article className="rounded-lg border border-line p-4" key={m.id}><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{m.agent_name || name(m.from)} → {name(m.to)}</span><StateBadge state={m.activity_status || ((m.source === 'conversation' || m.source === 'workflow') ? (m.outcome === 'failed' ? 'failed' : 'neutral') : state(m) === 'pending' ? 'queued' : 'completed')} label={m.activity_status ? undefined : (m.source === 'conversation' || m.source === 'workflow') ? (m.outcome === 'failed' ? 'Failed attempt' : 'Recorded activity') : state(m) === 'pending' ? 'Awaiting reply' : state(m) === 'answered' ? 'Answered' : 'Closed'}/><time className="ml-auto text-xs text-muted">{new Date(m.created_at).toLocaleString()}</time></div><h2 className="mt-3 font-semibold">{m.subject}</h2>{m.source === 'workflow' ? <details className="mt-2 text-sm"><summary>Read agent report</summary><p className="mt-2 whitespace-pre-wrap break-words">{m.body}</p></details> : <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>}<p className="mt-3 text-xs text-muted">{teams.find(t => t.id === m.team_id)?.name || (m.team_id ? 'Unavailable team' : 'No team link')}{m.task_id ? ' · ' + (taskOptions.find(t => t.id === m.task_id)?.title || 'Linked task unavailable') : ''}</p>{m.reply_to && <details className="mt-2 text-xs"><summary>Original message</summary><p>{messages.find(p => p.id === m.reply_to)?.body || 'Original message unavailable.'}</p></details>}{m.source === 'workflow' && m.task_id && <button className="wf-icon-button mt-2" title="Open work item" aria-label={'Open work item for ' + m.subject} onClick={() => { useTeamNavigation.setState({team:''}); useApp.getState().focusWorkItem(m.task_id!) }}><Icon name="list" size={16}/></button>}{m.run_id && <button className="wf-icon-button mt-2" title="Open agent run" aria-label={'Open run for ' + m.subject} onClick={() => openRun(m.run_id!, m.subject)}><Icon name="external" size={16}/></button>}{m.conversation_id && <button className="wf-icon-button mt-2" title="Open source conversation" aria-label={'Open conversation for ' + m.subject} onClick={() => { void useAiw.getState().openConversation(m.conversation_id!).then(() => useApp.getState().setRailView('chat')).catch(e => setError(String(e))) }}><Icon name="external" size={16}/></button>}{state(m) === 'pending' && <button className="wf-icon-button mt-2" title={'Reply to ' + m.subject} aria-label={'Reply to ' + m.subject} onClick={() => begin(m)}><Icon name="reply" size={16}/></button>}</article>)}</section>{!shown.length && <p className="text-muted py-8">{loading ? 'Loading messages…' : 'No messages match these filters.'}</p>}
    </main></div>
}
