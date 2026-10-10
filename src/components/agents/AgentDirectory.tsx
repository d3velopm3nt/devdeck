import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'
import { aiw } from '../../lib/aiw'
import { subtreeIds } from '../../lib/tree'
import { ManagerWorkspace } from './AgentsPage'
import { Settings } from '../aiw/Settings'
import { WorkerEditor } from '../workers/WorkerEditor'
import { useLibrary } from '../workers/LibraryPanel'
import { startWorker } from '../workers/StartWorker'

type Role = 'manager' | 'worker' | 'specialist'
const blank = (role: Role, profile: string, nodeId: number): ipc.Worker => ({
  handle: '', name: '', category: role === 'specialist' ? role : 'worker', profile,
  what: profile === 'Developer' ? 'Implement an agreed task and return a reviewable change' : profile === 'QA' ? 'Verify agreed behavior and report reproducible findings' : profile === 'Researcher' ? 'Research a question and return sources and findings' : profile === 'Writer' ? 'Draft requested content for review' : '',
  brief: '', skills: [], kit: '', runner: 'claude-code', model: 'sonnet', writes: profile === 'Developer' ? 'branch' : 'folder', minutes: 20, usd: 2,
  spaces: nodeId ? [nodeId] : [], unattended: false, allow: [], allow_until: '', created_at: '', body: profile === 'Developer' ? 'Implement only the agreed task. Run relevant checks and return a change for human review.' : profile === 'QA' ? 'Check the acceptance criteria. Report reproducible failures and evidence; do not claim untested behavior passes.' : profile === 'Researcher' ? 'Use relevant sources. Separate verified facts from assumptions and cite evidence.' : profile === 'Writer' ? 'Follow the requested audience, tone and format. Return a draft for review.' : '',
})

export function AgentDirectory() {
  const nodes = useApp(s => s.nodes)
  const scope = useApp(s => s.spaceScopeId)
  const refreshBots = useApp(s => s.refreshBots)
  const agents = useAiw(s => s.agents)
  const sessions = useAiw(s => s.sessions)
  const reloadAgents = useAiw(s => s.reloadAgents)
  const lib = useLibrary()
  const [team, setTeam] = useState<ipc.TeamMember[]>([])
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [runs, setRuns] = useState<ipc.Run[]>([])
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [role, setRole] = useState<Role>('worker')
  const [profile, setProfile] = useState('Developer')
  const [name, setName] = useState('')
  const [nodeId, setNodeId] = useState(scope ?? 0)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<ipc.Worker | null>(null)
  const [settings, setSettings] = useState(false)
  const reload = useCallback(async () => {
    try {
      const [t, w, r] = await Promise.all([ipc.managerTeam(), ipc.workersList(), ipc.runsList(0)])
      setTeam(t); setWorkers(w); setRuns(r)
    } catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => {
    void reload(); void reloadAgents()
    const stop = aiw.onEvent(e => { if (e.type.startsWith('manager.') || e.type.startsWith('session.')) void reload() })
    const workerStop = ipc.onWorker({ done: () => void reload(), asking: () => void reload() })
    return () => { void stop.then(off => off()); void workerStop.then(off => off()) }
  }, [reload, reloadAgents])
  const scopeIds = scope == null ? null : new Set(subtreeIds(nodes, scope))
  const spaceName = (id: number) => nodes.find(n => n.id === id)?.name || 'Unassigned'
  const visibleTeam = team.filter(t => !scopeIds || scopeIds.has(t.bot.node_id) || t.bot.businesses?.some(id => scopeIds.has(id)))
  const visibleWorkers = workers.filter(w => !scopeIds || !w.spaces.length || w.spaces.some(id => scopeIds.has(id)))
  const rows = [
    ...visibleTeam.map(t => ({ id: `manager:${t.bot.handle}`, name: t.bot.name, role: 'manager', profile: t.profile.role || 'Manager', space: spaceName(t.bot.node_id), task: t.bot.goal, status: t.pending ? `${t.pending} messages` : 'Ready', engine: t.bot.agent || 'Default assistant', parent: '' })),
    ...visibleWorkers.map(w => {
      const latest = runs.filter(r => r.worker === w.handle).sort((a,b) => b.started_at.localeCompare(a.started_at))[0]
      const parents = visibleTeam.filter(t => t.profile.workers.includes(w.handle) || t.bot.worker === w.handle).map(t => t.bot.name)
      return { id: `worker:${w.handle}`, name: w.name, role: w.category || 'worker', profile: w.profile || w.what || 'Custom', space: w.spaces.length ? w.spaces.map(spaceName).join(', ') : 'Available across spaces', task: latest?.title || 'No task yet', status: latest?.status || 'Ready', engine: `${w.runner} · ${w.model || 'runner default'}`, parent: parents.join(', ') }
    }),
    ...agents.filter(a => a.id !== 'assistant').map(a => {
      const latest = sessions.filter(s => s.agent_id === a.id).sort((a,b) => b.started_at.localeCompare(a.started_at))[0]
      return { id: `agent:${a.id}`, name: a.name, role: 'specialist', profile: a.role, space: 'Available across spaces', task: latest?.summary || latest?.feature_id || 'No task yet', status: latest?.status || 'Ready', engine: `${a.provider} · ${a.model}`, parent: visibleTeam.filter(t => t.bot.team.includes(a.id)).map(t => t.bot.name).join(', ') }
    }),
  ].filter(r => filter === 'all' || r.role === filter)
  const member = team.find(t => `manager:${t.bot.handle}` === selected)
  const create = async () => {
    if (role !== 'manager') { setEditing(blank(role, profile, nodeId)); setAdding(false); return }
    if (!name.trim() || !nodeId) { setError('Name your manager and choose its space.'); return }
    setBusy(true); setError('')
    try {
      const bot = await ipc.botCreate({ nodeId, templateId: '', name: name.trim(), goal: 'Coordinate agreed tasks and report blockers', every: '', atMin: 480, days: '', withPlan: false })
      // Keep the created manager selected if profile persistence fails, so retry never creates a duplicate.
      setSelected(`manager:${bot.handle}`); setAdding(false)
      await ipc.managerProfileSave(bot.handle, { revision: 0, domain: 'business', role: profile, responsibilities: ['Coordinate agreed tasks', 'Assign the team and report blockers', 'Return evidence for review'], boundaries: ['Ask before publishing or merging', 'Stay within assigned space permissions'], peers: [], workers: [] })
      await refreshBots(); await reload()
    } catch(e) { setError(String(e)); await refreshBots(); await reload() }
    finally { setBusy(false) }
  }
  return <div className="flex h-full min-h-0 flex-col bg-page">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
      <div><h1 className="text-xl font-semibold text-ink">Agents</h1><p className="mt-1 text-sm text-muted">Your agents, roles and teams in one place.</p></div>
      <div className="flex gap-2"><button className="btn-ghost" onClick={() => setSettings(!settings)}>{settings ? 'Back to agents' : 'AI & permissions'}</button><button className="btn-primary" onClick={() => { setSettings(false); setAdding(true) }}>Add agent</button></div>
    </header>
    {settings ? <Settings /> : <div className="min-h-0 flex-1 space-y-5 overflow-auto p-6">
      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      {adding && <section className="space-y-3 rounded-xl border border-line bg-panel p-4" aria-label="Add agent">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-dim">Role<select aria-label="Role" className="input mt-1 w-full" value={role} onChange={e => { const v=e.target.value as Role; setRole(v); setProfile(v === 'manager' ? 'Delivery manager' : 'Developer') }}><option value="manager">Manager</option><option value="worker">Worker</option><option value="specialist">Specialist</option></select></label>
          <label className="text-sm text-dim">Role profile<select aria-label="Role profile" className="input mt-1 w-full" value={profile} onChange={e => setProfile(e.target.value)}>{(role === 'manager' ? ['Delivery manager', 'Business manager', 'Custom'] : ['Developer', 'QA', 'Researcher', 'Writer', 'Custom']).map(p => <option key={p}>{p}</option>)}</select></label>
          <label className="text-sm text-dim">Space<select aria-label="Space" className="input mt-1 w-full" value={nodeId} onChange={e => setNodeId(Number(e.target.value))}><option value={0}>Choose a space</option>{nodes.filter(n => n.kind === 'workspace' || n.kind === 'project').map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        </div>
        {role === 'manager' && <label className="block text-sm text-dim">Name<input aria-label="Name" className="input mt-1 w-full" value={name} onChange={e => setName(e.target.value)} /></label>}
        <p className="text-xs text-muted">{role === 'manager' ? 'Uses the default assistant for conversations. Scheduling is configured separately.' : 'Next, choose its name, skills and execution connection. Coding workers use a CLI connection.'}</p>
        <div className="flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => void create()}>{role === 'manager' ? 'Create manager' : 'Continue'}</button><button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button></div>
      </section>}
      <label className="block text-sm text-dim">Role filter<select className="input ml-3" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All agents</option><option value="manager">Managers</option><option value="worker">Workers</option><option value="specialist">Specialists</option></select></label>
      <div className="overflow-auto rounded-xl border border-line bg-panel"><table className="w-full text-left text-sm"><thead className="bg-soft text-muted"><tr>{['Agent / profile', 'Role', 'Team / space', 'Task / status', 'Connection', ''].map((h,i) => <th className="px-4 py-3" key={i}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-t border-line">
        <td className="px-4 py-3"><span className="font-semibold text-ink">{r.name}</span><div className="text-xs text-muted">{r.profile}</div></td><td className="px-4 py-3 capitalize text-body">{r.role}</td><td className="px-4 py-3 text-dim">{r.parent && <div className="text-xs">Reports to {r.parent}</div>}{r.space}</td><td className="max-w-60 px-4 py-3 text-dim"><div className="truncate">{r.task}</div><span className="text-xs text-muted">{r.status}</span></td><td className="px-4 py-3 text-xs text-muted">{r.engine}</td>
        <td className="px-4 py-3"><button className="btn-ghost" onClick={() => { if(r.id.startsWith('manager:')) setSelected(r.id); else if(r.id.startsWith('worker:')) setEditing(workers.find(w => `worker:${w.handle}` === r.id) || null); else setSettings(true) }}>Configure</button>{r.id.startsWith('worker:') && <button className="btn-ghost" onClick={() => startWorker({handle: r.id.slice(7), nodeId: scope ?? undefined})}>Assign task</button>}</td>
      </tr>)}</tbody></table>{!rows.length && <p className="p-6 text-sm text-muted">Add your first agent to start building a team.</p>}</div>
      {member && <ManagerWorkspace key={member.bot.handle} member={member} team={team} workers={workers} onChanged={reload} />}
    </div>}
    {editing && <WorkerEditor worker={editing} library={lib.items} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
  </div>
}
