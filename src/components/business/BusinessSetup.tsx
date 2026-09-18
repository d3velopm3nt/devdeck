// Adding a business, the way Life and Home were set up: one step at a time,
// each suggesting what it can and asking only what it cannot work out.
//
// The space exists from the first step, because the steps after it clone
// repositories into it and tie mailboxes to it. Where you got to is kept on
// the business itself, so closing and coming back opens on the same step.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { BUSINESS_STEPS, type BusinessStepId } from '../setup/steps'
import { BusinessStep } from './BusinessStep'
import { SellsStep } from './SellsStep'
import { CodeStep } from './CodeStep'
import { MailStep } from './MailStep'
import { BusinessLearnStep } from './BusinessLearnStep'
import { TeamStep } from './TeamStep'
import type { StepProps } from './shared'

const pos = (s: string) => (s === 'done' ? BUSINESS_STEPS.length : BUSINESS_STEPS.findIndex((o) => o.id === s))

export function BusinessSetup({
  nodeId,
  start,
  onClose,
}: {
  nodeId?: number
  start?: string
  onClose: () => void
}) {
  const [view, setView] = useState<ipc.BusinessView | null>(null)
  const [step, setStep] = useState<BusinessStepId>((start as BusinessStepId) || 'business')
  const [loading, setLoading] = useState(!!nodeId)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!nodeId) return
    let live = true
    void ipc
      .businessGet(nodeId)
      .then((v) => {
        if (!live) return
        setView(v)
        if (!start && v.meta.step && v.meta.step !== 'done' && pos(v.meta.step) >= 0) {
          setStep(v.meta.step as BusinessStepId)
        }
      })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const furthest = view?.meta.step || 'business'
  const reached = pos(furthest) > pos(step) ? furthest : step

  const go = async (s: BusinessStepId) => {
    setErr('')
    if (view && view.meta.step !== 'done' && pos(s) > pos(view.meta.step || 'business')) {
      try {
        setView(await ipc.businessSave(view.node_id, { ...view.meta, step: s }))
      } catch (e) {
        setErr(String(e))
      }
    }
    setStep(s)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-page text-[12px] text-muted">
        Reading the business…
      </div>
    )
  }
  if (err && !view && nodeId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-page text-[12px] text-err">
        {err}
        <button className="btn-ghost text-[12px]" onClick={onClose}>
          Close
        </button>
      </div>
    )
  }

  const props: StepProps = {
    view,
    setView,
    nav: { reached, onGo: (s: string) => void go(s as BusinessStepId) },
    onClose,
    next: (s) => void go(s),
  }

  switch (step) {
    case 'sells':
      return <SellsStep {...props} />
    case 'code':
      return <CodeStep {...props} />
    case 'mail':
      return <MailStep {...props} />
    case 'learn':
      return <BusinessLearnStep {...props} />
    case 'team':
      return <TeamStep {...props} />
    default:
      return <BusinessStep {...props} />
  }
}
