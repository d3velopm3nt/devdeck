// What the bot could use, as a ladder.
//
// A skill is words. An agent is words plus permissions. Software is a real
// install. Self-hosted is something that keeps running. The bot proposes the
// cheapest rung that would work, and every rung above the first says out loud
// what it wants before you say yes.
//
// Two things this page will not do, and says so rather than hiding it: it never
// installs software and it never starts a service. Saying yes to those records
// the decision and tells you the step you have to take yourself. An app that
// quietly installed things on a bot's say-so would be the worst thing in this
// repository.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { TOOL_KIND } from '../../lib/bots'

const ORDER = ['skill', 'agent', 'software', 'self-hosted']

export function BotTools({ bot, onChanged }: { bot: ipc.Bot; onChanged: () => void }) {
  const [tools, setTools] = useState<ipc.ToolOffer[]>([])
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const load = () => void ipc.botTools(bot.node_id).then(setTools).catch((e) => setErr(String(e)))
  useEffect(load, [bot.node_id])

  const decide = (id: string, response: string) => {
    setErr('')
    setNote('')
    void ipc
      .botToolDecide(bot.node_id, id, response)
      .then((msg) => {
        if (msg) setNote(msg)
        load()
        onChanged()
      })
      .catch((e) => setErr(String(e)))
  }

  const sorted = [...tools].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))

  return (
    <div className="flex flex-col gap-3.5">
      {err && <div className="rounded-lg bg-red-500/[0.07] px-3 py-2 text-[11.5px] text-err">{err}</div>}
      {note && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-2.5">
          <Icon name="alert" size={13} className="mt-[1px] shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-body">{note}</span>
          <button className="shrink-0 text-[11px] text-faint hover:text-dim" onClick={() => setNote('')}>
            Got it
          </button>
        </div>
      )}

      {bot.skills.length > 0 && (
        <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            What it has learned
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bot.skills.map((s) => (
              <span
                key={s}
                className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10.5px] text-ok"
              >
                {s}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-faint">
            Written into <code>_bot.md</code>, so they travel with the folder.
          </p>
        </div>
      )}

      {sorted.length === 0 && (
        <div className="rounded-lg border border-line bg-panel px-4 py-6 text-center text-[11.5px] text-muted">
          Nothing to offer.
        </div>
      )}

      <div className="grid gap-2.5 lg:grid-cols-2">
        {sorted.map((t) => {
          const k = TOOL_KIND[t.kind] ?? TOOL_KIND.skill
          const costly = t.kind !== 'skill'
          return (
            <div
              key={t.id}
              className={`flex flex-col gap-2 rounded-lg border bg-panel px-3.5 py-3 ${
                t.decided === 'added'
                  ? 'border-emerald-500/30'
                  : t.decided === 'declined'
                    ? 'border-line opacity-60'
                    : costly
                      ? 'border-amber-500/25'
                      : 'border-line'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                  {t.name}
                </span>
                <span className={`shrink-0 rounded-full px-2 text-[9px] font-semibold uppercase tracking-[0.04em] leading-[1.7] ${k.tint}`}>
                  {k.label}
                </span>
              </div>

              <p className="text-[11px] leading-[1.5] text-muted">{t.what}</p>

              {t.because && (
                <p className="text-[11px] leading-[1.5] text-dim">
                  <span className="text-faint">Because: </span>
                  {t.because}
                </p>
              )}

              <div className={`text-[10.5px] ${costly ? 'text-warn' : 'text-faint'}`}>
                {t.wants ? `Wants: ${t.wants}` : 'Wants: nothing'}
              </div>

              {t.decided ? (
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] ${t.decided === 'added' ? 'text-ok' : 'text-muted'}`}
                  >
                    {t.decided === 'added' ? 'Added' : 'You said no'}
                  </span>
                  <button
                    className="btn-ghost ml-auto text-[10.5px]"
                    onClick={() => decide(t.id, t.decided === 'added' ? 'declined' : 'added')}
                  >
                    {t.decided === 'added' ? 'Take it back' : 'Change your mind'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    className={costly ? 'btn-ghost text-[11px] text-warn' : 'btn-primary text-[11px]'}
                    onClick={() => decide(t.id, 'added')}
                  >
                    {costly ? 'Yes, I will set it up' : 'Add'}
                  </button>
                  <button className="btn-ghost text-[11px]" onClick={() => decide(t.id, 'declined')}>
                    No thanks
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[10.5px] leading-[1.6] text-faint">
        It recommends from a catalog that ships with DevDeck. It never goes and finds one —
        letting a bot discover its own capabilities is a supply-chain problem wearing a helpful face.
      </p>
    </div>
  )
}
