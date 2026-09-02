// Team — the first view: what is being worked on, everywhere, right now.
//
// Three views over one board, because Goals, Features and Work are three
// questions about the same rows and asking the backend three times would let
// them disagree. Which one is open is the rail's sub-menu. The people — the
// bots and agents — have a page of their own.
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
import { Goals } from './Goals'
import { FeaturesTab } from './FeaturesTab'
import { WorkTab } from './WorkTab'

const TABS: { id: TeamTab; label: string }[] = [
  { id: 'goals', label: 'Goals' },
  { id: 'features', label: 'Features' },
  { id: 'work', label: 'Work' },
]

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
  const moving = board.rows.filter((r) => r.waiting === 0 && r.conflicts === 0 && r.on_it.length > 0).length

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">
            {tab === 'goals' ? 'Goals' : tab === 'features' ? 'Features' : 'Work'}
          </h2>
          <p className="text-[11.5px] text-muted">
            {tab === 'goals'
              ? 'Every space, right now, grouped by goal. Pick one to open its thread.'
              : tab === 'features'
                ? 'Every feature in every space, and who is on it.'
                : 'Every open item, and who is holding it.'}
          </p>
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
          <button className="text-muted hover:text-ink" title="Read it again" onClick={() => void reload()}>
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

      <div className="min-h-0 flex-1">
        {tab === 'goals' && <Goals board={board} />}
        {tab === 'features' && <FeaturesTab board={board} />}
        {tab === 'work' && <WorkTab board={board} />}
      </div>
    </div>
  )
}
