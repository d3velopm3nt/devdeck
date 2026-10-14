import { useEffect, useState } from 'react'
import { listen, emit } from '@tauri-apps/api/event'
import '../orb-engine.js'
import type { OrbPreferences } from '../orb-engine.js'
import { settingGet, settingSet } from '../ipc'
export const ORB_KEY = 'dev.orb.preferences'
export async function loadOrbPreferences(): Promise<OrbPreferences> {
  const raw = await settingGet(ORB_KEY)
  try { return DevOrb.normalize(raw ? JSON.parse(raw) : null) } catch { return DevOrb.normalize(null) }
}
export async function saveOrbPreferences(value: OrbPreferences) {
  const normalized = DevOrb.normalize(value)
  await settingSet(ORB_KEY, JSON.stringify(normalized))
  await emit('devdeck:orb-preferences', normalized)
}
export function useOrbPreferences() {
  const [value, setValue] = useState<OrbPreferences>(DevOrb.defaults)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void loadOrbPreferences().then(p => { if (live) setValue(p) }).catch(e => { if (live) setError(String(e)) })
    const stop = listen<OrbPreferences>('devdeck:orb-preferences', e => { if (live) setValue(DevOrb.normalize(e.payload)) })
    return () => { live = false; void stop.then(unlisten => unlisten()) }
  }, [])
  return { value, error }
}
