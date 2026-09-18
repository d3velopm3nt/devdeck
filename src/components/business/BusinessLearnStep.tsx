// Step five: learn from the business's mail, one organisation at a time.
//
// The personal learn run, kept to the business's mailboxes and grouped by
// the domain people write from: three people at one firm are one card. Each
// card says what the organisation is to the business, which of its products
// and services it has to do with, and what is going on. Keep, change or
// dismiss, then the next. A line about you personally goes to Your life,
// never to the business.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Err, Header } from '../setup/LearnStep'
import { CAPTURE_BUSINESS_AUTO } from '../../lib/devCapture'
import { Foot } from './BusinessStep'
import { BizFrame, isAgreed, type StepProps } from './shared'

type Phase = 'approve' | 'reading' | 'review'

const ROLES = [
  { id: 'client', label: 'a client' },
  { id: 'supplier', label: 'a supplier' },
  { id: 'adviser', label: 'an adviser' },
  { id: 'partner firm', label: 'a partner firm' },
]

const ROLE_TONE: Record<string, string> = {
  client: 'bg-indigo-500/15 text-indigo-400',
  supplier: 'bg-sky-500/15 text-info',
  adviser: 'bg-amber-500/15 text-warn',
  'partner firm': 'bg-violet-500/15 text-viol',
}

const FREE = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.net', 'zoho.com', 'mweb.co.za', 'telkomsa.net', 'vodamail.co.za', 'webmail.co.za',
  'iafrica.com',
])

const n = (v: number) => v.toLocaleString()

function RoleChip({ role }: { role: string }) {
  if (!role) return null
  return (
    <span
      className={`rounded-full px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider ${ROLE_TONE[role] ?? 'bg-raise text-muted'}`}
    >
      {role}
    </span>
  )
}

interface Card {
  run_id: number
  person: ipc.LivePerson
  role: string
  relates: string[]
  summary: string
  status: string
  facts: ipc.LearnFact[]
}

export function BusinessLearnStep({ view, nav, onClose, next }: StepProps) {
  const [phase, setPhase] = useState<Phase>('approve')
  const [est, setEst] = useState<ipc.LearnEstimate | null>(null)
  const [err, setErr] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [plan, setPlan] = useState<ipc.LearnPlanEvent | null>(null)
  const [doneIdx, setDoneIdx] = useState(-1)
  const [current, setCurrent] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [cost, setCost] = useState(0)
  const [stopping, setStopping] = useState(false)
  const runRef = useRef(0)

  const nodeId = view?.node_id ?? 0
  const offers = (view?.meta.items ?? [])
    .filter((i) => (i.field === 'product' || i.field === 'service') && isAgreed(i))
    .map((i) => i.text)

  useEffect(() => {
    if (!nodeId) return
    void ipc
      .learnEstimate(12, [], 'full', false, nodeId)
      .then((e) => {
        setEst(e)
        setErr('')
      })
      .catch((e) => setErr(String(e)))
  }, [nodeId])

  // Screenshot harness: approve the read without a mouse, on a throwaway
  // profile with the mock provider. Late enough for the approval to be seen.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || CAPTURE_BUSINESS_AUTO !== 'learn' || !est || !est.ready || est.messages === 0) return
    autoRan.current = true
    window.setTimeout(() => void start(), 12000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [est])

  // Screenshot harness: open the cards the last run left and keep the first
  // one as it stands, without reading again. Throwaway profile only.
  const keepRan = useRef(false)
  useEffect(() => {
    if (keepRan.current || CAPTURE_BUSINESS_AUTO !== 'keep' || !nodeId) return
    keepRan.current = true
    void (async () => {
      const c = (await ipc.learnReview(0)) as Card[]
      setCards(c)
      setPhase('review')
      const first = c.find((x) => x.status === 'proposed')
      if (!first) return
      window.setTimeout(() => {
        void decide(first, {
          role: first.role || 'client',
          relates: first.relates,
          summary: first.summary,
          keep: first.facts.filter((f) => f.status === 'proposed').map((f) => ({ id: f.id, text: f.text, node_id: f.node_id })),
          decline: [],
        })
      }, 6000)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  if (!view) return null
  const name = view.meta.name

  const orgs = (() => {
    const seen = new Map<string, number>()
    for (const p of est?.people ?? []) {
      const d = p.email.split('@')[1]?.toLowerCase() ?? ''
      const key = !d || FREE.has(d) ? `p:${p.contact_id}` : d
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    return seen.size
  })()

  const loadCards = async (runId: number) => {
    const c = await ipc.learnReview(runId)
    setCards(c as Card[])
    setPhase('review')
  }

  const start = async () => {
    setErr('')
    setPhase('reading')
    setCards([])
    setDoneIdx(-1)
    setCost(0)
    setPlan(null)
    const off = await ipc.onLearn({
      plan: (e) => {
        setPlan(e)
        runRef.current = e.run_id
        setCurrent(e.people[0]?.contact_id ?? null)
      },
      summary: (e) => setCurrent(e.person.contact_id),
      fact: (e) => setCurrent(e.person.contact_id),
      person: (e) => {
        setDoneIdx(e.index)
        setCost(e.cost_so_far)
      },
      done: (e) => void loadCards(e.run.id),
      failed: (e) => setErr(`${e.person.name}: ${e.error}`),
    })
    try {
      await ipc.learnRunLive(12, [], 'full', false, nodeId)
    } catch (e) {
      setErr(String(e))
      setPhase('approve')
    } finally {
      off()
      setStopping(false)
    }
  }

  const decide = async (c: Card, d: { role: string; relates: string[]; summary: string; keep: ipc.KeptLine[]; decline: number[] }) => {
    setErr('')
    try {
      await ipc.learnDecidePerson({
        run_id: c.run_id,
        contact_id: c.person.contact_id,
        name: c.person.name,
        email: c.person.email,
        summary: d.keep.length || d.summary ? d.summary : '',
        keep: d.keep,
        decline: d.decline,
        add: [],
        business: nodeId,
        role: d.role,
        relates: d.relates,
      })
      setSelected(null)
      await loadCards(c.run_id)
    } catch (e) {
      setErr(String(e))
    }
  }

  // ---- approve -------------------------------------------------------------
  if (phase === 'approve') {
    return (
      <BizFrame step="learn" view={view} nav={nav} onClose={onClose}>
        <Header
          icon="mail"
          title={`Learn from ${name}'s mail`}
          text={`To learn what each organisation is to ${name}, I read the threads with them, which means sending them to ${est?.provider_name || 'your provider'}. Once, and this is exactly what that is.`}
        />
        {est && (
          <div className="rounded-[10px] border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">
                Read {n(est.threads)} threads with {orgs} {orgs === 1 ? 'organisation' : 'organisations'}
              </span>
              <span className="ml-auto text-[10.5px] text-faint">only {name}&apos;s mailboxes</span>
            </div>
            <div className="grid grid-cols-2 gap-4 px-4 py-3 text-[12px]">
              <div className="flex flex-col gap-1.5">
                <span>
                  <b className="text-ink">{n(est.messages)}</b> <span className="text-muted">messages</span>
                </span>
                <span>
                  <b className="text-ink">{n(est.people.length)}</b>{' '}
                  <span className="text-muted">people you have written back to, at {orgs} organisations</span>
                </span>
                <span>
                  <b className="text-ink">{n(est.tokens)}</b> <span className="text-muted">tokens, estimated</span>
                </span>
                <span>
                  <b className="text-ink">{est.cost_usd > 0 ? `~ $${est.cost_usd.toFixed(2)}` : '—'}</b>{' '}
                  <span className="text-muted">{est.cost_usd > 0 ? `on your ${est.provider_name} key, once` : est.price_note}</span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5 border-l border-line pl-4">
                <span className="text-[11px] text-muted">Not included</span>
                {est.excluded.map((x) => (
                  <span key={x.kind} className="text-[11.5px] text-body">
                    <span className="font-mono text-faint">{n(x.count)}</span> {x.why}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-b-[10px] border-t border-line bg-raise px-4 py-3">
              {est.messages === 0 ? (
                // Everything was read by an earlier run and nothing new has
                // arrived: the cards that run left are what there is.
                <button className="btn-primary text-[12px]" onClick={() => void loadCards(0)}>
                  See the cards
                </button>
              ) : (
                <button className="btn-primary text-[12px]" disabled={!est.ready} onClick={() => void start()}>
                  Read them
                </button>
              )}
              <span className="flex-1" />
              <button className="btn-ghost text-[12px]" onClick={() => next('team')}>
                Not now
              </button>
            </div>
          </div>
        )}
        {est && !est.ready && <Err tone="warn">{est.note}</Err>}
        {est?.model_note && <p className="m-0 text-[11.5px] leading-relaxed text-muted">{est.model_note}</p>}
        {!est && !err && <div className="text-[12px] text-muted">Sorting {name}&apos;s mail on this machine…</div>}
        {err && <Err>{err}</Err>}
        <div className="flex items-center gap-3">
          <button className="btn-ghost text-[12px]" onClick={() => nav.onGo('mail')}>
            Back
          </button>
        </div>
        <Foot>
          What you keep about an organisation goes to {name}&apos;s space, where its team reads it. A line about you
          personally goes to Your life, never to the business.
        </Foot>
      </BizFrame>
    )
  }

  // ---- reading ---------------------------------------------------------------
  if (phase === 'reading') {
    const total = plan?.people.length ?? 0
    const pct = total ? Math.round(((doneIdx + 1) / total) * 100) : 0
    return (
      <BizFrame step="learn" view={view} nav={nav} onClose={onClose} wide>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <div className="text-[24px] font-semibold tracking-tight text-ink">One organisation at a time</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-dim">
              Reading each organisation&apos;s threads with {name}. The cards come up when the run is done.
            </p>
          </div>
          <button
            className="btn-ghost text-[11.5px]"
            disabled={stopping}
            onClick={() => {
              setStopping(true)
              void ipc.learnStop()
            }}
          >
            {stopping ? 'Stopping after this one…' : 'Stop'}
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3.5 text-[12px]">
            <span className="text-ink">
              <b className="font-semibold">{doneIdx + 1}</b> of {total} read
            </span>
            <span className="text-muted">${cost.toFixed(2)} so far</span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-full bg-raise">
            <span className="block h-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded-[10px] border border-line bg-panel">
          {(plan?.people ?? []).map((p, i) => (
            <div key={p.contact_id} className="flex items-center gap-2.5 border-b border-line px-4 py-2 text-[12px] last:border-b-0">
              {i <= doneIdx ? (
                <Icon name="check" size={13} className="text-ok" />
              ) : current === p.contact_id ? (
                <Icon name="update" size={13} spin className="text-indigo-400" />
              ) : (
                <span className="h-[6px] w-[6px] rounded-full border border-faint" />
              )}
              <span className={i <= doneIdx || current === p.contact_id ? 'text-ink' : 'text-muted'}>{p.name}</span>
              <span className="font-mono text-[10.5px] text-faint">{p.email}</span>
              <span className="flex-1" />
              <span className="text-[11px] text-muted">{p.threads} threads</span>
            </div>
          ))}
          {!plan && <div className="px-4 py-2.5 text-[12px] text-muted">Sorting the batch…</div>}
        </div>
        {err && <Err>{err}</Err>}
      </BizFrame>
    )
  }

  // ---- review ------------------------------------------------------------------
  const open = cards.filter((c) => c.status === 'proposed')
  const cur = (selected == null ? null : cards.find((c) => c.person.contact_id === selected)) ?? open[0] ?? cards[0]
  return (
    <BizFrame step="learn" view={view} nav={nav} onClose={onClose} wide>
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <div className="text-[24px] font-semibold tracking-tight text-ink">One organisation at a time</div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-dim">
            For each company {name} deals with: what kind it is, what it has to do with the products and services,
            and what is going on. Keep it, change it, or dismiss it, then the next.
          </p>
        </div>
      </div>
      <div className="flex items-baseline gap-3.5 text-[12px]">
        <span className="text-ink">
          <b className="font-semibold">{cards.length - open.length}</b> of {cards.length} decided
        </span>
        <span className="text-muted">read after you approved it, from {name}&apos;s mailboxes</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4">
        <div className="min-h-0 self-start overflow-auto rounded-[10px] border border-line bg-panel">
          <div className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Organisations</div>
          {cards.map((c) => {
            const on = cur?.person.contact_id === c.person.contact_id
            return (
              <button
                key={c.person.contact_id}
                onClick={() => setSelected(c.person.contact_id)}
                className={`flex w-full items-center gap-2.5 border-t border-line px-3 py-2 text-left text-[12px] ${
                  on ? 'bg-raise' : 'hover:bg-hover'
                }`}
              >
                {c.status === 'kept' ? (
                  <Icon name="check" size={13} className="text-ok" />
                ) : c.status === 'declined' ? (
                  <Icon name="close" size={13} className="text-faint" />
                ) : (
                  <span className="flex h-[13px] w-[13px] items-center justify-center">
                    <span className="h-[6px] w-[6px] rounded-full bg-indigo-400" />
                  </span>
                )}
                <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold text-ink' : 'text-body'}`}>{c.person.name}</span>
                <RoleChip role={c.role} />
                <span className="w-[48px] text-right text-[10.5px] text-muted">
                  {c.status === 'kept' ? 'kept' : c.status === 'declined' ? 'dismissed' : `${c.facts.length} facts`}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          {cur && <OrgCard key={`${cur.run_id}-${cur.person.contact_id}`} card={cur} offers={offers} name={name} onDecide={(d) => void decide(cur, d)} />}
          {cards.length === 0 && (
            <div className="rounded-[10px] border border-dashed border-line2 px-4 py-3 text-[12px] text-muted">
              Nothing came back to decide.
            </div>
          )}
        </div>
      </div>
      {err && <Err>{err}</Err>}
      <div className="flex items-center gap-3">
        <button className="btn-primary text-[12px]" onClick={() => next('team')}>
          Next: team
        </button>
        <button className="btn-ghost text-[12px]" onClick={() => nav.onGo('mail')}>
          Back
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">
          {open.length > 0 ? `${open.length} still to decide. They also wait in your Inbox.` : 'All decided.'}
        </span>
      </div>
    </BizFrame>
  )
}

function OrgCard({
  card,
  offers,
  name,
  onDecide,
}: {
  card: Card
  offers: string[]
  name: string
  onDecide: (d: { role: string; relates: string[]; summary: string; keep: ipc.KeptLine[]; decline: number[] }) => void
}) {
  const [role, setRole] = useState(card.role)
  const [relates, setRelates] = useState<string[]>(card.relates)
  const [changing, setChanging] = useState(false)
  const [summary, setSummary] = useState(card.summary)
  const [on, setOn] = useState<Record<number, boolean>>({})
  const decided = card.status === 'kept' || card.status === 'declined'
  const proposed = card.facts.filter((f) => f.status === 'proposed')
  const choices = [...new Set([...offers, ...card.relates])]

  const keepAll = (only?: ipc.LearnFact[]) => {
    const keep = (only ?? proposed).map((f) => ({ id: f.id, text: f.text, node_id: f.node_id }))
    const decline = proposed.filter((f) => !keep.some((k) => k.id === f.id)).map((f) => f.id)
    onDecide({ role, relates, summary: summary.trim(), keep, decline })
  }

  return (
    <div className={`flex flex-col gap-3 rounded-[10px] border bg-panel px-4 py-3.5 ${decided ? 'border-line opacity-80' : 'border-indigo-500/40'}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold text-ink">{card.person.name}</span>
        <span className="font-mono text-[11px] text-muted">{card.person.email}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted">
          {card.facts.length} {card.facts.length === 1 ? 'fact' : 'facts'}
          {decided ? ` · ${card.status === 'kept' ? 'kept' : 'dismissed'}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-muted">To {name} they are</span>
        {ROLES.map((r) => (
          <button
            key={r.id}
            disabled={decided}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              role === r.id ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
            }`}
            onClick={() => setRole(role === r.id ? '' : r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted">They have to do with</span>
          {choices.map((o) => {
            const yes = relates.includes(o)
            return (
              <button
                key={o}
                disabled={decided}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  yes ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                }`}
                onClick={() => setRelates((cur) => (yes ? cur.filter((x) => x !== o) : [...cur, o]))}
              >
                {o}
              </button>
            )
          })}
        </div>
      )}

      {changing ? (
        <textarea
          className="input min-h-[72px] resize-y text-[13px] leading-relaxed"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      ) : summary ? (
        <p className="m-0 text-[13px] leading-relaxed text-ink">{summary}</p>
      ) : null}

      {card.facts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">What I noticed</span>
          {card.facts.map((f) => (
            <label key={f.id} className="flex items-start gap-2 text-[12px] leading-relaxed">
              {changing && f.status === 'proposed' ? (
                <input
                  type="checkbox"
                  className="mt-[5px]"
                  checked={on[f.id] ?? true}
                  onChange={(e) => setOn((cur) => ({ ...cur, [f.id]: e.target.checked }))}
                />
              ) : f.status === 'kept' ? (
                <Icon name="check" size={12} className="mt-[4px] shrink-0 text-ok" />
              ) : f.status === 'declined' ? (
                <Icon name="close" size={12} className="mt-[4px] shrink-0 text-faint" />
              ) : (
                <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-faint" />
              )}
              <span className={f.status === 'declined' ? 'text-muted line-through' : 'text-body'}>
                {f.text}
                {f.kind === 'you' && (
                  <span className="ml-1.5 rounded-full bg-teal-500/15 px-2 text-[9px] font-semibold uppercase tracking-wider text-teal-400">
                    goes to Your life
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {!decided && (
        <div className="flex items-center gap-2 pt-0.5">
          {changing ? (
            <>
              <button
                className="btn-primary text-[11.5px]"
                onClick={() => {
                  setChanging(false)
                  keepAll(proposed.filter((f) => on[f.id] ?? true))
                }}
              >
                Keep these
              </button>
              <button className="btn-ghost text-[11.5px]" onClick={() => setChanging(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-primary text-[11.5px]" onClick={() => keepAll()}>
                Keep
              </button>
              <button className="btn-ghost text-[11.5px]" onClick={() => setChanging(true)}>
                Change
              </button>
              <button
                className="btn-ghost text-[11.5px] text-muted"
                onClick={() => onDecide({ role, relates, summary: '', keep: [], decline: proposed.map((f) => f.id) })}
              >
                Dismiss
              </button>
            </>
          )}
          {!role && <span className="text-[11px] text-warn">Choose what they are, so they get a folder</span>}
        </div>
      )}
    </div>
  )
}
