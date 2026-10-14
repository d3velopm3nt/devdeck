import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import * as ipc from '../lib/ipc'
import { IssueMonitorPanel } from './IssueMonitorPanel'
import { openRun } from '../lib/dock'
import { useApp } from '../store'
import { visibility, type ProductLink, type GithubIssue } from '../lib/visibility'

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
  const [items, setItems] = useState<ipc.WorkflowSummary[]>([])
  const [workflow, setWorkflow] = useState('default')
  const [newId, setNewId] = useState('')
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(() => ipc.folderWorkflowList(node).then(setItems).catch(e => setError(String(e))), [node])
  useEffect(() => { void reload() }, [reload])
  return <div className="flex h-full min-h-0 flex-col">
    <details className="shrink-0 border-b border-line"><summary className="cursor-pointer px-5 py-2 text-[12px] text-info">GitHub issue monitor</summary><IssueMonitorPanel/></details>
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-5 py-3">
      <label className="text-[12px] text-muted">Workflow <select aria-label="Choose workflow" className={field} value={workflow} onChange={e => setWorkflow(e.target.value)}>
        {!items.some(w => w.id === workflow) && <option value={workflow}>{workflow === 'default' ? 'Default workflow' : newId || workflow}</option>}
        {items.map(w => <option key={w.id} value={w.id}>{w.title} · {w.error ? 'Could not read' : `${w.done}/${w.steps}`}</option>)}
      </select></label>
      <input aria-label="New workflow ID" className={`${field} max-w-52`} value={newId} onChange={e => setNewId(e.target.value)} placeholder="mobile-release"/>
      <button className={button} disabled={!/^[a-z0-9_-]{1,80}$/.test(newId) || items.some(w => w.id === newId)} onClick={() => { setWorkflow(newId); setNewId('') }}>New workflow</button>
      <button className={button} disabled={!items.length} onClick={() => setRouting(r => !r)}>Route GitHub issue</button>
      {error && <span role="alert" className="text-[12px] text-err">{error}</span>}
    </div>
    {routing && <IssueRouting node={node} source={workflow} onRouted={id => { setWorkflow(id); setRouting(false); void reload() }}/>}
    <div className="min-h-0 flex-1"><WorkflowDetail key={`${node}:${workflow}`} node={node} name={name} workflow={workflow} onSaved={() => void reload()} onDashboard={onDashboard}/></div>
  </div>
}

function WorkflowDetail({ node, name, workflow, onSaved, onDashboard }: { node: number; name: string; workflow: string; onSaved: () => void; onDashboard: () => void }) {
  const nodes = useApp(s => s.nodes)
  const [data, setData] = useState<ipc.FolderWorkflow | null>(null)
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editExpected, setEditExpected] = useState('')
  const [draft, setDraft] = useState('')
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState('')
  const [evidence, setEvidence] = useState('')
  const [planRevision, setPlanRevision] = useState('')
  const [checkpointExpected, setCheckpointExpected] = useState('')
  const [actor, setActor] = useState('ChatGPT')
  const [progress, setProgress] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [plan, setPlan] = useState<ipc.RunPlan | null>(null)
  const refresh = useCallback(async () => {
    try { setData(await ipc.folderWorkflowGet(node, workflow)); setError('') }
    catch (e) { setError(String(e)) }
  }, [node, workflow])
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
  const handoff = data ? `Read the latest workflow file before acting. Follow dependencies and instructions; preserve completed work and record evidence and the next action. Sync the state repository before switching assistants.

Workflow file: ${data.path}

${data.raw}` : ''
  const editable = steps.every(s => s.status === 'pending')
  const act = async (fn: () => Promise<ipc.FolderWorkflow>) => {
    setBusy(true); setError('')
    try { setData(await fn()); onSaved(); setPlan(null); setEvidence(''); setProgress(''); setNextAction(''); setEditing(false) }
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
        <p className="mt-1 text-[12px] text-muted">{steps.filter(s => s.status === 'done').length} of {steps.length} accepted · Starts follow dependencies and permissions</p>
      </div>
      <button className={button} onClick={onDashboard}>Folder dashboard</button>
      <button className={button} disabled={busy} onClick={() => void refresh()}>Refresh</button>
      {data && editable && !editing && <button className={button} onClick={() => { setEditExpected(data.raw); setDraft(data.raw || template(node, workers[0]?.handle ?? 'choose-worker')); setEditing(true); setPlan(null) }}>{data.raw ? 'Edit workflow' : 'Create workflow'}</button>}
    </header>
    {error && <div role="alert" className="border-b border-line bg-red-500/10 px-5 py-3 text-[13px] text-err">{error}</div>}
    {data && steps.length > 0 && <details className="border-b border-line px-5 py-3">
      <summary className="cursor-pointer text-[12px] text-info">Continue with another assistant</summary>
      <p className="my-2 text-[12px] text-muted">Share the current workflow and its referenced files. Pull before reading, then commit and push progress so the next assistant sees it. DevDeck reads your local clone; chat history does not sync automatically.</p>
      <textarea aria-label="Assistant handoff" readOnly rows={8} className={`${field} font-mono`} value={handoff} onFocus={e => e.currentTarget.select()} />
    </details>}
    {!data && !error && <p className="p-5 text-muted">Loading workflow…</p>}
    {editing ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5">
      <p className="text-[12px] text-muted">Use existing worker handles and target folder IDs below. Each step can depend on other step IDs. Markdown after the header gives every worker the shared context.</p>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div><b>Workers</b><p>{workers.map(w => `${w.handle} (${w.name})`).join(', ') || 'Create a worker in Team before starting.'}</p></div>
        <div><b>Target folders</b><p>{nodes.map(n => `${n.id}: ${n.name}`).join(' · ')}</p></div>
      </div>
      <details className="rounded border border-line p-3"><summary className="cursor-pointer text-[12px] text-info">Technical team template</summary>
        <p className="my-2 text-[12px] text-muted">Assign reusable workers to the roles, then load the planning, implementation, testing and review process.</p>
        <div className="grid grid-cols-2 gap-2">{['lead', 'developer', 'tester', 'reviewer'].map(role => <label key={role} className="text-[12px] capitalize">{role}<select aria-label={`${role} worker`} className={field} value={roles[role] || workers[0]?.handle || ''} onChange={e => setRoles(r => ({ ...r, [role]: e.target.value }))}>{workers.map(w => <option key={w.handle} value={w.handle}>{w.name}</option>)}</select></label>)}</div>
        <button className={`${button} mt-3`} disabled={!workers.length} onClick={() => setDraft(technicalTemplate(node, Object.fromEntries(['lead', 'developer', 'tester', 'reviewer'].map(role => [role, roles[role] || workers[0].handle]))))}>Use technical template</button>
      </details>
      <textarea aria-label="Workflow Markdown" className={`${field} min-h-72 flex-1 font-mono`} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} />
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void act(() => ipc.folderWorkflowSave(node, editExpected, draft, workflow))}>Save workflow</button><button className={button} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
    </div> : data && steps.length === 0 ? <div className="m-5 rounded-xl border border-dashed border-line2 p-8">
      <h2 className="font-semibold text-ink">Use this folder for any repeatable piece of work.</h2>
      <p className="mt-2 max-w-xl text-[13px] text-muted">Add steps for a roadmap, marketing campaign, documentation or development. Each workflow has its own Markdown file, instructions and progress. Creating a workflow starts no agents.</p>
    </div> : data && <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(220px,2fr)_minmax(260px,3fr)] overflow-auto">
      <section aria-label="Workflow steps" className="space-y-3 border-r border-line p-4">
        {steps.map((s, i) => <button key={s.id} onClick={() => { setSelected(s.id); setPlan(null); setEvidence(''); setProgress(''); setNextAction('') }} className={`w-full rounded-xl border p-4 text-left ${step?.id === s.id ? 'border-indigo-400 bg-indigo-500/10' : 'border-line bg-panel hover:bg-hover'}`}>
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
        {step.actor && <p className="text-[12px] text-muted">Updated by {step.actor}{step.updated_at ? ` · ${step.updated_at}` : ''}</p>}
        {step.next_action && <p className="text-[13px]"><b>Next action:</b> {step.next_action}</p>}
        {canRun && <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-[12px] text-info" onClick={() => setCheckpointExpected(data.raw)}>Record work from another assistant</summary>
          <div className="mt-3 space-y-3">
            <input aria-label="Progress assistant" className={field} value={actor} onChange={e => setActor(e.target.value)} placeholder="ChatGPT, Claude or your name" />
            <textarea aria-label="Progress evidence" className={field} rows={3} value={progress} onChange={e => setProgress(e.target.value)} placeholder="Completed work, commit or file references, checks and blockers" />
            <textarea aria-label="Next action" className={field} rows={2} value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="What the next assistant should do" />
            <button className={button} disabled={busy || !actor.trim() || !progress.trim() || !nextAction.trim()} onClick={() => void act(() => ipc.folderWorkflowCheckpoint(node, step.id, checkpointExpected, actor, progress, nextAction, false, workflow))}>Save checkpoint</button>
            <button className={`${button} ml-2`} disabled={busy || !actor.trim() || !progress.trim() || !nextAction.trim()} onClick={() => void act(() => ipc.folderWorkflowCheckpoint(node, step.id, checkpointExpected, actor, progress, nextAction, true, workflow))}>Submit for review</button>
          </div>
        </details>}
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
          <button className="btn-primary text-[12px]" disabled={busy || !plan.ready || !canRun} onClick={() => void act(() => ipc.folderWorkflowStart(node, step.id, planRevision, workflow))}>Start this step</button>
          <button className={`${button} ml-2`} onClick={() => setPlan(null)}>Cancel</button>
        </div>}
        {step.status === 'review' && <div className="space-y-3 rounded-xl border border-line2 p-4">
          <p className="text-[12px]">Review the receipt and make the accepted output available to the next worker. Acceptance unlocks dependent steps; it does not merge code or publish anything.</p>
          <textarea aria-label="Review evidence" className={field} rows={3} placeholder="What did you verify, and where is the accepted output?" value={evidence} onChange={e => setEvidence(e.target.value)} />
          <button className="btn-primary text-[12px]" disabled={busy || !evidence.trim()} onClick={() => void act(() => ipc.folderWorkflowReview(node, step.id, data.raw, true, evidence, workflow))}>Accept step</button>
          <button className={`${button} ml-2`} disabled={busy || !evidence.trim()} onClick={() => void act(() => ipc.folderWorkflowReview(node, step.id, data.raw, false, evidence, workflow))}>Request changes</button>
        </div>}
        {!canRun && step.status === 'pending' && <p className="text-[12px] text-muted">Waiting for dependencies to be accepted.</p>}
      </section>}
    </div>}
  </div>
}

function technicalTemplate(node: number, roles: Record<string, string>) {
  const steps = [
    ['plan', 'Plan the ticket', 'lead', [], 'Analyze the request and project context. Record scope, acceptance criteria, affected files, dependencies and verification plan.'],
    ['implement', 'Implement the plan', 'developer', ['plan'], 'Implement the accepted plan. Record changed files, branch and commit references. Preserve existing work and explain deviations.'],
    ['test', 'Test the implementation', 'tester', ['implement'], 'Verify each acceptance criterion against the accepted implementation. Record commands, actual results, failures and device checks still outstanding.'],
    ['review', 'Review the result', 'reviewer', ['test'], 'Review scope, implementation and test evidence. Record defects or a reasoned recommendation. Publication is a separate action.'],
  ] as const
  return `---\ntitle: Technical ticket\nsteps:\n${steps.map(([id, title, role, needs, instructions]) => `  - id: ${id}\n    title: ${title}\n    worker: ${JSON.stringify(roles[role])}\n    target: ${node}\n    needs: ${JSON.stringify(needs)}\n    instructions: ${JSON.stringify(instructions)}\n`).join('')}---\n\n# Objective\n\nComplete the linked technical ticket with evidence for every acceptance criterion.\n\n# Team\n\n${Object.entries(roles).map(([role, handle]) => `- ${role}: @${handle}`).join('\n')}\n\n# Ticket\n\nAdd the GitHub issue URL and project-specific context here.\n`
}

function IssueRouting({ node, source, onRouted }: { node: number; source: string; onRouted: (id: string) => void }) {
  const [products, setProducts] = useState<ProductLink[]>([])
  const [repository, setRepository] = useState('')
  const [issues, setIssues] = useState<GithubIssue[]>([])
  const [picked, setPicked] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  useEffect(() => { let alive = true; void visibility.snapshot().then(s => { if (alive) setProducts(s.products) }).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [])
  useEffect(() => {
    let alive = true
    setIssues([]); setPicked(0); setError(''); setWarning('')
    if (!repository) { setBusy(false); return }
    setBusy(true)
    void visibility.issues(repository).then(s => { if (alive) { setIssues(s.items.filter(i => !i.pull_request && i.state === 'open')); setWarning([...(s.warnings || []), ...(s.truncated ? ['Partial issue history'] : [])].join(' · ')) } }).catch(e => { if (alive) setError(String(e)) }).finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [repository])
  const route = async () => {
    const issue = issues.find(i => i.number === picked)
    if (!issue) return
    setBusy(true); setError('')
    try { const template = await ipc.folderWorkflowGet(node, source); const result = await ipc.folderWorkflowRoute(node, source, template.raw, repository, issue.number, issue.title); onRouted(result.id) }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section aria-label="Route a GitHub issue" className="space-y-2 border-b border-line bg-panel px-5 py-3">
    <p className="text-[12px] text-muted">Use the selected workflow as the process for this ticket. Routing creates a fresh run; an existing route is opened without duplicating it.</p>
    <select aria-label="Issue repository" className={field} value={repository} onChange={e => setRepository(e.target.value)}><option value="">Choose connected project</option>{products.map(p => <option key={p.id} value={p.repository}>{p.name} · {p.repository}</option>)}</select>
    <select aria-label="GitHub issue" className={field} value={picked} onChange={e => setPicked(Number(e.target.value))}><option value={0}>{busy ? 'Reading issues…' : 'Choose open issue'}</option>{issues.map(i => <option key={i.number} value={i.number}>#{i.number} · {i.title}</option>)}</select>
    {!products.length && <p className="text-[12px] text-muted">Connect a project in Activity first.</p>}
    {warning && <p className="text-[12px] text-warn">{warning}</p>}
    {error && <p role="alert" className="text-[12px] text-err">{error}</p>}
    <button className={button} disabled={busy || !picked} onClick={() => void route()}>Route issue to workflow</button>
  </section>
}
