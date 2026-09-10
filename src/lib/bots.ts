// Small shared truths about bots, so five components do not each invent their
// own idea of what "weekdays at 07:00" reads like.

import type { Bot, BotWork } from './ipc'

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const toMin = (v: string) => {
  const [h, m] = v.split(':')
  return Math.min(1439, Math.max(0, (Number(h) || 0) * 60 + (Number(m) || 0)))
}

/** When it wakes, said the way a person would say it. */
export function routine(b: Pick<Bot, 'every' | 'at_min' | 'days'>): string {
  if (!b.every) return 'No heartbeat'
  if (b.every === 'hourly') return 'Every hour'
  const at = hhmm(b.at_min)
  if (b.every === 'daily') return `Daily at ${at}`
  if (b.every === 'weekdays') return `Weekdays at ${at}`
  const names = b.days
    .split(',')
    .map((d) => DAYS[Number(d.trim())])
    .filter(Boolean)
  return names.length ? `${names.join(' / ')} at ${at}` : `Weekly at ${at}`
}

export const EVERY_OPTIONS = [
  { id: '', label: 'Never — no heartbeat' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Certain days' },
  { id: 'hourly', label: 'Every hour' },
]

/** Status colours, shared so a blocked step is the same red everywhere. */
export const STATUS_TONE: Record<string, string> = {
  unclaimed: 'bg-soft text-muted',
  claimed: 'bg-sky-500/15 text-info',
  'in-progress': 'bg-emerald-500/15 text-ok',
  blocked: 'bg-red-500/15 text-err',
  done: 'bg-hover text-faint',
}

export const STATUS_LABEL: Record<string, string> = {
  unclaimed: 'Not started',
  claimed: 'Claimed',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

/** How far along a plan is. Only `done` counts — "nearly" is not a state. */
export function progress(work: BotWork[]): { done: number; total: number; pct: number } {
  const done = work.filter((w) => w.status === 'done').length
  const total = work.length
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/** The rung a tool sits on, cheapest first, and what saying yes really means. */
export const TOOL_KIND: Record<string, { label: string; tint: string; note: string }> = {
  skill: {
    label: 'Skill',
    tint: 'bg-emerald-500/15 text-ok',
    note: 'Words it follows. Nothing installs, nothing runs, nothing gains permission.',
  },
  agent: {
    label: 'Agent',
    tint: 'bg-indigo-500/15 text-indigo-400',
    note: 'Words plus permissions. It becomes a sub-agent with its own state.',
  },
  software: {
    label: 'Software',
    tint: 'bg-sky-500/15 text-info',
    note: 'A real install on this machine, which you do yourself from Machine.',
  },
  'self-hosted': {
    label: 'Self-hosted',
    tint: 'bg-violet-500/15 text-viol',
    note: 'Something that keeps running, as a service on this project.',
  },
}

export const SOURCE_TONE: Record<string, { label: string; tint: string }> = {
  you: { label: 'you said', tint: 'bg-emerald-500/15 text-ok' },
  corrected: { label: 'corrected', tint: 'bg-red-500/15 text-err' },
  watched: { label: 'watched', tint: 'bg-sky-500/15 text-info' },
}
