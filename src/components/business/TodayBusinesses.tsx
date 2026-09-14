// Today's list of businesses: the ones set up, where each is, and a way to
// add another. A workspace tagged Business from before there were business
// steps is listed too, with the one thing that can be done about it.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { BUSINESS_STEPS } from '../setup/steps'

export const openBusiness = (detail: { nodeId?: number; step?: string } = {}) =>
  window.dispatchEvent(new CustomEvent('devdeck:business', { detail }))

export const openClearBusinesses = () => window.dispatchEvent(new CustomEvent('devdeck:clear-businesses'))

export function TodayBusinesses() {
  const [list, setList] = useState<ipc.BusinessSummary[] | null>(null)
  useEffect(() => {
    void ipc
      .businessList()
      .then(setList)
      .catch(() => setList([]))
  }, [])
  if (list === null) return null
  const set = list.filter((b) => b.set_up)
  const old = list.filter((b) => !b.set_up)

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Your businesses</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        {set.map((b) => {
          const at = BUSINESS_STEPS.find((s) => s.id === b.step)
          return (
            <div key={b.node_id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
              <Icon name="workspace" size={14} className={b.made ? 'text-indigo-400' : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12.5px] text-ink">
                  {b.name}
                  <span className="rounded-full bg-indigo-500/15 px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider text-indigo-400">
                    Business
                  </span>
                </div>
                <div className="text-[11px] text-muted">
                  {b.made
                    ? `${b.products} product${b.products === 1 ? '' : 's'} · ${b.services} service${
                        b.services === 1 ? '' : 's'
                      } · ${b.mailboxes} mailbox${b.mailboxes === 1 ? '' : 'es'}`
                    : `setting up · ${at ? at.label : 'the business'} is next`}
                </div>
              </div>
              <button
                className={b.made ? 'btn-ghost text-[11.5px]' : 'btn-primary text-[11.5px]'}
                onClick={() => openBusiness({ nodeId: b.node_id, step: b.made ? 'team' : undefined })}
              >
                {b.made ? 'Open' : 'Carry on'}
              </button>
            </div>
          )
        })}
        <button
          className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-[12px] text-dim last:border-b-0 hover:bg-hover"
          onClick={() => openBusiness()}
        >
          <Icon name="add" size={13} className="text-muted" />
          Add a business
        </button>
        {old.length > 0 && (
          <div className="flex items-center gap-2.5 bg-amber-500/5 px-3 py-2">
            <Icon name="alert" size={13} className="text-warn" />
            <span className="min-w-0 flex-1 text-[11.5px] text-muted">
              {old.map((b) => b.name).join(' and ')} {old.length === 1 ? 'was' : 'were'} made before
              there were business steps.
            </span>
            <button className="btn-ghost text-[11.5px]" onClick={openClearBusinesses}>
              Start them again
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
