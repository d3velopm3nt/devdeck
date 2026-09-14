// The life step of the first run: who is in your life.
//
// Your family, your friends, your pets. Your own answers, and nothing else:
// no mailbox can know who your sister is, and the people you write to were
// dealt with in the learn step, one at a time. Everything saved here is a
// record in the personal store; nothing about a person ever goes into a
// space.

import { useEffect, useState } from 'react'
import { aiw, type PersonView } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { Err, Frame, Header } from './LearnStep'
import type { SetupNav } from './steps'

/// What somebody usually is. In words, because a role is a word and not a
/// code: "wife" is stored as "wife" if that is what you type.
const RELATIONS = ['partner', 'child', 'parent', 'sibling', 'friend'] as const
const FAMILY = new Set<string>(RELATIONS)

/// A guess at who lives with you, corrected with one click.
const LIVES_WITH: Record<string, boolean> = {
  partner: true,
  child: true,
  parent: false,
  sibling: false,
  friend: false,
}

interface Row {
  key: string
  name: string
  role: string
  home: boolean
  saved?: PersonView
}

interface Pet {
  key: string
  name: string
  what: string
  saved?: PersonView
}

let seq = 0
const key = () => `new-${Date.now()}-${seq++}`

export function LifeStep({
  onDone,
  onClose,
  nav,
}: {
  onDone: () => void
  onClose?: () => void
  nav?: SetupNav
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [pets, setPets] = useState<Pet[]>([])
  const [free, setFree] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // The add rows.
  const [name, setName] = useState('')
  const [role, setRole] = useState<string>('partner')
  const [other, setOther] = useState('')
  const [home, setHome] = useState(true)
  const [petName, setPetName] = useState('')
  const [petWhat, setPetWhat] = useState('')

  // Already on file, so coming back here shows what you said.
  useEffect(() => {
    let live = true
    void aiw
      .people()
      .then((known) => {
        if (!live) return
        setPets(
          known
            .filter((p) => p.kind === 'pet')
            .map((p) => ({ key: p.id, name: p.name, what: p.role, saved: p })),
        )
        setRows(
          known
            .filter((p) => p.kind !== 'pet' && (FAMILY.has(p.role) || p.source === 'you'))
            .filter((p) => p.role !== 'helps at home')
            .map((p) => ({ key: p.id, name: p.name, role: p.role, home: p.home, saved: p })),
        )
      })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [])

  const addRow = () => {
    const n = name.trim()
    const r = (role === 'other' ? other : role).trim()
    if (!n || !r) return
    setRows((cur) => [...cur, { key: key(), name: n, role: r, home }])
    setName('')
    setOther('')
  }
  const addPet = () => {
    const n = petName.trim()
    if (!n) return
    setPets((cur) => [...cur, { key: key(), name: n, what: petWhat.trim() }])
    setPetName('')
    setPetWhat('')
  }
  const dropRow = async (r: Row) => {
    setRows((cur) => cur.filter((x) => x.key !== r.key))
    if (r.saved) await aiw.personForget(r.saved.id).catch((e) => setErr(String(e)))
  }
  const dropPet = async (p: Pet) => {
    setPets((cur) => cur.filter((x) => x.key !== p.key))
    if (p.saved) await aiw.personForget(p.saved.id).catch((e) => setErr(String(e)))
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      for (const r of rows) {
        await aiw.personSave({
          id: r.saved?.id ?? '',
          name: r.name,
          kind: 'person',
          role: r.role,
          home: r.home,
          birthday: r.saved?.birthday ?? '',
          emails: r.saved?.emails ?? [],
          private: r.saved?.private ?? [],
          source: r.saved?.source ?? 'you',
          created_at: r.saved?.created_at ?? '',
          notes: r.saved?.notes ?? '',
        })
      }
      for (const p of pets) {
        await aiw.personSave({
          id: p.saved?.id ?? '',
          name: p.name,
          kind: 'pet',
          role: p.what || 'pet',
          home: true,
          birthday: p.saved?.birthday ?? '',
          emails: [],
          private: p.saved?.private ?? [],
          source: p.saved?.source ?? 'you',
          created_at: p.saved?.created_at ?? '',
          notes: p.saved?.notes ?? '',
        })
      }
      // What you typed in your own words is kept as said, as a note about
      // you, until a later pass turns it into records.
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

  const say = (r: Row) => `${r.name} is your ${r.role}${r.home ? ', and lives with you' : ''}`

  return (
    <Frame step="life" onClose={onClose} nav={nav}>
      <Header
        icon="contacts"
        title="Who is in your life"
        text="Your family, your friends, your pets. Nothing here comes from your mail: the people you write to were the last step, and this is the part no mailbox can know."
      />

      <div className="rounded-[10px] border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[12.5px] font-semibold text-ink">Family and friends</span>
          <span className="ml-auto text-[10.5px] text-faint">kept on this machine, never in a space</span>
        </div>
        {!loaded && <div className="px-4 py-3 text-[12px] text-muted">Reading…</div>}
        {loaded && rows.length === 0 && (
          <div className="px-4 py-3 text-[12px] text-muted">Nobody yet. Add them below.</div>
        )}
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 border-t border-line px-4 py-2.5">
            <Icon name="contacts" size={13} className="text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{say(r)}</span>
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
            <button
              className="btn-ghost text-[11px] text-muted"
              title="Remove"
              onClick={() => void dropRow(r)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-line px-4 py-3">
          <input
            className="input text-[12px]"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRow()}
          />
          <select className="input text-[12px]" value={role} onChange={(e) => setRole(e.target.value)}>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="other">something else…</option>
          </select>
          {role === 'other' ? (
            <input
              className="input text-[12px]"
              placeholder="what they are to you, in a word"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRow()}
            />
          ) : (
            <span />
          )}
          <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
            <input
              type="checkbox"
              checked={home}
              onChange={(e) => setHome(e.target.checked)}
            />
            lives with you
          </label>
          <button
            className="btn-ghost text-[11.5px]"
            disabled={!name.trim() || (role === 'other' && !other.trim())}
            onClick={() => {
              addRow()
              setHome(LIVES_WITH[role] ?? true)
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="rounded-[10px] border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[12.5px] font-semibold text-ink">Pets</span>
        </div>
        {loaded && pets.length === 0 && (
          <div className="px-4 py-3 text-[12px] text-muted">None, or none yet.</div>
        )}
        {pets.map((p) => (
          <div key={p.key} className="flex items-center gap-3 border-t border-line px-4 py-2.5">
            <Icon name="home" size={13} className="text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
              {p.name}
              {p.what && <span className="text-muted">, {p.what}</span>}
            </span>
            <button
              className="btn-ghost text-[11px] text-muted"
              title="Remove"
              onClick={() => void dropPet(p)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-t border-line px-4 py-3">
          <input
            className="input text-[12px]"
            placeholder="name"
            value={petName}
            onChange={(e) => setPetName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPet()}
          />
          <input
            className="input text-[12px]"
            placeholder="dog, cat, two goldfish"
            value={petWhat}
            onChange={(e) => setPetWhat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPet()}
          />
          <button className="btn-ghost text-[11.5px]" disabled={!petName.trim()} onClick={addPet}>
            Add
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Anything else about your life, in your own words
        </span>
        <textarea
          className="input min-h-[64px] resize-y text-[12px]"
          placeholder="Two kids at Oakhill Primary. My mother lives nearby and comes for Sunday lunch. We travel to Cape Town every December."
          value={free}
          onChange={(e) => setFree(e.target.value)}
        />
      </div>

      {err && <Err>{err}</Err>}

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <Icon name="secret" size={15} className="text-muted" />
        <span className="text-[11.5px] text-muted">
          Each person is a file in your personal store. Only the assistant reads them, never a
          manager.
        </span>
        <span className="flex-1" />
        <button className="btn-primary text-[12px]" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : rows.length + pets.length > 0 ? 'Save and continue' : 'Continue'}
        </button>
      </div>
    </Frame>
  )
}
