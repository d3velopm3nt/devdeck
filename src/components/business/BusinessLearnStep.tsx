// Step five: learn from the business's mail, who it deals with and who it is.
//
// The personal learn run, kept to the business's mailboxes. People who write
// from the same company domain are one organisation card, with each of them
// on it and what the mail says of them. People at the business's own domains
// are its team, a card each. Mail anyone on the team wrote counts, so a
// client only a partner answers is still found. Keep, change or dismiss,
// then the next. A line about you personally goes to Your life, never to the
// business.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Err, Header } from '../setup/LearnStep'
import { CAPTURE_BUSINESS_AUTO } from '../../lib/devCapture'
import { Foot } from './BusinessStep'
import { BizFrame, hostOf, isAgreed, type StepProps } from './shared'

type Phase = 'approve' | 'reading' | 'review'

/** How many people a run reads about. Organisations group several, and the
 *  team is on the list too, so a business needs more than a person does. */
const PEOPLE = 30

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
  team: 'bg-emerald-500/15 text-ok',
  person: 'bg-raise text-muted',
}

const FREE = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.net', 'zoho.com', 'mweb.co.za', 'telkomsa.net', 'vodamail.co.za', 'webmail.co.za',
  'iafrica.com',
])

const n = (v: number) => v.toLocaleString()
const localPart = (a: string) => a.split('@')[0] ?? a
const initials = (s: string) =>
  s
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** Ridgeback Mining from ridgeback-mining.co.za, as the backend names it. */
const orgName = (domain: string) =>
  (domain.replace(/^www\./, '').split('.')[0] ?? domain)
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')

function RoleChip({ role }: { role: string }) {
  if (!role) return null
  return (
    <span
      className={`shrink-0 rounded-full px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider ${ROLE_TONE[role] ?? 'bg-raise text-muted'}`}
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
  kind?: string
  title?: string
  contacts?: ipc.ContactSummary[]
}

const isTeam = (c: { kind?: string; role: string }) => c.kind === 'team' || c.role === 'team'

interface Decision {
  role: string
  relates: string[]
  summary: string
  title: string
  keep: ipc.KeptLine[]
  decline: number[]
}

interface Unit {
  key: string
  kind: 'organisation' | 'person' | 'team'
  name: string
  people: ipc.LearnPerson[]
  by: string[]
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
      .learnEstimate(PEOPLE, [], 'full', false, nodeId)
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
          role: isTeam(first) ? 'team' : first.role || 'client',
          relates: first.relates,
          summary: first.summary,
          title: first.title ?? '',
          keep: first.facts.filter((f) => f.status === 'proposed').map((f) => ({ id: f.id, text: f.text, node_id: f.node_id })),
          decline: [],
        })
      }, 6000)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  if (!view) return null
  const name = view.meta.name

  // The business's own domains: its website's, and whichever wrote to people.
  // Only the business's mailboxes are read, so a writer is you or the team.
  const ours = new Set<string>()
  const site = hostOf(view.meta.website ?? '').replace(/^www\./, '').toLowerCase()
  if (site) ours.add(site)
  for (const p of est?.people ?? []) {
    for (const w of p.written_by ?? []) {
      const d = w.split('@')[1]?.toLowerCase()
      if (d && !FREE.has(d)) ours.add(d)
    }
  }
  const units: Unit[] = []
  for (const p of est?.people ?? []) {
    const d = p.email.split('@')[1]?.toLowerCase() ?? ''
    const kind: Unit['kind'] = d && ours.has(d) ? 'team' : !d || FREE.has(d) ? 'person' : 'organisation'
    const key = kind === 'organisation' ? d : `p:${p.contact_id}`
    let u = units.find((x) => x.key === key)
    if (!u) {
      u = { key, kind, name: kind === 'organisation' ? orgName(d) : p.name || p.email, people: [], by: [] }
      units.push(u)
    }
    u.people.push(p)
    for (const w of p.written_by ?? []) if (!u.by.includes(w)) u.by.push(w)
  }
  const outside = units.filter((u) => u.kind !== 'team')
  const team = units.filter((u) => u.kind === 'team')

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
      await ipc.learnRunLive(PEOPLE, [], 'full', false, nodeId)
    } catch (e) {
      setErr(String(e))
      setPhase('approve')
    } finally {
      off()
      setStopping(false)
    }
  }

  const decide = async (c: Card, d: Decision) => {
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
        title: d.title,
        contacts: c.contacts ?? [],
      })
      setSelected(null)
      await loadCards(c.run_id)
    } catch (e) {
      setErr(String(e))
    }
  }

  // ---- approve -------------------------------------------------------------
  if (phase === 'approve') {
    const orgCount = outside.filter((u) => u.kind === 'organisation').length
    const personCount = outside.length - orgCount
    return (
      <BizFrame step="learn" view={view} nav={nav} onClose={onClose}>
        <Header
          icon="mail"
          title={`Learn from ${name}'s mail`}
          text={`To learn who ${name} deals with and who is on its team, I read the threads with them, which means sending them to ${est?.provider_name || 'your provider'}. Once, and this is exactly what that is.`}
        />
        {est && (
          <div className="rounded-[10px] border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">
                Read {n(est.threads)} threads: {orgCount} {orgCount === 1 ? 'organisation' : 'organisations'}
                {personCount > 0 ? `, ${personCount} on their own` : ''}
                {team.length > 0 ? ` and ${team.length} on ${name}'s team` : ''}
              </span>
              <span className="ml-auto shrink-0 text-[10.5px] text-faint">only {name}&apos;s mailboxes</span>
            </div>
            <div className="grid grid-cols-2 gap-4 px-4 py-3 text-[12px]">
              <div className="flex flex-col gap-1.5">
                <span>
                  <b className="text-ink">{n(est.messages)}</b> <span className="text-muted">messages</span>
                </span>
                <span>
                  <b className="text-ink">{n(est.people.length)}</b>{' '}
                  <span className="text-muted">people you or {name}&apos;s team have written to</span>
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
            {units.length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <div className="mb-1.5 text-[11px] text-muted">Who this reads about, and why</div>
                <div className="flex max-h-56 flex-col overflow-auto pr-1">
                  {[...outside, ...team].map((u) => (
                    <div key={u.key} className="flex items-baseline gap-2 py-1 text-[12px]">
                      <span className="min-w-0 truncate text-ink">{u.name}</span>
                      {u.kind !== 'organisation' && <RoleChip role={u.kind} />}
                      {u.kind === 'organisation' && (
                        <span className="shrink-0 text-[11px] text-faint">
                          {u.people.length} {u.people.length === 1 ? 'contact' : 'contacts'}
                        </span>
                      )}
                      <span className="flex-1" />
                      <span className="min-w-0 truncate text-[11px] text-muted">
                        written to by {u.by.length ? u.by.map(localPart).join(', ') : 'you'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
          What you keep about an organisation goes to {name}&apos;s space, with its people. Someone on the team goes to{' '}
          {name}&apos;s team. A line about you personally goes to Your life, never to the business.
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
            <div className="text-[24px] font-semibold tracking-tight text-ink">One at a time</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-dim">
              Reading each organisation&apos;s threads with {name}, then each person on its team. The cards come up when
              the run is done.
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
              {plan?.kinds?.[i] === 'team' && <RoleChip role="team" />}
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
  const orgCards = cards.filter((c) => !isTeam(c))
  const teamCards = cards.filter(isTeam)

  const listRow = (c: Card) => {
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
        {isTeam(c) ? (
          c.title ? <span className="max-w-[90px] truncate text-[10.5px] text-dim">{c.title}</span> : null
        ) : (
          <RoleChip role={c.role} />
        )}
        <span className="w-[56px] shrink-0 text-right text-[10.5px] text-muted">
          {c.status === 'kept'
            ? 'kept'
            : c.status === 'declined'
              ? 'dismissed'
              : !isTeam(c) && (c.contacts?.length ?? 0) > 0
                ? `${c.contacts!.length} ${c.contacts!.length === 1 ? 'person' : 'people'}`
                : `${c.facts.length} facts`}
        </span>
      </button>
    )
  }

  return (
    <BizFrame step="learn" view={view} nav={nav} onClose={onClose} wide>
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <div className="text-[24px] font-semibold tracking-tight text-ink">Who {name} deals with, and who it is</div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-dim">
            Each company {name} deals with, with its people and what each of them is about, and each person on its own
            team. Keep it, change it, or dismiss it, then the next.
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
          <div className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Organisations <span className="text-faint">{orgCards.length}</span>
          </div>
          {orgCards.map(listRow)}
          {teamCards.length > 0 && (
            <>
              <div className="border-t border-line2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {name}&apos;s team <span className="text-faint">{teamCards.length}</span>
              </div>
              {teamCards.map(listRow)}
            </>
          )}
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          {cur && (
            <OrgCard
              key={`${cur.run_id}-${cur.person.contact_id}`}
              card={cur}
              offers={offers}
              name={name}
              onDecide={(d) => void decide(cur, d)}
            />
          )}
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
  onDecide: (d: Decision) => void
}) {
  const team = isTeam(card)
  const [role, setRole] = useState(team ? 'team' : card.role)
  const [title, setTitle] = useState(card.title ?? '')
  const [relates, setRelates] = useState<string[]>(card.relates)
  const [changing, setChanging] = useState(false)
  const [summary, setSummary] = useState(card.summary)
  const [on, setOn] = useState<Record<number, boolean>>({})
  const decided = card.status === 'kept' || card.status === 'declined'
  const proposed = card.facts.filter((f) => f.status === 'proposed')
  const choices = [...new Set([...offers, ...card.relates])]
  const contacts = team ? [] : (card.contacts ?? [])

  const keepAll = (only?: ipc.LearnFact[]) => {
    const keep = (only ?? proposed).map((f) => ({ id: f.id, text: f.text, node_id: f.node_id }))
    const decline = proposed.filter((f) => !keep.some((k) => k.id === f.id)).map((f) => f.id)
    onDecide({ role, relates, summary: summary.trim(), title: title.trim(), keep, decline })
  }

  return (
    <div className={`flex flex-col gap-3 rounded-[10px] border bg-panel px-4 py-3.5 ${decided ? 'border-line opacity-80' : 'border-indigo-500/40'}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold text-ink">{card.person.name}</span>
        {team && <RoleChip role="team" />}
        <span className="font-mono text-[11px] text-muted">{card.person.email}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted">
          {card.facts.length} {card.facts.length === 1 ? 'fact' : 'facts'}
          {decided ? ` · ${card.status === 'kept' ? 'kept' : 'dismissed'}` : ''}
        </span>
      </div>

      {team ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-muted">On {name}&apos;s team as</span>
          <input
            className="input min-w-0 flex-1 text-[12px]"
            disabled={decided}
            value={title}
            placeholder="what they do, for example sales or the other director"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      ) : (
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
      )}
      {choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted">{team ? 'They work on' : 'They have to do with'}</span>
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

      {contacts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">People there</span>
          {contacts.map((c) => (
            <div key={c.email} className="flex gap-2.5 rounded-[8px] border border-line bg-raise px-3 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel text-[9.5px] font-semibold text-dim">
                {initials(c.name || c.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[12.5px] text-ink">{c.name || c.email}</span>
                  {c.title && <span className="text-[11px] text-dim">{c.title}</span>}
                  <span className="font-mono text-[10.5px] text-faint">{c.email}</span>
                </div>
                <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-body">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}

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
                onClick={() => onDecide({ role, relates, summary: '', title: '', keep: [], decline: proposed.map((f) => f.id) })}
              >
                Dismiss
              </button>
            </>
          )}
          {!team && !role && <span className="text-[11px] text-warn">Choose what they are, so they get a folder</span>}
        </div>
      )}
    </div>
  )
}
