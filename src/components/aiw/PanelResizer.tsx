import { useRef } from 'react'

export function PanelResizer({ label, value, min, max, side, onChange }: {
  label: string; value: number; min: number; max: number; side: 'left' | 'right'; onChange: (width: number) => void
}) {
  const drag = useRef({ x: 0, width: value })
  const clamp = (width: number) => Math.max(min, Math.min(max, width))
  const direction = side === 'left' ? 1 : -1
  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} className="chat-resizer"
    onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      onChange(e.key === 'Home' ? min : e.key === 'End' ? max : clamp(value + (e.key === 'ArrowRight' ? 24 : -24) * direction))
    }}
    onPointerDown={e => { drag.current = { x: e.clientX, width: value }; e.currentTarget.setPointerCapture(e.pointerId) }}
    onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(clamp(drag.current.width + (e.clientX - drag.current.x) * direction)) }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
  />
}
