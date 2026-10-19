import type { FolderWorkflowStep } from '../../lib/ipc'

export function StepProgress({ steps, onSelect }: { steps: FolderWorkflowStep[]; onSelect?: (step: FolderWorkflowStep) => void }) {
  if (!steps.length) return null
  return <div className="wh-step-pips" role="group" aria-label="Workflow step progress">
    {steps.map((step, index) => {
      const label = `Step ${index + 1}: ${step.title} — ${step.status === 'done' ? 'approved' : step.status === 'skipped' ? 'outside scope' : step.status}`
      return onSelect ? <button key={step.id} type="button" data-state={step.status} title={label} aria-label={label} onClick={() => onSelect(step)}/> : <span key={step.id} data-state={step.status} title={label} role="img" aria-label={label}/>
    })}
  </div>
}
