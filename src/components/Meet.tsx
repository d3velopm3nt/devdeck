import { useEffect, useState } from 'react'
import { aiw, type Voice } from '../lib/aiw'
import { Icon } from '../lib/icons'

/**
 * The first run — the only screen in DevDeck that has never existed.
 *
 * Until now you landed in an empty tree with an assistant whose instructions
 * said it was "the developer's assistant", and nothing anywhere had ever asked
 * your name. Everything the assistant says afterwards is shaped by what is
 * collected here, so this screen is deliberately three questions and no more:
 * a first run that asks twenty things is one people click through.
 *
 * What it writes lands in two different places on purpose, and the footer says
 * so out loud, because this is the moment that trust is either earned or lost.
 */
export function Meet({ onDone }: { onDone: () => void }) {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [pick, setPick] = useState('plain')
  const [own, setOwn] = useState('')
  const [writingOwn, setWritingOwn] = useState(false)
  const [name, setName] = useState('')
  const [assistantName, setAssistantName] = useState('Assistant')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    aiw
      .voices()
      .then((v) => {
        if (!live) return
        setVoices(v)
        if (v.length) setPick(v[0].id)
      })
      // A failure here is not cosmetic: with no voices there is nothing to
      // pick, and silently showing an empty row would look like a broken
      // screen rather than a backend that did not answer.
      .catch((e) => live && setErr(String(e)))
    return () => {
      live = false
    }
  }, [])

  const go = async () => {
    setErr('')
    setBusy(true)
    try {
      await aiw.meet(name, assistantName, pick, writingOwn ? own : '')
      onDone()
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  const ready = name.trim().length > 0 && (!writingOwn || own.trim().length > 0)

  return (
    <div className="flex h-full flex-col overflow-auto bg-page text-body">
      <div className="flex min-h-0 flex-grow items-center justify-center p-8">
        <div className="flex w-full max-w-[780px] flex-col gap-7">
          <div className="flex items-start gap-4">
            <span className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[14px] bg-indigo-500/15">
              <Icon name="ai" size={22} className="text-indigo-400" />
            </span>
            <div>
              <div className="text-[24px] font-semibold tracking-tight text-ink">
                Before we start
              </div>
              <p className="mt-2 max-w-[620px] text-[13.5px] leading-relaxed text-dim">
                You are going to talk to me every day, so it matters how I talk back. Pick a way and
                change it whenever you like — it is a file, not a setting.
              </p>
            </div>
          </div>

          <div>
            <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              How I should talk to you
            </div>

            {voices === null && !err ? (
              <div className="text-[12px] text-muted">Reading the voices…</div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {(voices ?? []).map((v) => {
                  const on = !writingOwn && pick === v.id
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        setPick(v.id)
                        setWritingOwn(false)
                      }}
                      className={`flex flex-col gap-2.5 rounded-[10px] border p-3.5 text-left transition-colors ${
                        on
                          ? 'border-indigo-500 bg-raise'
                          : 'border-line bg-panel hover:border-line2'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[13.5px] font-semibold ${on ? 'text-ink' : 'text-dim'}`}
                        >
                          {v.name}
                        </span>
                        {on && (
                          <span className="ml-auto text-indigo-400">
                            <Icon name="check" size={15} />
                          </span>
                        )}
                      </div>
                      <p className="m-0 text-[12px] italic leading-relaxed text-body">
                        “{v.sample}”
                      </p>
                      <span className="mt-auto text-[10.5px] text-faint">{v.note}</span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="mt-2.5 text-[11.5px] text-muted">
              Or{' '}
              <button
                className="text-indigo-400 hover:text-ink"
                onClick={() => setWritingOwn((w) => !w)}
              >
                write your own
              </button>{' '}
              — it becomes the first line of my instructions.
            </div>

            {writingOwn && (
              <textarea
                autoFocus
                value={own}
                onChange={(e) => setOwn(e.target.value)}
                rows={3}
                placeholder="Talk to me like a chief of staff. Assume I am busy and skip the context I already have."
                className="mt-2 w-full resize-none rounded-[8px] border border-line2 bg-panel p-3 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-indigo-500"
              />
            )}
          </div>

          <div className="flex items-end gap-5">
            <div className="flex-grow">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                What to call you
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="your name"
                className="w-full rounded-[8px] border border-line2 bg-panel px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-indigo-500"
              />
            </div>
            <div className="flex-grow">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                What to call me
              </div>
              <input
                value={assistantName}
                onChange={(e) => setAssistantName(e.target.value)}
                className="w-full rounded-[8px] border border-line2 bg-panel px-3 py-2 text-[12.5px] text-ink outline-none focus:border-indigo-500"
              />
            </div>
            <button
              disabled={!ready || busy}
              onClick={() => void go()}
              className="flex-shrink-0 rounded-[6px] bg-indigo-600 px-4 py-2 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Next'}
            </button>
          </div>

          {err && (
            <div className="rounded-[8px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">
              {err}
            </div>
          )}

          <div className="flex gap-2.5 border-t border-line pt-4">
            <Icon name="secret" size={15} className="mt-0.5 flex-shrink-0 text-muted" />
            <p className="m-0 text-[11.5px] leading-relaxed text-muted">
              Everything I learn about <span className="text-body">you</span> is kept on this
              machine, outside any repository, and never leaves it. Everything I learn about a{' '}
              <span className="text-body">client or a project</span> is kept with that thing, in
              your vault. Two places, on purpose, so nothing personal ends up in a commit.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
