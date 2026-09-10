// What a thing on the calendar *is*, decided once.
//
// Colour says what kind of time this is. Height says how long it takes. The
// left edge says how it went. Nothing carries two meanings, which is why this
// file exists: the day grid, the week, the sidebar and the legend all ask the
// same function, so they cannot end up disagreeing about what a bot wake is.
//
// The old rule coloured by *status* — amber for a deadline, indigo for a bot,
// grey for everything else — so a reminder and a lunch and a daily routine were
// one colour, and "how it went" had nowhere left to be said.

import type { CalendarItem } from './ipc'

export type Layer = 'events' | 'routine' | 'focus' | 'agents' | 'commands' | 'deadlines'

/// Which side of the day it belongs on. Your day is yours: agent work never
/// moves it, so it never shares a column with it either.
export type Lane = 'you' | 'agents'

export const LAYERS: Array<{
  id: Layer
  label: string
  lane: Lane
  /// A solid swatch for the legend and the filter list.
  swatch: string
  /// Block skin: left edge, fill.
  edge: string
  fill: string
  /// For text that must be the layer's colour rather than the ink.
  text: string
}> = [
  {
    id: 'events',
    label: 'My events',
    lane: 'you',
    swatch: 'bg-indigo-400',
    edge: 'border-l-indigo-400',
    fill: 'bg-indigo-500/12',
    text: 'text-indigo-300',
  },
  {
    id: 'routine',
    label: 'Daily routine',
    lane: 'you',
    swatch: 'bg-slate-500',
    edge: 'border-l-slate-500',
    fill: 'bg-raise',
    text: 'text-dim',
  },
  {
    id: 'focus',
    label: 'Focus blocks',
    lane: 'you',
    swatch: 'bg-amber-400',
    edge: 'border-l-amber-400',
    fill: 'bg-amber-500/12',
    text: 'text-warn',
  },
  {
    id: 'agents',
    label: 'Agent working time',
    lane: 'agents',
    swatch: 'bg-emerald-400',
    edge: 'border-l-emerald-400',
    fill: 'bg-emerald-500/10',
    text: 'text-ok',
  },
  {
    id: 'commands',
    label: 'Commands',
    lane: 'agents',
    swatch: 'bg-sky-400',
    edge: 'border-l-sky-400',
    fill: 'bg-sky-500/10',
    text: 'text-info',
  },
  {
    id: 'deadlines',
    label: 'Deadlines',
    lane: 'you',
    swatch: 'bg-red-400',
    edge: 'border-l-red-400',
    fill: 'bg-red-500/10',
    text: 'text-err',
  },
]

const BY_ID = new Map(LAYERS.map((l) => [l.id, l]))

export const layerMeta = (id: Layer) => BY_ID.get(id) ?? LAYERS[1]

/// A one-off is an event; the same row repeating is the shape of your day.
/// Nothing else can tell them apart — which is why `every` had to come through
/// on the wire.
export function layerOf(i: CalendarItem): Layer {
  if (i.kind === 'deadline') return 'deadlines'
  if (i.kind === 'focus') return 'focus'
  if (i.sort === 'bot' || i.sort === 'agent') return 'agents'
  if (i.sort === 'command') return 'commands'
  return i.every === 'once' ? 'events' : 'routine'
}

export const laneOf = (i: CalendarItem): Lane => layerMeta(layerOf(i)).lane

/// How it went, which is the left edge and nothing else.
export type Went = 'planned' | 'running' | 'done' | 'failed' | 'missed' | 'past'

export function wentOf(i: CalendarItem, now = Date.now()): Went {
  if (i.at > now) return 'planned'
  // A focus session that has not ended says so itself; everything else is
  // running if now is inside it.
  if (i.status === 'running') return 'running'
  if (i.end > now && i.end > i.at) return 'running'
  if (i.status === 'failed') return 'failed'
  if (i.status === 'done') return 'done'
  // A reminder whose moment passed without a run was never fired late, on
  // purpose. Saying "missed" is honest; saying nothing pretends it happened.
  if (i.kind === 'schedule' && i.status === 'past' && i.sort === 'reminder') return 'missed'
  if (i.kind === 'deadline') return i.status === 'done' ? 'done' : 'failed'
  return 'past'
}

/// The classes a block wears: its layer, and what became of it.
export function blockSkin(i: CalendarItem, now = Date.now()): string {
  const m = layerMeta(layerOf(i))
  const went = wentOf(i, now)
  if (went === 'planned') return `border-l-line3 border-dashed bg-transparent`
  if (went === 'failed') return `border-l-red-400 bg-red-500/[0.09]`
  if (went === 'missed') return `${m.edge} border-dashed bg-raise opacity-60`
  if (went === 'past' || went === 'done') return `${m.edge} ${m.fill} opacity-70`
  return `${m.edge} ${m.fill}`
}
