import { useEffect, useRef, useState } from 'react'

const KEY = 'devdeck.rail.width'
export const MIN_RAIL_WIDTH = 168
export const DEFAULT_RAIL_WIDTH = 188
const MAX_WIDTH = 360
const clamp = (value: number, max: number) => Math.round(Math.max(MIN_RAIL_WIDTH, Math.min(max, value)))

export function useRailWidth() {
  const ref = useRef<HTMLElement>(null)
  const [preferred, setPreferred] = useState(() => {
    const saved = Number(localStorage.getItem(KEY))
    return Number.isFinite(saved) && saved > 0 ? clamp(saved, MAX_WIDTH) : DEFAULT_RAIL_WIDTH
  })
  const [max, setMax] = useState(MAX_WIDTH)
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => setMax(Math.max(MIN_RAIL_WIDTH, Math.min(MAX_WIDTH, Math.floor(parent.clientWidth * 0.4)))))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  useEffect(() => localStorage.setItem(KEY, String(preferred)), [preferred])
  return { ref, width: clamp(preferred, max), max, setWidth: (value: number) => setPreferred(clamp(value, max)) }
}
