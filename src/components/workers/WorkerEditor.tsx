// Making a worker: who it is, what it may use, where it may write, and when
// it must stop. Everything here is a limit before it is a feature — the five
// things no worker ever does are shown but not editable, because a worker
// that could send, post, pay, push or merge is an account, not a draughtsman.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'

const MODELS = ['sonnet', 'opus', 'haiku']

export function WorkerEditor({
  worker,
  library,
  onClose,
  onSaved,
}: {
  worker: ipc.Worker
  library: ipc.LibraryItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const nodes = useApp((s) => s.nodes)
  const [w, setW] = useState<ipc.Worker>(worker)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [kits, setKits] = useState<ipc.LibraryKitRef[]>([])
  useEffect(() => {
    void ipc.libraryKits().then(setKits).catch(() => setKits([]))
  }, [])

  const set = <K extends keyof ipc.Worker>(k: K, v: ipc.Worker[K]) => setW((cur) => ({ ...cur, [k]: v }))
  const skills = library.filter((i) => i.kind === 'skill')
  const briefs = library.filter((i) => i.kind === 'brief')
  const spaces = nodes.filter((n) => n.kind === 'workspace')
  const isNew = !worker.handle

  const save = async () => {
    setErr('')
    setBusy(true)
    try {
      await ipc.workerSave(w)
      onSaved()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  const label = 'text-[11px] text-muted'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8" onClick={onClose}>
      <div
        className="flex max-h-full w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <span className="text-[14px] font-semibold text-ink">{isNew ? 'A new worker' : w.name}</span>
          {!isNew && <span className="font-mono text-[11px] text-faint">@{w.handle}</span>}
          <span className="flex-1" />
          <button className="btn-ghost text-[11.5px]" onClick={onClose}>
            <Icon name="close" size={12} /> Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
            <span className={label}>Name</span>
            <input
              className="input text-[12.5px]"
              value={w.name}
              placeholder="Scribe"
              onChange={(e) => set('name', e.target.value)}
            />

            <span className={label}>What it is for</span>
            <input
              className="input text-[12.5px]"
              value={w.what}
              placeholder="Writes a draught in your voice: pages, posts, letters"
              onChange={(e) => set('what', e.target.value)}
            />

            <span className={label}>Brief</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  !w.brief ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                }`}
                onClick={() => set('brief', '')}
              >
                the job is the brief
              </button>
            </div>
            <span />
            <Pills
              all={briefs}
              chosen={w.brief ? [w.brief] : []}
              onToggle={(id) => set('brief', w.brief === id ? '' : id)}
              empty="none in the library yet"
            />

            <span className={`${label} self-start pt-1`}>Kit</span>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    !w.kit ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => set('kit', '')}
                >
                  none
                </button>
                {kits.map((k) => (
                  <button
                    key={k.id}
                    title={`${k.count} ${k.kind === 'skill' ? 'skills' : 'briefs'} from ${k.repo}`}
                    className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                      w.kit === k.id ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                    }`}
                    onClick={() => set('kit', k.id)}
                  >
                    {k.folder}/ · {k.count}
                  </button>
                ))}
                {kits.length === 0 && (
                  <span className="text-[11px] text-faint">no kits yet — add a folder whole from the library</span>
                )}
              </div>
              {w.kit && (
                <p className="m-0 max-w-[520px] text-[11px] leading-relaxed text-muted">
                  It carries this bench into <code className="font-mono text-dim">.claude/agents</code> and picks who takes
                  the job. You have not read them; the folder limit and the never-list are what hold.
                </p>
              )}
            </div>

            <span className={`${label} self-start pt-1`}>Skills</span>
            <Pills
              all={skills}
              chosen={w.skills}
              onToggle={(id) => set('skills', toggle(w.skills, id))}
              empty="nothing in the library yet — it will work on the job alone"
            />

            <span className={label}>Writes in</span>
            <div className="flex items-center gap-2">
              {[
                { id: 'folder', label: 'one folder', note: 'drafts, notes, research' },
                { id: 'branch', label: 'its own branch', note: 'code, never pushed' },
              ].map((o) => (
                <button
                  key={o.id}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 text-[11.5px] ${
                    w.writes === o.id ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => set('writes', o.id)}
                >
                  <Icon name={o.id === 'branch' ? 'code' : 'folder'} size={12} />
                  {o.label}
                  <span className="text-[10.5px] text-faint">{o.note}</span>
                </button>
              ))}
            </div>

            <span className={label}>Stops at</span>
            <div className="flex items-center gap-2 text-[12px]">
              <input
                className="input w-20 text-[12px]"
                type="number"
                min={1}
                value={w.minutes}
                onChange={(e) => set('minutes', Number(e.target.value) || 1)}
              />
              <span className="text-muted">minutes, or</span>
              <input
                className="input w-24 text-[12px]"
                type="number"
                min={0}
                step={0.5}
                value={w.usd}
                onChange={(e) => set('usd', Number(e.target.value) || 0)}
              />
              <span className="text-muted">dollars, whichever comes first</span>
            </div>

            <span className={label}>Model</span>
            <div className="flex items-center gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    w.model === m ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => set('model', m)}
                >
                  {m}
                </button>
              ))}
              <span className="ml-2 text-[10.5px] text-faint">runs through Claude Code, on its own account</span>
            </div>

            <span className={`${label} self-start pt-1`}>Lent to</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  w.spaces.length === 0 ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                }`}
                onClick={() => set('spaces', [])}
              >
                every space
              </button>
              {spaces.map((s) => (
                <button
                  key={s.id}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    w.spaces.includes(s.id) ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() =>
                    set(
                      'spaces',
                      w.spaces.includes(s.id) ? w.spaces.filter((x) => x !== s.id) : [...w.spaces, s.id],
                    )
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>

            <span className={`${label} self-start pt-1`}>Say every time</span>
            <textarea
              className="input min-h-[70px] resize-y text-[12.5px] leading-relaxed"
              value={w.body}
              placeholder="Mark any claim you could not check, and say where you would check it."
              onChange={(e) => set('body', e.target.value)}
            />

            <span className={label}>While you sleep</span>
            <label className="flex items-center gap-2 text-[12px] text-body">
              <input
                type="checkbox"
                checked={w.unattended}
                onChange={(e) => set('unattended', e.target.checked)}
              />
              A manager may start it without asking
              <span className="text-[10.5px] text-faint">off means it waits in your Inbox with the handoff</span>
            </label>
          </div>

          <div className="mt-4 rounded-[8px] border border-line bg-raise px-3.5 py-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              What it will never do, whatever it is asked
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {['send mail', 'post anywhere', 'spend money', 'push', 'merge', 'write outside its folder'].map((n) => (
                <span key={n} className="flex items-center gap-1.5 text-[11.5px] text-body">
                  <Icon name="close" size={11} className="text-err" />
                  {n}
                </span>
              ))}
            </div>
          </div>

          {err && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">{err}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-raise px-5 py-3">
          <button className="btn-primary text-[12px]" disabled={busy || !w.name.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Make it' : 'Save'}
          </button>
          <button className="btn-ghost text-[12px]" onClick={onClose}>
            Cancel
          </button>
          <span className="flex-1" />
          {!isNew &&
            (confirmRemove ? (
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-muted">Remove {w.name}? Its past runs stay.</span>
                <button
                  className="btn-danger text-[11.5px]"
                  onClick={() => void ipc.workerDelete(w.handle).then(onSaved)}
                >
                  Remove
                </button>
                <button className="btn-ghost text-[11.5px]" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="flex items-center gap-1 text-[11px] text-muted hover:text-err" onClick={() => setConfirmRemove(true)}>
                <Icon name="delete" size={11} /> Remove worker
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

/// A row of library items to choose from.
///
/// It is a filter box and not just pills because a kit puts sixty-eight briefs
/// in the library at once, and sixty-eight pills is not a choice, it is a
/// wall. Short lists show whole; long ones show what you searched for.
function Pills({
  all,
  chosen,
  onToggle,
  empty,
}: {
  all: ipc.LibraryItem[]
  chosen: string[]
  onToggle: (id: string) => void
  empty: string
}) {
  const [q, setQ] = useState('')
  const long = all.length > 14
  const match = all.filter(
    (i) => !q.trim() || i.id.toLowerCase().includes(q.toLowerCase()) || i.what.toLowerCase().includes(q.toLowerCase()),
  )
  // The chosen ones stay in sight whatever is typed: losing the thing you
  // picked because you searched for something else reads as having lost it.
  const shown = [...all.filter((i) => chosen.includes(i.id)), ...match.filter((i) => !chosen.includes(i.id))].slice(
    0,
    long && !q.trim() ? 14 : 60,
  )

  return (
    <div className="flex flex-col gap-1.5">
      {long && (
        <input
          className="input w-56 py-0.5 text-[11px]"
          placeholder={`Filter ${all.length}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {shown.map((s) => (
          <button
            key={s.id}
            title={s.what}
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
              chosen.includes(s.id)
                ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                : 'border-line2 text-dim hover:text-ink'
            }`}
            onClick={() => onToggle(s.id)}
          >
            {s.id}
          </button>
        ))}
        {all.length === 0 && <span className="text-[11px] text-faint">{empty}</span>}
        {all.length > shown.length && (
          <span className="self-center text-[11px] text-faint">and {all.length - shown.length} more — filter to find one</span>
        )}
      </div>
    </div>
  )
}
