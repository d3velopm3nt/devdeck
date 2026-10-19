import { StepProgress } from './StepProgress'
import { CompleteWorkItem } from './CompleteWorkItem'
import { useEffect, useState } from 'react'
import type { GoalRow } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import type { TreeNode } from '../../lib/types'
import { goalKey, workDisplayState, type WorkCard, type WorkflowEntry } from '../../lib/workHub'
import { StateBadge } from '../ui/DesignSystem'
import { Markdown } from '../thread/Markdown'
import { WorkflowDetail } from '../FolderWorkflowPage'
import { openRun } from '../../lib/dock'
import { WorkItemEditor } from './WorkItemEditor'

export function WorkItemDetail({ card, goals, nodes, workers, teams, onClose, onChanged, onGoal, initialRun }: { initialRun?: {node: number; id: string; step?: string} | null; card: WorkCard; goals: GoalRow[]; nodes: TreeNode[]; workflows: WorkflowEntry[]; workers: ipc.Worker[]; teams: ipc.ReusableTeam[]; onClose: () => void; onChanged: () => void; onGoal: (key: string) => void }) {
  const [completing, setCompleting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [run, setRun] = useState<{ node: number; id: string; step?: string } | null>(initialRun ?? null)
  const [error, setError] = useState('')
  const [direct, setDirect] = useState<ipc.Run[]>([])
  const stored = card.record
  const goal = goals.find(g => goalKey(g) === stored.goal)
  const legacyFeature = card.legacy?.feature
  const legacyItem = card.legacy?.item
  useEffect(() => {
    if (!legacyFeature || !legacyItem) { setDirect([]); return }
    let alive = true
    void ipc.runsList(stored.node).then(runs => { if (alive) setDirect(runs.filter(r => r.feature === legacyFeature && r.item === legacyItem)) }).catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [legacyFeature, legacyItem, stored.node])
  if (run) return <section className="wh-run-detail" aria-label="Work item progress"><div className="wh-run-breadcrumb"><button className="wf-secondary" onClick={() => setRun(null)}>← {stored.title}</button><span>Plan and progress · this work item</span></div><WorkflowDetail key={`${run.node}:${run.id}`} node={run.node} name={nodes.find(n => n.id === run.node)?.name || 'Work item'} workflow={run.id} initialStep={run.step} onSaved={onChanged} onDashboard={() => setRun(null)} backLabel="Back to work item"/></section>
  return <section className="wh-detail" aria-label="Work item details"><header className="wh-detail-heading"><div><p className="wh-kicker">Work item · {nodes.find(n => n.id === stored.node)?.name || 'Choose a folder'}</p><h2>{stored.title}</h2><StateBadge state={workDisplayState(card)}/></div><button className="wf-secondary" onClick={onClose}>Close</button></header>
    <div className="wh-detail-content"><div className="wh-actions">{stored.status !== 'completed' && card.kind !== 'legacy' && <button className="wf-primary" onClick={() => setCompleting(true)}>Complete work item</button>}<button className="wf-secondary" onClick={() => setEditing(true)}>Edit work item</button>{goal && <button className="wf-secondary" onClick={() => onGoal(goalKey(goal))}>Goal: {goal.feature_name}</button>}{/^https?:\/\//i.test(stored.source_url) && <button className="wf-secondary" onClick={() => { void ipc.openUrl(stored.source_url).catch(e => setError(String(e))) }}>Open source{stored.github_sync === 'closed' ? ' · closed' : card.externalState ? ` · ${card.externalState}` : ''}</button>}</div>
      {stored.completion_note && <section aria-label="Completion"><h3>Completed</h3><Markdown text={stored.completion_note}/></section>}
      {stored.github_sync && <section aria-label="GitHub completion"><StateBadge state={stored.github_sync === 'closed' ? 'completed' : 'blocked'} label={stored.github_sync === 'closed' ? 'GitHub issue closed' : 'GitHub closure pending'}/>{stored.github_sync !== 'closed' && <><p role="alert">{stored.github_sync_error || 'Closure has not been confirmed.'}</p><button className="wf-secondary" disabled={syncing} onClick={() => { setSyncing(true); void ipc.workRecordSync(stored.id, stored.revision).then(onChanged).catch(e => setError(String(e))).finally(() => setSyncing(false)) }}>Retry GitHub sync</button></>}</section>}
      {card.workflows.flatMap(entry => entry.view.definition.steps.filter(step => step.status === 'review').map(step => <ReviewGate key={`${entry.node}:${entry.id}:${step.id}`} entry={entry} step={step} onChanged={onChanged}/>))}
      <h3>Request</h3><Markdown text={stored.description || 'Add context and the outcome you need.'}/><h3>Acceptance criteria</h3><Markdown text={stored.acceptance || 'No acceptance criteria recorded yet.'}/>
      <div className="wh-section-heading"><h3>Plan and progress</h3><span>{card.workflows.length} attached</span></div><p className="wh-note">Steps retain their attempts and evidence. Accepted steps unlock dependencies; finishing a run does not close this request.</p>
      {error && <p role="alert" className="wh-error">{error}</p>}
      {card.workflows.map(entry => {
        const steps = entry.view.definition.steps
        const active = steps.find(s => ['running','starting','review','blocked'].includes(s.status)) || steps.find(s => s.status === 'pending')
        return <button className="wh-run-card" key={`${entry.node}:${entry.id}`} onClick={() => setRun({ node:entry.node, id:entry.id })}><div><strong>{entry.view.definition.title}</strong><span>{teams.find(t => t.id === entry.view.definition.team)?.name || entry.view.definition.team || 'Direct agent assignments'}</span></div><p>{steps.filter(s => s.status === 'done').length} accepted{steps.some(s => s.status === 'skipped') ? ` · ${steps.filter(s => s.status === 'skipped').length} outside scope` : ` / ${steps.length}`} · {active ? `${active.title} · ${workers.find(w => w.handle === active.worker)?.name || active.worker}` : 'No remaining steps'}</p><StepProgress steps={steps}/></button>
      })}
      {!!direct.length && <><h3>Direct agent runs</h3>{direct.map(receipt => <button key={receipt.id} className="wh-run-card" onClick={() => openRun(receipt.id, receipt.title)}><strong>{receipt.title}</strong><span>{receipt.worker_name} · {receipt.status}</span></button>)}</>}
      {card.kind === 'legacy' && goal && <p className="wh-note"><button className="wf-link" onClick={() => onGoal(goalKey(goal))}>Open existing goal controls and approvals</button></p>}
    </div>{completing && <CompleteWorkItem card={card} onClose={() => setCompleting(false)} onSaved={() => { setCompleting(false); onChanged() }}/ >}{editing && <WorkItemEditor record={stored} legacy={card.kind === 'legacy'} goals={goals} nodes={nodes} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }}/>}</section>
}

function ReviewGate({ entry, step, onChanged }: { entry: WorkflowEntry; step: ipc.FolderWorkflowStep; onChanged: () => void }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const review = async (accept: boolean) => {
    setBusy(true); setError('')
    try { await ipc.folderWorkflowReview(entry.node, step.id, entry.view.raw, accept, notes.trim(), entry.id); onChanged() }
    catch(e) { setError(String(e)); onChanged() }
    finally { setBusy(false) }
  }
  return <section className="wh-review-gate" aria-label={`Review ${step.title}`}>
    <div className="wh-section-heading"><h3>Needs your review</h3><StateBadge state="review"/></div>
    <strong>{step.title}</strong><p className="wh-note">Approval unlocks dependent steps. Request changes returns this step for revision.</p>
    <details><summary>Read the submitted result</summary><Markdown text={step.evidence || 'Open the agent receipt to inspect the submitted result.'}/></details>
    <label>Review notes<textarea aria-label={`Review notes for ${step.title}`} value={notes} disabled={busy} onChange={e => setNotes(e.target.value)} rows={2} placeholder="What did you verify, or what needs to change?"/></label>
    <div className="wh-actions"><button className="wf-primary" disabled={busy || !notes.trim()} onClick={() => void review(true)}>Approve step</button><button className="wf-secondary" disabled={busy || !notes.trim()} onClick={() => void review(false)}>Request changes</button></div>
    {!notes.trim() && <p className="wh-note">Add a review note to enable both actions.</p>}{error && <p className="wh-error" role="alert">{error}</p>}
  </section>
}
