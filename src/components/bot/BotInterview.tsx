// The interview: a script the bot follows, not a chat it improvises.
//
// The script is on screen the whole time. That is the point — an open
// conversation gets you a different bot every time and no way to tell whether it
// has enough to be useful. Six questions you can read means you know what it is
// about to ask, you can skip one, and "it understands this space" becomes a
// thing with an answer.
//
// What it takes from an answer is shown the moment you give it, rather than
// accumulated quietly and revealed later.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'

export function BotInterview({
  bot,
  onClose,
  onChanged,
  startStep,
}: {
  bot: ipc.Bot
  onClose: () => void
  onChanged: () => void
  /// Open on one question rather than the next unanswered one, so a single
  /// answer can be changed without redoing the whole script.
  startStep?: number
}) {
  const [view, setView] = useState<ipc.Interview | null>(null)
  const [at, setAt] = useState<number | null>(startStep ?? null)
  const [answer, setAnswer] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void ipc
      .botInterview(bot.node_id)
      .then((v) => {
        setView(v)
        if (startStep != null) {
          setAnswer(v.answers.find((a) => a.step === startStep)?.answer ?? '')
        }
      })
      .catch((e) => setErr(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.node_id])

  useEffect(() => {
    box.current?.focus()
  }, [view?.step, at])

  // Which question is on screen: the one you picked, or the next unanswered.
  const step = at ?? view?.step ?? 0

  const send = (skipped: boolean) => {
    if (!view || busy) return
    const text = answer.trim()
    if (!skipped && !text) return
    setBusy(true)
    setErr('')
    void ipc
      .botAnswer(bot.node_id, step, text, skipped)
      .then((next) => {
        setJustSaved(skipped ? '' : text)
        setAnswer('')
        setAt(null)
        setView(next)
        onChanged()
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false))
  }

  const done = at == null && (view?.done ?? false)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[8vh]" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[620px] flex-col rounded-xl border border-line2 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
            <Icon name="bot" size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink">{bot.name} is asking</div>
            <div className="text-[11px] text-muted">
              It asks before it acts. You can skip any of them.
            </div>
          </div>
          <button className="btn-ghost text-[11.5px]" onClick={onClose}>
            {done ? 'Done' : 'Finish later'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* The script, visible, so you can see where it is going. */}
          <div className="border-b border-line">
            <div className="px-4 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              Its script — {Math.min(step + (done ? 0 : 1), view?.script.length ?? 6)} of{' '}
              {view?.script.length ?? 6}
            </div>
            {view?.script.map((q, i) => {
              const a = view.answers.find((x) => x.step === i)
              const live = !done && i === step
              return (
                <button
                  key={q}
                  className={`flex w-full items-center gap-2.5 border-t border-line px-4 py-1.5 text-left text-[11.5px] hover:bg-hover/40 ${
                    live ? 'bg-indigo-500/[0.06]' : ''
                  }`}
                  title={a ? 'Change this answer' : 'Answer this one now'}
                  onClick={() => {
                    setAt(i)
                    setAnswer(a && !a.skipped ? a.answer : '')
                  }}
                >
                  <span
                    className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full ${
                      a
                        ? a.skipped
                          ? 'bg-hover text-faint'
                          : 'bg-emerald-500/20 text-ok'
                        : live
                          ? 'bg-indigo-500/25 text-indigo-400'
                          : 'bg-hover'
                    }`}
                  >
                    {a ? (
                      <Icon name={a.skipped ? 'close' : 'check'} size={9} />
                    ) : live ? (
                      <Icon name="chevron-right" size={9} />
                    ) : null}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${live ? 'text-ink' : 'text-muted'}`}>
                    {q}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-3 px-4 py-4">
            {done ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Icon name="check" size={22} className="text-ok" />
                <div className="text-[13px] text-ink">It has what it asked for</div>
                <p className="max-w-[380px] text-[11.5px] leading-relaxed text-muted">
                  Everything it took is on the “Knows” tab, where you can correct or delete any of
                  it. Tell it more whenever you like.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-ok">
                    <Icon name="bot" size={13} />
                  </span>
                  <div className="pt-[3px] text-[13px] leading-[1.5] text-body">
                    {view?.script[step]}
                  </div>
                </div>

                <textarea
                  ref={box}
                  className="input w-full min-h-[92px] resize-none text-[12.5px] leading-[1.6]"
                  placeholder="In your own words…"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(false)
                  }}
                />

                <div className="flex items-center gap-2">
                  <button
                    className="btn-primary text-[12px]"
                    disabled={!answer.trim() || busy}
                    onClick={() => send(false)}
                  >
                    {view?.answers.some((a) => a.step === step) ? 'Change it' : 'Answer'}
                  </button>
                  <button className="btn-ghost text-[12px]" disabled={busy} onClick={() => send(true)}>
                    Skip this one
                  </button>
                  <span className="ml-auto text-[10.5px] text-faint">Ctrl+Enter</span>
                </div>
              </>
            )}

            {justSaved && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-3.5 py-2.5">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ok">
                  Writing that down
                </div>
                <div className="mt-1 text-[12px] leading-[1.5] text-body">{justSaved}</div>
                <p className="mt-1.5 text-[10.5px] text-faint">
                  Kept in your personal store. Correct or delete it any time on “Knows”.
                </p>
              </div>
            )}

            {err && <div className="text-[11.5px] text-err">{err}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
