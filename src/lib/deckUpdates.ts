import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { inQuietHours, mayInterruptFocus, type DeckEventKind, type DeckSettings } from './deck'

export interface DeckUpdate { id: string; space: string; title: string; kind: DeckEventKind; at: number }

// The filename is a hint, not an AI judgment. Unknown changes are information.
export function classifyPath(path: string): DeckEventKind {
  if (/(^|[/. _-])blocker([s/. _-]|$)/i.test(path)) return 'blocker'
  if (/(^|[/. _-])approval([s/. _-]|$)/i.test(path)) return 'approval'
  if (/(^|[/. _-])alert([s/. _-]|$)/i.test(path)) return 'alert'
  return 'info'
}

export function updatesFromPaths(head: string, paths: string[], spaces: { id: number; name: string }[], mutedSpaces: string[]): DeckUpdate[] {
  const active = spaces.filter((space) => !mutedSpaces.includes(String(space.id)))
  return paths.flatMap((path) => {
    const space = active.find((s) => path.split('/').some((part) => part.toLowerCase() === s.name.toLowerCase()))
    // A muted space must stay quiet, even when it appears in a group.
    if (!space && spaces.some((s) => mutedSpaces.includes(String(s.id)) && path.split('/').some((part) => part.toLowerCase() === s.name.toLowerCase()))) return []
    return [{ id: `${head}:${path}`, space: space?.name ?? 'Shared', title: path.split('/').at(-1) || path, kind: classifyPath(path), at: Date.now() }]
  })
}

export function playDeckSound(kind: DeckEventKind) {
  try {
    const context = new AudioContext()
    const tones = { info: [660], alert: [740, 560], approval: [660, 880], blocker: [440, 330] }[kind]
    tones.forEach((tone, index) => {
      const at = context.currentTime + index * 0.15
      const oscillator = context.createOscillator(); const volume = context.createGain()
      oscillator.frequency.value = tone; oscillator.type = 'sine'
      volume.gain.setValueAtTime(0.0001, at)
      volume.gain.exponentialRampToValueAtTime(0.055, at + 0.015)
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.12)
      oscillator.connect(volume).connect(context.destination)
      oscillator.start(at); oscillator.stop(at + 0.13)
    })
    window.setTimeout(() => void context.close(), 600)
  } catch { /* no audio device */ }
}

export async function announceUpdates(updates: DeckUpdate[], settings: DeckSettings, focusing: boolean) {
  const eligible = updates.filter((u) => !focusing || mayInterruptFocus(u.kind, settings.focusInterrupt))
  if (!eligible.length || inQuietHours(settings)) return
  const strongest = eligible.find((u) => u.kind === 'blocker') ?? eligible.find((u) => u.kind === 'approval') ?? eligible.find((u) => u.kind === 'alert') ?? eligible[0]
  if (settings.sounds[strongest.kind]) playDeckSound(strongest.kind)
  if (!settings.windowsNotifications) return
  try {
    let permitted = await isPermissionGranted()
    if (!permitted) permitted = (await requestPermission()) === 'granted'
    if (permitted) {
      if (settings.groupUpdates && eligible.length > 1) sendNotification({ title: `${eligible.length} DevDeck updates`, body: [...new Set(eligible.map((u) => u.space))].join(', ') })
      else eligible.slice(0, 4).forEach((u) => sendNotification({ title: `${u.space} · ${u.kind}`, body: u.title }))
    }
  } catch { /* Native notifications may be unavailable in development. */ }
}
