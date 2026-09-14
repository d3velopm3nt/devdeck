// Step five: learn from the business's mail. Built on the personal learn
// step, keyed by organisation. This file is replaced in the same build.

import { Header } from '../setup/LearnStep'
import { BizFrame, type StepProps } from './shared'

export function BusinessLearnStep({ view, nav, onClose, next }: StepProps) {
  return (
    <BizFrame step="learn" view={view} nav={nav} onClose={onClose}>
      <Header icon="mail" title="One organisation at a time" text="Reading the business's mail." />
      <div className="flex items-center gap-3">
        <button className="btn-primary text-[12px]" onClick={() => next('team')}>
          Next: team
        </button>
      </div>
    </BizFrame>
  )
}
