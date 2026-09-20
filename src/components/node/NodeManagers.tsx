// The managers working in a space: who each is, when it wakes, how its last
// wake went, and where its plan stands. A business has several, most spaces
// one. Each opens to its own page; the space's Thread is the room they share.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { avatarLabel, nodeColor } from '../../lib/spaces'
import { routine } from '../../lib/bots'
import { openBot } from '../../lib/dock'
import { openBusiness } from '../business/TodayBusinesses'
import { startWorker } from '../workers/StartWorker'
import { BotCreate } from '../bot/BotCreate'

type SpaceNode = Parameters<typeof nodeColor>[0] & { id: number; name: string }

export function NodeManagers({
  node,
  managers,
  isBusiness,
}: {
  node: SpaceNode
  managers: ipc.Bot[]
  isBusiness: boolean
}) {
  const refreshBots = useApp((s) => s.refreshBots)
  const [standing, setStanding] = useState<Record<string, ipc.BotStanding>>({})
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void ipc
      .botsStanding()
      .then((rows) => setStanding(Object.fromEntries(rows.map((r) => [r.handle, r]))))
      .catch(() => setStanding({}))
  }, [managers.length])

  return (
    <div className="flex max-w-[980px] flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="m-0 flex-1 text-[12px] leading-relaxed text-muted">
          {managers.length === 0
            ? `Nobody manages ${node.name} yet.`
            : `${managers.length === 1 ? 'One manager works' : `${managers.length} managers work`} in ${node.name}. Their wakes land in its Thread, each under its own name, and @ reaches one there.`}
        </p>
        <button className="btn-ghost text-[11.5px]" onClick={() => startWorker({ nodeId: node.id })}>
          <Icon name="run" size={12} /> Start a worker
        </button>
        {isBusiness ? (
          <button className="btn-ghost text-[11.5px]" onClick={() => openBusiness({ nodeId: node.id, step: 'team' })}>
            <Icon name="edit" size={12} /> Change the team
          </button>
        ) : managers.length === 0 ? (
          <button className="btn-primary text-[11.5px]" onClick={() => setCreating(true)}>
            <Icon name="add" size={12} /> Give it a bot
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {managers.map((m) => {
          const s = standing[m.handle]
          const woke = m.last_woke ? new Date(m.last_woke) : null
          return (
            <div key={m.handle} className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-black/80"
                  style={{ background: nodeColor(node) }}
                >
                  {avatarLabel(m.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">{m.name}</div>
                  <div className="truncate font-mono text-[10.5px] text-faint">@{m.handle}</div>
                </div>
                <button className="btn-ghost text-[11.5px]" onClick={() => openBot(m.node_id, m.name, false, m.handle)}>
                  Open
                </button>
              </div>
              {m.goal && <p className="m-0 text-[12px] leading-relaxed text-dim">{m.goal}</p>}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span className="flex items-center gap-1">
                  <Icon name="schedule" size={11} /> {routine(m)}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="check" size={11} />{' '}
                  {s && s.total > 0
                    ? `${s.done} of ${s.total} done${s.blocked ? `, ${s.blocked} blocked` : ''}`
                    : 'nothing on its plan yet'}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="agent" size={11} /> {m.agent ? `runs ${m.agent}` : 'plans and asks'}
                </span>
              </div>
              <div className="rounded-[8px] border border-line bg-raise px-2.5 py-2 text-[11.5px] leading-relaxed">
                <div className="mb-0.5 text-[10px] uppercase tracking-wider text-faint">
                  {woke
                    ? `Last woke ${woke.toLocaleString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Has not woken yet'}
                </div>
                <div className={`line-clamp-4 whitespace-pre-line ${m.last_ok === false ? 'text-warn' : 'text-body'}`}>
                  {m.last_note || (woke ? 'Nothing to report.' : `First wake: ${routine(m).toLowerCase()}.`)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {creating && (
        <BotCreate
          nodeId={node.id}
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false)
            void refreshBots()
            openBot(b.node_id, b.name, true, b.handle)
          }}
        />
      )}
    </div>
  )
}
