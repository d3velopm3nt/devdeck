import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { THEMES, themeById } from '../lib/themes'
import { Icon } from '../lib/icons'
import './theme-switch.css'

const PALETTE = [{key:'app',label:'Background'},{key:'panel',label:'Surface'},{key:'accent',label:'Accent'},{key:'ink',label:'Text'}] as const

export function ThemeSwitch() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const choices = useRef<HTMLDivElement>(null)
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
    const focus = requestAnimationFrame(() => choices.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus())
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(focus)
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
          ref={choices}
          id="theme-choices"
          className="theme-choices"
          role="group"
          aria-label="Theme choices"
        >
          <div className="theme-choices-heading">Appearance</div>
          <p className="theme-choices-legend">Background · Surface · Accent · Text</p>
          {THEMES.map((t, index) => (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-description={PALETTE.map(color => `${color.label}: ${t.swatch[color.key]}`).join(', ')}
              aria-pressed={theme === t.id}
              className="theme-choice"
              onKeyDown={event => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? THEMES.length - 1
                  : event.key === 'ArrowDown' ? (index + 1) % THEMES.length
                  : event.key === 'ArrowUp' ? (index + THEMES.length - 1) % THEMES.length : null
                if (next === null) return
                event.preventDefault()
                choices.current?.querySelectorAll<HTMLButtonElement>('.theme-choice')[next]?.focus()
              }}
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
              <span className="theme-choice-name">{t.label}</span>
              <span className="theme-palette" aria-hidden="true">{PALETTE.map(color =>
                <span key={color.key} className="theme-color" data-color-role={color.key}
                  title={`${color.label}: ${t.swatch[color.key]}`} style={{backgroundColor:t.swatch[color.key]}}/>
              )}</span>
              <span className="theme-choice-check" aria-hidden="true">{theme === t.id && <Icon name="check" size={14}/>}</span>
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
