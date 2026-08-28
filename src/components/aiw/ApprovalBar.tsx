// The approval prompt.
//
// `Approval` used to mean "refused", which was safe but useless: with nothing
// able to say yes, the only way to let an agent do real work was `Full`, and a
// permission nobody can satisfy is a permission nobody uses.
//
// An agent blocked here is stopped mid-turn with a thread held open, so this
// bar sits above every AI Workspace page rather than living on one of them.
// Three things it must get right:
//
//   1. **Legible.** A prompt showing raw JSON gets rubber-stamped, which is the
//      same as having no approval at all. The summary leads; the arguments are
//      one click away for when the summary isn't enough.
//   2. **Honest about the clock.** The request expires and is then refused. A
//      countdown that runs out in front of you is fine; a button that quietly
//      goes dead is not.
//   3. **Deniable by default.** Deny is the plain, always-available action.
//      Nothing here auto-answers.

import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { initials, type ApprovalRequest } from '../../lib/aiw'

/** Seconds left before the agent gives up and is refused. */
function secondsLeft(r: ApprovalRequest, now: number): number {
  const started = Date.parse(r.requested_at)
  if (Number.isNaN(started)) return r.expires_in
  return Math.max(0, Math.round((started + r.expires_in * 1000 - now) / 1000))
}

function clock(s: number): string {
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

function Request({ r, now }: { r: ApprovalRequest; now: number }) {
  const a = useAiw()
  const [open, setOpen] = useState(false)
  const [always, setAlways] = useState(false)
  const [busy, setBusy] = useState(false)

  const left = secondsLeft(r, now)
  const urgent = left <= 30
  const agent = a.agents.find((x) => x.id === r.agent_id)

  const answer = async (allow: boolean) => {
    setBusy(true)
    await a.resolveApproval(r.id, allow ? (always ? 'allow-always' : 'allow') : always ? 'deny-always' : 'deny')
    // No setBusy(false): answering removes the row.
  }

  return (
    <div className="border-b border-amber-500/20 last:border-0">
      <div className="flex items-start gap-3 px-4 py-2.5">
        <div className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-warn">
          {initials(agent?.name ?? r.agent_id)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-[12.5px] font-semibold text-ink">
              {agent?.name ?? r.agent_id}
            </span>
            <span className="text-[12px] text-dim">wants to</span>
            <span className="font-mono text-[12px] text-warn">{r.summary}</span>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted">
            <span className="font-mono">
              {r.tool}.{r.action}
            </span>
            {r.project_id && (
              <>
                <span className="text-faint">·</span>
                <span>{r.project_id}</span>
              </>
            )}
            <span className="text-faint">·</span>
            {/* The agent is blocked on a real deadline. Say so plainly rather
                than letting the buttons expire without explanation. */}
            <span className={urgent ? 'text-err' : 'text-muted'}>
              {left > 0 ? `refused in ${clock(left)}` : 'timed out — refused'}
            </span>
            <button
              className="text-faint underline-offset-2 hover:text-dim hover:underline"
              onClick={() => setOpen(!open)}
            >
              {open ? 'hide details' : 'details'}
            </button>
          </div>

          {open && (
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-line bg-app px-2.5 py-2 font-mono text-[10.5px] leading-[1.55] text-dim">
              {r.detail}
            </pre>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label
            className="flex cursor-pointer select-none items-center gap-1.5 text-[10.5px] text-muted hover:text-dim"
            title="Also change this agent's permission for this tool, so you aren't asked again"
          >
            <input
              type="checkbox"
              className="h-3 w-3 accent-indigo-500"
              checked={always}
              onChange={(e) => setAlways(e.target.checked)}
            />
            Don&rsquo;t ask again
          </label>
          <button
            className="rounded border border-line2 px-2.5 py-1 text-[11.5px] text-dim hover:bg-hover hover:text-ink disabled:opacity-40"
            disabled={busy}
            onClick={() => void answer(false)}
          >
            Deny
          </button>
          <button
            className="btn-primary px-3 py-1 text-[11.5px] disabled:opacity-40"
            disabled={busy}
            onClick={() => void answer(true)}
          >
            {busy ? '…' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ApprovalBar() {
  const a = useAiw()
  const [now, setNow] = useState(() => Date.now())
  const [showAll, setShowAll] = useState(false)

  // Only tick while something is actually waiting — an idle workspace should
  // not re-render once a second forever.
  const waiting = a.approvals.length > 0
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waiting])

  if (!waiting) return null

  const visible = showAll ? a.approvals : a.approvals.slice(0, 2)
  const hidden = a.approvals.length - visible.length

  return (
    <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.06]">
      <div className="flex items-center gap-2 px-4 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-warn">
        <Icon name="alert" size={12} />
        {a.approvals.length === 1
          ? 'An agent is waiting on you'
          : `${a.approvals.length} agents are waiting on you`}
      </div>
      <div className="mt-1.5">
        {visible.map((r) => (
          <Request key={r.id} r={r} now={now} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          className="w-full border-t border-amber-500/20 py-1.5 text-[11px] text-dim hover:bg-hover hover:text-ink"
          onClick={() => setShowAll(true)}
        >
          {hidden} more waiting
        </button>
      )}
    </div>
  )
}
