import { useState } from 'react'
import type { GoalRow } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import type { TreeNode } from '../../lib/types'
import { goalKey } from '../../lib/workHub'

export function WorkItemEditor({ record, goals, nodes, legacy = false, onSaved, onClose }: { record: ipc.WorkRecord; goals: GoalRow[]; nodes: TreeNode[]; legacy?: boolean; onSaved: (item: ipc.WorkRecord) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(record)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try { onSaved(await ipc.workRecordSave(draft, record.revision)) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <div className="wh-overlay"><section role="dialog" aria-modal="true" aria-label={record.revision ? 'Edit work item' : 'Save work item'} className="wh-dialog">
    <header><div><h2>{record.revision ? 'Edit work item' : 'Work item'}</h2><p>The request, its acceptance criteria and the processes used to deliver it.</p></div><button className="wf-secondary" disabled={busy} onClick={onClose}>Cancel</button></header>
    <div className="wh-form"><label>Title<input aria-label="Work item title" value={draft.title} onChange={e => setDraft({ ...draft, title:e.target.value })}/></label><div className="wh-form-row"><label>Folder<select aria-label="Work item folder" value={draft.node || ''} onChange={e => setDraft({ ...draft, node:Number(e.target.value), goal:'' })}><option value="">Choose a folder</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label>Goal<select aria-label="Work item goal" value={draft.goal} onChange={e => setDraft({ ...draft, goal:e.target.value })}><option value="">No goal</option>{goals.filter(g => g.node_id === draft.node).map(g => <option key={goalKey(g)} value={goalKey(g)}>{g.feature_name}</option>)}</select></label></div>
    <label>Description · Markdown<textarea aria-label="Work item description" rows={5} value={draft.description} onChange={e => setDraft({ ...draft, description:e.target.value })}/></label><label>Acceptance criteria · Markdown<textarea aria-label="Work item acceptance criteria" rows={4} value={draft.acceptance} onChange={e => setDraft({ ...draft, acceptance:e.target.value })} placeholder="- [ ] The result the user can verify"/></label>
    <div className="wh-form-row"><label>Work state<select aria-label="Work item state" disabled={legacy} value={draft.status} onChange={e => setDraft({ ...draft, status:e.target.value as ipc.WorkRecord['status'] })}>{(record.status === 'completed' ? ['completed'] : ['queued','working','review','blocked']).map(state => <option key={state}>{state}</option>)}</select></label><label>External source URL<input aria-label="Work item source URL" type="url" value={draft.source_url} onChange={e => setDraft({ ...draft, source_url:e.target.value })} placeholder="https://github.com/…"/></label></div>
    <p className="wh-note">Run progress is shown separately. Use Complete work item after reviewing the result. That action closes a linked GitHub issue and records any sync failure.{legacy && ' Existing work keeps its original execution state and history.'}</p>
    {error && <p role="alert" className="wh-error">{error}</p>}<button className="wf-primary" disabled={busy || !draft.title.trim() || !draft.node || (!!draft.source_url && !/^https?:\/\//i.test(draft.source_url))} onClick={() => void save()}>{busy ? 'Saving…' : 'Save work item'}</button></div>
  </section></div>
}
