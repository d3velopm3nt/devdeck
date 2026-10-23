import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { WorkCard } from '../../lib/workHub'

export function CompleteWorkItem({ card, onSaved, onClose }: { card: WorkCard; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => previous?.focus()
  }, [])
  const [reason, setReason] = useState('')
  const [exclude, setExclude] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = card.workflows.flatMap(w => w.view.definition.steps.filter(s => s.status === 'pending').map(s => ({ node:w.node, workflow:w.id, step:s.id, title:s.title })))
  const unresolved = card.workflows.some(w => w.view.definition.steps.some(s => ['starting', 'running', 'review', 'blocked'].includes(s.status)))
  const github = card.record.source_url.startsWith('https://github.com/')
  const complete = async () => {
    setBusy(true); setError('')
    try { await ipc.workRecordComplete(card.record, card.record.revision, exclude ? pending.map(({node,workflow,step}) => ({node,workflow,step})) : [], reason); onSaved() }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  return <div className="wh-overlay"><section ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }} role="dialog" aria-modal="true" aria-label="Complete work item" className="wh-dialog">
    <header><div><h2>Complete work item</h2><p>{card.record.title}</p></div><button className="wf-secondary" disabled={busy} onClick={onClose}>Cancel</button></header>
    <div className="wh-form">
      {unresolved && <p role="alert">Resolve running work, review requests and blocked steps before completion.</p>}
      {!!pending.length && <><p>These steps have not run:</p><ul>{pending.map(s => <li key={`${s.node}:${s.workflow}:${s.step}`}>{s.title}</li>)}</ul><label className="wh-scope-confirm"><input type="checkbox" checked={exclude} onChange={e => setExclude(e.target.checked)} disabled={busy}/> These remaining steps are outside this request’s scope</label><p className="wh-note">They will be recorded as Outside scope, preserving the plan and run history.</p></>}
      <label>Completion evidence{pending.length ? ' and scope explanation' : ''}<textarea autoFocus aria-label="Completion evidence" rows={4} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="What was delivered and verified? Explain any excluded steps."/></label>
      <p className="wh-note">{github ? 'This completes the work item and closes its linked GitHub issue. If GitHub cannot confirm closure, the work item keeps a visible retry action.' : 'This records local completion and retains the work history.'}</p>
      {error && <p role="alert" className="wh-error">{error}</p>}
      <button className="wf-primary" disabled={busy || unresolved || !reason.trim() || (!!pending.length && !exclude)} onClick={() => void complete()}>{busy ? 'Completing…' : github ? 'Complete and close GitHub issue' : 'Complete work item'}</button>
    </div>
  </section></div>
}
