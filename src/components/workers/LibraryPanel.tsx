import { DesignSystemsPanel } from '../design-systems/DesignSystemsPanel'
import { FilterTabs, PageHeader } from '../ui/DesignSystem'
// The library: the skills and briefs you installed, and the way to add more.
//
// Words only. A skill is instructions a worker is given; a brief is who it
// should be for a job. Nothing here runs, which is the only reason importing
// from a stranger's repository is a reasonable thing to do at all — and why
// hooks, MCP configs and install scripts are not importable.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { CAPTURE_LIBRARY } from '../../lib/devCapture'
import { AgentEditor } from '../aiw/AgentEditor'
import { WorkerEditor } from './WorkerEditor'
import { Bot, Sparkles, Search, Plus, Download, BookOpen, Pencil, Trash2 } from 'lucide-react'
import '../agents/workforce.css'
import { TeamPackageImport } from '../agents/TeamPackageImport'
import { RepositoryInstructionsImport } from '../agents/RepositoryInstructionsImport'
import { instructionOrigin } from '../../lib/repositoryInstructions'

export function LibraryPanel({
  items: templates,
  reload,
  onConfigure,
}: {
  items: ipc.LibraryItem[]
  reload: () => void
  onConfigure?: (item: ipc.LibraryItem) => void
}) {
  const [agents, setAgents] = useState<ipc.LibraryAgent[]>([])
  const [teamTemplates, setTeamTemplates] = useState<ipc.TeamPackagePreview[]>([])
  const [teamFilter, setTeamFilter] = useState('all')
  const [teamReading, setTeamReading] = useState<ipc.TeamPackagePreview | null>(null)
  const loadTeams = () => { void ipc.teamPackageTemplates().then(setTeamTemplates).catch(e => setErr(String(e))) }
  useEffect(loadTeams, [templates])
  const [managerEditing, setManagerEditing] = useState<{ original: ipc.LibraryAgent; name: string; instructions: string; goal: string } | null>(null)
  const [agentEditing, setAgentEditing] = useState<string | null>(null)
  const [workerEditing, setWorkerEditing] = useState<ipc.Worker | null>(null)
  const loadAgents = () => { void ipc.libraryAgents().then(setAgents).catch(e => setErr(String(e))) }
  useEffect(loadAgents, [templates])
  const packageItems: ipc.LibraryItem[] = teamTemplates.flatMap(pkg => pkg.texts.map(text => ({ id: `${pkg.team.id}:${text.id}`, kind: text.kind, name: text.name, what: text.description, repo: `team:${pkg.team.id}`, commit: pkg.fingerprint, licence: '', path: text.path, added_at: '', chars: text.content.length })))
  const items: ipc.LibraryItem[] = [...agents.map(agent => ({ id: agent.id, kind: 'brief', name: agent.name, what: agent.execution === 'manager' ? 'Vault manager · coordination' : agent.execution === 'model' ? 'Configured agent · model conversation' : 'Configured agent · CLI execution', repo: agent.execution === 'manager' ? 'vault' : instructionOrigin(agent.instructions)?.repo || 'personal', commit: instructionOrigin(agent.instructions)?.commit || '', licence: '', path: instructionOrigin(agent.instructions)?.path || '', added_at: '', chars: agent.instructions.length })), ...templates, ...packageItems]
  const configured = (item: ipc.LibraryItem) => agents.find(agent => agent.id === item.id)
  const sourceTeam = (item: ipc.LibraryItem) => teamTemplates.find(team => item.repo === 'team:' + team.team.id)?.team.name
  const sourceLabel = (item: ipc.LibraryItem) => item.repo.startsWith('local:') ? `Local package · ${item.repo.split(/[\\/]/).pop() || 'local'}` : item.repo
  const sourceBadge = (item: ipc.LibraryItem) => {
    if (['personal', 'vault'].includes(item.repo)) return null
    const localId = item.repo.startsWith('local:') ? item.repo.split(/[\\/]/).pop() : null
    const team = teamTemplates.find(t => item.repo === `team:${t.team.id}` || (localId && t.team.id === localId))
    const github = /^[\w.-]+\/[\w.-]+$/.test(item.repo)
    const label = team?.team.name || sourceLabel(item)
    return <div className="wf-card-source"><button type="button" className="wf-badge wf-source-badge" title={github ? `Open ${item.repo} on GitHub` : `Read source: ${label}`} onClick={() => { if (team) setTeamReading(team); else if (github) void ipc.openUrl(`https://github.com/${item.repo}`).catch(e => setErr(String(e))); else void read(item) }}>
      <Icon name={github ? 'github' : 'folder'} size={12} className="shrink-0" /><span>{label}</span>
    </button></div>
  }
  const [libraryTab, setLibraryTab] = useState<'brief' | 'skill' | 'team' | 'design'>('brief')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [origin, setOrigin] = useState('all')
  const repositories = [...new Set(items.map(item => item.repo).filter(repo => /^[\w.-]+\/[\w.-]+$/.test(repo)))].sort()
  const [sort, setSort] = useState('name')
  const [adding, setAdding] = useState(!!CAPTURE_LIBRARY)
  const [importingTeam, setImportingTeam] = useState(false)
  const [reading, setReading] = useState<{ item: ipc.LibraryItem; text: string } | null>(null)
  const [err, setErr] = useState('')
  const [custom, setCustom] = useState<{id:string; kind:string; name:string; what:string; body:string; expected:string|null} | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<ipc.LibraryItem | null>(null)

  const filtered = items.filter(i => `${i.name} ${i.what} ${i.id}`.toLowerCase().includes(search.toLowerCase()) && (teamFilter === 'all' || i.repo === `team:${teamFilter}`) && (origin === 'all' || (origin === 'imported' ? !['personal', 'vault'].includes(i.repo) : i.repo === origin.replace(/^repo:/, '')))).sort((a,b) => sort === 'name' ? (a.name || a.id).localeCompare(b.name || b.id) : a.repo.localeCompare(b.repo))
  const skills = filtered.filter((i) => i.kind === 'skill')
  const briefs = filtered.filter((i) => i.kind === 'brief')

  const read = async (it: ipc.LibraryItem) => {
    setErr('')
    try {
      const pkg = teamTemplates.find(t => it.repo === `team:${t.team.id}`)
      setReading({ item: it, text: pkg?.texts.find(t => t.path === it.path)?.content ?? configured(it)?.instructions ?? await ipc.libraryRead(it.id, it.kind) })
    } catch (e) {
      setErr(String(e))
    }
  }

  const edit = (it: ipc.LibraryItem) => {
    const agent = configured(it)
    if (agent?.execution === 'manager') { setManagerEditing({ original: agent, name: agent.name, instructions: agent.instructions, goal: String(agent.configuration.goal ?? '') }); return }
    if (agent?.execution === 'model') { setAgentEditing(String(agent.configuration.id)); return }
    if (agent?.execution === 'cli') {
      void ipc.workersList().then(workers => { const worker = workers.find(w => w.handle === agent.configuration.handle); if (worker) setWorkerEditing(worker); else setErr('Agent could not be loaded.') }).catch(e => setErr(String(e)))
      return
    }
    void ipc.libraryRead(it.id, it.kind).then(body => setCustom({id:it.id,kind:it.kind,name:it.name,what:it.what,body,expected:body})).catch(e => setErr(String(e)))
  }
  const remove = async (it: ipc.LibraryItem) => {
    try { await ipc.libraryRemove(it.id,it.kind); setRemoving(null); reload() } catch(e) { setErr(String(e)) }
  }
  const actions = (it: ipc.LibraryItem) => <>
    <button className="wf-icon-button" title="Read instructions" aria-label={'Read ' + (it.name || it.id)} onClick={() => void read(it)}><BookOpen size={15} /></button>
    {(configured(it) || it.repo === 'personal') && <button className="wf-icon-button" title="Edit definition" aria-label={'Edit ' + (it.name || it.id)} onClick={() => edit(it)}><Pencil size={15} /></button>}
    {!configured(it) && !it.repo.startsWith('team:') && <button className="wf-icon-button" title="Remove from library" aria-label={'Remove ' + (it.name || it.id)} onClick={() => setRemoving(it)}><Trash2 size={15} /></button>}
    {it.kind === 'brief' && !configured(it) && !it.repo.startsWith('team:') && onConfigure && <button className="wf-link" onClick={() => onConfigure(it)}>Configure agent</button>}
  </>
  const visible = libraryTab === 'brief' ? briefs : skills
  const visibleTeams = teamTemplates.filter(t => `${t.team.name} ${t.team.description}`.toLowerCase().includes(search.toLowerCase()) && (teamFilter === 'all' || teamFilter === t.team.id) && (origin === 'all' || origin === 'imported'))
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {managerEditing && <div className="wf-overlay"><section className="wf-picker" role="dialog" aria-modal="true" aria-label="Edit vault manager">
        <h2>Vault manager</h2><p className="wf-muted">Saved with the current vault. Existing responsibilities, schedule, permissions, and worker assignments are preserved.</p>
        <label>Name<input aria-label="Manager name" className="input w-full" value={managerEditing.name} onChange={e => setManagerEditing({ ...managerEditing, name: e.target.value })} /></label>
        <label>Goal<textarea aria-label="Manager goal" className="input w-full" value={managerEditing.goal} onChange={e => setManagerEditing({ ...managerEditing, goal: e.target.value })} /></label>
        <label>Instructions<textarea aria-label="Manager instructions" rows={10} className="input w-full" value={managerEditing.instructions} onChange={e => setManagerEditing({ ...managerEditing, instructions: e.target.value })} /></label>
        {err && <p role="alert" className="text-err">{err}</p>}
        <div className="wf-actions"><button className="wf-primary" disabled={saving || !managerEditing.name.trim()} onClick={() => { setSaving(true); setErr(''); void ipc.libraryManagerSave(managerEditing.original, managerEditing.name, managerEditing.instructions, managerEditing.goal).then(() => { setManagerEditing(null); loadAgents(); reload() }).catch(e => setErr(String(e))).finally(() => setSaving(false)) }}>Save manager</button><button className="wf-secondary" disabled={saving} onClick={() => { setManagerEditing(null); setErr('') }}>Cancel</button></div>
      </section></div>}
      {agentEditing && <div className="wf-overlay"><section className="wf-picker"><AgentEditor id={agentEditing} onClose={() => { setAgentEditing(null); loadAgents(); reload() }} /></section></div>}
      {workerEditing && <WorkerEditor worker={workerEditing} library={templates} onClose={() => setWorkerEditing(null)} onSaved={() => { setWorkerEditing(null); loadAgents(); reload() }} />}
      <PageHeader className="wf-section-heading" level={2} density="section" title={<>Your library <span className="wf-badge">{items.length + teamTemplates.length}</span></>} description="The personalities and capabilities behind your teams." actions={<div className="wf-actions"><button className="btn-ghost ds-button" onClick={() => setImportingTeam(true)}>Import team package</button><button className="btn-ghost ds-button" onClick={() => setAdding(true)}><Download size={15} />Import</button>{libraryTab !== 'team' && libraryTab !== 'design' && <button className="btn-primary ds-button" disabled={saving} onClick={() => setCustom({id:'',kind:libraryTab,name:'',what:'',body:'',expected:null})}><Plus size={16} />Create {libraryTab === 'brief' ? 'template' : 'skill'}</button>}</div>}/>
      <div className="wf-toolbar ds-toolbar">
        <select className="wf-filter" aria-label="Filter by team template" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="all">All team templates</option>{teamTemplates.map(t => <option key={t.team.id} value={t.team.id}>{t.team.name}</option>)}</select>
        <FilterTabs label="Library categories" value={libraryTab} onChange={setLibraryTab} options={[{id:'brief',label:'Agents',icon:'agent',count:briefs.length},{id:'skill',label:'Skills',icon:'ai',count:skills.length},{id:'team',label:'Teams',icon:'agent',count:visibleTeams.length},{id:'design',label:'Design systems',icon:'palette'}]}/>
        {libraryTab !== 'design' && <><label className="wf-search"><Search size={16} /><input aria-label="Search library" placeholder="Search your library…" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <select className="wf-filter" aria-label="Filter library source" value={origin} onChange={e => { setOrigin(e.target.value); if (e.target.value.startsWith('repo:')) setTeamFilter('all') }}><option value="all">All sources</option><option value="personal">Personal</option><option value="vault">Current vault</option><option value="imported">Imported</option>{!!repositories.length && <optgroup label="Repositories">{repositories.map(repo => <option key={repo} value={`repo:${repo}`}>{repo}</option>)}</optgroup>}</select>
        <select className="wf-filter" aria-label="Sort library" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name A–Z</option><option value="source">Source</option></select>
        <FilterTabs label="Library view" value={view} onChange={setView} options={[{id:'cards',label:'Cards',accessibleLabel:'Library card view',icon:'layout'},{id:'table',label:'Table',accessibleLabel:'Library table view',icon:'list'}]}/> </>}
      </div>
      {libraryTab === 'design' ? <DesignSystemsPanel/> : <>
      <p className="wf-muted">{libraryTab === 'brief' ? 'Your saved agents and reusable templates. Editing a configured agent updates it everywhere it is used; roles and reporting stay with each team.' : libraryTab === 'team' ? 'Reusable team packages. Browse their agents and skills without creating a working team.' : 'Reusable instructions that give your team members specific capabilities.'}</p>
      {removing && <div role="alert" className="wf-actions rounded-xl border border-line bg-panel p-4"><span className="wf-muted">Remove {removing.name || removing.id} from your library?</span><button className="wf-secondary" onClick={() => void remove(removing)}>Remove definition</button><button className="wf-secondary" onClick={() => setRemoving(null)}>Keep definition</button></div>}
      {custom && <section aria-label="Custom library definition" className="space-y-3 rounded-xl border border-line bg-panel p-4">
        <label className="block text-sm">Definition type<select aria-label="Definition type" disabled={custom.expected !== null} className="input ml-2" value={custom.kind} onChange={e=>setCustom({...custom,kind:e.target.value})}><option value="skill">Skill</option><option value="brief">Agent template</option></select></label>
        <p className="text-xs text-muted">Use lowercase letters, numbers, hyphens or underscores for the ID. Existing IDs are never silently replaced.</p>
        <label className="block text-sm">ID<input aria-label="Definition ID" className="input mt-1 w-full" disabled={custom.expected !== null} value={custom.id} placeholder="research-checklist" onChange={e=>setCustom({...custom,id:e.target.value})}/></label>
        <label className="block text-sm">Name<input aria-label="Definition name" className="input mt-1 w-full" value={custom.name} onChange={e=>setCustom({...custom,name:e.target.value})}/></label>
        <label className="block text-sm">Purpose<input aria-label="Definition purpose" className="input mt-1 w-full" value={custom.what} onChange={e=>setCustom({...custom,what:e.target.value})}/></label>
        <label className="block text-sm">Instructions<textarea aria-label="Definition instructions" rows={8} className="input mt-1 w-full font-mono" value={custom.body} onChange={e=>setCustom({...custom,body:e.target.value})}/></label>
        <div className="flex gap-2"><button className="btn-primary" disabled={saving} onClick={() => { setSaving(true); setErr(''); void ipc.librarySaveCustom(custom.id,custom.kind,custom.name,custom.what,custom.body,custom.expected).then(()=>{setLibraryTab(custom.kind === 'brief' ? 'brief' : 'skill');setCustom(null);reload()}).catch(e=>setErr(String(e))).finally(()=>setSaving(false)) }}>Save definition</button><button className="btn-ghost" disabled={saving} onClick={()=>setCustom(null)}>Cancel</button></div>
      </section>}
      {err && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11.5px] text-err">{err}</div>}

      {libraryTab === 'team' ? <>
        {!visibleTeams.length && <div className="wf-empty"><h3>No team templates found</h3><p>Import a team package to keep its agents, skills and reporting lines together in your Library.</p></div>}
        <div className="wf-grid">{visibleTeams.map(pkg => <article className="wf-card" key={pkg.team.id}><span className="wf-badge">Team template</span><h3>{pkg.team.name}</h3><p>{pkg.team.description}</p><p>{pkg.team.roles.length} agents · {pkg.texts.filter(t => t.kind === 'skill').length} skills</p><div className="wf-actions"><button className="wf-secondary" onClick={() => setTeamReading(pkg)}>Read team template</button><button className="wf-secondary" onClick={() => { setTeamFilter(pkg.team.id); setLibraryTab('brief') }}>Browse agents</button><button className="wf-secondary" onClick={() => { setTeamFilter(pkg.team.id); setLibraryTab('skill') }}>Browse skills</button></div></article>)}</div>
      </> : !visible.length ? <div className="wf-empty"><span className="wf-tile-icon">{libraryTab === 'brief' ? <Bot size={24} /> : <Sparkles size={24} />}</span><h3>{search || origin !== 'all' ? 'No matches found' : libraryTab === 'brief' ? 'Give your next agent a head start' : 'Build your team’s toolkit'}</h3><p>{search || origin !== 'all' ? 'Try a different search or source filter.' : 'Create a reusable definition or import one from GitHub. It will be ready when you build your next team.'}</p>{(search || origin !== 'all' || teamFilter !== 'all') ? <button className="wf-secondary" onClick={() => { setSearch(''); setOrigin('all'); setTeamFilter('all') }}>Clear filters</button> : <button className="wf-secondary" onClick={() => setAdding(true)}><Download size={15} />Explore imports</button>}</div>
      : view === 'cards' ? <div className="wf-grid">{visible.map(it => <article key={it.kind + it.id} className="wf-card"><div className="wf-card-top"><span className="wf-tile-icon">{it.kind === 'brief' ? <Bot size={23} /> : <Sparkles size={23} />}</span><span className="wf-badge">{configured(it)?.execution === 'manager' ? 'Vault agent' : configured(it) ? 'Personal agent' : it.kind === 'brief' ? 'Agent template' : it.repo === 'personal' ? 'Created by you' : 'Imported'}</span></div><h3>{it.name || it.id}</h3><p>{it.what || 'Ready to customize for your team.'}</p>{sourceBadge(it)}<div className="wf-card-footer">{actions(it)}</div></article>)}</div>
      : <div className="wf-table-wrap"><table className="wf-table"><thead><tr><th>Name</th><th>Source</th><th>Actions</th></tr></thead><tbody>{visible.map(it => <tr key={it.kind + it.id}><td><strong>{it.name || it.id}</strong><p>{it.what}</p></td><td><span className="wf-badge">{it.repo === 'personal' ? 'Personal' : it.repo === 'vault' ? 'Current vault' : sourceTeam(it) ? 'From ' + sourceTeam(it) : it.repo}</span></td><td><div className="wf-actions">{actions(it)}</div></td></tr>)}</tbody></table></div>}
      {importingTeam && <TeamPackageImport onClose={() => setImportingTeam(false)} onImported={() => { setImportingTeam(false); setLibraryTab('team'); loadTeams(); reload() }} />}
      {teamReading && <div className="wf-overlay"><section className="wf-picker" role="dialog" aria-modal="true" aria-label="Read team template"><h2>{teamReading.team.name}</h2><p>{teamReading.team.description}</p><p>Reusable template only. No working agents have been created from this import.</p><div className="wf-table-wrap"><table className="wf-table"><thead><tr><th>Role</th><th>Reports to</th><th>Skills</th></tr></thead><tbody>{teamReading.team.roles.map(role => <tr key={role.name}><td><strong>{teamReading.texts.find(t => t.kind === 'brief' && t.id === role.worker)?.name || role.name}</strong><p>{role.kind}</p></td><td>{role.reports_to || 'Team lead'}</td><td>{(teamReading.skills[role.name] || []).join(', ')}<p>Handoffs: {(role.handoffs || []).join(', ') || 'None'}</p></td></tr>)}</tbody></table></div><button className="wf-secondary" onClick={() => setTeamReading(null)}>Close</button></section></div>}
      {adding && (
        <AddFromGitHub
          onChanged={reload}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
      {reading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8" onClick={() => setReading(null)}>
          <div
            className="flex max-h-full w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="font-mono text-[12.5px] text-ink">{reading.item.id}</span>
              <span className="text-[10.5px] text-faint">
                {reading.item.repo} · {reading.item.commit.slice(0, 7)} · {reading.item.licence}
              </span>
              <span className="flex-1" />
              <button className="btn-ghost text-[11.5px]" onClick={() => setReading(null)}>
                Close
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11.5px] leading-relaxed text-body">
              {reading.text}
            </pre>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}

/// What a folder of somebody's repository is, in words you did not have to
/// learn. `agents/x.md` is a specialist with a job description; a skill is a
/// how-to a worker can follow. The repository's own spelling is kept in the
/// corner for when it matters, and nowhere else.
function kitWords(k: ipc.LibraryKit) {
  const one = k.picks.length === 1
  return {
    what: k.kind === 'brief' ? (one ? 'specialist' : 'specialists') : one ? 'skill' : 'skills',
    why:
      k.kind === 'brief'
        ? one
          ? 'A specialist a worker can call on for the job it fits.'
          : 'A bench your worker picks from — it reads what each one is for and chooses.'
        : one
          ? 'A guide a worker can follow when the job calls for it.'
          : 'Step-by-step guides a worker can follow when a job calls for one.',
  }
}

export function AddFromGitHub({ onClose, onAdded, onChanged, initialRepo = '' }: { onClose: () => void; onAdded: () => void; onChanged?: () => void; initialRepo?: string }) {
  const [repo, setRepo] = useState(initialRepo || CAPTURE_LIBRARY)
  const [src, setSrc] = useState<ipc.LibrarySource | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'' | 'look' | 'install'>('')
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('')
  const [missed, setMissed] = useState<ipc.LibraryAdded | null>(null)
  // Closed on purpose. Three hundred and sixty-seven tick boxes is not a
  // choice, it is a spreadsheet — and it was the first thing the window
  // showed. It is still here for the one time you want a single file.
  const [browsing, setBrowsing] = useState(false)
  const [others, setOthers] = useState(false)

  const look = async () => {
    setErr('')
    setBusy('look')
    try {
      const s = await ipc.libraryLook(repo)
      setSrc(s)
      setPicked(new Set())
      setBrowsing(false)
      setOthers(false)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy('')
    }
  }

  const install = async () => {
    if (!src) return
    setErr('')
    setBusy('install')
    try {
      settle(await ipc.libraryInstall(src, [...picked]))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy('')
    }
  }

  const addKit = async (folder: string) => {
    if (!src) return
    setErr('')
    setBusy('install')
    try {
      settle(await ipc.libraryInstallKit(src, folder))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy('')
    }
  }

  // What did not come in is said, not swallowed. A set is dozens of files over
  // somebody else's network, so a few timing out is ordinary — and a silent
  // "added" that quietly left six out is how a worker ends up missing the one
  // specialist you wanted.
  const settle = (r: ipc.LibraryAdded) => {
    if (r.missed.length === 0) {
      onAdded()
      return
    }
    setMissed(r)
  }

  // Screenshot harness: read the repository without a mouse.
  useEffect(() => {
    if (initialRepo || CAPTURE_LIBRARY) void look()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = (src?.items ?? []).filter(
    (i) =>
      !filter.trim() ||
      i.id.toLowerCase().includes(filter.toLowerCase()) ||
      i.what.toLowerCase().includes(filter.toLowerCase()),
  )

  // A repository's own sets first; the copies it keeps for other editors are
  // the same thing again, so they wait behind a line rather than doubling the
  // choice.
  const main = (src?.kits ?? []).filter((k) => k.folder === '.' || !k.folder.startsWith('.'))
  const copies = (src?.kits ?? []).filter((k) => k.folder !== '.' && k.folder.startsWith('.'))

  const kitCard = (k: ipc.LibraryKit) => {
    const w = kitWords(k)
    const all = k.have === k.picks.length
    return (
      <div key={k.folder} className="flex items-start gap-3 rounded-[10px] border border-line2 bg-panel px-4 py-3.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15">
          <Icon name={k.kind === 'skill' ? 'note' : 'bot'} size={15} className="text-indigo-300" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold text-ink">
              {k.picks.length} {w.what}
            </span>
            <span className="truncate font-mono text-[10px] text-faint">{k.folder === '.' ? 'Repository root' : `${k.folder}/`}</span>
          </div>
          <p className="m-0 mt-0.5 text-[11.5px] leading-relaxed text-muted">{w.why}</p>
          {k.have > 0 && (
            <div className="mt-1 text-[11px] text-ok">
              {k.picks.length === 1 ? 'already yours' : `${k.have} of them are already yours`}
            </div>
          )}
        </div>
        <button
          className={`${all ? 'btn-ghost' : 'btn-primary'} shrink-0 text-[12px]`}
          disabled={busy !== '' || all}
          onClick={() => void addKit(k.folder)}
        >
          {all
            ? k.picks.length === 1
              ? 'yours'
              : 'all yours'
            : busy === 'install'
              ? 'Adding…'
              : k.picks.length === 1
                ? 'Add it'
                : `Add all ${k.picks.length}`}
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8" onClick={onClose}>
      <div
        className="flex max-h-full w-[760px] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-4">
          <div className="text-[15px] font-semibold text-ink">{initialRepo ? 'Inspect repository' : 'Add from GitHub'}</div>
          <p className="mt-1 max-w-[600px] text-[12px] leading-relaxed text-muted">
            Find reusable skills and agent definitions. Inspection reads the repository without installing or running its code.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              className="input flex-1 font-mono text-[12px]"
              placeholder="github.com/owner/name"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void look()}
            />
            <button className="btn-primary text-[12px]" disabled={!repo.trim() || busy !== ''} onClick={() => void look()}>
              {busy === 'look' ? 'Reading…' : 'Read it'}
            </button>
            <button className="btn-ghost text-[12px]" onClick={onClose}>
              Cancel
            </button>
          </div>
          {err && <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11.5px] text-err">{err}</div>}
        </div>

        {src && (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-raise px-5 py-2 text-[11.5px]">
              <span className="font-semibold text-ink">{src.repo}</span>
              <span className="rounded-full bg-emerald-500/15 px-2 text-[9px] font-semibold uppercase tracking-wider text-ok">
                {src.licence}
              </span>
              <span className="font-mono text-[10.5px] text-faint">{src.commit.slice(0, 7)}</span>
              <span className="flex-1" />
              <span className="text-faint">pinned to this commit</span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              <RepositoryInstructionsImport key={`${src.repo}:${src.commit}`} source={src} onChanged={onChanged}/>
              {main.length > 0 ? (
                <>
                  <div className="mb-2 text-[12px] text-dim">What this repository holds</div>
                  <div className="flex flex-col gap-2">{main.map(kitCard)}</div>
                  <p className="mt-2.5 max-w-[640px] text-[11px] leading-relaxed text-faint">
                    A set goes to the worker that carries it, and it picks who does the job. You will not have read these
                    files: what holds is the one folder a worker may write in, and the five things no worker ever does.
                  </p>
                </>
              ) : (
                <div className="rounded-[10px] border border-dashed border-line2 px-4 py-5 text-center text-[12px] text-muted">
                  Nothing here is grouped into a set. Browse it below to take single files.
                </div>
              )}

              {copies.length > 0 && (
                <div className="mt-4">
                  <button
                    className="flex items-center gap-1.5 text-[11.5px] text-muted hover:text-ink"
                    onClick={() => setOthers((v) => !v)}
                  >
                    <Icon name={others ? 'chevron-down' : 'chevron-right'} size={12} />
                    {copies.length} more sets, kept here for other editors
                  </button>
                  {others && <div className="mt-2 flex flex-col gap-2">{copies.map(kitCard)}</div>}
                </div>
              )}

              <div className="mt-4 border-t border-line pt-3">
                <button
                  className="flex items-center gap-1.5 text-[11.5px] text-muted hover:text-ink"
                  onClick={() => setBrowsing((v) => !v)}
                >
                  <Icon name={browsing ? 'chevron-down' : 'chevron-right'} size={12} />
                  Browse all {src.items.length} one by one
                </button>

                {browsing && (
                  <div className="mt-2 overflow-hidden rounded-[10px] border border-line">
                    <div className="flex items-center gap-2 border-b border-line bg-raise px-3 py-2">
                      <input
                        className="input w-56 py-0.5 text-[11px]"
                        placeholder="Filter"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      />
                      <span className="flex-1" />
                      <button
                        className="btn-primary text-[11.5px]"
                        disabled={picked.size === 0 || busy !== ''}
                        onClick={() => void install()}
                      >
                        {busy === 'install' ? 'Adding…' : `Add ${picked.size || ''}`.trim()}
                      </button>
                    </div>
                    {src.note && (
                      <div className="flex items-start gap-2 border-b border-line bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-warn">
                        <Icon name="info" size={12} className="mt-0.5 shrink-0" />
                        {src.note}
                      </div>
                    )}
                    <div className="max-h-[320px] overflow-auto">
                      {shown.map((i) => {
                        const on = picked.has(i.id)
                        return (
                          <label
                            key={`${i.kind}-${i.id}`}
                            className={`flex cursor-pointer items-start gap-2.5 border-b border-line px-3 py-2 last:border-b-0 ${
                              on ? 'bg-indigo-500/[0.06]' : 'hover:bg-hover/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-[3px]"
                              checked={on}
                              disabled={i.have}
                              onChange={(e) =>
                                setPicked((cur) => {
                                  const next = new Set(cur)
                                  if (e.target.checked) next.add(i.id)
                                  else next.delete(i.id)
                                  return next
                                })
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <span className="font-mono text-[11.5px] text-ink">{i.id}</span>
                                <span className="rounded bg-raise px-1.5 text-[9.5px] uppercase tracking-wider text-muted">
                                  {i.kind === 'brief' ? 'specialist' : 'skill'}
                                </span>
                                {i.have && <span className="text-[10.5px] text-ok">already yours</span>}
                              </div>
                              {i.what && (
                                <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{i.what}</div>
                              )}
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-faint">{i.path}</span>
                          </label>
                        )
                      })}
                      {shown.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-muted">Nothing matches.</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {missed && (
              <div className="border-t border-line bg-amber-500/5 px-5 py-3">
                <div className="flex items-center gap-2 text-[12px] text-warn">
                  <Icon name="alert" size={13} className="shrink-0" />
                  {missed.items.length} came in; {missed.missed.length} did not.
                  <span className="flex-1" />
                  <button className="btn-ghost text-[11.5px]" onClick={onAdded}>
                    Keep what arrived
                  </button>
                </div>
                <ul className="mt-1.5 max-h-24 overflow-auto pl-5 text-[11px] leading-relaxed text-muted">
                  {missed.missed.map((m) => (
                    <li key={m} className="list-disc font-mono">
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-line bg-raise px-5 py-2.5 text-[11px] text-faint">
              <Icon name="secret" size={11} />
              Words only — hooks, MCP configs and install scripts are never imported.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The library, loaded once for whoever needs the names. */
export function useLibrary() {
  const [items, setItems] = useState<ipc.LibraryItem[]>([])
  const [err, setErr] = useState('')
  const reload = () => {
    void ipc
      .libraryList()
      .then(setItems)
      .catch((e) => setErr(String(e)))
  }
  useEffect(reload, [])
  return { items, reload, err }
}
