// Step two: what the business sells.
//
// Products are built and can hold code. Services are work done for a
// customer and have none. Both start as suggestions from the website, and
// both can be typed in. Next gives every agreed one its own folder, which is
// where a product's projects go in the step after.

import { useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Err, Header } from '../setup/LearnStep'
import { Foot } from './BusinessStep'
import { AddRow, BizFrame, ItemRow, isAgreed, yours, type StepProps } from './shared'

export function SellsStep({ view, setView, nav, onClose, next }: StepProps) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!view) return null
  const meta = view.meta

  const save = async (items: ipc.Suggestion[]) => {
    try {
      setView(await ipc.businessSave(view.node_id, { ...meta, items }))
    } catch (e) {
      setErr(String(e))
    }
  }
  const setItem = (id: string, n: ipc.Suggestion | null) =>
    void save(meta.items.flatMap((i) => (i.id === id ? (n ? [n] : []) : [i])))
  const list = (field: string) => meta.items.filter((i) => i.field === field && i.state !== 'declined')
  const offers = meta.items.filter((i) => (i.field === 'product' || i.field === 'service') && i.state !== 'declined')
  const agreed = offers.filter(isAgreed).length
  const waiting = offers.length - agreed

  const column = (field: 'product' | 'service') => {
    const rows = list(field)
    const product = field === 'product'
    return (
      <div className="rounded-[10px] border border-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Icon name={product ? 'package' : 'tool'} size={14} className={product ? 'text-indigo-400' : 'text-info'} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {product ? 'Products' : 'Services'}
          </span>
          <span className="text-[10.5px] text-faint">
            {product ? 'can link repositories next' : 'no code, a price and who does it'}
          </span>
        </div>
        {rows.length === 0 && (
          <div className="border-t border-line px-4 py-2.5 text-[12px] text-muted">
            {meta.site_read_at ? 'The website names none.' : 'None yet.'}
          </div>
        )}
        {rows.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            icon={product ? 'package' : 'tool'}
            onChange={(n) => setItem(item.id, n)}
          />
        ))}
        <AddRow
          placeholder={product ? 'A product, named the way your customers say it' : 'A service'}
          hint="Enter to add"
          onAdd={(t) => void save([...meta.items, yours(field, t)])}
        />
      </div>
    )
  }

  return (
    <BizFrame step="sells" view={view} nav={nav} onClose={onClose} wide>
      <Header
        icon="package"
        title={`What ${meta.name} sells`}
        text="Products are things you build, and they can have code. Services are work you do for a customer. Where the website says something, a suggestion quotes it. Where it does not, the suggestion says it is a guess."
      />
      <div className="grid grid-cols-2 gap-4">
        {column('product')}
        {column('service')}
      </div>
      <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-panel px-4 py-3">
        <Icon name="info" size={15} className="mt-0.5 shrink-0 text-muted" />
        <div>
          <div className="text-[12.5px] text-ink">Every suggestion says what it came from</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
            A line the site states is marked with its words. A guess says it is a guess. Mail read in
            the Learn step can suggest more, and they come back here rather than being added quietly.
          </div>
        </div>
      </div>
      {err && <Err>{err}</Err>}
      <div className="flex items-center gap-3">
        <button
          className="btn-primary text-[12px]"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr('')
            try {
              setView(await ipc.businessCommitItems(view.node_id))
              next('code')
            } catch (e) {
              setErr(String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Making their folders…' : 'Next: link the code'}
        </button>
        <button className="btn-ghost text-[12px]" onClick={() => nav.onGo('business')}>
          Back
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">
          {agreed} agreed, {waiting} waiting
        </span>
      </div>
      <Foot icon="folder">
        Each agreed product and service gets its own folder in the space when you press Next. What
        is still waiting stays a suggestion.
      </Foot>
    </BizFrame>
  )
}
