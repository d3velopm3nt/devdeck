// GitHub sign-in, as a three-beat flow: ask → approve on github.com → done.
//
// The device flow's whole trick is that the code is the interface. So the code
// gets the room: big, monospaced, letter-spaced, with copy and open sitting
// right under it. Everything else on the screen is subordinate to it.
//
// The polling loop lives here rather than in Rust deliberately — the backend
// answers one poll per call, so this component owns the cadence, the countdown,
// and the cancel. A sleep loop in Rust would hold a worker for fifteen minutes
// and be unable to tell you how long was left.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'

type Stage =
  | { s: 'idle' }
  | { s: 'starting' }
  /** We have a code and are waiting on the human. */
  | { s: 'waiting'; start: ipc.DeviceStart; left: number; opened: boolean }
  | { s: 'done'; login: string; gh: boolean }
  | { s: 'error'; message: string; retryable: boolean }

export function SignInModal({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const [stage, setStage] = useState<Stage>({ s: 'idle' })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)

  // Cancellation: every async hop checks this before touching state, so
  // closing the modal mid-poll doesn't resurrect it.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    void ipc
      .githubOauthConfigured()
      .then((c) => alive.current && setConfigured(c))
      .catch(() => alive.current && setConfigured(false))
  }, [])

  // Esc closes, except mid-poll where it would silently abandon a code the
  // user may already be typing into GitHub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage.s !== 'waiting') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage.s, onClose])

  const begin = useCallback(() => {
    setStage({ s: 'starting' })
    void ipc
      .githubDeviceStart()
      .then((start) => {
        if (!alive.current) return
        setStage({ s: 'waiting', start, left: start.expires_in, opened: false })
      })
      .catch((e) => {
        if (!alive.current) return
        setStage({ s: 'error', message: String(e), retryable: true })
      })
  }, [])

  // The poll loop. Re-armed by each tick rather than by an interval, so a
  // `slow_down` from GitHub actually slows us down.
  useEffect(() => {
    if (stage.s !== 'waiting') return
    const { start } = stage
    let timer: ReturnType<typeof setTimeout>
    let interval = start.interval
    let stopped = false

    const poll = () => {
      void ipc
        .githubDevicePoll(start.device_code, interval)
        .then((r) => {
          if (stopped || !alive.current) return
          if (r.kind === 'pending') {
            interval = Math.max(interval, r.interval)
            timer = setTimeout(poll, interval * 1000)
            return
          }
          if (r.kind === 'done') {
            setStage({ s: 'done', login: r.login, gh: r.gh })
            onSignedIn()
            return
          }
          setStage({ s: 'error', message: r.message, retryable: r.retryable })
        })
        .catch((e) => {
          if (stopped || !alive.current) return
          setStage({ s: 'error', message: String(e), retryable: true })
        })
    }

    timer = setTimeout(poll, interval * 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // Keyed on the device code: a new code means a new loop, and a re-render
    // from the countdown must not restart this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.s === 'waiting' ? stage.start.device_code : null])

  // The countdown, separately — the code really does expire, and a dead code
  // that still looks alive is the worst version of this screen.
  useEffect(() => {
    if (stage.s !== 'waiting') return
    const id = setInterval(() => {
      setStage((cur) => {
        if (cur.s !== 'waiting') return cur
        const left = cur.left - 1
        return left <= 0
          ? { s: 'error', message: 'That code expired. Start again for a fresh one.', retryable: true }
          : { ...cur, left }
      })
    }, 1000)
    return () => clearInterval(id)
  }, [stage.s === 'waiting' ? stage.start.device_code : null])

  const copyCode = (code: string) => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        setTimeout(() => alive.current && setCopied(false), 1600)
      })
      .catch(() => {})
  }

  const openGitHub = (uri: string) => {
    void ipc.openUrl(uri)
    setStage((cur) => (cur.s === 'waiting' ? { ...cur, opened: true } : cur))
  }

  const busy = stage.s === 'starting' || stage.s === 'waiting'

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-6"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-[440px] overflow-hidden rounded-xl border border-line2 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Icon name="github" size={16} className="shrink-0 text-body" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">Sign in to GitHub</div>
            <div className="truncate text-[11px] text-muted">
              So DevDeck can read your repos and push as you.
            </div>
          </div>
          {!busy && (
            <button
              className="ml-auto flex items-center rounded px-2 py-1 text-muted hover:bg-hover hover:text-ink"
              onClick={onClose}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="px-5 py-5">
          {/* This build has no OAuth app — say so plainly rather than offering
              a button that can only fail. */}
          {configured === false && stage.s === 'idle' && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <Icon name="alert" size={26} className="text-warn" />
              <div className="text-[13px] font-medium text-ink">Sign-in isn’t configured in this build</div>
              <div className="max-w-[330px] text-[11.5px] leading-relaxed text-muted">
                It needs a GitHub OAuth app’s client id. Register one, enable Device Flow, and set it in{' '}
                <span className="font-mono text-[11px] text-dim">src-tauri/src/github.rs</span>.
              </div>
            </div>
          )}

          {configured === true && stage.s === 'idle' && (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/15">
                <Icon name="github" size={22} className="text-indigo-400" />
              </span>
              <div className="max-w-[320px] text-[12.5px] leading-relaxed text-body">
                We’ll show you a short code to enter on github.com. No password ever comes through DevDeck.
              </div>
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-400"
                onClick={begin}
              >
                <Icon name="github" size={14} /> Continue with GitHub
              </button>
            </div>
          )}

          {stage.s === 'starting' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Icon name="spinner" size={22} spin className="text-indigo-400" />
              <div className="text-[12.5px] text-muted">Asking GitHub for a code…</div>
            </div>
          )}

          {stage.s === 'waiting' && (
            <div className="flex flex-col gap-4">
              <div className="text-center text-[12px] text-muted">
                Enter this code on GitHub to finish signing in.
              </div>

              {/* The code, given the room it deserves. */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-full rounded-lg border border-line2 bg-raise py-4 text-center font-mono text-[26px] font-bold tracking-[0.22em] text-ink">
                  {stage.start.user_code}
                </div>
                <div className="flex w-full gap-2">
                  <button
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line2 bg-raise px-3 py-2 text-[12px] font-medium text-body hover:bg-hover hover:text-ink"
                    onClick={() => copyCode(stage.start.user_code)}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={13} className={copied ? 'text-ok' : ''} />
                    {copied ? 'Copied' : 'Copy code'}
                  </button>
                  <button
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-[12px] font-semibold text-white hover:bg-indigo-400"
                    onClick={() => openGitHub(stage.start.verification_uri)}
                  >
                    <Icon name="external" size={13} />
                    {stage.opened ? 'Open again' : 'Open GitHub'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-line bg-raise px-3 py-2">
                <Icon name="spinner" size={13} spin className="shrink-0 text-indigo-400" />
                <span className="text-[11.5px] text-body">Waiting for you to approve…</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{mmss(stage.left)}</span>
              </div>

              <button
                className="self-center rounded px-2 py-1 text-[11.5px] text-muted hover:bg-hover hover:text-ink"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          )}

          {stage.s === 'done' && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <Icon name="ok" size={24} className="text-ok" />
              </span>
              <div className="text-[13.5px] font-semibold text-ink">Signed in as {stage.login}</div>
              {/* An honest note, not a footnote: without gh the chip is signed
                  in and `git push` is not, and the user should hear it here. */}
              <div className="max-w-[330px] text-[11.5px] leading-relaxed text-muted">
                {stage.gh
                  ? 'The GitHub CLI and git are signed in with the same account.'
                  : 'The GitHub CLI (gh) isn’t installed, so git pushes still use your existing credentials.'}
              </div>
              <button
                className="mt-1 w-full rounded-lg bg-indigo-500 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-400"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          )}

          {stage.s === 'error' && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
                <Icon name="alert" size={22} className="text-err" />
              </span>
              <div className="text-[13px] font-medium text-ink">Sign-in didn’t finish</div>
              <div className="max-w-[330px] text-[11.5px] leading-relaxed text-muted">{stage.message}</div>
              <div className="mt-1 flex w-full gap-2">
                <button
                  className="flex-1 rounded-lg border border-line2 bg-raise px-3 py-2 text-[12px] font-medium text-body hover:bg-hover hover:text-ink"
                  onClick={onClose}
                >
                  Close
                </button>
                {stage.retryable && (
                  <button
                    className="flex-1 rounded-lg bg-indigo-500 px-3 py-2 text-[12px] font-semibold text-white hover:bg-indigo-400"
                    onClick={begin}
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function mmss(total: number) {
  const m = Math.floor(Math.max(0, total) / 60)
  const s = Math.max(0, total) % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
