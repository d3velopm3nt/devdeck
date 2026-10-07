import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import * as ipc from '../lib/ipc'
import { openRun } from '../lib/dock'
import { useApp } from '../store'

const button = 'rounded border border-line2 bg-soft px-3 py-1.5 text-[12px] text-ink hover:bg-hover disabled:opacity-40'
const field = 'w-full rounded border border-line2 bg-panel p-2 text-[12px] text-ink'
function template(node: number, worker: string) {
  return `---
title: My workflow
steps:
  - id: prepare
    title: Prepare the work
    worker: ${JSON.stringify(worker)}
    target: ${node}
    needs: []
    instructions: |
      Describe the result to produce and how to verify it.
  - id: follow-up
    title: Update supporting material
    worker: ${JSON.stringify(worker)}
    target: ${node}
    needs: [prepare]
    instructions: |
      Use the accepted work to update the relevant documentation.
      Keep publication as a separate decision.
---

# Goal

Describe the topic, useful files, constraints and what success means.
`
}

export function FolderWorkflowPage({ node, name, onDashboard }: { node: number; name: string; onDashboard: () => void }) {
  const nodes = useApp(s => s.nodes)
  const [data, setData] = useState<ipc.FolderWorkflow | null>(null)
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editExpected, setEditExpected] = useState('')
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState('')
  const [evidence, setEvidence] = useState('')
  const [planRevision, setPlanRevision] = useState('')
  const [plan, setPlan] = useState<ipc.RunPlan | null>(null)
  const refresh = useCallback(async () => {
    try { setData(await ipc.folderWorkflowGet(node)); setError('') }
    catch (e) { setError(String(e)) }
  }, [node])
  useEffect(() => {
    void refresh()
    void ipc.workersList().then(setWorkers).catch(e => setError(String(e)))
    let disposed = false
    const stop = listen<{ project_id?: string; payload: { source?: string } }>('aiw:event', e => {
      if (e.payload.project_id === String(node) && e.payload.payload.source === 'folder_workflow') void refresh()
    })
    void stop.then(off => { if (disposed) off() }).catch(e => setError(String(e)))
    return () => { disposed = true; void stop.then(off => off()).catch(() => {}) }
  }, [node, refresh])
  const steps = data?.definition.steps ?? []
  const step = steps.find(s => s.id === selected) ?? steps[0]
  const canRun = step && ['pending', 'blocked'].includes(step.status) && step.needs.every(id => steps.some(s => s.id === id && s.status === 'done'))
  const editable = steps.every(s => s.status === 'pending')
  const act = async (fn: () => Promise<ipc.FolderWorkflow>) => {
    setBusy(true); setError('')
    try { setData(await fn()); setPlan(null); setEvidence(''); setEditing(false) }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  const preview = async () => {
    if (!step || !data) return
    setBusy(true); setError('')
    try { setPlan(await ipc.workerPlan(step.worker, step.target, step.title, `${data.body}\n\n${step.instructions}`)); setPlanRevision(data.raw) }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  return <div className="flex h-full flex-col bg-page text-body">
    <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1"><div className="text-[11px] uppercase tracking-wider text-muted">{name} / Workflow</div>
        <h1 className="text-xl font-semibold text-ink">{data?.definition.title || 'Set up a workflow'}</h1>
        <p className="mt-1 text-[12px] text-muted">{steps.filter(s => s.status === 'done').length} of {steps.length} accepted · Manual start</p>
      </div>
      <button className={button} onClick={onDashboard}>Folder dashboard</button>
      <button className={button} disabled={busy} onClick={() => void refresh()}>Refresh</button>
      {data && editable && !editing && <button className={button} onClick={() => { setEditExpected(data.raw); setDraft(data.raw || template(node, workers[0]?.handle ?? 'choose-worker')); setEditing(true); setPlan(null) }}>{data.raw ? 'Edit workflow' : 'Create workflow'}</button>}
    </header>
    {error && <div role="alert" className="border-b border-line bg-red-500/10 px-5 py-3 text-[13px] text-err">{error}</div>}
    {!data && !error && <p className="p-5 text-muted">Loading workflow…</p>}
    {editing ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5">
      <p className="text-[12px] text-muted">Use existing worker handles and target folder IDs below. Each step can depend on other step IDs. Markdown after the header gives every worker the shared context.</p>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div><b>Workers</b><p>{workers.map(w => `${w.handle} (${w.name})`).join(', ') || 'Create a worker in Team before starting.'}</p></div>
        <div><b>Target folders</b><p>{nodes.map(n => `${n.id}: ${n.name}`).join(' · ')}</p></div>
      </div>
      <textarea aria-label="Workflow Markdown" className={`${field} min-h-72 flex-1 font-mono`} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} />
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void act(() => ipc.folderWorkflowSave(node, editExpected, draft))}>Save workflow</button><button className={button} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
    </div> : data && steps.length === 0 ? <div className="m-5 rounded-xl border border-dashed border-line2 p-8">
      <h2 className="font-semibold text-ink">Use this folder for any repeatable piece of work.</h2>
      <p className="mt-2 max-w-xl text-[13px] text-muted">Add steps for a roadmap, marketing campaign, documentation or development. Instructions and progress live in WORKFLOW.md in this existing folder. Creating or labelling it starts no agents.</p>
    </div> : data && <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,2fr)_minmax(260px,3fr)] overflow-auto">
      <section aria-label="Workflow steps" className="space-y-3 border-r border-line p-4">
        {steps.map((s, i) => <button key={s.id} onClick={() => { setSelected(s.id); setPlan(null); setEvidence('') }} className={`w-full rounded-xl border p-4 text-left ${step?.id === s.id ? 'border-indigo-400 bg-indigo-500/10' : 'border-line bg-panel hover:bg-hover'}`}>
          <div className="flex justify-between gap-2"><span className="text-[11px] text-muted">STEP {i + 1}</span><span className={`text-[11px] uppercase ${s.status === 'done' ? 'text-ok' : s.status === 'blocked' ? 'text-err' : 'text-info'}`}>{s.status === 'review' ? 'Needs review' : s.status}</span></div>
          <h2 className="mt-2 text-[14px] font-semibold text-ink">{s.title}</h2>
          <p className="mt-1 text-[12px] text-dim">@{s.worker} · {nodes.find(n => n.id === s.target)?.name ?? `Folder ${s.target}`}</p>
          <p className="mt-2 text-[11px] text-muted">{s.needs.length ? `After acceptance: ${s.needs.join(', ')}` : 'No dependencies'}</p>
        </button>)}
      </section>
      {step && <section className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-ink">{step.title}</h2>
        <div><h3 className="mb-2 text-[11px] uppercase text-muted">Instructions</h3><p className="whitespace-pre-wrap text-[13px]">{step.instructions}</p></div>
        <details><summary className="cursor-pointer text-[12px] text-muted">Shared workflow context</summary><p className="mt-2 whitespace-pre-wrap text-[13px]">{data.body}</p></details>
        {step.evidence && <div className="rounded-lg border border-line bg-panel p-3"><h3 className="text-[11px] uppercase text-muted">Result / review notes</h3><p className="mt-2 whitespace-pre-wrap text-[13px]">{step.evidence}</p></div>}
        {step.previous_runs.length > 0 && <details><summary className="cursor-pointer text-[12px] text-muted">Previous attempts</summary>{step.previous_runs.map(id => <button key={id} className={`${button} mt-2 mr-2`} onClick={() => openRun(id, step.title)}>{id}</button>)}</details>}
        {step.run && <button className={button} onClick={() => openRun(step.run, step.title)}>Open worker receipt</button>}
        {['running', 'starting'].includes(step.status) && <button className={button} disabled={busy || !step.run} onClick={() => { void ipc.workerStop(step.run).catch(e => setError(String(e))) }}>Stop worker</button>}
        {canRun && !plan && <button className="btn-primary text-[12px]" disabled={busy} onClick={() => void preview()}>{steps.every(s => s.status === 'pending') ? 'Start workflow' : step.status === 'blocked' ? 'Review retry' : 'Start step'}</button>}
        {plan && <div className="space-y-3 rounded-xl border border-line2 bg-panel p-4">
          <h3 className="font-semibold text-ink">Start {plan.worker.name}?</h3>
          <p className="break-all text-[12px]">Working folder: {plan.folder}</p>
          <p className="text-[12px]">{plan.minutes} minute limit · ${plan.usd} budget · {plan.is_repo ? 'Separate branch and worktree' : 'Writes in the target workspace folder'}</p>
          <p className="text-[12px]">Skills: {plan.skills.map(s => s.name).join(', ') || 'None selected'}</p>
          {plan.note && <p className="text-[12px] text-warn">{plan.note}</p>}
          <button className="btn-primary text-[12px]" disabled={busy || !plan.ready || !canRun} onClick={() => void act(() => ipc.folderWorkflowStart(node, step.id, planRevision))}>Start this step</button>
          <button className={`${button} ml-2`} onClick={() => setPlan(null)}>Cancel</button>
        </div>}
        {step.status === 'review' && <div className="space-y-3 rounded-xl border border-line2 p-4">
          <p className="text-[12px]">Review the receipt and make the accepted output available to the next worker. Acceptance unlocks dependent steps; it does not merge code or publish anything.</p>
          <textarea aria-label="Review evidence" className={field} rows={3} placeholder="What did you verify, and where is the accepted output?" value={evidence} onChange={e => setEvidence(e.target.value)} />
          <button className="btn-primary text-[12px]" disabled={busy || !evidence.trim()} onClick={() => void act(() => ipc.folderWorkflowReview(node, step.id, data.raw, true, evidence))}>Accept step</button>
          <button className={`${button} ml-2`} disabled={busy || !evidence.trim()} onClick={() => void act(() => ipc.folderWorkflowReview(node, step.id, data.raw, false, evidence))}>Request changes</button>
        </div>}
        {!canRun && step.status === 'pending' && <p className="text-[12px] text-muted">Waiting for dependencies to be accepted.</p>}
      </section>}
    </div>}
  </div>
}
