// Pieces every business step uses: the frame, a suggestion row, an add row.
//
// A suggestion always says where it came from, in words: the site's own
// words, a suggestion from them, a guess, or you. Changing the words of a
// quote makes it yours, because it is no longer what the site says.

import { useState } from 'react'
import type * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Frame } from '../setup/LearnStep'
import { BUSINESS_STEPS, type BusinessStepId, type SetupNav } from '../setup/steps'

export interface StepProps {
  view: ipc.BusinessView | null
  setView: (v: ipc.BusinessView) => void
  nav: SetupNav
  onClose: () => void
  next: (s: BusinessStepId) => void
}

export const isAgreed = (i: ipc.Suggestion) =>
  i.state === 'agreed' || (i.kind === 'you' && i.state !== 'declined')

export function sourceLine(i: ipc.Suggestion): string {
  switch (i.kind) {
    case 'quote':
      return i.source ? `the site's own words, from ${i.source}` : "the site's own words"
    case 'suggestion':
      return i.source ? `a suggestion from ${i.source}` : 'a suggestion from the site'
    case 'you':
      return i.source ? `you, ${i.source}` : 'you added this'
    default:
      return i.source ? `a guess: ${i.source}` : 'a guess, not stated on the site'
  }
}

let seq = 0
export const newId = () => `you-${Date.now()}-${seq++}`

export function hostOf(site: string): string {
  return site
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

export function BizFrame({
  step,
  view,
  nav,
  onClose,
  wide,
  children,
}: {
  step: BusinessStepId
  view: ipc.BusinessView | null
  nav: SetupNav
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <Frame step={step} order={BUSINESS_STEPS} nav={nav} onClose={onClose} wide={wide} aside={view?.meta.name}>
      {children}
    </Frame>
  )
}

function StateChip({ item }: { item: ipc.Suggestion }) {
  if (isAgreed(item)) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider text-ok">
        {item.kind === 'you' ? 'yours' : 'agreed'}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-amber-500/10 px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider text-warn">
      {item.kind === 'guess' ? 'a guess' : item.kind === 'quote' ? "the site's words" : 'suggested'}
    </span>
  )
}

/**
 * One suggestion: its words, where they came from, and Agree / Change / No.
 * `onChange(null)` removes a line you added yourself.
 */
export function ItemRow({
  item,
  label,
  icon,
  onChange,
}: {
  item: ipc.Suggestion
  label?: string
  icon?: string
  onChange: (next: ipc.Suggestion | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const agreed = isAgreed(item)

  const commit = () => {
    const t = text.trim()
    setEditing(false)
    if (!t) return
    if (t === item.text) {
      onChange({ ...item, state: 'agreed' })
      return
    }
    // New words are yours, whatever the old ones were.
    onChange({
      ...item,
      text: t,
      kind: 'you',
      source: item.kind === 'you' ? item.source : `changed from “${item.text}”`,
      state: 'agreed',
    })
  }

  return (
    <div className="flex items-start gap-3 border-t border-line px-3.5 py-2.5">
      {label !== undefined && (
        <span className="mt-[3px] w-[96px] shrink-0 text-[11px] text-muted">{label}</span>
      )}
      {icon && <Icon name={icon} size={14} className="mt-[3px] shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="input w-full text-[12.5px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setText(item.text)
                setEditing(false)
              }
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-ink">{item.text}</span>
            <StateChip item={item} />
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-muted">{sourceLine(item)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {editing ? (
          <>
            <button className="btn-primary text-[11.5px]" onClick={commit}>
              Save
            </button>
            <button
              className="btn-ghost text-[11.5px]"
              onClick={() => {
                setText(item.text)
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </>
        ) : agreed ? (
          <>
            <button className="btn-ghost text-[11.5px] text-muted" onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              className="btn-ghost text-[11.5px] text-muted"
              title={item.kind === 'you' ? 'Remove' : 'Not true after all'}
              onClick={() => onChange(item.kind === 'you' ? null : { ...item, state: 'declined' })}
            >
              <Icon name="close" size={11} />
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary text-[11.5px]" onClick={() => onChange({ ...item, state: 'agreed' })}>
              Agree
            </button>
            <button className="btn-ghost text-[11.5px]" onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              className="btn-ghost text-[11.5px] text-muted"
              onClick={() => onChange({ ...item, state: 'declined' })}
            >
              No
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function AddRow({
  placeholder,
  hint,
  onAdd,
}: {
  placeholder: string
  hint?: string
  onAdd: (text: string) => void
}) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-2.5">
      <Icon name="add" size={13} className="shrink-0 text-muted" />
      <input
        className="input min-w-0 flex-1 text-[12px]"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      {hint && <span className="shrink-0 text-[10.5px] text-faint">{hint}</span>}
      <button className="btn-ghost text-[11.5px]" disabled={!text.trim()} onClick={add}>
        Add
      </button>
    </div>
  )
}

/** A line you typed, agreed from the start. */
export function yours(field: string, text: string): ipc.Suggestion {
  return { id: newId(), field, text, kind: 'you', source: '', state: 'agreed', node_id: 0 }
}
