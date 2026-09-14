// The home step of the first run: the house you run, as a space.
//
// Home is a space tagged Personal, made here from the same starter the Spaces
// page offers, so it has folders, a Home manager and a Monday rhythm like any
// other space. What you answer becomes notes in its knowledge folder, which
// is where the Home manager reads from. The people who work there become
// records in your personal store; the space only keeps their role and days.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { aiw } from '../../lib/aiw'
import { Icon } from '../../lib/icons'
import { Err, Frame, Header } from './LearnStep'
import { useApp } from '../../store'
import { CAPTURE_HOME_AUTO } from '../../lib/devCapture'
import type { SetupNav } from './steps'

interface Worker {
  key: string
  name: string
  role: string
  days: string
}

export function HomeStep({
  onDone,
  onSkip,
  onClose,
  nav,
}: {
  onDone: () => void
  onSkip: () => void
  onClose?: () => void
  nav?: SetupNav
}) {
  const { refreshTree, nodes } = useApp()
  // Made already, on an earlier pass. Coming back here shows the space
  // rather than a form that would make a second one.
  const existing = nodes.find((x) => x.kind === 'workspace' && x.name === 'Home')
  const [starter, setStarter] = useState<ipc.Starter | null>(null)
  const [address, setAddress] = useState('')
  const [kind, setKind] = useState('')
  const [since, setSince] = useState('')
  const [pool, setPool] = useState(false)
  const [poolNote, setPoolNote] = useState('')
  const [garden, setGarden] = useState(false)
  const [gardenNote, setGardenNote] = useState('')
  const [workers, setWorkers] = useState<Worker[]>([])
  const [adding, setAdding] = useState<Worker>({ key: '', name: '', role: '', days: '' })
  const [extra, setExtra] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<ipc.SpaceCreated | null>(null)

  useEffect(() => {
    void ipc
      .spaceStarters()
      .then((all) => setStarter(all.find((s) => s.id === 'home') ?? null))
      .catch((e) => setErr(String(e)))
  }, [])

  // Screenshot harness: sample answers, then the button. Made-up, like the
  // rest of the throwaway profile.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!CAPTURE_HOME_AUTO || !starter || autoRan.current) return
    autoRan.current = true
    setAddress('12 Acacia Lane, Parkview')
    setKind('A house with a pool and a garden')
    setSince('2021')
    setPool(true)
    setPoolNote('AquaCare, first Thursday of the month; salt chlorinator, pump on a 6-hour timer')
    setGarden(true)
    setGardenNote('GreenCut Services on Tuesdays; irrigation on two zones')
    setWorkers([{ key: 'w-1', name: 'Grace Mthembu', role: 'domestic worker', days: 'Mon, Wed, Fri' }])
    setExtra('Prepaid electricity. Bins go out on Tuesday night.')
    window.setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-capture="make-home"]')
      btn?.click()
    }, 800)
  }, [starter])

  const create = async () => {
    setBusy(true)
    setErr('')
    try {
      const s = starter
      const created = await ipc.spaceCreate({
        name: 'Home',
        label: 'Personal',
        folders: s?.folders ?? [
          { name: 'Pool', why: 'Chemicals, the service, the pump.' },
          { name: 'Garden', why: 'Who comes, and what the seasons need.' },
          { name: 'House', why: 'Everything with a switch, a pipe or a policy.' },
        ],
        routines: s?.routines ?? [],
        botName: 'Home manager',
        botGoal: 'Keep the house running: what is due, who does it, and when.',
      })
      setMade(created)
      const id = created.node_id

      // The answers, as notes the Home manager reads. Nothing private about a
      // person goes here: a worker's role and days, never their details.
      const where = [
        address.trim() && `Address: ${address.trim()}`,
        kind.trim() && `The place: ${kind.trim()}`,
        since.trim() && `Ours since ${since.trim()}`,
      ]
        .filter(Boolean)
        .join('\n')
      if (where) await ipc.learnNoteSave(id, 'Where we live', where)
      if (pool) {
        await ipc.learnNoteSave(id, 'Pool', poolNote.trim() || 'There is a pool.')
      }
      if (garden) {
        await ipc.learnNoteSave(id, 'Garden', gardenNote.trim() || 'There is a garden.')
      }
      if (workers.length) {
        const lines = workers
          .map((w) => `- ${w.name}${w.role ? `, ${w.role}` : ''}${w.days ? ` · ${w.days}` : ''}`)
          .join('\n')
        await ipc.learnNoteSave(id, 'Who works here', lines)
        for (const w of workers) {
          await aiw.personSave({
            id: '',
            name: w.name,
            kind: 'person',
            role: w.role || 'helps at home',
            home: false,
            birthday: '',
            emails: [],
            private: [],
            source: 'you',
            created_at: '',
            notes: w.days ? `Comes ${w.days}.` : '',
          })
        }
      }
      if (extra.trim()) await ipc.learnNoteSave(id, 'About the house', extra.trim())

      await refreshTree()
      onDone()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (existing && !made) {
    return (
      <Frame step="home" onClose={onClose} nav={nav}>
        <Header
          icon="home"
          ok
          title="Home is a space"
          text="It is in Spaces, tagged Personal, with a Home manager that keeps what is due. What you told me is on its Known tab, and that is where anything else about the house goes."
        />
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-panel px-4 py-3">
          <Icon name="home" size={16} className="text-indigo-400" />
          <span className="text-[13px] font-semibold text-ink">{existing.name}</span>
          <span className="rounded bg-raise px-1.5 py-0.5 text-[10.5px] text-muted">Personal</span>
          <span className="flex-1" />
          <span className="text-[11px] text-muted">Spaces, then Home, then Known</span>
        </div>
        <div className="flex items-center gap-3 border-t border-line pt-4">
          <button className="btn-primary text-[12px]" onClick={onDone}>
            Finish
          </button>
          <span className="text-[11px] text-faint">
            Add to the house from its Known tab, or ask the Home manager in its thread.
          </span>
        </div>
      </Frame>
    )
  }

  return (
    <Frame step="home" onClose={onClose} nav={nav}>
      <Header
        icon="home"
        title="The house you run"
        text="Home becomes a space of its own, tagged Personal, with a manager that keeps what is due. Tell me the basics; invoices and service mails fill in the rest over time."
      />

      <div className="grid grid-cols-2 gap-4">
        <section className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Where</span>
          <input
            className="input text-[12px]"
            placeholder="Street and suburb"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <input
            className="input text-[12px]"
            placeholder="A house with a garden · a flat · a farm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          />
          <input
            className="input text-[12px]"
            placeholder="Yours since (a year is fine)"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </section>

        <section className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            The house
          </span>
          <label className="flex items-center gap-2 text-[12px] text-body">
            <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} />
            There is a pool
          </label>
          {pool && (
            <input
              className="input text-[12px]"
              placeholder="Who services it, how often, anything about the pump"
              value={poolNote}
              onChange={(e) => setPoolNote(e.target.value)}
            />
          )}
          <label className="flex items-center gap-2 text-[12px] text-body">
            <input type="checkbox" checked={garden} onChange={(e) => setGarden(e.target.checked)} />
            There is a garden
          </label>
          {garden && (
            <input
              className="input text-[12px]"
              placeholder="A garden service, irrigation, what day they come"
              value={gardenNote}
              onChange={(e) => setGardenNote(e.target.value)}
            />
          )}
        </section>
      </div>

      <section className="rounded-[10px] border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[12.5px] font-semibold text-ink">Who works here</span>
          <span className="ml-auto text-[10.5px] text-faint">
            their role and days go in the space; the person goes in your life
          </span>
        </div>
        {workers.map((w) => (
          <div key={w.key} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[12px]">
            <span className="text-ink">{w.name}</span>
            <span className="text-muted">{w.role}</span>
            <span className="text-faint">{w.days}</span>
            <button
              className="ml-auto text-muted hover:text-ink"
              onClick={() => setWorkers((cur) => cur.filter((x) => x.key !== w.key))}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-4 py-3">
          <input
            className="input text-[12px]"
            placeholder="name"
            value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })}
          />
          <input
            className="input text-[12px]"
            placeholder="domestic worker · gardener · pool service"
            value={adding.role}
            onChange={(e) => setAdding({ ...adding, role: e.target.value })}
          />
          <input
            className="input text-[12px]"
            placeholder="Mon, Wed, Fri · first Thursday"
            value={adding.days}
            onChange={(e) => setAdding({ ...adding, days: e.target.value })}
          />
          <button
            className="btn-ghost text-[12px]"
            disabled={!adding.name.trim()}
            onClick={() => {
              setWorkers((cur) => [...cur, { ...adding, key: `w-${Date.now()}` }])
              setAdding({ key: '', name: '', role: '', days: '' })
            }}
          >
            <Icon name="add" size={11} /> Add
          </button>
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Anything else about the house
        </span>
        <textarea
          className="w-full resize-none rounded-[8px] border border-line2 bg-panel p-3 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-indigo-500"
          rows={2}
          placeholder="Prepaid electricity. The geyser was replaced in 2016. Bins go out on Tuesday night."
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
      </div>

      {err && <Err>{err}</Err>}
      {made && made.problems.length > 0 && (
        <Err tone="warn">Home was made, but: {made.problems.join(' · ')}</Err>
      )}

      <div className="flex items-center gap-3">
        <button
          className="btn-primary text-[12px]"
          disabled={busy}
          data-capture="make-home"
          onClick={() => void create()}
        >
          {busy ? 'Making Home…' : 'Make the Home space'}
        </button>
        <button className="btn-ghost text-[12px]" disabled={busy} onClick={onSkip}>
          Not now
        </button>
        <span className="text-[11px] text-muted">
          {starter ? `Brings ${starter.brings}.` : ''}
        </span>
      </div>

      <div className="flex gap-2.5 border-t border-line pt-4">
        <Icon name="secret" size={15} className="mt-0.5 shrink-0 text-muted" />
        <p className="m-0 text-[11.5px] leading-relaxed text-muted">
          Personal means no manager or agent from a business space is ever lent into Home, and
          the Home manager works nowhere else. Account numbers, alarm and gate codes are never
          written down, even when a mail contains them.
        </p>
      </div>
    </Frame>
  )
}
