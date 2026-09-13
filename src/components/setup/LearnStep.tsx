// The learn step of the first run: sorting on this machine, one approval,
// reading one person at a time, done.
//
// Everything on the first screen is local and says so. The approval is the
// one place mail leaves the machine, and it shows the real numbers for the
// real batch. The reading screen is fed by events from the run itself, one
// per fact as its line is written, so what you watch is what is happening
// and not an animation of it.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store'
import type { MailCounts } from '../../lib/types'

type Phase = 'sorting' | 'approve' | 'reading' | 'done'

const n = (v: number) => v.toLocaleString()

function Steps({ at }: { at: 'learn' | 'life' | 'home' }) {
  const order: Array<'voice' | 'mail' | 'learn' | 'life' | 'home'> = ['voice', 'mail', 'learn', 'life', 'home']
  const label = { voice: 'Voice', mail: 'Mail', learn: 'Learn', life: 'Life', home: 'Home' }
  const idx = order.indexOf(at)
  return (
    <div className="flex items-center gap-2.5 text-[11px]">
      {order.map((s, i) => (
        <span key={s} className="flex items-center gap-2.5">
          {i > 0 && <span className="h-px w-6 bg-line2" />}
          <span
            className={`flex items-center gap-1.5 ${
              i === idx ? 'font-semibold text-ink' : 'text-muted'
            }`}
          >
            {i < idx ? (
              <Icon name="check" size={12} className="text-ok" />
            ) : i === idx ? (
              <span className="h-[7px] w-[7px] rounded-full bg-indigo-400" />
            ) : (
              <span className="h-[7px] w-[7px] rounded-full border border-line2" />
            )}
            {label[s]}
          </span>
        </span>
      ))}
    </div>
  )
}

export { Steps }

interface LiveFact {
  fact: ipc.LearnFact
  person: string
  status: 'proposed' | 'kept' | 'declined'
}

export function LearnStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { mailSyncing, mailAccounts } = useApp()
  const [phase, setPhase] = useState<Phase>('sorting')
  const [counts, setCounts] = useState<MailCounts | null>(null)
  const [est, setEst] = useState<ipc.LearnEstimate | null>(null)
  const [err, setErr] = useState('')

  // Sorting: what is on the machine, polled while the first sync runs. It is
  // a local query each time, and the numbers are the same ones the approval
  // will show, so nothing here is illustrative.
  useEffect(() => {
    if (phase !== 'sorting' && phase !== 'approve') return
    let live = true
    const tick = async () => {
      try {
        const [c, e] = await Promise.all([ipc.mailCounts(), ipc.learnEstimate(12, [], 'full')])
        if (!live) return
        setCounts(c)
        setEst(e)
        setErr('')
      } catch (e) {
        if (live) setErr(String(e))
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1500)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [phase])

  // Reading: fed by the run.
  const [plan, setPlan] = useState<ipc.LearnPlanEvent | null>(null)
  const [doneIdx, setDoneIdx] = useState(-1)
  const [current, setCurrent] = useState<ipc.LivePerson | null>(null)
  const [facts, setFacts] = useState<LiveFact[]>([])
  const [perPerson, setPerPerson] = useState<Record<number, number>>({})
  const [cost, setCost] = useState(0)
  const [mode, setMode] = useState<'now' | 'end'>('now')
  const [result, setResult] = useState<ipc.LearnDoneEvent | null>(null)
  const [stopping, setStopping] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const start = async () => {
    setErr('')
    setPhase('reading')
    setFacts([])
    setPerPerson({})
    setDoneIdx(-1)
    setCost(0)
    const off = await ipc.onLearn({
      plan: (e) => {
        setPlan(e)
        setCurrent(e.people[0] ?? null)
      },
      fact: (e) => {
        setCurrent(e.person)
        setFacts((cur) => [...cur, { fact: e.fact, person: e.person.name, status: 'proposed' }])
      },
      person: (e) => {
        setDoneIdx(e.index)
        setCost(e.cost_so_far)
        setPerPerson((cur) => ({ ...cur, [e.person.contact_id]: e.facts }))
        setCurrent(plan?.people[e.index + 1] ?? null)
      },
      done: (e) => {
        setResult(e)
        setPhase('done')
      },
      failed: (e) => setErr(`${e.person.name}: ${e.error}`),
    })
    try {
      await ipc.learnRunLive(12, [], 'full')
    } catch (e) {
      setErr(String(e))
      setPhase('approve')
    } finally {
      off()
      setStopping(false)
    }
  }

  useEffect(() => {
    // Keep the newest fact in view as they arrive.
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [facts.length])

  const decide = async (f: LiveFact, keep: boolean) => {
    try {
      if (keep) await ipc.learnKeep(f.fact.id, f.fact.text, f.fact.node_id)
      else await ipc.learnDecline(f.fact.id)
      setFacts((cur) =>
        cur.map((x) => (x.fact.id === f.fact.id ? { ...x, status: keep ? 'kept' : 'declined' } : x)),
      )
    } catch (e) {
      setErr(String(e))
    }
  }

  const account = mailAccounts[0]
  const automated = counts?.bots ?? 0
  const secret = est?.excluded.find((x) => x.kind === 'secret')?.count ?? 0
  const strangers = est?.excluded.find((x) => x.kind === 'strangers')?.count ?? 0

  // ---- sorting -------------------------------------------------------------
  if (phase === 'sorting') {
    const ready = !mailSyncing && !!est && !!counts
    return (
      <Frame step="learn">
        <Header
          icon="mail"
          title="Reading your mail, here first"
          text="I am fetching your mail and sorting the people you actually talk to from everything else. This part runs on this machine. Nothing is sent anywhere yet."
        />

        <div className="rounded-[10px] border border-line bg-panel px-4 py-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {mailSyncing ? 'Fetching' : 'Fetched'}
            </span>
            <span className="ml-auto text-[11px] text-muted">
              {account ? `${account.address} · personal` : 'no mailbox connected'}
            </span>
          </div>
          <div className="grid grid-cols-[70px_minmax(0,1fr)_96px] items-center gap-3 text-[12px]">
            {(
              [
                ['Inbox', counts?.inbox ?? 0],
                ['Sent', counts?.sent ?? 0],
                ['Drafts', counts?.drafts ?? 0],
              ] as const
            ).map(([name, c]) => (
              <Bar key={name} name={name} count={c} running={mailSyncing} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat
            head="People you write back to"
            big={est ? String(est.people.length) : '…'}
            tone="ink"
            accent
          >
            <div className="mt-1 flex flex-col gap-1 text-[12px] text-body">
              {(est?.people ?? []).slice(0, 4).map((p) => (
                <span key={p.contact_id} className="truncate">
                  {p.name || p.email}
                </span>
              ))}
              {est && est.people.length > 4 && (
                <span className="text-faint">+ {est.people.length - 4} more</span>
              )}
            </div>
          </Stat>
          <Stat head="Automated, ignored" big={counts ? n(automated) : '…'} tone="dim">
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              Newsletters, receipts and login alerts. Counted, never read, and I will not ask you
              about them.
            </p>
          </Stat>
          <Stat head="Skipped whole" big={est ? n(secret) : '…'} tone="dim">
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              One-time codes and password resets. Not read, not stored, not sent.
            </p>
          </Stat>
        </div>

        {err && <Err>{err}</Err>}

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <Icon name="secret" size={15} className="text-ok" />
          <span className="text-[12px] text-body">Nothing has left this machine.</span>
          <span className="flex-1" />
          {ready ? (
            <button className="btn-primary text-[12px]" onClick={() => setPhase('approve')}>
              Continue
            </button>
          ) : (
            <span className="text-[11px] text-muted">
              {mailSyncing ? 'about a minute left' : 'working it out…'}
            </span>
          )}
          <button className="btn-ghost text-[12px]" onClick={onSkip}>
            Not now
          </button>
        </div>
      </Frame>
    )
  }

  // ---- approve -------------------------------------------------------------
  if (phase === 'approve') {
    const people = est?.people ?? []
    return (
      <Frame step="learn">
        <Header
          icon="contacts"
          title={`${people.length} ${people.length === 1 ? 'person' : 'people'} you actually talk to`}
          text={`Sorting is done, and it all ran here. To learn what these people are to you I have to read the threads themselves, which means sending them to ${est?.provider_name || 'your provider'}. Once, and this is exactly what that is.`}
        />

        {est && (
          <div className="rounded-[10px] border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">
                Read {n(est.threads)} threads with {people.length} people
              </span>
              <span className="ml-auto text-[10.5px] text-faint">one decision, then a receipt</span>
            </div>
            <div className="grid grid-cols-2 px-4 pb-3 pt-1">
              <div className="pr-4">
                <Num v={`${n(est.threads)}`} l={`threads, ${n(est.messages)} messages`} first />
                <Num v={String(people.length)} l="people, all of whom you have written back to" />
                <Num v={n(est.tokens)} l="tokens, estimated" />
                <Num
                  v={est.cost_usd > 0 ? `~ $${est.cost_usd.toFixed(2)}` : '—'}
                  l={est.cost_usd > 0 ? `on your ${est.provider_name} key, once` : est.price_note}
                />
              </div>
              <div className="flex flex-col gap-1.5 border-l border-line pl-4 pt-2">
                <span className="text-[11px] text-muted">Not included</span>
                <Left c={automated} why="automated messages, ignored and never read" />
                <Left c={strangers} why="from senders you have never replied to" />
                <Left c={secret} why="one-time codes and resets, skipped whole" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5 px-4 pb-3.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Who</span>
              <div className="flex flex-wrap gap-1.5">
                {people.slice(0, 8).map((p) => (
                  <span key={p.contact_id} className="rounded bg-raise px-2 py-0.5 text-[11px] text-body">
                    {p.name || p.email}
                  </span>
                ))}
                {people.length > 8 && (
                  <span className="rounded bg-raise px-2 py-0.5 text-[11px] text-muted">
                    + {people.length - 8} more
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-b-[10px] border-t border-line bg-raise px-4 py-3">
              <button
                className="btn-primary text-[12px]"
                disabled={!est.ready || est.messages === 0}
                onClick={() => void start()}
              >
                Read them
              </button>
              <span className="flex-1" />
              <button className="btn-ghost text-[12px] text-muted" onClick={onSkip}>
                Not now
              </button>
            </div>
          </div>
        )}

        {est && !est.ready && <Err tone="warn">{est.note}</Err>}
        {est?.model_note && (
          <p className="text-[11.5px] leading-relaxed text-muted">{est.model_note}</p>
        )}
        {err && <Err>{err}</Err>}

        <div className="flex gap-2.5 border-t border-line pt-4">
          <Icon name="secret" size={15} className="mt-0.5 shrink-0 text-muted" />
          <p className="m-0 text-[11.5px] leading-relaxed text-muted">
            This is your personal mailbox, so everything I learn from it goes to your personal store
            on this machine, never into a space or a repository. Not now finishes setup; you can
            run this any time from Mail.
          </p>
        </div>
      </Frame>
    )
  }

  // ---- reading -------------------------------------------------------------
  if (phase === 'reading') {
    const total = plan?.people.length ?? 0
    const done = doneIdx + 1
    const pct = total ? Math.round((done / total) * 100) : 0
    return (
      <Frame step="learn" wide>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <div className="text-[24px] font-semibold tracking-tight text-ink">
              Reading, one person at a time
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-dim">
              Each fact appears as I write it. Keep or dismiss them now, or leave them all for the
              end.
            </p>
          </div>
          <span className="flex overflow-hidden rounded-md border border-line2 text-[11.5px]">
            {(['now', 'end'] as const).map((m) => (
              <button
                key={m}
                className={`px-3 py-1.5 ${
                  mode === m ? 'bg-indigo-500/10 text-ink' : 'text-muted hover:text-ink'
                } ${m === 'end' ? 'border-l border-line2' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'now' ? 'As they come' : 'At the end'}
              </button>
            ))}
          </span>
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
              <b className="font-semibold">{done}</b> of {total} people
            </span>
            <span className="text-muted">{facts.length} facts so far</span>
            <span className="text-muted">${cost.toFixed(2)} so far</span>
            <span className="flex-1" />
            <span className="text-[11px] text-faint">
              the receipt was written before the first person was sent
            </span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-full bg-raise">
            <span
              className="block h-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-4">
          <div className="self-start rounded-[10px] border border-line bg-panel">
            <div className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              People
            </div>
            {(plan?.people ?? []).map((p, i) => {
              const state = i <= doneIdx ? 'done' : current?.contact_id === p.contact_id ? 'now' : 'wait'
              return (
                <div
                  key={p.contact_id}
                  className={`flex items-center gap-2.5 border-t border-line px-3 py-2 text-[12px] ${
                    state === 'now' ? 'bg-raise' : ''
                  }`}
                >
                  {state === 'done' ? (
                    <Icon name="check" size={13} className="text-ok" />
                  ) : state === 'now' ? (
                    <Icon name="update" size={13} spin className="text-indigo-400" />
                  ) : (
                    <span className="flex h-[13px] w-[13px] items-center justify-center">
                      <span className="h-[6px] w-[6px] rounded-full border border-faint" />
                    </span>
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      state === 'wait' ? 'text-muted' : state === 'now' ? 'font-semibold text-ink' : 'text-body'
                    }`}
                  >
                    {p.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {state === 'done'
                      ? `${perPerson[p.contact_id] ?? 0} facts`
                      : state === 'now'
                        ? `${p.threads} threads`
                        : ''}
                  </span>
                </div>
              )
            })}
          </div>

          <div ref={listRef} className="flex min-h-0 flex-col gap-2 overflow-auto pr-1">
            {facts.length === 0 && (
              <div className="rounded-[10px] border border-dashed border-line2 px-4 py-3 text-[12px] text-muted">
                {current ? `Reading ${current.name}…` : 'Starting…'}
              </div>
            )}
            {facts.map((f) => (
              <FactCard key={f.fact.id} f={f} mode={mode} onDecide={decide} />
            ))}
          </div>
        </div>

        {err && <Err>{err}</Err>}
        <div className="flex gap-2.5 border-t border-line pt-3">
          <Icon name="secret" size={15} className="mt-0.5 shrink-0 text-muted" />
          <p className="m-0 text-[11.5px] leading-relaxed text-muted">
            What you keep goes to your personal store on this machine. Stop at any point: what
            came back stays, and the receipt covers exactly what was sent.
          </p>
        </div>
      </Frame>
    )
  }

  // ---- done ----------------------------------------------------------------
  const kept = facts.filter((f) => f.status === 'kept').length
  const declined = facts.filter((f) => f.status === 'declined').length
  const waiting = facts.filter((f) => f.status === 'proposed').length
  const run = result?.run
  return (
    <Frame step="learn">
      <Header
        icon="check"
        ok
        title={result?.stopped ? 'Stopped, and kept what came back' : 'I know your people now'}
        text={`I read ${plan?.people.length ?? 0} people's threads. What you kept I use from here on. What you dismissed will not come back.`}
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat head="kept" big={String(kept)} tone="ink" />
        <Stat head="still waiting for you" big={String(waiting)} tone="ink" accent />
        <Stat head="dismissed" big={String(declined)} tone="dim" />
      </div>
      {run && (
        <div className="rounded-[10px] border border-line bg-panel">
          <div className="px-4 py-2.5 text-[12.5px] font-semibold text-ink">Receipt</div>
          <Rcpt k="sent">
            {n(run.messages)} messages in {n(run.threads)} threads, {n(run.tokens)} tokens, to{' '}
            <span className="font-mono text-ink">{run.model}</span>
          </Rcpt>
          <Rcpt k="held back">
            {n(run.held_back)} messages from senders you never answered, or carrying codes. None
            reached the model.
          </Rcpt>
          <Rcpt k="ignored">{n(automated)} automated messages. Counted, never read, never raised.</Rcpt>
          <Rcpt k="kept in">
            <span className="font-mono text-[11px]">your personal store, memory</span>
          </Rcpt>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn-primary text-[12px]" onClick={onDone}>
          Continue
        </button>
        <span className="text-[11px] text-faint">
          {waiting > 0 ? `The ${waiting} waiting also wait for you in Inbox.` : ''}
        </span>
      </div>
    </Frame>
  )
}

// ---- pieces ----------------------------------------------------------------

export function Frame({
  step,
  wide,
  children,
}: {
  step: 'learn' | 'life' | 'home'
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col overflow-auto bg-page text-body">
      <div className="flex min-h-0 flex-grow justify-center p-8">
        <div className={`flex w-full flex-col gap-6 ${wide ? 'max-w-[1080px]' : 'max-w-[760px]'}`}>
          <Steps at={step} />
          {children}
        </div>
      </div>
    </div>
  )
}

export function Header({
  icon,
  title,
  text,
  ok,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  title: string
  text: string
  ok?: boolean
}) {
  return (
    <div className="flex items-start gap-4">
      <span
        className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] ${
          ok ? 'bg-emerald-500/15' : 'bg-indigo-500/15'
        }`}
      >
        <Icon name={icon} size={22} className={ok ? 'text-ok' : 'text-indigo-400'} />
      </span>
      <div>
        <div className="text-[24px] font-semibold tracking-tight text-ink">{title}</div>
        <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-dim">{text}</p>
      </div>
    </div>
  )
}

export function Err({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div
      className={`rounded-[8px] border px-3 py-2 text-[12px] ${
        tone === 'warn'
          ? 'border-amber-500/30 bg-amber-500/5 text-warn'
          : 'border-red-500/30 bg-red-500/10 text-err'
      }`}
    >
      {children}
    </div>
  )
}

function Bar({ name, count, running }: { name: string; count: number; running: boolean }) {
  return (
    <>
      <span className="text-body">{name}</span>
      <span className="h-[5px] overflow-hidden rounded-full bg-raise">
        <span
          className={`block h-full ${running ? 'w-2/3 animate-pulse bg-indigo-500' : 'w-full bg-emerald-500/70'}`}
        />
      </span>
      <span className="text-right font-mono text-[11px] text-muted">
        {n(count)}
        {!running && ' ✓'}
      </span>
    </>
  )
}

function Stat({
  head,
  big,
  tone,
  accent,
  children,
}: {
  head: string
  big: string
  tone: 'ink' | 'dim'
  accent?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-[10px] border bg-panel px-4 py-3.5 ${
        accent ? 'border-indigo-500/45' : 'border-line'
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{head}</span>
      <span
        className={`text-[30px] font-semibold leading-none tabular-nums ${
          tone === 'ink' ? 'text-ink' : 'text-dim'
        }`}
      >
        {big}
      </span>
      {children}
    </div>
  )
}

function Num({ v, l, first }: { v: string; l: string; first?: boolean }) {
  return (
    <div className={`flex items-baseline gap-2 py-[7px] text-[12px] ${first ? '' : 'border-t border-line'}`}>
      <b className="text-[15px] font-semibold tabular-nums text-ink">{v}</b>
      <span className="text-muted">{l}</span>
    </div>
  )
}

function Left({ c, why }: { c: number; why: string }) {
  return (
    <div className="text-[12px] leading-relaxed text-body">
      <span className="font-mono text-faint">{n(c)}</span> {why}
    </div>
  )
}

function Rcpt({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-line px-4 py-2.5 text-[12px]">
      <span className="w-[84px] shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-muted">
        {k}
      </span>
      <span className="text-body">{children}</span>
    </div>
  )
}

function FactCard({
  f,
  mode,
  onDecide,
}: {
  f: LiveFact
  mode: 'now' | 'end'
  onDecide: (f: LiveFact, keep: boolean) => Promise<void>
}) {
  if (f.status !== 'proposed') {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-line bg-panel px-3.5 py-2.5 opacity-70">
        <Icon
          name={f.status === 'kept' ? 'check' : 'close'}
          size={13}
          className={f.status === 'kept' ? 'text-ok' : 'text-faint'}
        />
        <span
          className={`flex-1 text-[12.5px] ${
            f.status === 'kept' ? 'text-body' : 'text-muted line-through'
          }`}
        >
          {f.fact.text}
        </span>
        <span className="text-[11px] text-muted">
          {f.person} · {f.status}
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-indigo-500/40 bg-panel px-3.5 py-3">
      <span className="text-[13px] leading-relaxed text-ink">{f.fact.text}</span>
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span>{f.person}</span>
        <span>·</span>
        <span>{f.fact.source || 'from your mail'}</span>
        <span className="flex-1" />
        {mode === 'now' && (
          <>
            <button className="btn-primary text-[11.5px]" onClick={() => void onDecide(f, true)}>
              Keep
            </button>
            <button className="btn-ghost text-[11.5px]" onClick={() => void onDecide(f, false)}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  )
}
