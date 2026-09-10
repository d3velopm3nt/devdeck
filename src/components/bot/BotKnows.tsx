// What the bot knows about you, and the interview that gave it most of it.
//
// Two rules make this a list you can trust rather than a black box:
//
//   * **Every line has a source.** You said it, it watched it, or you corrected
//     it — and a corrected line keeps what it used to say, because a bot that
//     silently rewrites what it believed cannot be audited.
//   * **Nothing you said ages out.** Ageing offers to drop what it worked out
//     on its own, never your instructions, and never anything pinned. It offers;
//     it does not act.
//
// None of this is in the vault. It is the personal store, which refuses to be
// created inside a git repository at all.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { SOURCE_TONE } from '../../lib/bots'
import { BotInterview } from './BotInterview'

function Ago({ iso }: { iso: string }) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return <span className="shrink-0 text-[10px] text-faint">{d.toLocaleDateString()}</span>
}

export function BotKnows({ bot }: { bot: ipc.Bot }) {
  const [beliefs, setBeliefs] = useState<ipc.Belief[]>([])
  const [interview, setInterview] = useState<ipc.Interview | null>(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState('')
  const [correcting, setCorrecting] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [askAt, setAskAt] = useState<number | null>(null)

  const load = () => {
    void ipc.botBeliefs(bot.node_id).then(setBeliefs).catch((e) => setErr(String(e)))
    void ipc.botInterview(bot.node_id).then(setInterview).catch((e) => setErr(String(e)))
  }
  useEffect(load, [bot.node_id])

  const run = (fn: () => Promise<unknown>) => {
    setErr('')
    void fn()
      .then(load)
      .catch((e) => setErr(String(e)))
  }

  const stale = beliefs.filter((b) => b.stale)
  const answered = interview?.answers.filter((a) => !a.skipped).length ?? 0
  const skipped = interview?.answers.filter((a) => a.skipped).length ?? 0

  return (
    <div className="flex flex-col gap-3.5">
      {err && <div className="rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] text-err">{err}</div>}

      <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink">
            It knows {beliefs.length} thing{beliefs.length === 1 ? '' : 's'} about this space
          </span>
          <span className="ml-auto text-[10.5px] text-faint">
            {answered} of {interview?.script.length ?? 6} answered
            {skipped > 0 ? ` · ${skipped} skipped` : ''}
          </span>
        </div>
        <p className="mt-1 text-[10.5px] leading-[1.5] text-muted">
          Kept in your personal store, never in the folder — so none of it can reach a pull request.
        </p>
      </div>

      {/* Tell it something. The most under-rated way to fix a bot. */}
      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
        <Icon name="add" size={12} className="shrink-0 text-faint" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[12px] text-body outline-none placeholder:text-faint"
          placeholder="Tell it something…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !adding.trim()) return
            const text = adding.trim()
            setAdding('')
            run(() => ipc.botBeliefAdd(bot.node_id, text))
          }}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        {beliefs.length === 0 ? (
          <div className="bg-panel px-4 py-6 text-center">
            <div className="text-[12.5px] text-dim">It knows nothing yet</div>
            <p className="mx-auto mt-1 max-w-[400px] text-[11.5px] leading-relaxed text-muted">
              Answer its questions, or just tell it something above.
            </p>
          </div>
        ) : (
          beliefs.map((b) => {
            const tone = SOURCE_TONE[b.source] ?? SOURCE_TONE.watched
            return (
              <div
                key={b.id}
                className={`group flex items-start gap-2.5 border-b border-line bg-panel px-3 py-2.5 last:border-b-0 ${
                  b.stale ? 'opacity-60' : ''
                }`}
              >
                <span
                  className={`mt-[1px] shrink-0 rounded px-1.5 text-[9px] font-semibold leading-[1.7] ${tone.tint}`}
                >
                  {tone.label}
                </span>

                <div className="min-w-0 flex-1">
                  {correcting === b.id ? (
                    <input
                      autoFocus
                      className="input w-full text-[12px]"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => setCorrecting(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setCorrecting(null)
                        if (e.key === 'Enter' && draft.trim()) {
                          setCorrecting(null)
                          run(() => ipc.botBeliefCorrect(bot.node_id, b.id, draft.trim()))
                        }
                      }}
                    />
                  ) : (
                    <div className="text-[12px] leading-[1.5] text-body">{b.text}</div>
                  )}
                  {b.was && (
                    <div className="mt-0.5 text-[10.5px] text-faint">
                      was <span className="line-through">{b.was}</span>
                    </div>
                  )}
                  {b.stale && (
                    <div className="mt-0.5 text-[10.5px] text-warn">
                      It worked this out and has not used it since. Still true?
                    </div>
                  )}
                </div>

                {b.uses > 0 && (
                  <span className="shrink-0 text-[10px] text-faint">used {b.uses}&times;</span>
                )}
                <Ago iso={b.created_at} />

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className={`rounded p-1 hover:bg-hover ${b.pinned ? 'text-warn' : 'text-faint hover:text-dim'}`}
                    title={b.pinned ? 'Let it age again' : 'Keep this whatever happens'}
                    onClick={() => run(() => ipc.botBeliefPin(bot.node_id, b.id, !b.pinned))}
                  >
                    <Icon name="pin" size={12} />
                  </button>
                  <button
                    className="rounded p-1 text-faint hover:bg-hover hover:text-dim"
                    title="Correct it"
                    onClick={() => {
                      setDraft(b.text)
                      setCorrecting(b.id)
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    className="rounded p-1 text-faint hover:bg-hover hover:text-err"
                    title="Drop it"
                    onClick={() => run(() => ipc.botBeliefDrop(bot.node_id, b.id))}
                  >
                    <Icon name="delete" size={12} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {stale.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-2.5">
          <Icon name="history" size={13} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 text-[11.5px] text-muted">
            {stale.length} thing{stale.length === 1 ? '' : 's'} it worked out and stopped using.
            Nothing you told it is ever in here.
          </span>
          <button
            className="btn-ghost shrink-0 text-[11px]"
            onClick={() => run(() => ipc.botBeliefDropStale(bot.node_id))}
          >
            Let them go
          </button>
        </div>
      )}

      {/* The transcript. Second, because what it knows matters more than how it
          came to know it — but you must be able to see both. */}
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <button
          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover"
          onClick={() => setShowScript((v) => !v)}
        >
          <Icon name={showScript ? 'chevron-down' : 'chevron-right'} size={12} className="text-muted" />
          <span className="text-[11.5px] text-dim">What it asked you</span>
          <span className="ml-auto text-[10.5px] text-faint">
            {interview?.done ? 'finished' : `${interview?.step ?? 0} of ${interview?.script.length ?? 6}`}
          </span>
        </button>

        {showScript && interview && (
          <div className="border-t border-line">
            {interview.script.map((q, i) => {
              const a = interview.answers.find((x) => x.step === i)
              return (
                <button
                  key={q}
                  className="block w-full border-b border-line px-3.5 py-2.5 text-left last:border-b-0 hover:bg-hover/40"
                  title={a ? 'Change this answer' : 'Answer this one'}
                  onClick={() => setAskAt(i)}
                >
                  <div className="text-[11.5px] text-muted">{q}</div>
                  {a ? (
                    a.skipped ? (
                      <div className="mt-0.5 text-[11.5px] italic text-faint">you skipped this</div>
                    ) : (
                      <div className="mt-0.5 text-[12px] text-body">{a.answer}</div>
                    )
                  ) : (
                    <div className="mt-0.5 text-[11.5px] text-faint">not asked yet</div>
                  )}
                </button>
              )
            })}
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <button
                className="btn-ghost text-[11px]"
                onClick={() => {
                  if (!confirm('Start the questions again? What it took from the last run goes.'))
                    return
                  run(() => ipc.botInterviewReset(bot.node_id))
                }}
              >
                Ask me again
              </button>
              <span className="text-[10.5px] text-faint">
                Or click any question above to change just that one. Anything you told it another
                way stays.
              </span>
            </div>
          </div>
        )}
      </div>

      {askAt != null && (
        <BotInterview
          bot={bot}
          startStep={askAt}
          onClose={() => setAskAt(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
