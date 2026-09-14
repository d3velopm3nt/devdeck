// The life step of the first run: your home, filled in from what the mail
// already suggests, corrected by you.
//
// It starts from the people you actually write to rather than a blank form
// about your family, and asks only what it cannot work out: what somebody is
// to you, and who it missed. Everything saved here is a record in the
// personal store; nothing about a person ever goes into a space.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { aiw, type PersonView } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { Err, Frame, Header } from './LearnStep'
import type { SetupNav } from './steps'

/// What somebody usually is. In words, because a role is a word and not a
/// code: "wife" is stored as "wife".
const ROLES = ['partner', 'child', 'parent', 'sibling', 'friend', 'pet', 'helps at home'] as const
type Role = (typeof ROLES)[number]

/// Which roles mean "lives with you". A parent may, a sibling may not, and
/// a guess either way is wrong for half the people: those ask.
const AT_HOME: Record<Role, boolean | null> = {
  partner: true,
  child: true,
  parent: null,
  sibling: null,
  friend: false,
  pet: true,
  'helps at home': false,
}

interface Draft {
  key: string
  name: string
  email: string
  role: Role | ''
  home: boolean
  kind: 'person' | 'pet'
  birthday: string
  /// Where the suggestion came from, so a row can say so.
  why: string
  saved?: PersonView
}

const blank = (): Draft => ({
  key: `new-${Date.now()}`,
  name: '',
  email: '',
  role: '',
  home: true,
  kind: 'person',
  birthday: '',
  why: 'you',
})

export function LifeStep({
  onDone,
  onClose,
  nav,
}: {
  onDone: () => void
  onClose?: () => void
  nav?: SetupNav
}) {
  const [rows, setRows] = useState<Draft[]>([])
  const [adding, setAdding] = useState<Draft>(blank())
  const [free, setFree] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [people, known] = await Promise.all([ipc.learnPeople(12), aiw.people()])
        if (!live) return
        // Already on file first, then the mail's suggestions that are not.
        const onFile: Draft[] = known.map((p) => ({
          key: p.id,
          name: p.name,
          email: p.emails[0] ?? '',
          role: (ROLES.find((r) => r === p.role) ?? '') as Role | '',
          home: p.home,
          kind: p.kind === 'pet' ? 'pet' : 'person',
          birthday: p.birthday,
          why: p.source === 'mail' ? 'from your mail' : 'you told me',
          saved: p,
        }))
        const seen = new Set(known.flatMap((p) => p.emails.map((e) => e.toLowerCase())))
        const fromMail: Draft[] = people
          .filter((c) => !seen.has(c.email.toLowerCase()))
          .slice(0, 8)
          .map((c) => ({
            key: `mail-${c.contact_id}`,
            name: c.name || c.email,
            email: c.email,
            role: '',
            home: false,
            kind: 'person',
            birthday: '',
            why: `${c.threads} threads, and you wrote back ${c.sent} times`,
          }))
        setRows([...onFile, ...fromMail])
      } catch (e) {
        if (live) setErr(String(e))
      } finally {
        if (live) setLoaded(true)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const setRole = (key: string, role: Role) =>
    setRows((cur) =>
      cur.map((r) =>
        r.key === key
          ? {
              ...r,
              role,
              kind: role === 'pet' ? 'pet' : 'person',
              home: AT_HOME[role] ?? r.home,
            }
          : r,
      ),
    )

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      for (const r of rows) {
        if (!r.role) continue
        const p: PersonView = {
          id: r.saved?.id ?? '',
          name: r.name.trim(),
          kind: r.kind,
          role: r.role,
          home: r.home,
          birthday: r.birthday,
          emails: r.email ? [r.email] : (r.saved?.emails ?? []),
          private: r.saved?.private ?? [],
          source: r.saved?.source ?? (r.why === 'you' ? 'you' : 'mail'),
          created_at: r.saved?.created_at ?? '',
          notes: r.saved?.notes ?? '',
        }
        await aiw.personSave(p)
      }
      // What you typed in your own words is kept as said, as a note about
      // you, until a later run turns it into records.
      if (free.trim()) {
        await aiw.remember(`About your life: ${free.trim()}`, free.trim(), ['life', 'you-told-me'])
      }
      onDone()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const named = rows.filter((r) => r.role).length

  return (
    <Frame step="life" onClose={onClose} nav={nav}>
      <Header
        icon="contacts"
        title="Who is in your life"
        text="From your mail I think these are the people closest to you. Tell me what each of them is to you, and who I missed. I only ask what I cannot work out myself."
      />

      <div className="rounded-[10px] border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[12.5px] font-semibold text-ink">Your people</span>
          <span className="ml-auto text-[10.5px] text-faint">each row says what it is based on</span>
        </div>
        {!loaded && <div className="px-4 py-3 text-[12px] text-muted">Reading…</div>}
        {loaded && rows.length === 0 && (
          <div className="px-4 py-3 text-[12px] text-muted">
            Nobody yet. Add the people you live with below.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-2 border-t border-line px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">
                  {r.name}
                  {r.role && (
                    <span className="text-muted">
                      {' '}
                      is your {r.role}
                      {r.home ? ', and lives with you' : ''}
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] text-faint">{r.why}</div>
              </div>
              {r.role && (
                <label className="flex items-center gap-1.5 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={r.home}
                    onChange={(e) =>
                      setRows((cur) =>
                        cur.map((x) => (x.key === r.key ? { ...x, home: e.target.checked } : x)),
                      )
                    }
                  />
                  lives with you
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((role) => (
                <button
                  key={role}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    r.role === role
                      ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                      : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => setRole(r.key, role)}
                >
                  {role}
                </button>
              ))}
              <button
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  r.role === '' && r.why !== 'you'
                    ? 'border-line2 text-faint'
                    : 'border-line2 text-dim hover:text-ink'
                }`}
                title="Not family, not a friend — leave them out"
                onClick={() =>
                  setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, role: '' } : x)))
                }
              >
                not one of these
              </button>
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Anyone I missed?
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_150px_150px_auto] items-center gap-2">
            <input
              className="input text-[12px]"
              placeholder="name"
              value={adding.name}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            />
            <select
              className="input text-[12px]"
              value={adding.role}
              onChange={(e) => {
                const role = e.target.value as Role | ''
                setAdding({
                  ...adding,
                  role,
                  kind: role === 'pet' ? 'pet' : 'person',
                  home: role ? (AT_HOME[role] ?? true) : true,
                })
              }}
            >
              <option value="">what they are</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              className="input text-[12px]"
              type="date"
              title="birthday, if you like"
              value={adding.birthday}
              onChange={(e) => setAdding({ ...adding, birthday: e.target.value })}
            />
            <button
              className="btn-ghost text-[12px]"
              disabled={!adding.name.trim() || !adding.role}
              onClick={() => {
                setRows((cur) => [...cur, { ...adding, key: `new-${Date.now()}` }])
                setAdding(blank())
              }}
            >
              <Icon name="add" size={11} /> Add
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Or just tell me, in your own words
        </span>
        <textarea
          className="w-full resize-none rounded-[8px] border border-line2 bg-panel p-3 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-indigo-500"
          rows={3}
          placeholder="Pepper is our cat, she is three. Emma is allergic to peanuts."
          value={free}
          onChange={(e) => setFree(e.target.value)}
        />
      </div>

      {err && <Err>{err}</Err>}

      <div className="flex items-center gap-3">
        <button className="btn-primary text-[12px]" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : named > 0 || free.trim() ? 'Save and continue' : 'Continue'}
        </button>
        <span className="text-[11px] text-muted">
          {named} {named === 1 ? 'person' : 'people'} named. You can add more any time.
        </span>
      </div>

      <div className="flex gap-2.5 border-t border-line pt-4">
        <Icon name="secret" size={15} className="mt-0.5 shrink-0 text-muted" />
        <p className="m-0 text-[11.5px] leading-relaxed text-muted">
          Each person is a file in your personal store, outside every space and repository. A Home
          space refers to them by name and never copies anything private. Health details are
          shown on their page and never put in a bulk read.
        </p>
      </div>
    </Frame>
  )
}
