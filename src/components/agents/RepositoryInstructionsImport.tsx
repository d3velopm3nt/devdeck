import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { agentFromInstructions, matchingSkills, readRepositoryInstructions, sourceContext, suggestWorkflow, workflowFromInstructions,
  type InstructionSource, type SuggestedStep } from '../../lib/repositoryInstructions'
import './repository-instructions.css'

export function RepositoryInstructionsImport({ source, onChanged }: { source: ipc.LibrarySource; onChanged?: () => void }) {
  const nodes = useApp(s => s.nodes)
  const [document, setDocument] = useState<InstructionSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'summary' | 'agent' | 'workflow'>('summary')
  const [installed, setInstalled] = useState<ipc.LibraryItem[]>([])
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [selected, setSelected] = useState<string[]>(source.items.filter(i => i.kind === 'skill').map(i => i.id))
  const [name, setName] = useState(`${source.repo.split('/')[0]} · Repository agent`)
  const [model, setModel] = useState('sonnet')
  const [created, setCreated] = useState<ipc.Worker | null>(null)
  const [worker, setWorker] = useState('')
  const [target, setTarget] = useState('')
  const [workflowId, setWorkflowId] = useState(`${source.repo.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-workflow`.slice(0, 80))
  const [title, setTitle] = useState(`${source.repo} workflow`)
  const [steps, setSteps] = useState<SuggestedStep[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void Promise.all([readRepositoryInstructions(source.repo, source.commit, controller.signal), ipc.libraryList(), ipc.workersList()])
      .then(([doc, items, agents]) => { if (!controller.signal.aborted) {
        setDocument(doc); setInstalled(items); setWorkers(agents); setSteps(suggestWorkflow(doc?.text || ''))
        const existing = doc ? agents.find(agent => agent.body === sourceContext(doc)) : undefined
        if (existing) { setCreated(existing); setWorker(existing.handle) }
      } })
      .catch(e => { if (!controller.signal.aborted) setError(String(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [source.repo, source.commit, retry])

  const available = matchingSkills(source, installed)
  const missing = selected.filter(id => !available.has(id))
  const act = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError('')
    try { await action() } catch (e) { setError(String(e)) } finally { setBusy('') }
  }
  const install = () => act('skills', async () => {
    const result = await ipc.libraryInstall(source, missing)
    setInstalled(await ipc.libraryList()); onChanged?.()
    if (result.missed.length) throw new Error(result.missed.join('\n'))
  })
  const create = () => act('agent', async () => {
    if (!document) return
    // Revalidate provenance at save time, not just when the preview was opened.
    const current = matchingSkills(source, await ipc.libraryList())
    if (selected.some(id => !current.has(id))) throw new Error('Install the selected skills from this revision before creating the agent.')
    const existing = (await ipc.workersList()).find(agent => agent.body === sourceContext(document))
    if (existing) { setCreated(existing); setWorker(existing.handle); return }
    const agent = await ipc.workerSave(agentFromInstructions(document, name, selected, model))
    setCreated(agent); setWorker(agent.handle); setWorkers(previous => [...previous, agent]); onChanged?.()
  })
  const saveWorkflow = () => act('workflow', async () => {
    if (!document || !reviewed) return
    const raw = workflowFromInstructions(document, title, steps, worker, Number(target))
    const result = await ipc.folderWorkflowSave(Number(target), '', raw, workflowId)
    setSaved(result.path); onChanged?.()
  })
  const editStep = (id: string, patch: Partial<SuggestedStep>) => { setReviewed(false); setSteps(list => list.map(step => step.id === id ? { ...step, ...patch } : step)) }
  const moveStep = (index: number, direction: number) => {
    setReviewed(false)
    setSteps(list => { const next = [...list]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })
  }

  if (loading) return <p role="status" className="ri-loading">Checking for repository instructions…</p>
  if (!document && !error) return null
  if (!document) return <div className="ri-error" role="alert">{error}<button className="wf-secondary" onClick={() => setRetry(n => n + 1)}>Retry instructions</button></div>
  return <section className="ri-import" aria-label="Repository instructions">
    <header className="ri-heading"><span className="ri-symbol"><Icon name="agent" size={18}/></span><div><h3>Build from AGENTS.md</h3><p>Keep the agent’s instructions. Make its process visible when useful.</p></div><span className="wf-badge">{steps.length ? `${steps.length} suggested steps` : 'Instructions found'}</span></header>
    <div className="ri-provenance"><Icon name="github" size={13}/><span>{source.repo}</span><span>·</span><span title={source.commit}>Revision {source.commit.slice(0, 7)}</span></div>
    <div className="ri-actions" role="group" aria-label="Use repository instructions">
      <button className={mode === 'agent' ? 'wf-primary' : 'wf-secondary'} disabled={!!busy} onClick={() => setMode('agent')}><Icon name="agent" size={14}/>Create agent</button>
      <button className={mode === 'workflow' ? 'wf-primary' : 'wf-secondary'} disabled={!!busy} onClick={() => setMode('workflow')}><Icon name="list" size={14}/>Review workflow</button>
    </div>
    <details className="ri-original"><summary>Read original instructions</summary><pre>{document.text}</pre></details>
    {error && <p className="ri-error" role="alert">{error}</p>}
    {mode === 'agent' && <div className="ri-panel">
      {created ? <div role="status" className="ri-success"><strong>{created.name} is in your Library.</strong><p>{created.skills.length} skills assigned · no run started. Add it to a team or use it in a workflow.</p><button className="wf-secondary" onClick={() => setMode('workflow')}>Review its workflow</button></div> : <>
        <div className="ri-fields"><label>Agent name<input aria-label="Imported agent name" value={name} disabled={!!busy} onChange={e => setName(e.target.value)}/></label><label>Claude Code model<select aria-label="Imported agent model" value={model} disabled={!!busy} onChange={e => setModel(e.target.value)}><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select></label></div>
        <fieldset disabled={!!busy}><legend>Assign skills from this repository</legend><div className="ri-skills">{source.items.filter(i => i.kind === 'skill').map(skill => <label key={skill.id}><input type="checkbox" checked={selected.includes(skill.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, skill.id] : ids.filter(id => id !== skill.id))}/><span>{skill.name || skill.id}</span><small>{available.has(skill.id) ? 'Installed' : 'Needs import'}</small></label>)}</div></fieldset>
        <p className="ri-note">Original instructions are copied with their source revision. Uses Claude Code with a 20-minute / $2 limit and branch isolation. Skills currently import instruction files only; bundled helper resources still need setup.</p>
        <div className="ri-actions">{!!missing.length && <button className="wf-secondary" disabled={!!busy} onClick={() => void install()}>{busy === 'skills' ? 'Importing…' : `Import ${missing.length} selected skills`}</button>}<button className="wf-primary" disabled={!!busy || !name.trim() || !!missing.length} onClick={() => void create()}>{busy === 'agent' ? 'Creating…' : 'Create in Library'}</button></div>
      </>}
    </div>}
    {mode === 'workflow' && <div className="ri-panel">
      {saved ? <div role="status" className="ri-success"><strong>Workflow saved. No steps started.</strong><p>Open Work → Team Workflows for {nodes.find(n => n.id === Number(target))?.name} to use it.</p></div> : <>
        <p className="ri-note">A suggested sequence from the document’s numbered process. Review which steps apply, their order and instructions. Original conditions remain attached as shared context; each step waits for acceptance.</p>
        <button className="wf-secondary" disabled={!!busy} onClick={() => { setSteps(suggestWorkflow(document.text)); setReviewed(false); setError('') }}>Reset suggested steps</button>
        <div className="ri-fields"><label>Workflow name<input aria-label="Imported workflow name" value={title} disabled={!!busy} onChange={e => { setTitle(e.target.value); setReviewed(false) }}/></label><label>Workflow ID<input aria-label="Imported workflow ID" value={workflowId} disabled={!!busy} onChange={e => { setWorkflowId(e.target.value); setReviewed(false) }}/></label><label>Assign agent<select aria-label="Workflow agent" value={worker} disabled={!!busy} onChange={e => { setWorker(e.target.value); setReviewed(false) }}><option value="">Choose an agent</option>{workers.map(w => <option key={w.handle} value={w.handle}>{w.name}</option>)}</select></label><label>Target folder<select aria-label="Workflow target folder" value={target} disabled={!!busy} onChange={e => { setTarget(e.target.value); setReviewed(false) }}><option value="">Choose a folder</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label></div>
        {!steps.length && <p className="ri-note">No explicit numbered workflow was detected. You can still create the agent from the original instructions.</p>}
        <ol className="ri-steps">{steps.map((step, index) => <li key={step.id}><div className="ri-step-number">{index + 1}</div><div className="ri-step-body"><input aria-label={`Step ${index + 1} title`} disabled={!!busy} value={step.title} onChange={e => editStep(step.id, { title: e.target.value })}/><p>{index ? `After acceptance of step ${index}` : 'Starts when requested'}</p><details><summary>Edit instructions</summary><textarea aria-label={`Step ${index + 1} instructions`} rows={5} disabled={!!busy} value={step.instructions} onChange={e => editStep(step.id, { instructions: e.target.value })}/></details></div><div className="ri-step-actions"><button className="wf-icon-button" aria-label={`Move step ${index + 1} up`} disabled={!!busy || index === 0} onClick={() => moveStep(index, -1)}>↑</button><button className="wf-icon-button" aria-label={`Move step ${index + 1} down`} disabled={!!busy || index === steps.length - 1} onClick={() => moveStep(index, 1)}>↓</button><button className="wf-icon-button" aria-label={`Remove step ${index + 1}`} disabled={!!busy} onClick={() => { setSteps(list => list.filter(s => s.id !== step.id)); setReviewed(false) }}><Icon name="close" size={13}/></button></div></li>)}</ol>
        <label className="ri-review"><input type="checkbox" checked={reviewed} disabled={!!busy} onChange={e => setReviewed(e.target.checked)}/>I reviewed the steps, conditions, agent and target folder.</label>
        <button className="wf-primary" disabled={!!busy || !reviewed || !steps.length || steps.some(s => !s.title.trim() || !s.instructions.trim()) || !worker || !target || !title.trim() || !/^[a-z0-9_-]{1,80}$/.test(workflowId)} onClick={() => void saveWorkflow()}>{busy === 'workflow' ? 'Saving…' : 'Save reviewed workflow'}</button>
      </>}
    </div>}
  </section>
}
