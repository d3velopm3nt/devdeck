// Your life: the people, from the personal store.
//
// Home, then family, friends, pets and the people who help at home, each a
// record you can correct or forget. Questions about them are not here: they
// are in the Inbox, and this page only says how many are waiting. Nothing on
// this page is in a space or a repository, and no manager can read it.

import { useEffect, useState } from 'react'
import { aiw, type PersonView } from '../lib/aiw'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { useApp } from '../store'
import { relationGroup } from '../lib/relations'

const GROUPS: Array<{ key: string; title: string; note: string; pick: (p: PersonView) => boolean }> = [
  { key: 'home', title: 'Home', note: 'the people and animals you live with', pick: (p) => p.home },
  {
    key: 'family',
    title: 'Family',
    note: 'beyond your home',
    pick: (p) => !p.home && ['partner', 'child', 'parent', 'sibling'].includes(relationGroup(p.role, p.kind)),
  },
  { key: 'friends', title: 'Friends', note: 'people you choose to see', pick: (p) => !p.home && relationGroup(p.role, p.kind) === 'friend' },
  { key: 'pets', title: 'Pets', note: '', pick: (p) => !p.home && relationGroup(p.role, p.kind) === 'pet' },
  {
    key: 'help',
    title: 'Who helps',
    note: 'at home, or with something in it',
    pick: (p) => !p.home && relationGroup(p.role, p.kind) === 'other',
  },
]

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

export function LifePage() {
  const { setRailView } = useApp()
  const [people, setPeople] = useState<PersonView[]>([])
  const [waiting, setWaiting] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<PersonView | null>(null)

  const load = async () => {
    try {
      const [ps, facts] = await Promise.all([aiw.people(), ipc.learnFacts(0, 'proposed').catch(() => [])])
      setPeople(ps)
      setWaiting(facts.filter((f) => f.kind === 'you').length)
      setErr('')
    } catch (e) {
      setErr(String(e))
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const save = async (p: PersonView) => {
    try {
      await aiw.personSave(p)
      setDraft(null)
      await load()
    } catch (e) {
      setErr(String(e))
    }
  }
  const forget = async (p: PersonView) => {
    try {
      await aiw.personForget(p.id)
      setOpen(null)
      await load()
    } catch (e) {
      setErr(String(e))
    }
  }

  const selected = people.find((p) => p.id === open) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="shrink-0 border-b border-line px-6 py-4">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Your people</h1>
            <p className="mt-1 text-[12.5px] text-dim">
              Who is in your life, and what I know about each of them. All of it stays on this
              machine, outside every space.
            </p>
          </div>
          {waiting > 0 && (
            <button
              className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-1.5 text-[11.5px] text-ink hover:bg-indigo-500/10"
              onClick={() => setRailView('inbox')}
            >
              <Icon name="inbox" size={12} className="text-indigo-400" />
              {waiting} to confirm, in Inbox
            </button>
          )}
          <button
            className="btn-primary text-[11.5px]"
            onClick={() =>
              setDraft({
                id: '',
                name: '',
                kind: 'person',
                role: '',
                home: true,
                birthday: '',
                emails: [],
                private: [],
                source: 'you',
                created_at: '',
                notes: '',
              })
            }
          >
            Tell me about someone
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-5 overflow-auto px-6 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {err && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-err">
              {err}
            </div>
          )}
          {people.length === 0 && !err && (
            <div className="rounded-lg border border-line bg-panel px-4 py-6 text-center text-[12.5px] text-muted">
              Nobody on file yet. Finish setting up from Today, or tell me about someone.
            </div>
          )}
          {GROUPS.map((g) => {
            const rows = people.filter(g.pick)
            if (rows.length === 0) return null
            return (
              <section key={g.key}>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {g.title}
                  </span>
                  {g.note && <span className="text-[10px] text-faint">{g.note}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
                  {rows.map((p) => (
                    <button
                      key={p.id}
                      className={`flex flex-col gap-2 rounded-lg border bg-panel p-3 text-left ${
                        open === p.id ? 'border-indigo-500/50' : 'border-line hover:border-line3'
                      }`}
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-raise text-[11px] font-semibold text-dim">
                          {p.kind === 'pet' ? <Icon name="bot" size={14} /> : initials(p.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {p.role || (p.kind === 'pet' ? 'pet' : 'person')}
                          </span>
                        </span>
                      </div>
                      <span className="line-clamp-2 text-[11.5px] leading-relaxed text-body">
                        {p.notes || (p.birthday ? `Birthday ${p.birthday}` : 'Only a name so far.')}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}

          <div className="mt-auto flex gap-2.5 border-t border-line pt-3">
            <Icon name="secret" size={15} className="mt-0.5 shrink-0 text-muted" />
            <p className="m-0 text-[11.5px] leading-relaxed text-muted">
              Kept in your personal store, outside every space and repository. The managers and
              agents working on your businesses never see this page or anything on it.
            </p>
          </div>
        </div>

        {(selected || draft) && (
          <PersonPanel
            person={draft ?? selected!}
            editing={!!draft}
            onEdit={() => setDraft(selected)}
            onCancel={() => setDraft(null)}
            onSave={save}
            onForget={forget}
          />
        )}
      </div>
    </div>
  )
}

function PersonPanel({
  person,
  editing,
  onEdit,
  onCancel,
  onSave,
  onForget,
}: {
  person: PersonView
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (p: PersonView) => Promise<void>
  onForget: (p: PersonView) => Promise<void>
}) {
  const [d, setD] = useState<PersonView>(person)
  useEffect(() => setD(person), [person])
  const set = (patch: Partial<PersonView>) => setD({ ...d, ...patch })

  return (
    <div className="flex w-[340px] shrink-0 flex-col gap-3 self-start rounded-lg border border-line bg-panel p-4">
      {editing ? (
        <>
          <input
            className="input text-[13px] font-semibold"
            placeholder="name"
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select className="input text-[12px]" value={d.kind} onChange={(e) => set({ kind: e.target.value })}>
              <option value="person">person</option>
              <option value="pet">pet</option>
            </select>
            <input
              className="input text-[12px]"
              placeholder="wife · son · sister · dog"
              value={d.role}
              onChange={(e) => set({ role: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-body">
            <input type="checkbox" checked={d.home} onChange={(e) => set({ home: e.target.checked })} />
            lives with you
          </label>
          <input
            className="input text-[12px]"
            type="date"
            value={d.birthday}
            onChange={(e) => set({ birthday: e.target.value })}
          />
          <textarea
            className="w-full resize-none rounded-[8px] border border-line2 bg-page p-2.5 text-[12px] leading-relaxed text-ink outline-none focus:border-indigo-500"
            rows={4}
            placeholder="What I should know, in your words."
            value={d.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
          <textarea
            className="w-full resize-none rounded-[8px] border border-amber-500/30 bg-page p-2.5 text-[12px] leading-relaxed text-ink outline-none focus:border-amber-500"
            rows={2}
            placeholder="Private: health and the like. Never in a bulk read."
            value={d.private.join('\n')}
            onChange={(e) => set({ private: e.target.value.split('\n') })}
          />
          <div className="flex items-center gap-2">
            <button className="btn-primary text-[12px]" disabled={!d.name.trim()} onClick={() => void onSave(d)}>
              Save
            </button>
            <button className="btn-ghost text-[12px]" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-raise text-[14px] font-semibold text-dim">
              {person.kind === 'pet' ? <Icon name="bot" size={18} /> : initials(person.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-ink">{person.name}</div>
              <div className="text-[11.5px] text-muted">
                {[person.role, person.home ? 'lives with you' : '', person.birthday ? `born ${person.birthday}` : '']
                  .filter(Boolean)
                  .join(' · ') || 'Only a name so far'}
              </div>
            </div>
          </div>
          {person.notes && (
            <div className="rounded-lg border border-line bg-page px-3 py-2.5 text-[12.5px] leading-relaxed text-body">
              {person.notes}
            </div>
          )}
          {person.private.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-warn">
                <Icon name="secret" size={11} /> Private
              </div>
              {person.private.map((l, i) => (
                <div key={i} className="text-[12px] leading-relaxed text-body">
                  {l}
                </div>
              ))}
              <div className="mt-1 text-[10.5px] text-faint">
                Used when a question needs it. Never in a bulk read.
              </div>
            </div>
          )}
          <div className="text-[10.5px] text-faint">
            {person.source === 'mail' ? 'From your mail' : person.source === 'calendar' ? 'From your calendar' : 'You told me'}
            {person.emails.length > 0 && ` · ${person.emails[0]}`}
          </div>
          <div className="flex items-center gap-2 border-t border-line pt-3">
            <button className="btn-ghost text-[12px]" onClick={onEdit}>
              Edit
            </button>
            <button
              className="ml-auto text-[11.5px] text-muted hover:text-err"
              title="Deletes every line on this record. Not hidden: gone."
              onClick={() => void onForget(person)}
            >
              Forget {person.name.split(' ')[0]}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
