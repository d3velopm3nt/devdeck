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

// Layered bell partials give each event a recognizable, rounded chime.
let activeSound: AudioContext | null = null
export function playDeckSound(kind: DeckEventKind) {
  void (async () => {
    let context: AudioContext | null = null
    try {
      // Avoid stacked previews or event bursts becoming unexpectedly loud.
      if (activeSound) await activeSound.close().catch(() => {})
      context = new AudioContext()
      activeSound = context
      await context.resume()
      if (activeSound !== context || context.state !== 'running') return
      const output = context.createGain()
      output.gain.value = 0.32
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -12
      limiter.knee.value = 12
      limiter.ratio.value = 6
      output.connect(limiter).connect(context.destination)
      const notes: Record<DeckEventKind, [number, number][]> = {
        info: [[784, 0], [1175, 0.16]],
        approval: [[523, 0], [659, 0.19], [988, 0.38]],
        alert: [[880, 0], [698, 0.2], [880, 0.46]],
        blocker: [[392, 0], [330, 0.28], [262, 0.56]],
      }
      for (const [frequency, delay] of notes[kind]) {
        for (const [ratio, strength, decay] of [[1, 0.65, 0.75], [2, 0.2, 0.4], [3, 0.07, 0.22]]) {
          const at = context.currentTime + 0.025 + delay
          const oscillator = context.createOscillator()
          const envelope = context.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency * ratio
          envelope.gain.setValueAtTime(0.0001, at)
          envelope.gain.exponentialRampToValueAtTime(strength, at + 0.012)
          envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay)
          oscillator.connect(envelope).connect(output)
          oscillator.start(at)
          oscillator.stop(at + decay + 0.02)
        }
      }
      const playing = context
      window.setTimeout(() => {
        if (activeSound === playing) activeSound = null
        void playing.close().catch(() => {})
      }, 1600)
    } catch {
      if (activeSound === context) activeSound = null
      if (context) void context.close().catch(() => {})
    }
  })()
}
export async function announceUpdates(updates: DeckUpdate[], settings: DeckSettings, focusing: boolean) {
  if (settings.notificationLevel === 'off' || settings.notificationLevel === 'summary') return
  const eligible = updates.filter(u => settings.notificationLevel === 'all' || u.kind !== 'info').filter((u) => !focusing || mayInterruptFocus(u.kind, settings.focusInterrupt))
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
