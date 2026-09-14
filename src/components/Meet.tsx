import { useEffect, useState } from 'react'
import { aiw, type Voice } from '../lib/aiw'
import * as ipc from '../lib/ipc'
import type { MailAccount } from '../lib/types'
import { Icon } from '../lib/icons'
import { GoogleButton } from './GoogleMark'
import { CAPTURE_MEET_STEP } from '../lib/devCapture'
import { LearnStep } from './setup/LearnStep'
import { LifeStep } from './setup/LifeStep'
import { HomeStep } from './setup/HomeStep'

export type MeetStep = 'voice' | 'mail' | 'learn' | 'life' | 'home'

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
export function Meet({
  onDone,
  onClose,
  start,
}: {
  onDone: () => void
  /** Leave setup where it is. The steps after mail can always be finished from Today. */
  onClose?: () => void
  start?: MeetStep
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [pick, setPick] = useState('plain')
  const [own, setOwn] = useState('')
  const [writingOwn, setWritingOwn] = useState(false)
  const [name, setName] = useState('')
  const [assistantName, setAssistantName] = useState('Assistant')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Two steps, and the first one is saved before the second begins. Closing
  // the window at the mail step must not lose the voice you just picked.
  const [step, setStep] = useState<MeetStep>(
    start ?? ((CAPTURE_MEET_STEP as MeetStep) || 'voice'),
  )
  // Screenshot harness: follow the flag when it changes under a hot reload,
  // so a shot of each step does not need a cold start each time.
  useEffect(() => {
    if (CAPTURE_MEET_STEP) setStep(CAPTURE_MEET_STEP as MeetStep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CAPTURE_MEET_STEP])
  const [googleReady, setGoogleReady] = useState(false)
  const [connected, setConnected] = useState<MailAccount[]>([])

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

    // Asked, not assumed. A build with no Google client must offer the step
    // honestly rather than show a button that can only apologise.
    void ipc
      .mailGoogleAvailable()
      .then((ok) => live && setGoogleReady(ok))
      .catch(() => live && setGoogleReady(false))

    return () => {
      live = false
    }
  }, [])

  const go = async () => {
    setErr('')
    setBusy(true)
    try {
      await aiw.meet(name, assistantName, pick, writingOwn ? own : '')
      setStep('mail')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const connectGoogle = async () => {
    setErr('')
    setBusy(true)
    try {
      const account = await ipc.mailGoogleConnect()
      // Re-connecting an address updates its row rather than adding one, so
      // the list here has to do the same or it shows the same mailbox twice.
      setConnected((all) => [...all.filter((a) => a.id !== account.id), account])
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const ready = name.trim().length > 0 && (!writingOwn || own.trim().length > 0)

  // The three steps after mail. Each can be skipped, and skipping one goes
  // on to the next rather than out: Not now on the learn run still offers
  // your home.
  // Closing is not skipping: it leaves setup where it is, and Today offers
  // to finish it. Before anyone has met, the voice step has already been
  // saved by the time these show, so closing is safe there too.
  const close = onClose ?? onDone
  if (step === 'learn') {
    return (
      <LearnStep onDone={() => setStep('life')} onSkip={() => setStep('life')} onClose={close} />
    )
  }
  if (step === 'life') {
    return <LifeStep onDone={() => setStep('home')} onClose={close} />
  }
  if (step === 'home') {
    return <HomeStep onDone={onDone} onSkip={onDone} onClose={close} />
  }

  if (step === 'mail') {
    return (
      <div className="flex h-full flex-col overflow-auto bg-page text-body">
        <div className="flex min-h-0 flex-grow items-center justify-center p-8">
          <div className="flex w-full max-w-[640px] flex-col gap-7">
            <div className="flex items-start gap-4">
              <span className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[14px] bg-indigo-500/15">
                <Icon name="mail" size={22} className="text-indigo-400" />
              </span>
              <div>
                <div className="text-[24px] font-semibold tracking-tight text-ink">
                  Where your life already is
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
                  Your mailbox knows your clients, your bills and who you actually talk to. Connect
                  it and I can stop asking you things you have already written down.
                </p>
              </div>
            </div>

            {connected.length > 0 && (
              <div className="rounded-[10px] border border-line bg-panel">
                {connected.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2.5 border-t border-line px-3.5 py-2.5 first:border-t-0"
                  >
                    <Icon name="check" size={15} className="text-ok" />
                    <span className="min-w-0 flex-grow truncate text-[12.5px] text-ink">
                      {a.address}
                    </span>
                    <span className="text-[10.5px] text-muted">connected</span>
                  </div>
                ))}
              </div>
            )}

            {googleReady ? (
              <div className="flex flex-col items-start gap-3">
                <GoogleButton
                  onClick={() => void connectGoogle()}
                  disabled={busy}
                  label={
                    busy
                      ? 'Waiting for your browser...'
                      : connected.length
                        ? 'Connect another account'
                        : 'Continue with Google'
                  }
                />
                <p className="m-0 text-[11px] leading-relaxed text-faint">
                  Google will say it has not verified this app. That is expected for a build
                  signing in with its own client. Click Advanced, then continue.
                </p>
              </div>
            ) : (
              <div className="rounded-[10px] border border-line bg-panel px-3.5 py-3">
                <div className="text-[12px] text-ink">Mail is set up in Settings</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  This build has no Google client configured, so there is no one-click sign-in. You
                  can add any mailbox, Gmail included, from the Mail page with an app password.
                </p>
              </div>
            )}

            {err && (
              <div className="rounded-[8px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">
                {err}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep('learn')}
                className="rounded-[6px] bg-indigo-600 px-4 py-2 text-[12px] text-white disabled:opacity-40"
                disabled={busy}
              >
                {connected.length ? 'Next' : 'Skip for now'}
              </button>
              {connected.length === 0 && (
                <span className="text-[11px] text-muted">
                  You can connect a mailbox any time from Mail.
                </span>
              )}
            </div>

            <div className="flex gap-2.5 border-t border-line pt-4">
              <Icon name="secret" size={15} className="mt-0.5 flex-shrink-0 text-muted" />
              <p className="m-0 text-[11.5px] leading-relaxed text-muted">
                Nothing is read until you connect, and nothing about a person is kept until you
                accept it one at a time. Messages carrying passwords, one-time codes or card
                numbers are skipped whole — not summarised, not stored — the same rule the Stash
                already applies to your clipboard.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

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
