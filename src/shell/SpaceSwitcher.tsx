import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import type { TreeNode } from '../lib/types'

export function SpaceSwitcher({ spaces, value, expanded, onChange }: {
  spaces: TreeNode[]
  value: number | null
  expanded: boolean
  onChange: (id: number | null) => void
}) {
  const [position, setPosition] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [query, setQuery] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  const selected = spaces.find(space => space.id === value)
  const name = selected?.name ?? 'All spaces'
  const color = selected ? nodeColor(selected) : 'var(--color-muted)'
  const options = [{ id: null, name: 'All spaces', color: null }, ...spaces]
    .filter(space => space.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  function close(restoreFocus = false) {
    setPosition(null)
    if (restoreFocus) trigger.current?.focus()
  }

  function open() {
    const rect = trigger.current!.getBoundingClientRect()
    const width = Math.min(300, window.innerWidth - 24)
    const below = window.innerHeight - rect.bottom - 20
    const height = Math.min(380, Math.max(below, rect.top - 20))
    setQuery('')
    setPosition({ width, height, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: below >= height ? rect.bottom + 8 : Math.max(12, rect.top - height - 8) })
  }

  useEffect(() => {
    if (!position) return
    search.current?.focus()
    const outside = (event: Event) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setPosition(null)
    }
    const dismiss = () => setPosition(null)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', dismiss)
    }
  }, [position])

  const avatar = (space: { id: number | null; name: string; color: string | null }) => (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold"
      style={space.id === null ? { background: 'var(--color-raise)', color: 'var(--color-muted)' } : { background: `${nodeColor({ ...space, id: space.id })}20`, color: nodeColor({ ...space, id: space.id }) }}>
      {space.id === null ? <Icon name="workspace" size={16} /> : avatarLabel(space.name)}
    </span>
  )

  return <>
    <button ref={trigger} type="button" aria-label={`Switch space: ${name}`} aria-haspopup="dialog" aria-expanded={!!position} aria-controls={position ? id : undefined}
      title={expanded ? undefined : name} onClick={() => position ? close() : open()}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open() } }}
      className={`flex w-full items-center rounded-xl border border-line bg-panel transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${expanded ? 'gap-2.5 p-2' : 'justify-center py-1.5'}`}>
      {avatar({ id: selected?.id ?? null, name, color: selected?.color ?? null })}
      {expanded && <><span className="min-w-0 flex-1 text-left"><span className="block text-[9px] font-semibold uppercase tracking-wider text-faint">Space</span><span className="block truncate text-[12px] font-medium text-ink">{name}</span></span><span className="text-muted"><Icon name="chevron-down" size={13} /></span></>}
    </button>
    {position && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Switch space"
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.height }}
      className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (event.target !== search.current && (event.key === 'Home' || event.key === 'End'))) {
          event.preventDefault()
          const buttons = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button'))
          if (!buttons.length) return
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length)
          buttons[next].focus()
          buttons[next].scrollIntoView({ block: 'nearest' })
        }
      }}>
      <div className="border-b border-line p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">Switch space</p><input ref={search} aria-label="Search spaces" placeholder="Search spaces…" value={query} onChange={event => setQuery(event.target.value)} className="input w-full rounded-lg text-[12px]" /></div>
      <div className="min-h-0 overflow-y-auto p-1.5">
        {options.map(space => <button key={space.id ?? 'all'} type="button" aria-pressed={space.id === value}
          onClick={() => { onChange(space.id); close(true) }}
          className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left focus-visible:outline-2 focus-visible:outline-indigo-500 ${space.id === value ? 'bg-raise' : 'hover:bg-hover'}`}>
          {avatar(space)}<span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-ink">{space.name}</span><span className="block text-[10px] text-muted">{space.id === null ? 'Your whole workspace' : 'Work, routines and agents'}</span></span>
          {space.id === value && <span style={{ color }}><Icon name="check" size={15} /></span>}
        </button>)}
        {!options.length && <p className="px-3 py-6 text-center text-xs text-muted">No spaces match “{query}”.</p>}
      </div>
    </div>, document.body)}
  </>
}
