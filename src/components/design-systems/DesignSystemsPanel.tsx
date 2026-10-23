import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { TreeNode } from '../../lib/types'
import './design-systems.css'

// Render the original files: each design owns its layout, controls and themes.
const htmlFiles = import.meta.glob<string>('../../../design-systems/*-design-system.html', {
  query: '?raw', import: 'default', eager: true,
})

const catalogFiles = import.meta.glob<{ id: string }>('../../../design-systems/*.json', {
  import: 'default', eager: true,
})
const designHtmlFiles = Object.fromEntries(Object.entries(catalogFiles).map(([path, design]) => [
  design.id, { path: path.replace(/\.json$/, '-design-system.html'), html: htmlFiles[path.replace(/\.json$/, '-design-system.html')] },
]))

export function DesignSystemsPanel() {
  const [designs, setDesigns] = useState<ipc.ProjectDesignSystem[]>([])
  const [projects, setProjects] = useState<TreeNode[]>([])
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('')
  const [assignment, setAssignment] = useState<ipc.DesignAssignment | null>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([ipc.designSystemsList(), ipc.treeList()]).then(([items, nodes]) => {
      if (!active) return
      setDesigns(items)
      setSelected(items[0]?.id ?? '')
      setProjects(nodes.filter(n => n.kind === 'project' || !!n.path?.trim()))
    }).catch(e => { if (active) setError(String(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    setAssignment(null); setReady(false); setError(''); setMessage('')
    if (!project) { setReading(false); return () => { active = false } }
    setReading(true)
    ipc.designSystemAssignment(Number(project)).then(value => {
      if (active) { setAssignment(value); setReady(true) }
    }).catch(e => { if (active) setError(String(e)) }).finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [project, reload])
  const design = designs.find(d => d.id === selected)
  const save = async (id: string | null) => {
    if (!project || !ready || saving) return
    setSaving(true); setError(''); setMessage('')
    try {
      const saved = await ipc.designSystemAssign(Number(project), id, assignment)
      setAssignment(saved)
      setMessage(id ? 'Design saved for this project. Future worker launches will receive its tokens and guidelines.' : 'Project design cleared. Future launches will use no assigned design at this scope.')
    } catch (e) { setError(String(e)); setReady(false) }
    finally { setSaving(false) }
  }
  if (loading) return <p role="status" className="text-muted">Loading design systems…</p>
  return <section aria-label="Design system library" className="ds-library">
    <aside className="ds-list">
      <label className="block text-sm">Search designs<input className="input mt-2 w-full" value={search} onChange={e => setSearch(e.target.value)} /></label>
      {designs.filter(d => `${d.name} ${d.description}`.toLowerCase().includes(search.toLowerCase())).map(d => <button key={d.id} className="ds-choice" aria-pressed={selected === d.id} onClick={() => setSelected(d.id)}><strong>{d.name}</strong><span>Version {d.version} · Light & dark</span></button>)}
      {!designs.some(d => `${d.name} ${d.description}`.toLowerCase().includes(search.toLowerCase())) && <p className="text-muted">No matching designs.</p>}
      <p className="text-xs text-muted">Start with a bundled design. Project selection does not change DevDeck’s appearance.</p>
    </aside>
    <div className="min-w-0 space-y-4">
      {design && <>
        <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{design.name}</h2><p className="mt-1 max-w-xl text-sm text-muted">{design.description}</p></div></header>
        <DesignHtmlPreview key={design.id} design={design} />
        <details className="rounded-lg border border-line p-4"><summary className="cursor-pointer text-sm font-medium">Agent guidelines</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">{design.guidelines.map(g => <li key={g}>{g}</li>)}</ul></details>
      </>}
      <div className="ds-assignment">
        <label className="min-w-0 flex-1 text-sm">Assign to project<select aria-label="Assign to project" className="input mt-2 w-full" value={project} disabled={saving} onChange={e => setProject(e.target.value)}><option value="">Select a project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name} · {p.rel_path || p.path}</option>)}</select></label>
        <button className="wf-primary" disabled={!ready || saving || !design || reading || (assignment?.design_id === design.id && assignment?.version === design.version)} onClick={() => void save(selected)}>{saving ? 'Saving…' : 'Assign design'}</button>
        <button className="wf-secondary" disabled={!ready || saving || !assignment?.design_id} onClick={() => void save(null)}>Clear assignment</button>
      </div>
      {!projects.length && <p className="text-sm text-muted">Create a project or link a repository in Projects, then return here.</p>}
      {reading && <p role="status">Loading project assignment…</p>}
      {ready && <p className="text-sm text-muted">Saved design: {assignment?.design_id ? `${designs.find(d => d.id === assignment.design_id)?.name ?? assignment.design_id} · version ${assignment.version}` : 'None'}</p>}
      {message && <p role="status" className="text-sm text-ok">{message}</p>}
      {error && <div role="alert" className="text-sm text-err">{error} {project && <button className="wf-secondary" onClick={() => setReload(n => n + 1)}>Reload assignment</button>}</div>}
    </div>
  </section>
}

function DesignHtmlPreview({ design }: { design: ipc.ProjectDesignSystem }) {
  const [showSource, setShowSource] = useState(false)
  const preview = designHtmlFiles[design.id]
  const html = preview?.html
  if (!html) return <p role="alert">No HTML preview is available for {design.name}.</p>

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted">{preview.path.split('/').pop()}</span>
      <button type="button" className="wf-secondary" aria-expanded={showSource}
        aria-controls="design-html-source" onClick={() => setShowSource(value => !value)}>
        {showSource ? 'Close raw HTML' : 'Open raw HTML'}
      </button>
    </div>
    {showSource && <section id="design-html-source" aria-label="Raw HTML source"
      className="rounded-lg border border-line bg-panel p-4">
      <pre tabIndex={0} className="max-h-96 overflow-auto text-xs"><code>{html}</code></pre>
    </section>}
    <iframe title={`${design.name} design preview`} srcDoc={html}
      sandbox="allow-scripts" className="w-full rounded-lg border border-line"
      style={{ height: '75vh', minHeight: 480 }} />
  </div>
}
