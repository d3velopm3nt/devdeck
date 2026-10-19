import { useEffect, useRef, useState } from 'react'
import { Explorer } from '../components/Explorer'
import { PanelResizer } from '../components/aiw/PanelResizer'

const MIN = 180
const MAX = 480
const KEY = 'devdeck.explorer.width'
const clamp = (value: number, max: number) => Math.round(Math.max(MIN, Math.min(max, value)))

export function ExplorerSidebar() {
  const ref = useRef<HTMLElement>(null)
  const [preferred, setPreferred] = useState(() => {
    const saved = Number(localStorage.getItem(KEY))
    return Number.isFinite(saved) && saved > 0 ? clamp(saved, MAX) : 280
  })
  const [max, setMax] = useState(MAX)
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const update = () => setMax(Math.max(MIN, Math.min(MAX, Math.floor(parent.clientWidth * 0.4))))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { localStorage.setItem(KEY, String(preferred)) }, [preferred])
  const width = clamp(preferred, max)
  return <>
    <aside ref={ref} aria-label="Spaces explorer" style={{ width }} className="shrink-0 overflow-hidden">
      <Explorer />
    </aside>
    <PanelResizer label="Resize Spaces explorer" value={width} min={MIN} max={max} side="left" onChange={value => setPreferred(clamp(value, max))}/>
  </>
}
