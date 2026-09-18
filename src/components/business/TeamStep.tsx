// Step six: who runs what.
//
// Roles, the way a company has them, suggested from what the business sells
// and has. Each covers every product, project and client it touches, so
// nobody is hired per project. A role is on the team or the directors keep
// doing it. A manager already working for another business is offered above
// the roles, and never assumed.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { openNodeThread } from '../../lib/dock'
import { Err, Header } from '../setup/LearnStep'
import { CAPTURE_BUSINESS_AUTO } from '../../lib/devCapture'
import { Foot } from './BusinessStep'
import { BizFrame, type StepProps } from './shared'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className={`flex items-center gap-1.5 text-[10.5px] ${on ? 'text-ok' : 'text-muted'}`}
      onClick={() => onChange(!on)}
      title={on ? 'On the team' : 'You keep doing this'}
    >
      {label}
      <span className={`relative inline-block h-[15px] w-[26px] rounded-full ${on ? 'bg-indigo-600' : 'bg-line2'}`}>
        <span
          className={`absolute top-[2px] h-[11px] w-[11px] rounded-full transition-all ${
            on ? 'left-[13px] bg-white' : 'left-[2px] bg-dim'
          }`}
        />
      </span>
    </button>
  )
}

export function TeamStep({ view, setView, nav, onClose }: StepProps) {
  const [offer, setOffer] = useState<ipc.TeamOffer | null>(null)
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [reuse, setReuse] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<ipc.TeamMade | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!view) return
    void ipc
      .businessTeam(view.node_id)
      .then((o) => {
        setOffer(o)
        setOn(Object.fromEntries(o.roles.map((r) => [r.id, r.on])))
      })
      .catch((e) => setErr(String(e)))
  }, [view?.node_id])

  // Screenshot harness: make the team as suggested, without a mouse.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || CAPTURE_BUSINESS_AUTO !== 'make' || !offer) return
    autoRan.current = true
    window.setTimeout(() => void make(), 8000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer])

  if (!view) return null
  const name = view.meta.name
  const roles = offer?.roles ?? []
  const onCount = roles.filter((r) => on[r.id]).length + reuse.size
  const keep = roles.filter((r) => !on[r.id]).length

  const make = async () => {
    setBusy(true)
    setErr('')
    try {
      const m = await ipc.businessMakeTeam(
        view.node_id,
        roles.filter((r) => on[r.id] && !r.made).map((r) => r.id),
        [...reuse],
      )
      setMade(m)
      setView(await ipc.businessGet(view.node_id))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (made) {
    return (
      <BizFrame step="team" view={view} nav={nav} onClose={onClose}>
        <Header
          icon="check"
          ok
          title={`${name} is a space`}
          text="Tagged Business, with the roles you put on the team. Each wakes on its own rhythm, and anything that needs a director waits for you. Nothing is pushed or sent without a yes."
        />
        <div className="rounded-[10px] border border-line bg-panel">
          {[...made.made.map((m) => ({ m, how: 'on the team' })), ...made.joined.map((m) => ({ m, how: 'also works here now' }))].map(
            ({ m, how }) => (
              <div key={`${m}-${how}`} className="flex items-center gap-2.5 border-b border-line px-4 py-2.5 last:border-b-0">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/15 text-[9.5px] font-semibold text-indigo-400">
                  {initials(m)}
                </span>
                <span className="flex-1 text-[12.5px] text-ink">{m}</span>
                <span className="text-[11px] text-muted">{how}</span>
              </div>
            ),
          )}
          {made.made.length + made.joined.length === 0 && (
            <div className="px-4 py-2.5 text-[12px] text-muted">Nobody on the team yet. The directors do it all.</div>
          )}
        </div>
        {made.problems.length > 0 && <Err tone="warn">{made.problems.join(' · ')}</Err>}
        <div className="flex items-center gap-3">
          <button
            className="btn-primary text-[12px]"
            onClick={() => {
              onClose()
              window.setTimeout(() => openNodeThread(view.node_id, name), 400)
            }}
          >
            Open {name}
          </button>
          <button className="btn-ghost text-[12px]" onClick={onClose}>
            Close
          </button>
        </div>
      </BizFrame>
    )
  }

  return (
    <BizFrame step="team" view={view} nav={nav} onClose={onClose} wide>
      <Header
        icon="agent"
        title="Who runs what"
        text="Roles, the way a company has them. Each one covers every product, project and client it touches, so nobody is hired per project. Put the ones you want on the team now. The rest you keep doing yourself."
      />
      <div className="flex items-center gap-3 text-[12px]">
        <span className="text-[11px] text-muted">Everyone reports to the directors</span>
        {(offer?.directors ?? []).map((d) => (
          <span key={d} className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/15 text-[9.5px] font-semibold text-indigo-400">
              {initials(d)}
            </span>
            <span className="text-ink">{d}</span>
          </span>
        ))}
        <span className="flex-1" />
        <span className="text-[10.5px] text-faint">suggested from what {name} sells and has</span>
      </div>

      {(offer?.others.length ?? 0) > 0 && (
        <div className="rounded-[10px] border border-line bg-panel">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Already on your team</span>
            <span className="text-[10.5px] text-faint">optional · a manager from another business can work for {name} too</span>
          </div>
          {offer!.others.map((m) => {
            const yes = reuse.has(m.handle)
            return (
              <div key={m.handle} className="flex items-center gap-2.5 border-t border-line px-4 py-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/15 text-[9.5px] font-semibold text-indigo-400">
                  {initials(m.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-ink">{m.name}</div>
                  <div className="text-[11px] text-muted">
                    works for {m.works_for.join(' and ') || 'another business'}
                    {m.rhythm ? ` · ${m.rhythm}` : ''}
                  </div>
                </div>
                <button
                  className={yes ? 'btn-primary text-[11.5px]' : 'btn-ghost text-[11.5px]'}
                  onClick={() =>
                    setReuse((cur) => {
                      const n = new Set(cur)
                      if (n.has(m.handle)) n.delete(m.handle)
                      else n.add(m.handle)
                      return n
                    })
                  }
                >
                  {yes ? `Works for ${name} too` : `Use for ${name} too`}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {roles.map((r) => (
          <div
            key={r.id}
            className={`flex flex-col gap-2 rounded-[10px] border bg-panel px-3.5 py-3 ${
              on[r.id] ? 'border-indigo-500/35' : 'border-line'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[9.5px] font-semibold ${
                  on[r.id] ? 'bg-indigo-500/15 text-indigo-400' : 'bg-raise text-dim'
                }`}
              >
                {initials(r.name)}
              </span>
              <span className="flex-1 text-[13px] font-semibold text-ink">{r.name}</span>
              {r.made ? (
                <span className="text-[10.5px] text-ok">on the team</span>
              ) : (
                <Switch
                  on={!!on[r.id]}
                  label={on[r.id] ? 'on the team' : 'you do this'}
                  onChange={(v) => setOn((cur) => ({ ...cur, [r.id]: v }))}
                />
              )}
            </div>
            <div className="text-[12px] leading-relaxed text-body">{r.job}</div>
            {r.covers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {r.covers.map((c) => (
                  <span key={c} className="rounded-full border border-line2 px-2 py-px text-[10.5px] text-dim">
                    {c}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <Icon name="clock" size={12} />
              {r.rhythm}
            </div>
            {r.stop_at.length > 0 && (
              <div className="text-[11px] leading-relaxed text-muted">
                Puts {r.team.join(' and ')} to work. <span className="text-warn">Stops {r.stop_at.join(', ')}.</span>
              </div>
            )}
            <div className="text-[10.5px] text-faint">{r.why}</div>
          </div>
        ))}
      </div>

      {err && <Err>{err}</Err>}
      <div className="flex items-center gap-3">
        <button className="btn-primary text-[12px]" disabled={busy || !offer} onClick={() => void make()}>
          {busy ? 'Making the team…' : `Make ${name}`}
        </button>
        <button className="btn-ghost text-[12px]" onClick={() => nav.onGo('learn')}>
          Back
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">
          {onCount} on the team, {keep} you keep doing
        </span>
      </div>
      <Foot icon="info">
        A role owns work, not a folder. The engineering lead is the same role for every project, and a question
        from any of them reaches the directors from that role.
      </Foot>
    </BizFrame>
  )
}
