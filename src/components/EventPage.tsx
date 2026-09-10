// One occurrence, and what came of it.
//
// A schedule says a thing recurs; this says what happened *this time*. Which
// is the difference between a calendar you look at and one you work out of.
//
// Four parts, in the order you use them: which occurrence this is and how to
// step to another; whether it happened; what you wrote about it; and the last
// few times, because two entries make a record and one makes a note.
//
// **Not said is not no.** `done` is three-valued on purpose. A Tuesday you
// never answered is not a Tuesday you skipped, and a page that collapsed the
// two would quietly turn every week you were busy into a week you failed.
//
// Entries are files in the personal store, one per date. Your Tuesday is
// yours: nothing here goes near a repository.

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import * as ipc from '../lib/ipc'
import type { CalendarItem, EventEntry } from '../lib/ipc'
import { useApp } from '../store'

const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

const shortDate = (day: string) =>
  new Date(`${day}T12:00`).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function EventPage({
  item,
  onBack,
  onStep,
}: {
  item: CalendarItem
  onBack: () => void
  /// Move to the same event a day either side. The calendar owns which
  /// occurrences exist, so it does the arithmetic and hands back an item.
  onStep: (item: CalendarItem, days: number) => void
}) {
  const [entry, setEntry] = useState<EventEntry | null>(null)
  const [history, setHistory] = useState<EventEntry[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const id = item.schedule_id ?? 0

  const load = useCallback(() => {
    if (!id) return
    void ipc
      .eventEntry(id, item.at)
      .then((e) => {
        setEntry(e)
        setNotes(e.notes ?? '')
        setErr('')
      })
      .catch((e) => setErr(String(e)))
    void ipc
      .eventHistory(id, 8)
      .then(setHistory)
      .catch(() => {})
  }, [id, item.at])

  useEffect(() => {
    load()
  }, [load])

  const save = async (done: boolean | null, text: string) => {
    if (!id) return
    setSaving(true)
    try {
      const saved = await ipc.eventEntrySave(id, item.at, done, text)
      setEntry(saved)
      setErr('')
      setHistory(await ipc.eventHistory(id, 8))
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  const done = entry?.done ?? null
  const kept = history.filter((h) => h.done === true).length
  const answered = history.filter((h) => h.done != null).length

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
      <div className="flex items-center gap-2">
        <button className="btn-ghost text-[11px]" onClick={onBack}>
          <Icon name="chevron-left" size={12} /> Calendar
        </button>
        <div className="flex-1" />
        <button
          className="btn-ghost px-1.5 text-[11px]"
          title="The occurrence before this one"
          onClick={() => onStep(item, -1)}
        >
          <Icon name="chevron-left" size={12} />
        </button>
        <button
          className="btn-ghost px-1.5 text-[11px]"
          title="The next occurrence"
          onClick={() => onStep(item, 1)}
        >
          <Icon name="chevron-right" size={12} />
        </button>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[16px] font-semibold text-ink">{item.title}</h2>
          <span className="rounded bg-soft px-1.5 py-px text-[10px] text-muted">
            {item.sort}
          </span>
          <span className="rounded bg-soft px-1.5 py-px text-[10px] text-muted">
            {item.space || 'personal'}
          </span>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          {longDate(item.at)} · {hhmm(item.at)}
          {item.end > item.at && ` · ${Math.round((item.end - item.at) / 60000)}m`}
        </div>
        {/* What it is for, when it says so — and a way through to it, since
            the whole point of the link is not having to go and find the
            thing this is about. */}
        {item.feature && item.kind !== 'deadline' && (
          <button
            className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-indigo-400 hover:underline"
            title="Open the feature this is for"
            onClick={() => {
              const app = useApp.getState()
              app.setRailView('team')
              app.setTeamTab('features')
            }}
          >
            <Icon name="project" size={11} />
            For {item.feature}
            {item.work_item ? ` · ${item.work_item}` : ''}
          </button>
        )}
      </div>

      {err && (
        <div className="rounded border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[11.5px] text-err">
          {err}
        </div>
      )}

      {/* Three answers, and the third is "nothing yet" — which is why the
          chosen one can be un-chosen rather than only replaced. */}
      <div className="flex gap-2">
        <button
          className={`flex-1 rounded-md border px-3 py-2 text-[12px] ${
            done === true
              ? 'border-emerald-500/45 bg-emerald-500/10 text-ok'
              : 'border-line text-dim hover:bg-hover/40'
          }`}
          disabled={saving || !id}
          onClick={() => void save(done === true ? null : true, notes)}
        >
          <Icon name="check" size={12} /> Did it
        </button>
        <button
          className={`flex-1 rounded-md border px-3 py-2 text-[12px] ${
            done === false
              ? 'border-amber-500/45 bg-amber-500/10 text-warn'
              : 'border-line text-dim hover:bg-hover/40'
          }`}
          disabled={saving || !id}
          onClick={() => void save(done === false ? null : false, notes)}
        >
          <Icon name="close" size={12} /> Skipped
        </button>
      </div>

      <div className="rounded-lg border border-line bg-panel p-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
          This time
        </div>
        <textarea
          className="input min-h-[90px] w-full resize-y text-[12px] leading-[1.55]"
          placeholder="What happened, what to change next time…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes.trim() !== (entry?.notes ?? '')) void save(done, notes)
          }}
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            className="btn-primary text-[11px]"
            disabled={saving || !id || notes.trim() === (entry?.notes ?? '')}
            onClick={() => void save(done, notes)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <span className="text-[10px] text-faint">
            {entry?.updated_at
              ? `Written ${new Date(entry.updated_at).toLocaleString()}`
              : 'Nothing written for this one yet'}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
            Last few
          </span>
          {answered > 0 && (
            <span className="ml-auto text-[11px] text-ok">
              {kept} of the last {answered}
            </span>
          )}
        </div>
        {history.length === 0 ? (
          <div className="px-3 py-3 text-[11.5px] leading-[1.6] text-muted">
            Nothing recorded yet. Answering one occurrence starts the record — a week you
            never answered stays blank rather than counting against you.
          </div>
        ) : (
          history.map((h) => (
            <div
              key={h.day}
              className="flex items-baseline gap-2.5 border-t border-line px-3 py-1.5 first:border-0"
            >
              <Icon
                name={h.done === true ? 'check' : h.done === false ? 'close' : 'info'}
                size={11}
                className={
                  h.done === true ? 'text-ok' : h.done === false ? 'text-warn' : 'text-faint'
                }
              />
              <span className="w-[86px] shrink-0 text-[11px] text-muted">
                {shortDate(h.day)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">
                {(h.notes ?? '') || (h.done === true ? 'done' : h.done === false ? 'skipped' : '—')}
              </span>
            </div>
          ))
        )}
      </div>

      {!id && (
        <div className="rounded-lg border border-line bg-raise px-3 py-2 text-[11.5px] leading-[1.6] text-muted">
          This is a deadline on a work item, not a schedule — its record is the work item
          itself, in the vault beside the feature. There is nothing personal to write down
          here, which is the store split doing its job.
        </div>
      )}
    </div>
  )
}
