import * as ipc from './ipc'

export type DeckEventKind = 'info' | 'alert' | 'approval' | 'blocker'
export type FocusInterrupt = 'none' | 'urgent' | 'all'

export interface DeckSettings {
  watch: boolean
  intervalMin: number
  windowsNotifications: boolean
  popups: boolean
  groupUpdates: boolean
  quietHours: boolean
  quietFrom: string
  quietTo: string
  sounds: Record<DeckEventKind, boolean>
  focusInterrupt: FocusInterrupt
  mutedSpaces: string[]
  focusMinutes: number
}

export const DECK_DEFAULTS: DeckSettings = {
  watch: true,
  intervalMin: 1,
  windowsNotifications: true,
  popups: true,
  groupUpdates: true,
  quietHours: false,
  quietFrom: '22:00',
  quietTo: '07:00',
  sounds: { info: true, alert: true, approval: true, blocker: true },
  focusInterrupt: 'urgent',
  mutedSpaces: [],
  focusMinutes: 25,
}

const KEY = 'deck.settings'

export async function loadDeckSettings(): Promise<DeckSettings> {
  const raw = await ipc.settingGet(KEY)
  if (!raw) return DECK_DEFAULTS
  try {
    const value = JSON.parse(raw) as Partial<DeckSettings>
    return {
      ...DECK_DEFAULTS,
      ...value,
      intervalMin: Math.max(1, Math.min(60, Number(value.intervalMin) || 1)),
      focusMinutes: Math.max(1, Math.min(120, Number(value.focusMinutes) || 25)),
      sounds: { ...DECK_DEFAULTS.sounds, ...value.sounds },
      mutedSpaces: Array.isArray(value.mutedSpaces) ? value.mutedSpaces.filter((s): s is string => typeof s === 'string') : [],
    }
  } catch {
    return DECK_DEFAULTS
  }
}

export async function saveDeckSettings(settings: DeckSettings): Promise<void> {
  await ipc.settingSet(KEY, JSON.stringify(settings))
}

export function inQuietHours(settings: DeckSettings, now = new Date()): boolean {
  if (!settings.quietHours) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  const parse = (value: string) => {
    const [h, m] = value.split(':').map(Number)
    return h * 60 + m
  }
  const from = parse(settings.quietFrom)
  const to = parse(settings.quietTo)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

export function mayInterruptFocus(kind: DeckEventKind, setting: FocusInterrupt): boolean {
  return setting === 'all' || (setting === 'urgent' && (kind === 'approval' || kind === 'blocker'))
}
