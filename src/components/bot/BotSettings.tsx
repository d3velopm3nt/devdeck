// Everything about a bot you can change, in one place, including deleting it.
//
// The routine is written here and lands in `_bot.md`; the `schedules` row is
// only the clock agreeing with the file. That is why this is the *only* place a
// heartbeat is edited — the Scheduler shows it and sends you back here rather
// than offering an Edit the next list would silently undo.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { DAYS, EVERY_OPTIONS, hhmm, toMin } from '../../lib/bots'

export function BotSettings({
  bot,
  reload,
  onDeleted,
}: {
  bot: ipc.Bot
  reload: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(bot.name)
  const [goal, setGoal] = useState(bot.goal)
  const [every, setEvery] = useState(bot.every)
  const [at, setAt] = useState(hhmm(bot.at_min))
  const [days, setDays] = useState<string[]>(
    bot.days ? bot.days.split(',').map((d) => d.trim()).filter(Boolean) : [],
  )
  const [body, setBody] = useState(bot.body)
  const [skills, setSkills] = useState(bot.skills.join(', '))
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  // Re-seed when the bot changes under us — a skill added on the Tools tab
  // must not be reverted by a stale form.
  useEffect(() => {
    setName(bot.name)
    setGoal(bot.goal)
    setEvery(bot.every)
    setAt(hhmm(bot.at_min))
    setDays(bot.days ? bot.days.split(',').map((d) => d.trim()).filter(Boolean) : [])
    setBody(bot.body)
    setSkills(bot.skills.join(', '))
  }, [bot])

  const dirty =
    name !== bot.name ||
    goal !== bot.goal ||
    every !== bot.every ||
    at !== hhmm(bot.at_min) ||
    days.join(',') !== bot.days ||
    body !== bot.body ||
    skills !== bot.skills.join(', ')

  const save = () => {
    setErr('')
    void ipc
      .botSave({
        nodeId: bot.node_id,
        name,
        goal,
        every,
        atMin: toMin(at),
        days: days.join(','),
        body,
        skills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      .then(() => {
        setSaved(true)
        setTimeout(() => setSaved(false), 1800)
        reload()
      })
      .catch((e) => setErr(String(e)))
  }

  const remove = () => {
    if (
      !confirm(
        `Delete ${bot.name}?\n\nIts folder, its work items and everything else in the space stay. ` +
          `What it knew about you is forgotten.`,
      )
    )
      return
    setErr('')
    void ipc.botDelete(bot.node_id).then(onDeleted).catch((e) => setErr(String(e)))
  }

  return (
    <div className="flex max-w-[620px] flex-col gap-4">
      {err && <div className="rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] text-err">{err}</div>}

      <div>
        <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Called
        </label>
        <input className="input w-full text-[12.5px]" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Its goal
        </label>
        <input className="input w-full text-[12.5px]" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
          Required. Without one it has nothing to judge a suggestion against.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Wakes
        </label>
        <div className="flex items-center gap-2">
          <select
            className="input flex-1 text-[12px]"
            value={every}
            onChange={(e) => setEvery(e.target.value)}
          >
            {EVERY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {every && every !== 'hourly' && (
            <input
              type="time"
              className="input w-[110px] text-[12px]"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          )}
        </div>

        {every === 'weekly' && (
          <div className="mt-2 flex gap-1">
            {DAYS.map((d, i) => {
              const on = days.includes(String(i))
              return (
                <button
                  key={d}
                  className={`flex-1 rounded py-1 text-[10px] ${
                    on ? 'bg-indigo-500/20 text-indigo-300' : 'bg-soft text-muted'
                  }`}
                  onClick={() =>
                    setDays(on ? days.filter((x) => x !== String(i)) : [...days, String(i)])
                  }
                >
                  {d}
                </button>
              )
            })}
          </div>
        )}

        <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
          Waking reads the space and writes at most one line to your inbox — nothing at all when
          there is nothing to say. It does not run an agent: that needs a standing grant the
          permission model does not offer yet.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Skills
        </label>
        <input
          className="input w-full text-[12.5px]"
          placeholder="seo, accessibility"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
        />
        <p className="mt-1.5 text-[10.5px] text-muted">
          Comma separated. Words it follows — no permissions, nothing installed.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          What it is for, and what it holds the work to
        </label>
        <textarea
          className="input w-full min-h-[160px] resize-y font-mono text-[11.5px] leading-[1.6]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'## What it holds the work to\n\n- One page, one job.'}
        />
        <p className="mt-1.5 text-[10.5px] text-muted">
          The body of <code>_bot.md</code>. A standard you cannot edit is someone else’s standard.
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-3.5">
        <button className="btn-primary text-[12px]" disabled={!dirty} onClick={save}>
          Save
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-[11.5px] text-ok">
            <Icon name="check" size={12} /> Saved
          </span>
        )}
        {dirty && !saved && <span className="text-[11px] text-faint">Unsaved changes</span>}
        <button className="btn-danger ml-auto text-[12px]" onClick={remove}>
          Delete this bot
        </button>
      </div>

      <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Where it lives
        </div>
        <div className="mt-1.5 break-all font-mono text-[11px] text-muted">{bot.dir}\_bot.md</div>
        <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
          Everything above is in that file, so it travels with the folder. What it knows about
          <em> you</em> is kept somewhere else entirely, and never committed.
        </p>
      </div>
    </div>
  )
}
