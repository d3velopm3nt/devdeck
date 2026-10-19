import { Icon } from '../../lib/icons'
import { useState } from 'react'
import type { TreeNode } from '../../lib/types'
import type { ReusableTeam, Worker } from '../../lib/ipc'
import { isTemplate, type WorkflowEntry } from '../../lib/workHub'
import { WorkflowBuilder } from './WorkflowBuilder'

export function WorkflowLibrary({ nodes, entries, workers, teams, onChanged, onRun }: { nodes: TreeNode[]; entries: WorkflowEntry[]; workers: Worker[]; teams: ReusableTeam[]; onChanged: () => void; onRun: (entry: WorkflowEntry) => void }) {
  const [folder, setFolder] = useState('all')
  const [editing, setEditing] = useState<WorkflowEntry | 'new' | null>(null)
  const [history, setHistory] = useState(false)
  const visible = entries.filter(e => folder === 'all' || String(e.node) === folder)
  if (editing) return <WorkflowBuilder key={editing === 'new' ? 'new' : `${editing.node}:${editing.id}`} entry={editing === 'new' ? undefined : editing} nodes={nodes} workers={workers} teams={teams} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged() }}/>
  const templates = visible.filter(isTemplate)
  return <section className="wh-workflows" aria-label="Reusable workflows"><div className="wh-workflow-toolbar"><div><h2>Reusable workflows</h2><p>Define a process once. Attach a fresh run to a work item when it is needed.</p></div><select aria-label="Workflow library folder" value={folder} onChange={e => setFolder(e.target.value)}><option value="all">All folders</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select><button className="wf-primary" disabled={!nodes.length} onClick={() => setEditing('new')}>Create workflow</button></div>
    <div className="wh-workflow-grid">{templates.map(entry => <article className="wh-workflow-card" key={`${entry.node}:${entry.id}`}><span className="wh-kicker">{entry.folder} · Reusable process</span><h3>{entry.view.definition.title}</h3><p>{teams.find(t => t.id === entry.view.definition.team)?.name || 'Direct agent assignments'}</p><div className="wh-workflow-outline">{entry.view.definition.steps.map(step => <span key={step.id}>{step.title}</span>)}</div><footer><span>{entry.view.definition.steps.length} steps · {entry.view.definition.steps.filter(s => s.needs.length > 1).length} joins</span><button className="wf-secondary" onClick={() => setEditing(entry)}><Icon name="edit" size={14}/>Edit workflow</button></footer></article>)}</div>
    {!templates.length && <div className="wh-empty"><h3>Create your team’s repeatable process</h3><p>Connect steps, choose roles, and keep review gates visible.</p></div>}
    <button className="wf-secondary" onClick={() => setHistory(value => !value)}>{history ? 'Hide existing execution history' : `Existing execution history (${visible.length - templates.length})`}</button>
    {history && <div className="wh-workflow-grid">{visible.filter(e => !isTemplate(e)).map(entry => <button className="wh-run-card" key={`${entry.node}:${entry.id}`} onClick={() => onRun(entry)}><strong>{entry.view.definition.title}</strong><span>{entry.folder} · {entry.view.definition.steps.filter(s => s.status === 'done').length}/{entry.view.definition.steps.length} accepted</span><p>Open its owning work item</p></button>)}</div>}
  </section>
}
