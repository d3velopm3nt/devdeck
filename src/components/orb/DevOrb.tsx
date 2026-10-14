import { useEffect, useRef } from 'react'
import '../../lib/orb-engine.js'
import type { OrbMode, OrbPreferences } from '../../lib/orb-engine.js'
export function DevOrb({ mode = 'idle', preferences = globalThis.DevOrb.defaults, level = () => 0, pixels = 300 }: { mode?: OrbMode; preferences?: OrbPreferences; level?: () => number; pixels?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ mode, preferences, level })
  useEffect(() => { state.current = { mode, preferences, level } }, [mode, preferences, level])
  useEffect(() => {
    if (!canvas.current) return
    return globalThis.DevOrb.mount(canvas.current, () => true, () => state.current.mode, () => state.current.level(), () => state.current.preferences)
  }, [])
  return <canvas ref={canvas} aria-hidden="true" style={{ width: pixels * preferences.size, maxWidth: '100%', aspectRatio: '1', height: 'auto' }} />
}
