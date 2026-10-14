import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
const empty = (): ipc.ReusableTeam => ({ id: '', name: '', description: '', roles: [{ name: '', worker: '' }], revision: 0 })
export function ReusableTeams({ workers, onAgents }: { workers: ipc.Worker[]; onAgents: () => void }) {
  const [teams, setTeams] = useState<ipc.ReusableTeam[]>([])
  const [draft, setDraft] = useState<ipc.ReusableTeam | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = () => ipc.reusableTeamsList().then(setTeams).catch(e => setError(String(e)))
  useEffect(() => { void reload() }, [])
  const save = async () => {
    if (!draft) return
    setBusy(true); setError('')
    try { await ipc.reusableTeamSave(draft); setDraft(null); await reload() }
    catch(e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section aria-label="Reusable teams" className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold">Reusable teams</h2><button className="btn-primary" disabled={busy} onClick={() => setDraft(empty())}>Create team</button><button className="btn-ghost" onClick={onAgents}>Configure agents</button></div>
    <p className="text-sm text-muted">Assign saved agents to named roles. Workflows choose this team and map roles to steps. Saving a team starts no work and changes no permissions.</p>
    {error && <p role="alert" className="text-sm text-err">{error}</p>}
    {!workers.length && <p className="text-sm text-warn">Create and configure an agent first. Imported agent templates become team members only after configuration.</p>}
    {draft && <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <label className="block text-sm">Team name<input aria-label="Team name" className="input mt-1 w-full" value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}/></label>
      <p className="text-xs text-muted">Team IDs and role names use lowercase letters, numbers, hyphens or underscores.</p>
      <label className="block text-sm">Team ID<input aria-label="Team ID" disabled={draft.revision > 0} className="input mt-1 w-full" placeholder="delivery" value={draft.id} onChange={e => setDraft({...draft, id: e.target.value})}/></label>
      <label className="block text-sm">Purpose<input className="input mt-1 w-full" value={draft.description} onChange={e => setDraft({...draft, description: e.target.value})}/></label>
      {draft.roles.map((role, i) => <div key={i} className="flex flex-wrap gap-2">
        <label className="text-sm">Role name<input aria-label={`Role ${i + 1} name`} className="input block" placeholder="developer" value={role.name} onChange={e => setDraft({...draft, roles: draft.roles.map((r,j) => j === i ? {...r, name:e.target.value} : r)})}/></label>
        <label className="text-sm">Saved agent<select aria-label={`Role ${i + 1} agent`} className="input block" value={role.worker} onChange={e => setDraft({...draft, roles:draft.roles.map((r,j) => j === i ? {...r, worker:e.target.value} : r)})}><option value="">Choose agent</option>{role.worker && !workers.some(w=>w.handle===role.worker) && <option value={role.worker}>Missing: {role.worker}</option>}{workers.map(w=><option key={w.handle} value={w.handle}>{w.name} · {w.profile || w.what || w.handle}</option>)}</select></label>
        <button className="btn-ghost" onClick={() => setDraft({...draft, roles:draft.roles.filter((_,j)=>j!==i)})}>Remove role</button>
      </div>)}
      <button className="btn-ghost" onClick={() => setDraft({...draft, roles:[...draft.roles,{name:'',worker:''}]})}>Add role</button>
      <div className="flex gap-2"><button className="btn-primary" disabled={busy || !draft.roles.length} onClick={() => void save()}>Save team</button><button className="btn-ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </div>}
    {!teams.length && !draft && <p className="text-sm text-muted">No reusable teams yet. Start with the agents you need for one workflow.</p>}
    <div className="grid gap-3 md:grid-cols-2">{teams.map(t=><article key={t.id} className="rounded-xl border border-line bg-panel p-4"><h3 className="font-semibold">{t.name}</h3><p className="text-sm text-muted">{t.description}</p><ul className="my-3 space-y-1 text-sm">{t.roles.map(r=><li key={r.name}>{r.name}: {workers.find(w=>w.handle===r.worker)?.name || `Missing agent: ${r.worker}`}</li>)}</ul><button className="btn-ghost" disabled={busy} onClick={()=>{setDraft(structuredClone(t));setError('')}}>Edit team</button></article>)}</div>
  </section>
}
