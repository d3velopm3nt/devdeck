// The bots, on Home.
//
// Two halves of one band, and each answers a question the other cannot. The
// icons are read from across the room: is anything wrong. The list is read
// leaning in: what is this bot even for, and where did it get to.
//
// **A bot lights up only for something you can do.** Blocked work is red,
// unclaimed work and a waiting approval are amber, and a bot busy doing its
// own job is not attention — it breathes green and asks for nothing. A light
// that fires for everything is one you stop seeing, and then it is worse than
// no light.
//
// **The icon is a pointer, never the only place a thing is said.** Everything
// that lights one up also has a card under "Needs you" beside it; clearing it
// there puts the light out. Two inboxes is one too many.

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { openBot } from '../lib/dock'
import { nodeColor } from '../lib/spaces'
import { findNode } from '../lib/tree'

/// What a bot wants from you, in one word.
type Mood = 'blocked' | 'waiting' | 'working' | 'quiet' | 'handsoff'

const TONE: Record<Mood, { ring: string; tile: string; text: string; dot: string }> = {
  blocked: {
    ring: 'bg-red-400',
    tile: 'border-red-500/35 bg-red-500/[0.07]',
    text: 'text-err',
    dot: 'bg-red-400',
  },
  waiting: {
    ring: 'bg-amber-400',
    tile: 'border-amber-500/32 bg-amber-500/[0.06]',
    text: 'text-warn',
    dot: 'bg-amber-400',
  },
  working: { ring: 'bg-emerald-400', tile: 'border-line', text: 'text-ok', dot: 'bg-emerald-400' },
  quiet: { ring: '', tile: 'border-line', text: 'text-faint', dot: 'bg-slate-500' },
  handsoff: { ring: '', tile: 'border-line2 border-dashed', text: 'text-faint', dot: 'bg-slate-500' },
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/// Two lines of a name, because "x-platform bot" in a 96px tile is one long
/// word and an ellipsis.
function twoLines(name: string): [string, string] {
  const at = name.lastIndexOf(' ')
  return at < 0 ? [name, ''] : [name.slice(0, at), name.slice(at + 1)]
}

export function HomeBots() {
  const { nodes } = useApp()
  const aiw = useAiw()
  const [bots, setBots] = useState<ipc.Bot[] | null>(null)
  const [standing, setStanding] = useState<Record<number, ipc.BotStanding>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    void ipc
      .botsList()
      .then(setBots)
      // A failed read must not read as "you have no bots".
      .catch((e) => setErr(String(e)))
    void ipc
      .botsStanding()
      .then((rows) => setStanding(Object.fromEntries(rows.map((r) => [r.node_id, r]))))
      .catch(() => {})
  }, [])

  const rows = useMemo(() => {
    return (bots ?? []).map((b) => {
      const s = standing[b.node_id]
      const project = String(b.node_id)
      const working = aiw.sessions.some(
        (x) => x.project_id === project && (x.status === 'working' || x.status === 'planning'),
      )
      const approvals = aiw.approvals.filter((r) => r.project_id === project).length
      const blocked = s?.blocked ?? 0
      const unclaimed = s?.unclaimed ?? 0

      // Order matters: stopped beats waiting beats busy. The worst true thing
      // is the one worth a colour.
      const mood: Mood =
        blocked > 0
          ? 'blocked'
          : unclaimed > 0 || approvals > 0
            ? 'waiting'
            : working
              ? 'working'
              : b.agent.trim() === ''
                ? 'handsoff'
                : 'quiet'

      const count = blocked > 0 ? blocked : unclaimed + approvals
      const says =
        blocked > 0
          ? `${blocked} blocked`
          : approvals > 0
            ? `${approvals} waiting on you`
            : unclaimed > 0
              ? `${unclaimed} to pick up`
              : working
                ? 'working now'
                : b.agent.trim() === ''
                  ? 'no agent named'
                  : 'nothing needed'

      const node = findNode(nodes, b.node_id)
      return {
        bot: b,
        mood,
        count,
        says,
        working,
        color: node ? nodeColor(node) : '#6366f1',
        done: s?.done ?? 0,
        total: s?.total ?? 0,
      }
    })
    // The ones that want you, first. A dashboard that keeps a blocked bot in
    // fourth place because of its name is sorting by the wrong thing.
    .sort((a, b) => {
      const rank = (m: Mood) => (m === 'blocked' ? 0 : m === 'waiting' ? 1 : m === 'working' ? 2 : 3)
      return rank(a.mood) - rank(b.mood) || a.bot.name.localeCompare(b.bot.name)
    })
  }, [bots, standing, aiw.sessions, aiw.approvals, nodes])

  const wants = rows.filter((r) => r.mood === 'blocked' || r.mood === 'waiting').length

  if (bots != null && bots.length === 0 && !err) return null

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 px-3 pb-0.5 pt-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bots</span>
        <span className="text-[10.5px] text-faint">one per space, awake on a rhythm</span>
        <span className="flex-1" />
        {wants > 0 ? (
          <span className="text-[10.5px] text-warn">
            {wants} want{wants === 1 ? 's' : ''} you
          </span>
        ) : (
          <span className="text-[10.5px] text-faint">nothing needs you</span>
        )}
      </div>

      {err && <div className="px-3 py-2 text-[11.5px] text-err">{err}</div>}

      <div className="flex gap-2.5 p-3">
        <div className="flex shrink-0 gap-2.5">
          {rows.map(({ bot, mood, count, says, color }) => {
            const tone = TONE[mood]
            const [a, b] = twoLines(bot.name)
            return (
              <button
                key={bot.node_id}
                className={`flex w-[96px] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 transition hover:-translate-y-0.5 hover:shadow-lg ${tone.tile}`}
                title={`${bot.name} — ${says}`}
                onClick={() => openBot(bot.node_id, bot.name)}
              >
                <span className="relative flex items-center justify-center">
                  {/* The ring is the whole "live" idea: it breathes while the
                      bot has something to say, and is simply absent when it
                      does not. */}
                  {tone.ring && (
                    <span
                      className={`absolute h-[62px] w-[62px] animate-pulse rounded-[18px] opacity-40 ${tone.ring}`}
                    />
                  )}
                  <span
                    className={`relative flex h-[54px] w-[54px] items-center justify-center rounded-2xl text-white ${
                      mood === 'handsoff' ? 'border border-dashed border-line3' : ''
                    }`}
                    style={
                      mood === 'handsoff'
                        ? { background: 'transparent', color }
                        : { background: color }
                    }
                  >
                    <Icon name="bot" size={26} />
                  </span>
                  {count > 0 && (
                    <span
                      className={`absolute -right-1.5 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-app ${tone.dot}`}
                    >
                      {count}
                    </span>
                  )}
                </span>
                <span
                  className={`text-center text-[11px] font-semibold leading-tight ${
                    mood === 'quiet' || mood === 'handsoff' ? 'text-dim' : 'text-ink'
                  }`}
                >
                  {a}
                  {b && (
                    <>
                      <br />
                      {b}
                    </>
                  )}
                </span>
                <span className={`text-[9.5px] ${tone.text}`}>
                  {mood === 'quiet' || mood === 'handsoff'
                    ? bot.every
                      ? hhmm(bot.at_min)
                      : 'no rhythm'
                    : says}
                </span>
              </button>
            )
          })}

          <button
            className="flex w-[96px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line2 text-faint hover:border-line3 hover:text-dim"
            title="Give a space a bot"
            onClick={() => useApp.getState().setRailView('bots')}
          >
            <Icon name="add" size={20} />
            <span className="text-[10.5px]">New bot</span>
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-px border-l border-line pl-3">
          {rows.map(({ bot, mood, says, done, total }) => {
            const tone = TONE[mood]
            return (
              <button
                key={bot.node_id}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover/40 ${
                  mood === 'blocked' ? 'bg-red-500/[0.06]' : ''
                }`}
                onClick={() => openBot(bot.node_id, bot.name)}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                <span className="w-[104px] shrink-0 truncate text-[12px] font-semibold text-ink">
                  {bot.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim" title={bot.goal}>
                  {bot.goal || 'No goal yet — a bot without one is a chat window.'}
                </span>
                {total > 0 && (
                  <span className="shrink-0 font-mono text-[10.5px] text-muted">
                    {done}/{total}
                  </span>
                )}
                <span className={`w-[112px] shrink-0 text-right text-[11px] ${tone.text}`}>
                  {says}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
