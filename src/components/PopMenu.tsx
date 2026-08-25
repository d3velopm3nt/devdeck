// Floating icon menu used for right-click context menus and tab menus.
// Renders in a portal, positions at (x, y), clamped to the viewport, and
// closes on outside click / Escape / scroll.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../lib/icons'

export interface MenuItem {
  icon?: string
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

export function PopMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[1000]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={ref}
        className="absolute min-w-52 rounded-md border border-line2 bg-menu p-1 shadow-2xl"
        style={pos}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="my-1 border-t border-line2" />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-[12.5px] disabled:opacity-40 ${
                it.danger
                  ? 'text-err hover:bg-red-500/20'
                  : 'text-ink hover:bg-indigo-600/40 hover:text-ink'
              }`}
              onClick={() => {
                onClose()
                it.onClick?.()
              }}
            >
              <span className="flex w-4 shrink-0 items-center justify-center opacity-90">
                {it.icon ? <Icon name={it.icon} size={15} /> : null}
              </span>
              <span className="flex-1">{it.label}</span>
            </button>
          ),
        )}
      </div>
    </div>,
    document.body,
  )
}
