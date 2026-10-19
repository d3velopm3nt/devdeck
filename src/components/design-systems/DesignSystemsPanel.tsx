import { useEffect, useState, type CSSProperties } from 'react'
import * as ipc from '../../lib/ipc'
import type { TreeNode } from '../../lib/types'
import './design-systems.css'

export function DesignSystemsPanel() {
  const [designs, setDesigns] = useState<ipc.ProjectDesignSystem[]>([])
  const [projects, setProjects] = useState<TreeNode[]>([])
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState('dark')
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
        <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{design.name}</h2><p className="mt-1 max-w-xl text-sm text-muted">{design.description}</p></div><div className="wf-segment" aria-label="Preview appearance">{Object.keys(design.modes).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'dark' ? 'Dark' : 'Light'}</button>)}</div></header>
        <DesignSpecimens design={design} mode={mode} />
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

function DesignSpecimens({ design, mode }: { design: ipc.ProjectDesignSystem; mode: string }) {
  const tokens = design.modes[mode] ?? design.modes.dark
  const style = { ...Object.fromEntries(Object.entries(tokens).map(([k,v]) => [`--ds-${k}`,v])), '--ds-radius': `${design.radius}px`, fontFamily: design.font } as CSSProperties
  return <div className="ds-specimens" style={style}>
    <section><h3>Colours</h3><div className="ds-swatches">{Object.entries(tokens).filter(([k]) => k !== 'onBrand').map(([key,value]) => <div key={key}><div className="ds-swatch" style={{background:value}} /><span>{key}</span><code>{value.toUpperCase()}</code></div>)}</div></section>
    <section><h3>Typography</h3><p className="ds-heading">Heading example <small>24px</small></p><p>Body text for clear, readable interfaces. <small>14px</small></p><p className="ds-caption">Caption and helper text · 12px</p></section>
    <section><h3>Components</h3><div className="ds-controls"><button className="ds-primary" type="button">Primary action</button><button type="button">Secondary</button><button disabled>Disabled</button></div><div className="ds-fields"><label>Name<input placeholder="Enter a name" /></label><label>Option<select defaultValue="one"><option value="one">Option one</option><option value="two">Option two</option></select></label></div><label className="ds-check"><input type="checkbox" /> Enable feature</label></section>
    <section><h3>Table</h3><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>Item one</td><td>Active</td></tr><tr><td>Item two</td><td>Draft</td></tr></tbody></table></section>
    <section><h3>Spacing & shape</h3><p>{design.spacing.map(n => `${n}px`).join(' · ')} · Radius {design.radius}px</p><p className="ds-caption">Interactive specimens only; these controls do not save project data.</p></section>
  </div>
}
