// Team — what is being worked on, everywhere, and who is working on it.
//
// Four views over one board. Goals, Features and Work are three questions
// about the same rows, so asking the backend three times would let them
// disagree; Bots is who answers them, and it lived on a rail entry of its own
// until the trip between "what is happening" and "who is doing it" turned out
// to be the trip you make most.
//
// **One shape for all four: a list, and the thread beside it.** Features and
// Work were full-width tables that replaced themselves with a thread when you
// clicked a row, so reading two of them meant going back, finding your place
// and clicking again. Now the list stays put and the right-hand side changes,
// which is what the bots page always did.
//
// Which feature is open is held here rather than in each list, because Goals,
// Features and Work are three ways of pointing at the same thing: switching
// tabs keeps the room you were in.
//
// Global on purpose. Features live in each node's deck, so a page scoped to
// whichever folder happened to be selected would hide the bot working two
// folders over — and "what is my team doing" was never a question about the
// folder you clicked last.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import type { GoalRow } from '../../lib/aiw'
import { aiw } from '../../lib/aiw'
import { useApp, type TeamTab } from '../../store'
import { Icon } from '../../lib/icons'
import { GoalsList } from './Goals'
import { FeaturesList } from './FeaturesTab'
import { WorkList } from './WorkTab'
import { FeatureThread } from './FeatureThread'
import { BotsPage } from '../BotsPage'
import { CAPTURE_GOAL } from '../../lib/devCapture'

const TABS: { id: TeamTab; label: string }[] = [
  { id: 'goals', label: 'Goals' },
  { id: 'features', label: 'Features' },
  { id: 'work', label: 'Work' },
  { id: 'bots', label: 'Bots' },
]

const SAYS: Record<TeamTab, { title: string; sub: string }> = {
  goals: {
    title: 'Goals',
    sub: 'Every space, right now, grouped by goal. Pick one to open its thread.',
  },
  features: { title: 'Features', sub: 'Every feature in every space, and who is on it.' },
  work: { title: 'Work', sub: 'Every open item, and who is holding it.' },
  bots: { title: 'Bots', sub: 'Who you talk to, and who they put to work.' },
}

/// What a failed read must never look like: an empty board.
export interface Board {
  rows: GoalRow[]
  /// Null until the first read comes back; a message when it failed.
  error: string | null
  loaded: boolean
}

export function TeamPage() {
  // Which view is open is one piece of state with two handles on it: the
  // tabs here and the sub-menu on the rail. Either sets it, both show it.
  const tab = useApp((s) => s.teamTab)
  const setTab = useApp((s) => s.setTeamTab)
  const [board, setBoard] = useState<Board>({ rows: [], error: null, loaded: false })
  const [picked, setPicked] = useState<string | null>(CAPTURE_GOAL || null)
  const refreshBots = useApp((s) => s.refreshBots)

  const reload = useCallback(() => {
    return ipc
      .teamBoard()
      .then((rows) => setBoard({ rows, error: null, loaded: true }))
      // An empty board and a board that could not be read must not look the
      // same: one says nothing is happening, the other says nothing at all.
      .catch((e) => setBoard((b) => ({ ...b, error: String(e), loaded: true })))
  }, [])

  useEffect(() => {
    void reload()
    void refreshBots()
    // The board moves while you watch it — an agent claims something, a
    // session ends, an approval is raised. Without the live tail this is a
    // snapshot from whenever the page mounted.
    let stop: (() => void) | undefined
    void aiw.onEvent(() => void reload()).then((un) => {
      stop = un
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const waiting = board.rows.filter((r) => r.waiting > 0 || r.conflicts > 0).length
  const moving = board.rows.filter(
    (r) => r.waiting === 0 && r.conflicts === 0 && r.on_it.length > 0,
  ).length

  const key = (g: GoalRow) => `${g.node_id}:${g.feature_id}`
  // Nothing picked yet opens the first row rather than an empty half-page —
  // but only once you have chosen nothing, never over a choice.
  const current =
    picked == null ? board.rows[0] : board.rows.find((g) => key(g) === picked)

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{SAYS[tab].title}</h2>
          <p className="text-[11.5px] text-muted">{SAYS[tab].sub}</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[10.5px] text-faint">
          {board.error ? (
            <span className="flex items-center gap-1.5 text-err">
              <Icon name="alert" size={11} /> could not read the board
            </span>
          ) : (
            <span>
              {moving} moving · {waiting} waiting on you · every space
            </span>
          )}
          <button
            className="text-muted hover:text-ink"
            title="Read it again"
            onClick={() => void reload()}
          >
            <Icon name="update" size={12} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-end gap-5 border-b border-line px-5 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`relative pb-2 text-[12.5px] ${
              tab === t.id ? 'text-ink' : 'text-muted hover:text-dim'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute inset-x-0 -bottom-px h-[2px] rounded bg-indigo-500" />
            )}
          </button>
        ))}
      </div>

      {board.error && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/[0.06] px-5 py-2 text-[11.5px] text-err">
          {board.error}
        </div>
      )}

      {/* Bots brings its own list and its own right-hand side: the whole bot
          page, not a chat pane, so nothing a bot has is hidden behind one. */}
      {tab === 'bots' ? (
        <div className="min-h-0 flex-1">
          <BotsPage compact />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-panel">
            {tab === 'goals' && <GoalsList board={board} picked={picked} onPick={setPicked} />}
            {tab === 'features' && (
              <FeaturesList board={board} picked={picked} onPick={setPicked} />
            )}
            {tab === 'work' && <WorkList board={board} picked={picked} onPick={setPicked} />}
          </div>

          <div className="min-w-0 flex-1">
            {current ? (
              <FeatureThread goal={current} />
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center text-[12px] text-muted">
                {board.loaded
                  ? 'Pick one to open its thread.'
                  : 'Reading the board…'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
