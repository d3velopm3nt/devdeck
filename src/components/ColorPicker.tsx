// Small color-picker popover: palette swatches + a custom hex input, plus
// a "use default" reset. Purely presentational — the caller persists.

import { useState } from 'react'
import { SPACE_PALETTE } from '../lib/spaces'
import { Icon } from '../lib/icons'

export function ColorPicker({
  color,
  custom,
  onPick,
  onReset,
  className,
}: {
  color: string
  /** whether the current color is a user override (enables Reset). */
  custom: boolean
  onPick: (hex: string) => void
  onReset: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        className="flex h-6 w-6 items-center justify-center rounded-md border border-line2/70 shadow-sm ring-1 ring-black/20 transition hover:scale-105"
        style={{ background: color }}
        title="Change color"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="palette" size={12} className="text-white/90 drop-shadow" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-line2 bg-menu p-3 shadow-2xl">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Accent color</div>
            <div className="grid grid-cols-4 gap-2">
              {SPACE_PALETTE.map((c) => {
                const active = c.toLowerCase() === color.toLowerCase()
                return (
                  <button
                    key={c}
                    className={`h-8 rounded-lg transition hover:scale-105 ${active ? 'ring-2 ring-ink ring-offset-2 ring-offset-menu' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => {
                      onPick(c)
                      setOpen(false)
                    }}
                  />
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 rounded-lg border border-line2 bg-panel px-2 py-1.5">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => onPick(e.target.value)}
                  className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="font-mono text-[11px] text-dim">{color.toUpperCase()}</span>
              </label>
            </div>
            {custom && (
              <button
                className="mt-2 w-full rounded-lg border border-line2 px-2 py-1.5 text-[11px] text-dim hover:bg-hover hover:text-ink"
                onClick={() => {
                  onReset()
                  setOpen(false)
                }}
              >
                Use default color
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
