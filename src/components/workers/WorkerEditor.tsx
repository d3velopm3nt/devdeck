// Making a worker: who it is, what it may use, where it may write, and when
// it must stop. Everything here is a limit before it is a feature — the five
// things no worker ever does are shown but not editable, because a worker
// that could send, post, pay, push or merge is an account, not a draughtsman.

import { useState } from 'react'
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
              {briefs.map((b) => (
                <button
                  key={b.id}
                  title={b.what}
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                    w.brief === b.id ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => set('brief', b.id)}
                >
                  {b.id}
                </button>
              ))}
              {briefs.length === 0 && <span className="text-[11px] text-faint">none in the library yet</span>}
            </div>

            <span className={`${label} self-start pt-1`}>Skills</span>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <button
                  key={s.id}
                  title={s.what}
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                    w.skills.includes(s.id)
                      ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                      : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => set('skills', toggle(w.skills, s.id))}
                >
                  {s.id}
                </button>
              ))}
              {skills.length === 0 && (
                <span className="text-[11px] text-faint">
                  nothing in the library yet — it will work on the job alone
                </span>
              )}
            </div>

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
