import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { THEMES, themeById } from '../lib/themes'
import { Icon } from '../lib/icons'

export function ThemeSwitch() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        aria-label="Switch theme"
        aria-expanded={open}
        aria-controls="theme-choices"
        title={`Theme: ${themeById(theme).label}`}
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
      >
        <Icon name="palette" size={16} />
      </button>
      {open && (
        <div
          id="theme-choices"
          className="absolute right-0 top-10 z-[1000] w-52 rounded-xl border border-line bg-menu p-2 shadow-xl"
          aria-label="Theme choices"
        >
          <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Appearance
          </div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              aria-pressed={theme === t.id}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${theme === t.id ? 'bg-hover text-ink' : 'text-dim hover:bg-hover'}`}
              onClick={() => {
                setError('')
                void setTheme(t.id)
                  .then(() => {
                    setOpen(false)
                    trigger.current?.focus()
                  })
                  .catch((e) => setError(String(e)))
              }}
            >
              <span>{t.label}</span>
              {theme === t.id && <Icon name="check" size={14} />}
            </button>
          ))}
          {error && (
            <p role="alert" className="p-2 text-xs text-err">
              Theme changed for this session, but could not be saved: {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
