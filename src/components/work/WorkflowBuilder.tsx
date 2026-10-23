import { useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { TreeNode } from '../../lib/types'
import { stepLevels, type WorkflowEntry } from '../../lib/workHub'
import { FilterTabs } from '../ui/DesignSystem'
import { Icon } from '../../lib/icons'

type Step = ipc.FolderWorkflowStep
function step(id: string, node: number): Step { return { id, title:'New step', worker:'agent:assistant', role:'', target:node, needs:[], instructions:'Describe the result to produce and how to verify it.', status:'pending', claim:'', run:'', evidence:'', previous_runs:[] } }
export function WorkflowBuilder({ entry, nodes, workers, teams, onClose, onSaved }: { entry?: WorkflowEntry; nodes: TreeNode[]; workers: ipc.Worker[]; teams: ipc.ReusableTeam[]; onClose: () => void; onSaved: () => void }) {
  const [node, setNode] = useState(entry?.node || nodes.find(n => n.kind === 'project')?.id || nodes[0]?.id || 0)
  const [id, setId] = useState(entry?.id || '')
  const [title, setTitle] = useState(entry?.view.definition.title || 'New workflow')
  const [teamId, setTeamId] = useState(entry?.view.definition.team || '')
  const [steps, setSteps] = useState<Step[]>(entry?.view.definition.steps || [step('step-1', node)])
  const [body, setBody] = useState(entry?.view.body || '# Objective\n\nDescribe the outcome and shared constraints.\n')
  const [selected, setSelected] = useState(steps[0]?.id || '')
  const [view, setView] = useState<'canvas' | 'outline'>('canvas')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = steps.find(s => s.id === selected)
  const team = teams.find(t => t.id === teamId)
  const levels = stepLevels(steps)
  const invalid = steps.filter(s => !levels.has(s.id))
  const edit = (patch: Partial<Step>) => setSteps(all => all.map(s => s.id === selected ? { ...s, ...patch } : s))
  const add = () => {
    const id = `step-${crypto.randomUUID().slice(0, 8)}`
    const created = step(id, node)
    if (team?.roles[0]) { created.role = team.roles[0].name; created.worker = team.roles[0].worker }
    setSteps(all => [...all, created]); setSelected(id)
  }
  const selectTeam = (value: string) => {
    setTeamId(value)
    const first = teams.find(t => t.id === value)?.roles[0]
    setSteps(all => all.map(s => ({ ...s, role:first?.name || '', worker:first?.worker || s.worker })))
  }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const raw = `---\n${JSON.stringify({ title, team:teamId, steps }, null, 2)}\n---\n\n${body}`
      await ipc.folderWorkflowParse(raw)
      await ipc.folderWorkflowSave(node, entry?.view.raw || '', raw, id)
      onSaved()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section className="wh-builder" aria-label="Visual workflow builder"><header><div><p className="wh-kicker">Reusable workflow · {entry ? 'Edit definition' : 'New definition'}</p><input aria-label="Workflow title" value={title} onChange={e => setTitle(e.target.value)}/></div><div className="wh-actions"><button className="wf-secondary" disabled={busy} onClick={onClose}>Back to workflows</button><button className="wf-primary" disabled={busy || !title.trim() || !/^[a-z0-9_-]{1,80}$/.test(id) || !steps.length || invalid.length > 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save workflow'}</button></div></header>
    <div className="wh-builder-settings"><label>Folder<select aria-label="Workflow definition folder" disabled={!!entry} value={node} onChange={e => { const value = Number(e.target.value); setNode(value); setSteps(all => all.map(s => ({ ...s, target:value }))) }}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label>ID<input aria-label="Workflow definition ID" disabled={!!entry} placeholder="deliver-feature" value={id} onChange={e => setId(e.target.value)}/></label><label>Team<select aria-label="Workflow definition team" value={teamId} onChange={e => selectTeam(e.target.value)}><option value="">Direct agents</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><FilterTabs label="Builder view" value={view} onChange={setView} options={[{id:'canvas',label:'Canvas',icon:'context'},{id:'outline',label:'Outline',icon:'list'}]}/></div>
    {error && <p role="alert" className="wh-error">{error}</p>}{!!invalid.length && <p role="alert" className="wh-error">A dependency cycle or missing step needs correction before saving.</p>}
    <div className="wh-builder-main"><div className="wh-canvas-area"><div className="wh-section-heading"><span>{steps.length} steps · select a card to edit · change connections under “Wait for accepted steps”</span><button className="wf-secondary" onClick={add}>Add step</button></div>
      {view === 'canvas' ? <WorkflowCanvas steps={steps} levels={levels} selected={selected} workers={workers} onSelect={setSelected}/>
      : <ol className="wh-builder-outline">{steps.map(s => <li key={s.id}><button aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}><strong>{s.title}</strong><span>{s.needs.length ? `After: ${s.needs.map(id => steps.find(p => p.id === id)?.title || id).join(', ')}` : 'No dependencies'}</span></button></li>)}</ol>}
      <details className="wh-shared-context"><summary>Shared context · Markdown</summary><textarea aria-label="Workflow shared context" rows={8} value={body} onChange={e => setBody(e.target.value)}/></details></div>
      <aside className="wh-step-inspector" aria-label="Step inspector">{current ? <><div className="wh-section-heading"><h2>Edit step</h2><Icon name="edit" size={14}/></div><label>Name<input aria-label="Step name" value={current.title} onChange={e => edit({ title:e.target.value })}/></label>{team ? <label>Team role<select aria-label="Step team role" value={current.role || ''} onChange={e => { const role = team.roles.find(r => r.name === e.target.value); if (role) edit({ role:role.name, worker:role.worker }) }}>{team.roles.map(role => <option key={role.name} value={role.name}>{role.name}</option>)}</select></label> : <label>Agent<select aria-label="Step agent" value={current.worker} onChange={e => edit({ worker:e.target.value })}><option value="agent:assistant">Main agent</option>{workers.map(w => <option key={w.handle} value={w.handle}>{w.name}</option>)}</select></label>}<label>Target folder<select aria-label="Step target folder" value={current.target} onChange={e => edit({ target:Number(e.target.value) })}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <fieldset><legend>Wait for accepted steps</legend>{steps.filter(s => s.id !== current.id).map(s => <label className="wh-dependency" key={s.id}><input type="checkbox" checked={current.needs.includes(s.id)} onChange={e => edit({ needs:e.target.checked ? [...current.needs,s.id] : current.needs.filter(id => id !== s.id) })}/>{s.title}</label>)}</fieldset><label>Instructions<textarea aria-label="Step instructions" rows={8} value={current.instructions} onChange={e => edit({ instructions:e.target.value })}/></label><p className="wh-review-gate"><Icon name="decision" size={14}/>Human acceptance unlocks dependent steps.</p><button className="wf-secondary" onClick={() => { setSteps(all => all.filter(s => s.id !== current.id).map(s => ({ ...s, needs:s.needs.filter(id => id !== current.id) }))); setSelected(steps.find(s => s.id !== current.id)?.id || '') }}>Remove step</button></> : <p>Select a step or add one.</p>}</aside></div>
  </section>
}


function WorkflowCanvas({ steps, levels, selected, workers, onSelect }: { steps: Step[]; levels: Map<string,number>; selected: string; workers: ipc.Worker[]; onSelect: (id: string) => void }) {
  const rows = new Map<number,number>()
  const fallback = Math.max(0,...levels.values()) + 1
  const positions = new Map(steps.map(item => {
    const level = levels.get(item.id) ?? fallback
    const row = rows.get(level) || 0
    rows.set(level,row+1)
    return [item.id,{x:16+level*280,y:16+row*208}]
  }))
  const width = Math.max(300,...[...positions.values()].map(p=>p.x+240))
  const height = Math.max(250,...[...positions.values()].map(p=>p.y+200))
  return <div className="wh-canvas" aria-label="Workflow dependency graph"><div className="wh-graph-surface" style={{width,height,minWidth:width}}>
    <svg width={width} height={height} aria-hidden="true" className="wh-graph-lines"><defs><marker id="wh-dependency-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>{steps.flatMap(item=>item.needs.map(parent=>{
      const from=positions.get(parent),to=positions.get(item.id)
      if(!from||!to)return null
      const x=from.x+220,y=from.y+90,tx=to.x-3,ty=to.y+90
      const middle=(x+tx)/2
      return <path key={`${parent}:${item.id}`} d={`M${x},${y} C${middle},${y} ${middle},${ty} ${tx},${ty}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#wh-dependency-arrow)"/>
    }))}</svg>
    {steps.map(item=>{const p=positions.get(item.id)!;return <button key={item.id} style={{left:p.x,top:p.y}} className="wh-node" aria-pressed={selected===item.id} onClick={()=>onSelect(item.id)}><span className="wh-kicker" title={item.needs.map(id=>steps.find(s=>s.id===id)?.title||id).join(' + ')}>{item.needs.length?`After ${item.needs.map(id=>steps.find(s=>s.id===id)?.title||id).join(' + ')}`:'Start'}</span><strong>{item.title}</strong><span>{item.role||workers.find(w=>w.handle===item.worker)?.name||(item.worker==='agent:assistant'?'Main agent':item.worker)}</span><small>{item.needs.length>1?`Join · ${item.needs.length} accepted dependencies`:'Human review gate'}</small></button>})}
  </div></div>
}
