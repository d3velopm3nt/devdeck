// Making a space, with a first cut already drafted.
//
// A new workspace used to be a `window.prompt` for a name: you got an empty
// folder and worked out the rest later, which mostly meant never.
//
// Three steps, and the third one is the point. **Start** asks what the space is
// for — which only decides what gets drafted, never a kind of node to live with.
// **Draft** is a first cut you edit: folders, a rhythm, a bot. **Review** shows
// exactly what will be written to disk and to the clock, and — the half nobody
// states — what will not. That last list is what makes the first one worth
// trusting.
//
// The draft is composed here and sent to the backend as an explicit list, so
// the review screen and the create call are reading the same thing. A backend
// that re-derived the draft could quietly disagree with the screen that got
// your consent.

import { useEffect, useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { Icon } from '../lib/icons'
import { DAYS, hhmm, toMin } from '../lib/bots'

type Step = 'start' | 'draft' | 'review'

/** Tags that mean "this is not work". Everything else is treated as work — a
 *  space that starts too quiet is a nuisance; one that pings you at 07:00 about
 *  your family folder is worse. */
const QUIET = ['personal', 'private', 'family', 'home', 'health', 'life']

const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function routineText(r: ipc.RoutineDraft): string {
  if (r.every === 'hourly') return 'Every hour'
  const at = hhmm(r.at_min)
  if (r.every === 'daily') return `Daily at ${at}`
  if (r.every === 'weekdays') return `Weekdays at ${at}`
  const day = LONG[Number(r.days.split(',')[0])]
  return day ? `${day}s at ${at}` : `Weekly at ${at}`
}

export function SpaceSetup({ onClose }: { onClose: () => void }) {
  const { nodes, refreshTree, setActiveWorkspace, labels } = useApp()

  const [starters, setStarters] = useState<ipc.Starter[]>([])
  const [step, setStep] = useState<Step>('start')
  const [name, setName] = useState('')
  const [pick, setPick] = useState('')
  const [label, setLabel] = useState('')
  const [touchedLabel, setTouchedLabel] = useState(false)

  const [folders, setFolders] = useState<ipc.FolderDraft[]>([])
  const [routines, setRoutines] = useState<ipc.RoutineDraft[]>([])
  const [withBot, setWithBot] = useState(false)
  const [botGoal, setBotGoal] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [made, setMade] = useState<ipc.SpaceCreated | null>(null)

  useEffect(() => {
    void ipc.spaceStarters().then(setStarters).catch((e) => setErr(String(e)))
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const starter = starters.find((s) => s.id === pick) ?? null
  const quiet = QUIET.some((q) => label.toLowerCase().includes(q))

  // The registry is editable, so the tag a starter suggests may not be in it.
  // Show it anyway: a tag that is set but has no pill is one you can neither
  // see nor take off, and the line above would be claiming a tag you cannot
  // find.
  const pills = label && !labels.includes(label) ? [...labels, label] : labels

  // A name already in the vault fails at the very end, after you have drafted
  // everything. Say it at the field where the name is typed instead.
  const taken =
    name.trim().length > 0 &&
    nodes.some(
      (n) => n.kind === 'workspace' && n.name.toLowerCase() === name.trim().toLowerCase(),
    )

  // Choosing a starter seeds the draft. It never overwrites a tag you set
  // yourself — the two are not tied, and a decision you are working out at work
  // is Business.
  const choose = (s: ipc.Starter) => {
    setPick(s.id)
    setFolders(s.folders.map((f) => ({ ...f })))
    setRoutines(s.routines.map((r) => ({ ...r })))
    setWithBot(s.bot)
    if (!touchedLabel) setLabel(s.label)
  }

  const botName = name.trim() ? `${name.trim()} bot` : ''
  const needsGoal = withBot && !botGoal.trim()

  const create = () => {
    if (busy) return
    setBusy(true)
    setErr('')
    void ipc
      .spaceCreate({
        name: name.trim(),
        label,
        folders: folders.filter((f) => f.name.trim()),
        routines: routines.filter((r) => r.name.trim()),
        botName: withBot ? botName : '',
        botGoal: withBot ? botGoal : '',
      })
      .then(async (res) => {
        setMade(res)
        await refreshTree()
        setActiveWorkspace(res.node_id)
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false))
  }

  // -- after it exists -----------------------------------------------------
  if (made) {
    const clean = made.problems.length === 0
    return (
      <Shell onClose={onClose} title={`${made.name} is there`}>
        <div className="flex flex-col gap-3.5">
          <div
            className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${
              clean ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.05]'
            }`}
          >
            <Icon
              name={clean ? 'check' : 'alert'}
              size={14}
              className={`mt-px shrink-0 ${clean ? 'text-ok' : 'text-warn'}`}
            />
            <div className="text-[12px] leading-[1.6] text-body">
              {made.folders.length} folder{made.folders.length === 1 ? '' : 's'},{' '}
              {made.routines.length} reminder{made.routines.length === 1 ? '' : 's'}
              {made.bot ? ', and a bot' : ''}.
              {clean ? ' Everything you agreed to.' : ' Some of it did not happen:'}
            </div>
          </div>

          {made.problems.map((p) => (
            <div key={p} className="rounded-lg bg-red-500/[0.07] px-3.5 py-2 text-[11.5px] text-err">
              {p}
            </div>
          ))}

          {!clean && (
            <p className="text-[10.5px] leading-[1.5] text-muted">
              The space itself is real and yours — nothing was undone to tidy this up. Add what is
              missing from the Explorer.
            </p>
          )}

          <div className="flex items-center gap-2 border-t border-line pt-3.5">
            <button className="btn-primary text-[12px]" onClick={onClose}>
              Open it
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // -- 1. what is it for ---------------------------------------------------
  if (step === 'start') {
    return (
      <Shell
        onClose={onClose}
        title="A new space"
        sub="A space is a folder in your vault. Everything you put in it lives there, and you can move it later."
      >
        <div className="flex gap-6">
          <div className="flex w-[560px] shrink-0 flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                Called
              </label>
              <input
                autoFocus
                className="input w-full text-[14px]"
                placeholder="Fitness"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {name.trim() && (
                <div className={`mt-1.5 font-mono text-[10.5px] ${taken ? 'text-err' : 'text-muted'}`}>
                  ~/DevDeck/{name.trim()}
                  {taken && ' — a space of that name is already there'}
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                What is it for?
              </label>
              {err && (
                <div className="mb-2 rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] leading-[1.55] text-err">
                  Could not read the starters, so there is nothing to draft from: {err}
                </div>
              )}
              {!err && starters.length === 0 && (
                <div className="mb-2 rounded-lg border border-line bg-panel px-3 py-2 text-[11.5px] text-muted">
                  Reading the starters…
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {starters.map((s) => {
                  const on = pick === s.id
                  const wide = s.id === 'empty'
                  return (
                    <button
                      key={s.id}
                      className={`rounded-lg border px-3 py-2.5 text-left ${wide ? 'col-span-2' : ''} ${
                        on
                          ? 'border-indigo-500/50 bg-indigo-500/[0.06]'
                          : 'border-line bg-panel hover:border-line2'
                      }`}
                      onClick={() => choose(s)}
                    >
                      <div className="text-[12.5px] font-semibold text-ink">{s.name}</div>
                      <div className="mt-0.5 text-[10.5px] leading-[1.45] text-muted">{s.what}</div>
                      <div className="mt-1.5 text-[10px] text-faint">Brings: {s.brings}</div>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[10.5px] leading-[1.5] text-muted">
                This only decides what gets drafted next. Afterwards it is a folder like any other —
                there is no kind of space to live with later.
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {starter && (
              <div className="flex items-start gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.05] px-3.5 py-3">
                <Icon name="ai" size={13} className="mt-px shrink-0 text-indigo-400" />
                <div className="text-[11.5px] leading-[1.6] text-body">
                  {starter.label
                    ? `${starter.name} is usually ${starter.label.toLowerCase()}, so I have tagged it that way. `
                    : 'Nothing is drafted for an empty space, so the tag is yours to pick. '}
                  That tag decides whether anything here is allowed to interrupt you during the day.
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              <div className="px-3.5 pb-1.5 pt-3">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Tagged
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
                {pills.map((l) => (
                  <button
                    key={l}
                    className={`rounded-full px-3 py-0.5 text-[11px] ${
                      label === l
                        ? 'bg-indigo-500/20 font-semibold text-indigo-300'
                        : 'border border-line text-muted hover:text-dim'
                    }`}
                    onClick={() => {
                      setTouchedLabel(true)
                      setLabel(label === l ? '' : l)
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="border-t border-line px-3.5 py-2.5 text-[10.5px] leading-[1.55] text-muted">
                {!label
                  ? 'Untagged, nothing here assumes anything about your day. Pick one and the drafted times move with it.'
                  : quiet
                    ? 'Personal keeps it quiet: routines land in the evening, and a bot here waits until you are not working.'
                    : 'Business puts routines and a bot on work hours.'}
              </div>
              <div className="border-t border-line px-3.5 py-2.5 text-[10.5px] leading-[1.55] text-faint">
                The kind only suggests one — the two are not tied. A decision you are working out at
                work is Business; a product you ship at the weekend is Personal.
              </div>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <button
                className="btn-primary text-[12px]"
                disabled={!name.trim() || !pick || taken}
                onClick={() => setStep('draft')}
              >
                Draft it
              </button>
              <button className="btn-ghost text-[12px]" onClick={onClose}>
                Cancel
              </button>
            </div>
            <div className="text-[10.5px] text-faint">Nothing is written until you say so.</div>
          </div>
        </div>
      </Shell>
    )
  }

  // -- 2. the draft --------------------------------------------------------
  if (step === 'draft') {
    return (
      <Shell onClose={onClose} title={name.trim()} tag={label} sub={`~/DevDeck/${name.trim()}`}>
        <div className="flex flex-col gap-3.5">
          <div className="flex items-start gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.05] px-3.5 py-3">
            <Icon name="ai" size={13} className="mt-px shrink-0 text-indigo-400" />
            <div className="text-[11.5px] leading-[1.6] text-body">
              A first cut. Rename anything, drop what you do not want, add what is missing — none of
              it exists yet.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            {/* folders */}
            <div className="flex flex-col gap-3.5">
              <Card title="Folders inside it" count={folders.length}>
                {folders.map((f, i) => (
                  <div key={i} className="flex items-center gap-2.5 border-t border-line px-3 py-1.5">
                    <Icon name="folder" size={13} className="shrink-0 text-muted" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-[12.5px] text-body outline-none"
                      value={f.name}
                      onChange={(e) =>
                        setFolders(folders.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))
                      }
                    />
                    <span className="shrink-0 text-[10.5px] text-muted">{f.why}</span>
                    <button
                      className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-err"
                      onClick={() => setFolders(folders.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                ))}
                <AddRow
                  label="Add a folder…"
                  onAdd={(v) => setFolders([...folders, { name: v, why: '' }])}
                />
                <Foot>
                  Each one is a real directory with a note file saying what it is for. Give one a
                  repository later and it becomes a project.
                </Foot>
              </Card>

              <Card title="A bot for this space">
                <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
                  <Icon name="bot" size={14} className="shrink-0 text-indigo-400" />
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                    {botName || 'Name the space first'}
                  </span>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-indigo-500"
                    checked={withBot}
                    onChange={(e) => setWithBot(e.target.checked)}
                  />
                </div>
                {withBot && (
                  <div className="border-t border-line px-3 py-2.5">
                    <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                      Its goal
                    </label>
                    <input
                      className="input w-full text-[12px]"
                      placeholder="What does good look like in three months?"
                      value={botGoal}
                      onChange={(e) => setBotGoal(e.target.value)}
                    />
                    <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
                      The one thing it will not guess. Without a goal there is nothing to judge a
                      suggestion against, so a blank one means no bot.
                    </p>
                  </div>
                )}
              </Card>
            </div>

            {/* routines */}
            <div className="flex flex-col gap-3.5">
              <Card title="Its rhythm" count={routines.length}>
                {routines.map((r, i) => (
                  <div key={i} className="flex items-center gap-2.5 border-t border-line px-3 py-1.5">
                    <Icon name="schedule" size={13} className="shrink-0 text-ok" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-[12.5px] text-body outline-none"
                      value={r.name}
                      onChange={(e) =>
                        setRoutines(routines.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))
                      }
                    />
                    <select
                      className="input w-[104px] shrink-0 text-[11px]"
                      value={r.every === 'weekly' ? r.days.split(',')[0] : r.every}
                      onChange={(e) => {
                        const v = e.target.value
                        const next =
                          v === 'daily' || v === 'weekdays'
                            ? { every: v, days: '' }
                            : { every: 'weekly', days: v }
                        setRoutines(routines.map((x, j) => (i === j ? { ...x, ...next } : x)))
                      }}
                    >
                      <option value="daily">Every day</option>
                      <option value="weekdays">Weekdays</option>
                      {DAYS.map((d, n) => (
                        <option key={d} value={String(n)}>
                          {LONG[n]}s
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      className="input w-[92px] shrink-0 text-[11px]"
                      value={hhmm(r.at_min)}
                      onChange={(e) =>
                        setRoutines(
                          routines.map((x, j) => (i === j ? { ...x, at_min: toMin(e.target.value) } : x)),
                        )
                      }
                    />
                    <button
                      className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-err"
                      onClick={() => setRoutines(routines.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                ))}
                <AddRow
                  label="Add a reminder…"
                  onAdd={(v) =>
                    setRoutines([
                      ...routines,
                      { name: v, every: 'weekly', at_min: quiet ? 18 * 60 : 9 * 60, days: '1' },
                    ])
                  }
                />
                <Foot>
                  {quiet ? 'Evenings, because this space is Personal. ' : 'Work hours, because this space is Business. '}
                  Each only tells you; one that was missed is recorded as missed rather than fired
                  late.
                </Foot>
              </Card>

              <div className="flex-1" />
            </div>
          </div>

          {err && <div className="rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] text-err">{err}</div>}

          <div className="flex items-center gap-2 border-t border-line pt-3.5">
            <button
              className="btn-primary text-[12px]"
              disabled={needsGoal}
              title={needsGoal ? 'Give the bot a goal, or switch it off' : undefined}
              onClick={() => setStep('review')}
            >
              See what this makes
            </button>
            <button className="btn-ghost text-[12px]" onClick={() => setStep('start')}>
              Back
            </button>
            <span className="flex-1" />
            <span className="text-[10.5px] text-faint">
              {needsGoal ? 'The bot needs a goal, or switch it off.' : 'Nothing has been written yet.'}
            </span>
          </div>
        </div>
      </Shell>
    )
  }

  // -- 3. exactly what it makes -------------------------------------------
  const kept = folders.filter((f) => f.name.trim())
  const keptR = routines.filter((r) => r.name.trim())
  return (
    <Shell
      onClose={onClose}
      title="Before it exists"
      sub="Everything below, and nothing else. All of it is a folder or a row you can delete afterwards."
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <Icon name="folder" size={13} className="text-ok" />
            <span className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              In your vault
            </span>
          </div>
          <div className="border-t border-line px-4 py-3 font-mono text-[11.5px] leading-[1.85]">
            <div className="text-muted">~/DevDeck/</div>
            <div className="text-ok">{name.trim()}/</div>
            <div className="pl-5 text-muted">
              _devdeck.md <span className="text-faint">{label ? `label: ${label}` : ''}</span>
            </div>
            {kept.map((f) => (
              <div key={f.name}>
                <div className="pl-5 text-body">{f.name.trim()}/</div>
                <div className="pl-10 text-muted">_devdeck.md</div>
              </div>
            ))}
            {withBot && botGoal.trim() && (
              <div className="pl-5 text-indigo-400">
                _bot.md <span className="text-faint">{botName}</span>
              </div>
            )}
          </div>
          <div className="border-t border-line px-3.5 py-2.5 text-[10.5px] leading-[1.55] text-muted">
            Plain folders with a note file each. Open them in File Explorer, edit them in anything,
            move the whole space to another machine — it comes with its own description.
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-line bg-panel">
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <Icon name="schedule" size={13} className="text-ok" />
              <span className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                On the clock
              </span>
              <span className="text-[10px] text-faint">
                {keptR.length} reminder{keptR.length === 1 ? '' : 's'}
              </span>
            </div>
            {keptR.map((r) => (
              <div key={r.name} className="flex items-baseline gap-3 border-t border-line px-3.5 py-1.5">
                <span className="w-[124px] shrink-0 font-mono text-[11.5px] text-dim">
                  {routineText(r)}
                </span>
                <span className="min-w-0 flex-1 text-[12px] text-body">{r.name}</span>
              </div>
            ))}
            {keptR.length === 0 && (
              <div className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">
                Nothing on the clock.
              </div>
            )}
            <div className="border-t border-line px-3.5 py-2.5 text-[10.5px] leading-[1.55] text-muted">
              All of them only tell you. They run while DevDeck is open; one that was missed is
              recorded as missed rather than fired late.
            </div>
          </div>

          {/* The half nobody states. */}
          <div className="overflow-hidden rounded-lg border border-line bg-panel">
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <Icon name="close" size={13} className="text-muted" />
              <span className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                Not created
              </span>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line px-3.5 py-3 text-[11.5px] text-muted">
              <div>No commands and no services — nothing here runs a process.</div>
              <div>No repository. Give a folder one later and it becomes a project.</div>
              <div>
                {withBot && botGoal.trim()
                  ? 'The bot watches. It wakes nothing until you name an agent for it.'
                  : 'No bot.'}
              </div>
              <div>Nothing reaches outside this machine.</div>
            </div>
          </div>
        </div>
      </div>

      {err && <div className="mt-3.5 rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] text-err">{err}</div>}

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3.5">
        <button className="btn-primary text-[12px]" disabled={busy} onClick={create}>
          {busy ? 'Making it…' : 'Create the space'}
        </button>
        <button className="btn-ghost text-[12px]" disabled={busy} onClick={() => setStep('draft')}>
          Back to the draft
        </button>
        <span className="flex-1" />
        <span className="text-[10.5px] text-faint">
          Every line above is something you can rename or delete afterwards.
        </span>
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------------------

function Shell({
  title,
  sub,
  tag,
  onClose,
  children,
}: {
  title: string
  sub?: string
  tag?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[1000px] flex-col rounded-xl border border-line2 bg-page shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-semibold text-ink">{title}</span>
              {tag && (
                <span className="rounded-full bg-soft px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted">
                  {tag}
                </span>
              )}
            </div>
            {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
          </div>
          <button className="btn-ghost shrink-0 text-[11.5px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function Card({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          {title}
        </span>
        {count != null && <span className="text-[10px] text-faint">{count}</span>}
      </div>
      {children}
    </div>
  )
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-line px-3.5 py-2.5 text-[10.5px] leading-[1.55] text-faint">
      {children}
    </div>
  )
}

function AddRow({ label, onAdd }: { label: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-3 py-1.5">
      <Icon name="add" size={12} className="shrink-0 text-faint" />
      <input
        className="min-w-0 flex-1 bg-transparent text-[12px] text-body outline-none placeholder:text-faint"
        placeholder={label}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !v.trim()) return
          onAdd(v.trim())
          setV('')
        }}
      />
    </div>
  )
}
