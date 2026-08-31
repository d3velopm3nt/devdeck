// Standing grants: what you have already said yes to, in advance.
//
// This sits under the permission matrix rather than on a page of its own,
// because the two are one question. The matrix says what an agent *may ask
// about*; this says what it no longer has to ask. Reading one without the other
// tells you the wrong thing.
//
// Three rules the screen has to make visible, or the safety argument only
// exists in the Rust:
//
//   * every grant names one exact thing, expires, and runs out,
//   * a grant never reaches past the matrix — take the tool away and the
//     grants on it die with it,
//   * what a grant actually did is kept next to what you agreed to, so "what
//     happened while I was asleep" is answerable in one place.

import { useEffect, useState } from 'react'
import { useAiw } from '../../lib/aiwStore'
import type { Grant } from '../../lib/aiw'
import { Icon } from '../../lib/icons'

function when(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/** How long is left, in the units a person would say it in. */
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

function scopeText(g: Grant): string {
  if (g.scope.kind === 'any') return 'any arguments'
  const v = g.scope.value ?? ''
  return g.scope.kind === 'exact' ? `exactly ${v}` : `anything starting ${v}`
}

export function Grants() {
  const a = useAiw()
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    void a.refreshGrants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Until the first read comes back this is null, and the screen says nothing
  // rather than asserting there is nothing.
  const loaded = a.grants != null
  const all = a.grants ?? []
  const live = all.filter((g) => g.live)
  const past = all.filter((g) => !g.live)

  // A grant's project is a node id, which means nothing to a person reading it.
  // Show the space's name, and fall back to the id only when the space is gone —
  // in which case saying so is more useful than a bare number.
  const where = (id: string) => {
    if (!id) return null
    const p = a.projects.find((x) => x.id === id)
    return p ? p.name : `${id} (a space that is no longer here)`
  }

  // Likewise an agent id. The matrix above shows names, so this must too.
  const who = (id: string) => a.agents.find((x) => x.id === id)?.name ?? id

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">What you have allowed in advance</h3>
        <p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
          Answering a prompt with <span className="text-ink">always</span> writes one of these: that
          exact call, in that project, bounded and dated. It is how an agent can run while you are
          asleep — and it is deliberately the narrow option. Anything outside a grant still asks,
          and at 3am asking still means no.
        </p>
        <p className="mt-1.5 text-[11.5px] leading-[1.6] text-muted">
          A grant never reaches past the table above. Set a tool to{' '}
          <span className="text-ink">None</span> and every grant on it stops working, whether or not
          you tidied it away. They are kept in your personal store, never in a repository — and
          they are managed here, not by editing that file while DevDeck is open.
        </p>
      </div>

      {live.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-md border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2">
          <Icon name="alert" size={13} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-[11.5px] text-body">
            {live.length} standing grant{live.length === 1 ? '' : 's'} can be used without asking
            you.
          </span>
          <button
            className="btn-ghost shrink-0 text-[11px]"
            onClick={() => {
              if (!confirm(`Withdraw all ${live.length}? Everything goes back to asking.`)) return
              void a.revokeAllGrants()
            }}
          >
            Withdraw them all
          </button>
        </div>
      )}

      {!loaded && (
        <div className="rounded-md border border-line bg-raise px-3.5 py-4 text-center text-[11.5px] text-faint">
          Reading what you have allowed…
        </div>
      )}

      {loaded && all.length === 0 && (
        <div className="rounded-md border border-line bg-raise px-3.5 py-4 text-center text-[11.5px] text-muted">
          Nothing is pre-authorised. Every call that needs approval will ask.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {[...live, ...past].map((g) => (
          <div
            key={g.id}
            className={`overflow-hidden rounded-md border bg-raise ${
              g.live ? 'border-line' : 'border-line opacity-55'
            }`}
          >
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <span
                className={`mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded ${
                  g.live ? 'bg-amber-500/15 text-warn' : 'bg-hover text-faint'
                }`}
              >
                <Icon name={g.live ? 'check' : 'close'} size={11} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[12px] text-ink">
                    <span className="font-semibold">{who(g.agent_id)}</span> may {g.tool}.
                    {g.action}
                  </span>
                  <span className="font-mono text-[11px] text-dim">{scopeText(g)}</span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
                  <span>
                    {g.project_id ? (
                      where(g.project_id)
                    ) : (
                      <span className="text-warn">every project</span>
                    )}
                  </span>
                  <span>
                    {g.uses} of {g.max_uses} used
                  </span>
                  <span>{g.live ? until(g.expires_at) : g.state}</span>
                  {g.last_used && <span>last {when(g.last_used)}</span>}
                </div>

                {g.note && <div className="mt-1 text-[10.5px] text-faint">{g.note}</div>}

                {(g.recent?.length ?? 0) > 0 && (
                  <button
                    className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-dim hover:text-ink"
                    onClick={() => setOpen(open === g.id ? null : g.id)}
                  >
                    <Icon
                      name={open === g.id ? 'chevron-down' : 'chevron-right'}
                      size={10}
                    />
                    What it did ({g.recent?.length})
                  </button>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {g.live ? (
                  <button
                    className="btn-ghost text-[11px]"
                    onClick={() => void a.revokeGrant(g.id)}
                  >
                    Withdraw
                  </button>
                ) : (
                  <button
                    className="btn-ghost text-[11px] text-faint"
                    title="Remove it from the list. It is already inert."
                    onClick={() => void a.forgetGrant(g.id)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {open === g.id && (
              <div className="border-t border-line bg-page px-3 py-2">
                {g.recent?.map((line) => (
                  <div key={line} className="font-mono text-[10.5px] leading-[1.7] text-muted">
                    {line}
                  </div>
                ))}
                <div className="mt-1.5 text-[10px] text-faint">
                  The last {g.recent?.length} it allowed. Older ones are not kept — this is a
                  receipt, not a log.
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
