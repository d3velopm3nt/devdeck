// The learn run — one decision, then a receipt.
//
// This is the screen where mail leaves the machine for the first time, so its
// whole job is to make that decision an informed one rather than a shrug. Three
// rules shape it:
//
//  - Every number on the estimate is computed from the batch that would
//    actually be sent. Nothing here is illustrative.
//  - What is left out is given the same weight as what goes. "1,204 messages
//    from senders you never replied to" is the reason this is affordable, and
//    it belongs on the screen, not in a tooltip.
//  - Facts arrive one at a time with their destination written out in full.
//    The store split is the thing most worth getting wrong quietly, and a path
//    you can read before you press Keep is the only defence against it.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { useApp } from '../store'

type Step = 'estimate' | 'running' | 'facts'

const n = (v: number) => v.toLocaleString()

/** The prompt's size, in the unit it is actually measured in. */
const size = (chars: number) =>
  chars >= 1_000_000
    ? `${(chars / 1_000_000).toFixed(1)}M chars`
    : `${Math.round(chars / 1000).toLocaleString()}K chars`

function Num({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2 border-t border-line py-[7px] first:border-t-0">
      <b className="text-[15px] font-semibold tabular-nums text-ink">{value}</b>
      <span className="text-[11.5px] text-dim">{label}</span>
    </div>
  )
}

export function LearnRunPage() {
  const { nodes } = useApp()

  const [step, setStep] = useState<Step>('estimate')
  const [est, setEst] = useState<ipc.LearnEstimate | null>(null)
  const [error, setError] = useState('')
  const [depth, setDepth] = useState<'full' | 'headers'>('full')

  // Who to read about. Empty means the top twelve by reciprocity; choosing
  // narrows it, and the estimate recomputes against the narrower batch —
  // which is the point of letting you choose at all.
  const [people, setPeople] = useState<ipc.Correspondent[]>([])
  const [only, setOnly] = useState<number[]>([])
  const [choosing, setChoosing] = useState(false)

  const [run, setRun] = useState<ipc.LearnRun | null>(null)
  const [facts, setFacts] = useState<ipc.LearnFact[]>([])
  const [at, setAt] = useState(0)
  const [draft, setDraft] = useState('')
  const [destNode, setDestNode] = useState(0)
  const [busy, setBusy] = useState(false)
  const [written, setWritten] = useState('')

  const refreshEstimate = useCallback(() => {
    setError('')
    void ipc
      .learnEstimate(12, only, depth)
      .then(setEst)
      // Reported, never swallowed. An empty estimate and a failed one look
      // identical on screen, and one of them means "you have no mail".
      .catch((e) => {
        setEst(null)
        setError(String(e))
      })
  }, [only, depth])

  useEffect(refreshEstimate, [refreshEstimate])
  useEffect(() => {
    void ipc.learnPeople(50).then(setPeople).catch(() => setPeople([]))
  }, [])

  // Anything still undecided from an earlier run comes back, so closing the
  // tab halfway through is not the same as saying no to everything.
  useEffect(() => {
    void ipc
      .learnFacts(0, 'proposed')
      .then((f) => {
        if (f.length > 0 && step === 'estimate') {
          setFacts(f)
          setAt(0)
          setStep('facts')
        }
      })
      .catch(() => {})
    // Deliberately once, on open: re-running this on every step change would
    // drag you back into the fact list the moment you finished it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const f = facts[at]
    setDraft(f?.text ?? '')
    setDestNode(f?.node_id ?? 0)
    setWritten('')
  }, [facts, at])

  const start = async () => {
    setError('')
    setStep('running')
    try {
      const r = await ipc.learnRun(12, only, depth)
      setRun(r)
      const f = await ipc.learnFacts(r.id, 'proposed')
      setFacts(f)
      setAt(0)
      setStep('facts')
    } catch (e) {
      setError(String(e))
      setStep('estimate')
      // The receipt exists even when the run failed — that is the point of
      // writing it before the send — so pick it up and show it.
      void ipc.learnRuns(1).then((rs) => setRun(rs[0] ?? null)).catch(() => {})
    }
  }

  const decide = async (keep: boolean) => {
    const f = facts[at]
    if (!f) return
    setBusy(true)
    setError('')
    try {
      if (keep) {
        const where = await ipc.learnKeep(f.id, draft, destNode)
        setWritten(where)
      } else {
        await ipc.learnDecline(f.id)
      }
      // A short beat on a keep so you can see where it went, then on.
      window.setTimeout(() => setAt((i) => i + 1), keep ? 900 : 0)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Only real containers make sense as a home for a fact about a thing.
  const spaces = nodes.filter((x) => x.kind === 'workspace' || x.kind === 'project')

  // ---- facts, one at a time ------------------------------------------------

  if (step === 'facts') {
    const f = facts[at]
    if (!f) {
      return (
        <div className="flex h-full flex-col items-center gap-4 overflow-auto bg-page p-8 pt-16 text-center">
          <Icon name={facts.length === 0 ? 'alert' : 'check'} size={26}
            className={facts.length === 0 ? 'text-warn' : 'text-ok'} />
          <div className="text-[15px] font-semibold text-ink">
            {facts.length === 0 ? 'Nothing came back.' : 'That is all of them.'}
          </div>
          <p className="max-w-md text-[12.5px] leading-relaxed text-muted">
            {facts.length === 0 ? (
              <>
                The mail was read and the model offered no facts it was willing to stand behind.
                That is a real answer, not a failure &mdash; the receipt below says exactly what
                was sent. A wider batch, or bodies instead of headers, usually gives it more to
                work with.
              </>
            ) : (
              <>
                {facts.length} proposed, and every one has an answer. Anything you kept is a file
                you can open, edit or delete; anything you declined left a row saying no, so it
                will not be offered again.
              </>
            )}
          </p>
          <button
            className="btn-ghost text-[12px]"
            onClick={() => {
              setFacts([])
              setRun(null)
              setStep('estimate')
              refreshEstimate()
            }}
          >
            Back to the estimate
          </button>
          {/* The copy above points at the receipt, so the receipt has to be
              here. It is the whole answer when nothing came back. */}
          {run && (
            <div className="w-full max-w-[760px] text-left">
              <Receipt run={run} />
            </div>
          )}
        </div>
      )
    }

    const thing = f.kind === 'thing'
    return (
      <div className="flex h-full flex-col overflow-auto bg-page">
        <div className="mx-auto w-full max-w-[760px] px-6 py-7">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
              Proposed
            </span>
            <span className="font-mono text-[10px] text-dim">
              {at + 1} of {facts.length}
            </span>
            <span className="ml-auto text-[11px] text-faint">
              a decline is remembered, so it is not offered twice
            </span>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5">
            <span
              className={`inline-block rounded px-1.5 py-[1px] text-[10px] font-semibold ${
                thing ? 'bg-info/15 text-info' : 'bg-indigo-500/15 text-indigo-300'
              }`}
            >
              {thing ? 'thing' : 'you'}
            </span>

            {/* Editable, because a fact you had to correct is worth more than
                one you had to reject. What is stored is what is in this box. */}
            <textarea
              className="mt-3 w-full resize-none rounded-lg border border-line2 bg-raise px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none focus:border-indigo-500/60"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />

            <div className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-muted">
              <div>
                <span className="text-dim">from</span> {f.source || 'your mail'}
                {f.thread_keys.length > 0 && ` · ${f.thread_keys.length} threads`}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-dim">goes to</span>
                <code className="break-all rounded bg-raise px-1.5 py-[2px] font-mono text-[10.5px] text-body">
                  {f.destination}
                </code>
              </div>
              {thing ? (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-dim">space</span>
                  <select
                    className="rounded border border-line2 bg-raise px-2 py-1 text-[11.5px] text-body outline-none"
                    value={destNode}
                    onChange={(e) => setDestNode(Number(e.target.value))}
                  >
                    <option value={0}>Choose one…</option>
                    {spaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-faint">
                    a teammate cloning that repo would read this
                  </span>
                </div>
              ) : (
                <div className="pt-1 text-faint">
                  The personal store refuses to live inside a repository, so this one cannot end up
                  in a commit.
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                disabled={busy || !draft.trim()}
                onClick={() => void decide(true)}
              >
                Keep
              </button>
              <button
                className="btn-ghost text-[12px]"
                disabled={busy}
                onClick={() => void decide(false)}
              >
                No
              </button>
              <button
                className="btn-ghost ml-auto text-[11.5px] text-muted"
                disabled={busy}
                onClick={() => setAt((i) => i + 1)}
                title="Leave it undecided. It will be waiting next time."
              >
                Later
              </button>
            </div>

            {written && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-ok">
                <Icon name="check" size={12} className="mt-[2px] shrink-0" />
                <span className="break-all">Written to {written}</span>
              </div>
            )}
            {error && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] text-err">
                {error}
              </div>
            )}
          </div>

          {run && <Receipt run={run} />}
        </div>
      </div>
    )
  }

  // ---- the estimate --------------------------------------------------------

  return (
    <div className="flex h-full flex-col overflow-auto bg-page">
      <div className="mx-auto w-full max-w-[760px] px-6 py-7">
        <h2 className="text-[15px] font-semibold text-ink">Read your mail</h2>
        <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
          Working out <span className="text-body">who you actually correspond with</span> ran here
          and nothing left the machine. To work out what these people are to you, the threads
          themselves have to be read, and that means sending them to{' '}
          {est?.provider_name || 'your provider'}. Here is exactly what that is.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-[12px] text-err">
            {error}
          </div>
        )}

        {est && (
          <>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-line bg-panel p-4">
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="text-[13px] font-semibold text-ink">
                    Read {n(est.threads)} thread{est.threads === 1 ? '' : 's'} with{' '}
                    {n(est.people.length)} {est.people.length === 1 ? 'person' : 'people'}
                  </h3>
                  <span className="text-[10.5px] text-faint">one decision, then a receipt</span>
                </div>
                <Num value={`${n(est.threads)} / ${n(est.messages)}`} label="threads, messages" />
                <Num
                  value={n(est.people.length)}
                  label="people, all of whom you have replied to"
                />
                <Num
                  value={n(est.attachments)}
                  label="attachments with readable text"
                />
                <Num value={size(est.chars)} label={`about ${n(est.tokens)} tokens`} />
                <Num
                  value={est.cost_usd > 0 ? `~ $${est.cost_usd.toFixed(2)}` : '—'}
                  label={
                    est.cost_usd > 0
                      ? `on your ${est.provider_name} key, once`
                      : est.price_note
                  }
                />
                <p className="pt-2 text-[10.5px] leading-relaxed text-faint">
                  {est.cost_usd > 0 && <>{est.price_note} &middot; </>}
                  {est.model_note ? (
                    est.model_note
                  ) : (
                    <>
                      Reading uses your assistant&rsquo;s own model ({est.model || 'none set'}),
                      on the key you already gave it.
                    </>
                  )}
                </p>
              </section>

              <section className="rounded-xl border border-line bg-panel p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Not included, and why</h3>
                {est.excluded.length === 0 ? (
                  <p className="text-[11.5px] leading-relaxed text-muted">
                    Nothing was held back this time — there was nothing in the batch that matched a
                    rule. That is unusual, and worth a second look at the numbers beside it.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {est.excluded.map((x) => (
                      <li key={x.kind} className="text-[11.5px] leading-relaxed text-muted">
                        <b className="font-semibold tabular-nums text-body">{n(x.count)}</b>{' '}
                        {x.why}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Who, by name. A count of people is not a list of people, and
                this is the half you might object to. */}
            <section className="mt-4 rounded-xl border border-line bg-panel p-4">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Who</h3>
                <button
                  className="btn-ghost ml-auto text-[11px]"
                  onClick={() => setChoosing((v) => !v)}
                >
                  {choosing ? 'Done choosing' : 'Choose who'}
                </button>
              </div>

              {choosing ? (
                <>
                  <p className="mb-2 text-[11px] leading-relaxed text-faint">
                    Nothing ticked means the top twelve by how often you wrote back. Ticking
                    narrows it, and the numbers above recount against what you picked.
                  </p>
                  <div className="max-h-[240px] space-y-1 overflow-auto">
                    {people.map((p) => {
                      const on = only.includes(p.contact_id)
                      return (
                        <label
                          key={p.contact_id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover/50"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setOnly((cur) =>
                                on
                                  ? cur.filter((x) => x !== p.contact_id)
                                  : [...cur, p.contact_id],
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate text-[12px] text-body">
                            {p.name || p.email}
                            {p.domain && <span className="text-faint"> · {p.domain}</span>}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted">
                            {p.received}↓ {p.sent}↑
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  {only.length > 0 && (
                    <button
                      className="btn-ghost mt-2 text-[11px]"
                      onClick={() => setOnly([])}
                    >
                      Clear the {only.length} selected
                    </button>
                  )}
                </>
              ) : (
                <ul className="space-y-1">
                  {est.people.slice(0, 6).map((p) => (
                    <li key={p.contact_id} className="flex items-center gap-2 text-[12px]">
                      <span className="min-w-0 flex-1 truncate text-body">
                        {p.name || p.email}
                        {p.domain && <span className="text-muted"> · {p.domain}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {n(p.threads)} threads
                      </span>
                    </li>
                  ))}
                  {est.people.length > 6 && (
                    <li className="text-[11.5px] text-faint">
                      + {est.people.length - 6} more
                    </li>
                  )}
                </ul>
              )}
            </section>

            {/* The provider has to be able to answer, and saying so here beats
                failing after the approval. */}
            {!est.ready && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-relaxed text-warn">
                {est.note}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                className="rounded-md bg-indigo-600 px-4 py-2 text-[12.5px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                disabled={!est.ready || step === 'running' || est.messages === 0}
                onClick={() => void start()}
              >
                {step === 'running' ? 'Reading…' : 'Read them'}
              </button>
              <button
                className={`rounded-md border px-3 py-2 text-[12px] ${
                  depth === 'headers'
                    ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                    : 'border-line2 text-dim hover:text-ink'
                }`}
                onClick={() => setDepth((d) => (d === 'headers' ? 'full' : 'headers'))}
                title="Subjects and the last few lines of each message — where signatures are"
              >
                Only headers and signatures
              </button>
              <span className="ml-auto text-[11px] text-faint">
                {est.depth === 'headers'
                  ? 'bodies stay on this machine'
                  : 'bodies are the only way to learn what was agreed'}
              </span>
            </div>

            {step === 'running' && (
              <p className="mt-3 text-[11.5px] text-muted">
                Sending {n(est.messages)} messages to {est.model}. This takes a minute or two and
                the receipt is already written — if it fails, there is still a row saying exactly
                what left.
              </p>
            )}

            <p className="mt-6 max-w-[62ch] text-[11.5px] leading-relaxed text-faint">
              The ranking above is what makes this small. A retailer that has sent hundreds of
              messages you never once answered is not a person, and none of it is here.
              Reciprocity, not volume — and it is a local query over folders already synced.
            </p>
          </>
        )}

        {run && <Receipt run={run} />}
      </div>
    </div>
  )
}

/**
 * The receipt.
 *
 * Written when the batch is posted rather than when it succeeds, so a run that
 * died on the wire still has a row saying what left — which is exactly the run
 * you would want to audit.
 */
function Receipt({ run }: { run: ipc.LearnRun }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mt-5 rounded-xl border border-line bg-panel p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon
          name={run.status === 'failed' ? 'alert' : 'check'}
          size={13}
          className={run.status === 'failed' ? 'text-err' : 'text-ok'}
        />
        <h3 className="text-[13px] font-semibold text-ink">Receipt</h3>
        <span className="text-[10.5px] text-faint">
          {new Date(run.started_at).toLocaleString()} · kept beside the mail, auditable afterwards
        </span>
      </div>

      <dl className="space-y-1.5 text-[11.5px] leading-relaxed">
        <div className="flex gap-3">
          <dt className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
            sent
          </dt>
          <dd className="text-body">
            {n(run.messages)} messages and {n(run.attachments)} extracted attachments,{' '}
            {n(run.tokens)} tokens, to {run.model || 'nothing'}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
            held back
          </dt>
          <dd className="text-body">
            {n(run.held_back)} items, none of which reached the model
            {run.held.length > 0 && (
              <span className="text-muted"> — {run.held.map((h) => h.kind).join(', ')}</span>
            )}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
            came back
          </dt>
          <dd className="text-body">
            {n(run.facts)} proposed facts · {n(run.kept)} kept
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
            the log
          </dt>
          <dd>
            <button className="text-info hover:underline" onClick={() => setOpen((v) => !v)}>
              {run.thread_keys.length} thread ids
            </button>
            <span className="text-muted">
              {' '}
              — so you can check the claim rather than trust it
            </span>
          </dd>
        </div>
        {run.error && (
          <div className="flex gap-3">
            <dt className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
              failed
            </dt>
            <dd className="text-err">{run.error}</dd>
          </div>
        )}
      </dl>

      {open && (
        <pre className="mt-2.5 max-h-[200px] overflow-auto rounded-lg border border-line bg-raise p-2.5 font-mono text-[10px] leading-relaxed text-muted">
          {run.thread_keys.join('\n')}
        </pre>
      )}
    </section>
  )
}
