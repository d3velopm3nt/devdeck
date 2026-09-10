// A feature's room.
//
// No new object: the feature already exists in the deck, and this is the same
// conversation record every other thread is, marked with its slug. Whoever
// manages it answers in it — the bot whose `_bot.md` names this feature, or
// the assistant when nothing manages it yet, which the header says plainly
// rather than letting a reply look like it came from a manager that does not
// exist.
//
// `@name` in a message pulls that agent or bot in. `@name take "item"` hands
// the work over, and that is a claim transfer through the same gate as
// delegation — the header says so, because the difference is the whole rule.

import type { GoalRow } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Thread } from '../thread/Thread'
import { useSpeakers } from '../thread/speakers'
import { useApp } from '../../store'
import { findNode, resolveDir } from '../../lib/tree'

export function FeatureThread({ goal }: { goal: GoalRow }) {
  const speakers = useSpeakers()
  const nodes = useApp((s) => s.nodes)
  const answers = goal.managed_by ?? 'Assistant'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[11.5px] text-muted">
            {goal.workspace} / {goal.space} /
          </span>
          <span className="text-[15px] font-semibold text-ink">{goal.feature_name}</span>
          <span className="text-[10.5px] text-faint">
            feature · {goal.items_done} of {goal.items_total} done
            {goal.items_blocked > 0 && ` · ${goal.items_blocked} blocked`}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10.5px]">
          {goal.managed_by ? (
            <span className="flex items-center gap-1.5 text-indigo-400">
              <Icon name="bot" size={11} />
              {goal.managed_by}
              <span className="text-faint">manages this</span>
            </span>
          ) : (
            <span className="text-muted">
              No bot manages this yet — the assistant answers here.
            </span>
          )}
          {goal.on_it.map((a) => (
            <span key={a} className="flex items-center gap-1.5 text-muted">
              <span className="h-[6px] w-[6px] rounded-full bg-emerald-400" />
              {speakers(a)} <span className="text-faint">has work on it</span>
            </span>
          ))}
          {goal.waiting > 0 && (
            <span className="font-semibold text-warn">
              {goal.waiting} waiting on you
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-5 py-3">
        <Thread
          reloadKey={`${goal.node_id}:${goal.feature_id}`}
          // A feature's room belongs to a node, so a command in it runs where
          // that node's work runs.
          dir={resolveDir(nodes, findNode(nodes, goal.node_id))}
          nodeId={goal.node_id}
          load={() => ipc.featureThread(goal.node_id, goal.feature_id)}
          send={(text) => ipc.featureThreadSend(goal.node_id, goal.feature_id, text)}
          name={answers}
          placeholder={`Say something to everyone on ${goal.feature_name}, or @ one of them…`}
          footnote='@name pulls someone in and costs nothing. @name take "an item" hands the work over — that moves the claim, and goes through the same gate as delegation.'
          empty={
            <>
              This is the room for {goal.feature_name}. Bots and agents talk here, and everything a
              session does on it reports back into this thread.
            </>
          }
        />
      </div>
    </div>
  )
}
