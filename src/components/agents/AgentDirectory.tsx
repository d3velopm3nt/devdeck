import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Bot, Compass, Network, Plus, Search, Settings2, Sparkles, X } from 'lucide-react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Settings } from '../aiw/Settings'
import { WorkerEditor } from '../workers/WorkerEditor'
import { ReusableTeams } from './ReusableTeams'
import { LibraryPanel, useLibrary } from '../workers/LibraryPanel'
import { CommunityView } from '../CommunityView'
import { TeamBuild } from './TeamBuild'
import './workforce.css'

const blank = (nodeId: number, item?: ipc.LibraryItem): ipc.Worker => ({
  handle: '', name: item?.name || '', category: 'worker', profile: 'Custom',
  what: item?.what || '', brief: item?.id || '', skills: [], kit: '',
  runner: 'claude-code', model: 'sonnet', writes: 'branch', minutes: 20, usd: 2,
  spaces: nodeId ? [nodeId] : [], unattended: false, allow: [], allow_until: '',
  created_at: '', body: '',
})

export function AgentDirectory() {
  const scope = useApp(s => s.spaceScopeId)
  const lib = useLibrary()
  const [builtTeam, setBuiltTeam] = useState<ipc.ReusableTeam | null>(null)
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ipc.Worker | null>(null)
  const [settings, setSettings] = useState(false)
  const [section, setSection] = useState<'build' | 'library' | 'teams' | 'discover'>('teams')
  const [choosing, setChoosing] = useState(false)
  const [search, setSearch] = useState('')
  const assignment = useRef<((worker: ipc.Worker) => void) | null>(null)
  const reload = useCallback(async () => {
    try { setWorkers(await ipc.workersList()); setError('') }
    catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void reload() }, [reload, lib.items])
  const configure = (item?: ipc.LibraryItem) => { setChoosing(false); setEditing(blank(scope ?? 0, item)) }
  const closePicker = () => { setChoosing(false); assignment.current = null }
  const templates = lib.items.filter(item => item.kind === 'brief' && `${item.name} ${item.what}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="workforce">
    <div id="repository-page-host" />
    <header className="wf-header">
      <div className="wf-brand"><span className="wf-brand-icon"><Network size={20} /></span><h1>Workforce</h1></div>
      <button className="wf-icon-button" aria-label={settings ? 'Back to workforce' : 'AI & permissions'} title={settings ? 'Back to workforce' : 'AI & permissions'} onClick={() => setSettings(!settings)}>{settings ? <ArrowLeft size={19} /> : <Settings2 size={19} />}</button>
    </header>
    {settings && <div className="wf-content"><Settings /></div>}
    <div hidden={settings} className="wf-main">
      <nav aria-label="Workforce sections" className="wf-navigation">
        <button aria-pressed={section === 'build'} onClick={() => setSection('build')}><Sparkles size={18} />Build<span>Plan your team</span></button>
        <button aria-pressed={section === 'teams'} onClick={() => setSection('teams')}><Network size={18} />Teams<span>Build & coordinate</span></button>
        <button aria-pressed={section === 'library'} onClick={() => { setSection('library'); lib.reload() }}><BookOpen size={18} />Library<span>Agents & skills</span></button>
        <button aria-pressed={section === 'discover'} onClick={() => setSection('discover')}><Compass size={18} />Discover<span>Community & trending</span></button>
      </nav>
      <main className="wf-content">
        {(error || lib.err) && <p role="alert" className="text-sm text-err">{error || lib.err}</p>}
        <div hidden={section !== 'build'}><TeamBuild workers={workers} onCreated={team => { void ipc.reusableTeamsList().then(teams => { setBuiltTeam(teams.find(t => t.id === team.id) || team); setSection('teams'); void reload(); void lib.reload() }).catch(e => setError(String(e))) }} /></div>
        <div hidden={section !== 'teams'}><ReusableTeams openedTeam={builtTeam} workers={workers} onEdit={w => { assignment.current = null; setEditing(w) }} onAgents={() => { assignment.current = null; setChoosing(true) }} onCreate={assign => { assignment.current = assign; setSearch(''); setChoosing(true) }} /></div>
        <div hidden={section !== 'library'}><LibraryPanel items={lib.items} reload={lib.reload} /></div>
        {section === 'discover' && <CommunityView discoveryOnly />}
      </main>
    </div>
    {choosing && <div className="wf-overlay" onClick={closePicker} onKeyDown={e => { if (e.key === 'Escape') closePicker() }}>
      <section className="wf-picker" role="dialog" aria-modal="true" aria-label="Add a team member" onClick={e => e.stopPropagation()}>
        <header><div><span className="wf-eyebrow">BUILD YOUR TEAM</span><h2>Add a team member</h2><p>Start with a template, then choose its model and skills.</p></div><button autoFocus className="wf-icon-button" aria-label="Close agent picker" onClick={closePicker}><X size={18} /></button></header>
        <label className="wf-search"><Search size={17} /><input aria-label="Search agent templates" placeholder="Find an agent template…" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="wf-picker-grid"><button className="wf-template" onClick={() => configure()}><span className="wf-tile-icon"><Plus size={22} /></span><strong>Start from scratch</strong><p>Give your agent a purpose, model, and tools.</p></button>
          {templates.map(item => <button className="wf-template" key={item.id} onClick={() => configure(item)}><span className="wf-tile-icon"><Bot size={22} /></span><strong>{item.name || item.id}</strong><p>{item.what || 'A reusable agent template, ready to personalize.'}</p><span className="wf-link">Use template <Sparkles size={13} /></span></button>)}
        </div>
        {!templates.length && <p className="wf-muted">{search ? 'No matching templates. Try another search or start from scratch.' : 'Your library is empty. Create a member from scratch, or add templates in Library.'}</p>}
      </section>
    </div>}
    {editing && <WorkerEditor key={editing.handle || editing.brief || 'new'} worker={editing} library={lib.items} onClose={() => { setEditing(null); assignment.current = null }} onSaved={saved => { void lib.reload(); if (saved) { setWorkers(current => [...current.filter(w => w.handle !== saved.handle), saved]); assignment.current?.(saved) } else { void reload() } assignment.current = null; setEditing(null) }} />}
  </div>
}
