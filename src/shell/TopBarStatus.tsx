// The right-hand end of the top bar: who is working, what needs you, who you are.
//
// These replaced the Launch / Widget / Terminal buttons. The trade is
// deliberate: those were three ways to *start* something, in the corner you
// look at when you want to know whether anything needs you. Starting things
// lives in the DevDeck menu and on the project's own row now.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import { useAiw } from '../lib/aiwStore'
import { useApp } from '../store'
import { unreadFailures } from '../lib/inbox'
import { initials, severityStyle } from '../lib/aiw'
import * as ipc from '../lib/ipc'
import { githubUser, type GithubUser } from '../lib/ipc'
import { SignInModal } from '../components/SignInModal'
import { ProjectTag } from '../components/aiw/ProjectTag'
import { CAPTURE_BELL } from '../lib/devCapture'

// ---------------------------------------------------------------------------
// Who is working
// ---------------------------------------------------------------------------

export function AgentCluster() {
  const a = useAiw()
  const live = a.sessions.filter((s) => s.status === 'working' || s.status === 'planning')
  if (live.length === 0) return null

  // Overlapping avatars, oldest first, capped. A row that grows without bound
  // pushes the things you can act on off the edge of the bar.
  const shown = live.slice(0, 4)
  const rest = live.length - shown.length

  return (
    <div
      className="flex items-center"
      title={live.map((s) => `${s.agent_name} · ${s.feature_id}`).join('\n')}
    >
      {shown.map((s, i) => (
        <span
          key={s.id}
          className="flex h-[21px] w-[21px] items-center justify-center rounded-full border-[1.5px] border-panel bg-indigo-500/15 text-[8.5px] font-bold text-indigo-300"
          style={i > 0 ? { marginLeft: -6 } : undefined}
        >
          {initials(s.agent_name)}
        </span>
      ))}
      {rest > 0 && (
        <span
          className="flex h-[21px] w-[21px] items-center justify-center rounded-full border-[1.5px] border-panel bg-hover text-[8.5px] font-bold text-dim"
          style={{ marginLeft: -6 }}
        >
          +{rest}
        </span>
      )}
      <span className="ml-2 text-[10.5px] text-muted">{live.length} working</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// What needs you
// ---------------------------------------------------------------------------

export function NotificationBell() {
  const a = useAiw()
  const activity = useApp((s) => s.activity)
  const inboxRead = useApp((s) => s.inboxRead)
  const inboxFloor = useApp((s) => s.inboxFloor)
  const inboxLoaded = useApp((s) => s.inboxLoaded)
  const setRailView = useApp((s) => s.setRailView)
  // Screenshot harness: this panel only exists while it is being clicked.
  const [open, setOpen] = useState(CAPTURE_BELL)
  const wrap = useRef<HTMLDivElement>(null)

  const approvals = a.approvals
  const blockers = a.conflicts.filter((c) => !c.resolved)
  // Things that broke and have not been looked at. This corner is where you
  // check whether anything needs you, and until now a stopped agent was the
  // one kind of "needs you" it could not say — you had to go and find it.
  // Under the harness, what has been read is shown anyway: every screenshot
  // taken after reading the Inbox would otherwise be of an empty panel.
  const marks = { read: inboxRead, floor: inboxFloor, loaded: inboxLoaded }
  const broken = (CAPTURE_BELL ? activity.filter((x) => !x.ok) : unreadFailures(activity, marks))
    .slice(0, 5)
  const total = approvals.length + blockers.length + broken.length

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative">
      <button
        className={`relative flex items-center rounded p-1 ${
          open ? 'bg-hover text-ink' : 'text-dim hover:text-ink'
        }`}
        title={total === 0 ? 'Nothing needs you' : `${total} need${total === 1 ? 's' : ''} you`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="alert" size={15} />
        {/* Three states, worst first: red for something broken, amber for
            something waiting on an answer, grey for a disagreement to read.
            A badge that goes amber for a suggestion teaches you to ignore it
            when an agent is genuinely stopped — and one that never goes red
            leaves you finding that out for yourself. */}
        {total > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full border-[1.5px] border-panel px-[3px] text-[8.5px] font-bold ${
              broken.length > 0
                ? 'bg-red-500 text-white'
                : approvals.length > 0
                  ? 'bg-amber-400 text-app'
                  : 'bg-line3 text-app'
            }`}
          >
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[380px] overflow-hidden rounded-md border border-line2 bg-menu shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <span className="text-[12.5px] font-semibold text-ink">Needs you</span>
            {total > 0 && <span className="text-[10.5px] text-muted">{total}</span>}
          </div>

          {total === 0 && (
            <div className="px-3.5 py-5 text-center text-[11.5px] text-muted">
              Nothing is waiting. Agents show up here when they need an answer, and when one
              stops.
            </div>
          )}

          {approvals.map((r) => (
            <div key={r.id} className="border-b border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-[19px] w-[19px] items-center justify-center rounded-full bg-amber-500/15 text-[8px] font-bold text-warn">
                  {initials(a.agents.find((x) => x.id === r.agent_id)?.name ?? r.agent_id)}
                </span>
                <span className="truncate text-[11.5px] text-ink">{r.summary}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  className="btn-primary px-2.5 py-0.5 text-[10.5px]"
                  onClick={() => void a.resolveApproval(r.id, 'allow')}
                >
                  Allow
                </button>
                <button
                  className="rounded border border-line2 px-2.5 py-0.5 text-[10.5px] text-dim hover:text-ink"
                  onClick={() => void a.resolveApproval(r.id, 'deny')}
                >
                  Deny
                </button>
                {r.project_id && (
                  <span className="ml-auto max-w-[130px] rounded bg-raise px-1.5 text-[9.5px] text-muted">
                    <ProjectTag id={r.project_id} />
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Under the approvals, not above them. An approval is the one
              thing here that expires — an agent waiting for an answer is
              denied when the wait runs out, and then it has failed too. What
              already broke will still be broken in a minute. */}
          {broken.map((x) => (
            <button
              key={x.id}
              className="flex w-full items-start gap-2.5 border-b border-red-500/20 bg-red-500/[0.06] px-3.5 py-2.5 text-left hover:bg-red-500/[0.10]"
              title="Open Needs you"
              onClick={() => {
                setOpen(false)
                setRailView('inbox')
              }}
            >
              <Icon name="alert" size={13} className="mt-px shrink-0 text-err" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-err">{x.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted">
                  {x.detail || x.kind}
                </div>
              </div>
              {x.project_name && (
                <span className="ml-1 shrink-0 rounded bg-raise px-1.5 text-[9.5px] text-muted">
                  {x.project_name}
                </span>
              )}
            </button>
          ))}

          {blockers.slice(0, 6).map((c) => {
            // `chip` carries both a tint and a text colour; the icon only
            // wants the latter, and taking the whole class string would paint
            // a background behind a bare glyph.
            const tone = severityStyle(c.severity).chip.split(' ').find((x) => x.startsWith('text-'))
            return (
              <button
                key={c.id}
                className="flex w-full items-start gap-2.5 border-b border-line px-3.5 py-2.5 text-left last:border-0 hover:bg-hover"
                onClick={() => {
                  setOpen(false)
                  a.setPage('conflicts')
                }}
              >
                <Icon name="conflict" size={13} className={`mt-px shrink-0 ${tone ?? 'text-dim'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-ink">{c.title}</div>
                  <div className="mt-0.5 flex min-w-0 items-baseline gap-1 text-[10px] text-muted">
                    <ProjectTag id={c.project_id} />
                    <span className="shrink-0">·</span>
                    <span className="truncate">{c.feature_id}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Who you are
// ---------------------------------------------------------------------------

export function AccountChip() {
  const [user, setUser] = useState<GithubUser | null>(null)
  const [open, setOpen] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    githubUser()
      .then(setUser)
      .catch(() => setUser(null))
  }, [])
  useEffect(() => load(), [load])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const signedIn = !!user?.login
  // Still checking: `null` is "we have not asked yet", which is not the same
  // as "nobody is signed in" and must not render as "Sign in".
  const checking = user === null

  const signOut = () => {
    setBusy(true)
    void ipc
      .githubSignOut(true)
      .catch(() => {})
      .finally(() => {
        setBusy(false)
        setOpen(false)
        load()
      })
  }

  return (
    <>
      <div ref={wrap} className="relative">
        <button
          className={`flex items-center gap-1.5 rounded-full border border-line py-[2px] pl-[2px] pr-2 ${
            open ? 'bg-hover' : 'bg-page hover:bg-hover'
          }`}
          // The reason matters when there is no login: "gh is not installed" and
          // "you are not signed in" need different things from you.
          title={
            signedIn
              ? `Signed in to GitHub as ${user.login}`
              : checking
                ? 'Checking GitHub…'
                : `${user?.reason || 'Not signed in to GitHub'} — click to sign in`
          }
          onClick={() => (signedIn ? setOpen(!open) : setSigningIn(true))}
        >
          <span
            className={`relative flex h-[21px] w-[21px] items-center justify-center rounded-full text-[9px] font-bold ${
              signedIn ? 'bg-indigo-500 text-white' : 'bg-hover text-muted'
            }`}
          >
            {signedIn ? initials(user.name || user.login) : <Icon name="github" size={11} />}
            {signedIn && (
              <span className="absolute -bottom-0.5 -right-0.5 h-[9px] w-[9px] rounded-full border-[1.5px] border-page bg-emerald-400" />
            )}
          </span>
          <span className={`text-[11.5px] ${signedIn ? 'text-body' : 'text-muted'}`}>
            {signedIn ? user.login : checking ? 'Checking…' : 'Sign in'}
          </span>
        </button>

        {open && signedIn && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-[220px] overflow-hidden rounded-md border border-line2 bg-menu shadow-2xl">
            <div className="border-b border-line px-3.5 py-2.5">
              <div className="truncate text-[12.5px] font-semibold text-ink">{user.name || user.login}</div>
              <div className="truncate text-[11px] text-muted">{user.login}</div>
            </div>
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false)
                void ipc.openUrl(`https://github.com/${user.login}`)
              }}
            >
              <Icon name="external" size={13} /> View profile
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false)
                load()
              }}
            >
              <Icon name="restart" size={13} /> Refresh
            </button>
            <div className="my-1 border-t border-line" />
            <button className="menu-item" disabled={busy} onClick={signOut}>
              <Icon name={busy ? 'spinner' : 'close'} size={13} spin={busy} /> Sign out
            </button>
          </div>
        )}
      </div>

      {signingIn && (
        <SignInModal onClose={() => setSigningIn(false)} onSignedIn={load} />
      )}
    </>
  )
}
