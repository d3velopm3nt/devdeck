// What this bot may actually do while nobody is watching.
//
// The bot page could say "it wakes at 07:00 and runs the QA agent" and leave you
// to work out the rest somewhere else. That would be the wrong half of the
// sentence: a heartbeat with no standing grants runs, refuses every tool call
// and achieves nothing, and a heartbeat with a broad one can do more than you
// remember agreeing to. Both are answered here, beside the routine.
//
// It shows and withdraws; it never creates. A grant should come from a real
// approval you answered — a prompt in front of you, about a call that actually
// happened — rather than from a page where it is cheap to click yes about
// something hypothetical.

import { useEffect } from 'react'
import { useAiw } from '../../lib/aiwStore'
import type { Grant } from '../../lib/aiw'
import type { Bot } from '../../lib/ipc'
import { Icon } from '../../lib/icons'

function scopeText(g: Grant): string {
  if (g.scope.kind === 'any') return 'any arguments'
  const v = g.scope.value ?? ''
  return g.scope.kind === 'exact' ? `exactly ${v}` : `anything starting ${v}`
}

function until(iso: string): string {
  const end = new Date(iso).getTime()
  if (Number.isNaN(end)) return 'unreadable'
  const mins = Math.round((end - Date.now()) / 60000)
  if (mins <= 0) return 'expired'
  if (mins < 60) return `${mins} min left`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h} hr left`
  return `${Math.floor(h / 24)} days left`
}

/** The grants that apply to this bot's agent in this bot's space. */
export function grantsFor(grants: Grant[] | null, bot: Bot): Grant[] | null {
  if (grants == null || !bot.agent) return grants == null ? null : []
  const here = String(bot.node_id)
  return grants.filter(
    (g) => g.live && g.agent_id === bot.agent && (g.project_id === '' || g.project_id === here),
  )
}

export function BotGrants({ bot, compact = false }: { bot: Bot; compact?: boolean }) {
  const a = useAiw()

  useEffect(() => {
    void a.refreshGrants()
    // The team is loaded when the Assistant page opens, and a bot document can
    // be the first thing you look at — without this the agent reads as its id
    // rather than its name, which is the difference between "qa" and
    // "QA Agent".
    if (a.agents.length === 0) void a.reloadAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!bot.agent) return null

  const mine = grantsFor(a.grants, bot)
  const agentName = a.agents.find((x) => x.id === bot.agent)?.name ?? bot.agent

  // Not read yet is not the same as none, and the difference matters most here:
  // "it can do nothing" is a claim about what happens tonight.
  if (mine == null) {
    return compact ? null : (
      <div className="rounded-lg border border-line bg-panel px-3.5 py-3 text-[11.5px] text-faint">
        Reading what {agentName} is allowed to do…
      </div>
    )
  }

  if (compact) {
    return (
      <span className={mine.length === 0 ? 'text-warn' : 'text-ok'}>
        {mine.length === 0
          ? 'no standing grants — it will refuse everything'
          : `${mine.length} standing grant${mine.length === 1 ? '' : 's'}`}
      </span>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          What it may do unattended
        </span>
        <span className="ml-auto text-[10.5px] text-faint">
          {agentName}
          {mine.length > 0 ? ` · ${mine.length}` : ''}
        </span>
      </div>

      {mine.length === 0 ? (
        <div className="border-t border-line px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <Icon name="alert" size={13} className="mt-px shrink-0 text-warn" />
            <div className="text-[11.5px] leading-[1.6] text-body">
              Nothing. When it wakes it will start, refuse every tool call it tries, and say so —
              there is nobody there to ask.
              <div className="mt-1.5 text-[10.5px] text-muted">
                To let it do something: run {agentName} yourself once from the Assistant, and when
                it asks, answer with <span className="text-ink">always</span>. That writes a
                standing grant for exactly that call. Grants are never made from this page — one
                should come from a prompt about a call that really happened.
              </div>
            </div>
          </div>
        </div>
      ) : (
        mine.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-2.5 border-t border-line px-3.5 py-2 text-[11.5px]"
          >
            <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded bg-amber-500/15 text-warn">
              <Icon name="check" size={10} />
            </span>
            <span className="shrink-0 text-body">
              {g.tool}.{g.action}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">
              {scopeText(g)}
            </span>
            <span className="shrink-0 text-[10px] text-muted">
              {g.uses_left} left · {until(g.expires_at)}
            </span>
            {g.project_id === '' && (
              <span className="shrink-0 text-[10px] text-warn">every project</span>
            )}
            <button
              className="btn-ghost shrink-0 text-[10.5px]"
              onClick={() => void a.revokeGrant(g.id)}
            >
              Withdraw
            </button>
          </div>
        ))
      )}
    </div>
  )
}
