// Making a bot: it drafts one first and asks you to change it.
//
// A blank form is a worse question than a wrong answer. So this arrives already
// filled in — a starter, a name, a routine — and every line is editable. The
// only thing it will not invent is your goal, because a template that makes up
// your deadline is a template you have to correct.
//
// The workspace decides the defaults before anything else. A bot in a personal
// space starts quiet; one in a business space starts on work hours. That is not
// two hard-coded categories — it reads the workspace's own label, which you set
// in Settings, and only changes the *defaults*, all of which are on screen.

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { DAYS, EVERY_OPTIONS, hhmm, toMin } from '../../lib/bots'
import { findNode, subtreeIds, workspaceOf } from '../../lib/tree'

/** Labels that mean "this is not work". Everything else is treated as work,
 *  which is the safer default: a bot that starts too quiet is a nuisance; one
 *  that pings you at 07:00 about your family folder is worse. */
const QUIET = ['personal', 'private', 'family', 'home', 'health', 'life']

export function BotCreate({
  nodeId: fixedNode,
  onClose,
  onCreated,
}: {
  nodeId?: number
  onClose: () => void
  onCreated: (bot: ipc.Bot) => void
}) {
  const { nodes, activeWorkspaceId, bots } = useApp()
  const [templates, setTemplates] = useState<ipc.BotTemplate[]>([])
  const [templateId, setTemplateId] = useState('website')
  const [nodeId, setNodeId] = useState<number | null>(fixedNode ?? null)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [every, setEvery] = useState('weekdays')
  const [at, setAt] = useState('08:00')
  const [days, setDays] = useState<string[]>([])
  const [withPlan, setWithPlan] = useState(true)
  const [touchedName, setTouchedName] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void ipc.botCatalog().then(setTemplates).catch((e) => setErr(String(e)))
  }, [])

  // Anything in the workspace that could have one, the workspace included —
  // a bot for the whole of Business is a reasonable thing to want.
  const choices = useMemo(() => {
    if (activeWorkspaceId == null) return []
    const ids = new Set(subtreeIds(nodes, activeWorkspaceId))
    const taken = new Set(bots.map((b) => b.node_id))
    return nodes.filter((n) => ids.has(n.id) && !taken.has(n.id))
  }, [nodes, bots, activeWorkspaceId])

  const node = nodeId == null ? null : findNode(nodes, nodeId)
  const ws = workspaceOf(nodes, node)
  // Only the tag decides. This used to fall back to the workspace's *name*, so
  // a space called "Health" came out personal and "Innotrack" came out business
  // by string luck rather than because anyone had said so. An untagged
  // workspace is undecided, and the draft says so instead of pretending.
  const label = (ws?.label ?? '').toLowerCase()
  const tagged = label.length > 0
  const quiet = QUIET.some((q) => label.includes(q))
  const template = templates.find((t) => t.id === templateId) ?? null

  // Re-draft when the starter or the space changes — but never overwrite a name
  // you have typed.
  useEffect(() => {
    if (!template) return
    if (!touchedName) setName(node ? `${node.name} bot` : template.name)
    setEvery(quiet ? 'weekly' : template.every)
    setAt(quiet ? '18:00' : hhmm(template.at_min))
    setDays(quiet ? ['0'] : [])
    setWithPlan(template.steps.length > 0)
  }, [template, node, quiet, touchedName])

  const create = () => {
    if (nodeId == null || busy) return
    setBusy(true)
    setErr('')
    void ipc
      .botCreate({
        nodeId,
        templateId,
        name,
        goal,
        every,
        atMin: toMin(at),
        days: days.join(','),
        withPlan,
      })
      .then(onCreated)
      .catch((e) => {
        setErr(String(e))
        setBusy(false)
      })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[6vh]" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[660px] flex-col rounded-xl border border-line2 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
            <Icon name="bot" size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink">A new bot</div>
            <div className="text-[11px] text-muted">
              It is drafted for you. Change anything before it exists.
            </div>
          </div>
          <button className="btn-ghost text-[11.5px]" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <div className="flex flex-col gap-3.5">
            {/* Which space, and what that already decided */}
            <div>
              <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                For which space
              </label>
              {fixedNode != null ? (
                <div className="rounded-lg border border-line bg-page px-3 py-2 text-[12.5px] text-body">
                  {node?.name ?? fixedNode}
                </div>
              ) : (
                <select
                  className="input w-full text-[12.5px]"
                  value={nodeId ?? ''}
                  onChange={(e) => setNodeId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Pick one…</option>
                  {choices.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              )}

              {ws && (
                <div
                  className={`mt-2 flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                    !tagged
                      ? 'border-line bg-page'
                      : quiet
                        ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
                        : 'border-sky-500/25 bg-sky-500/[0.04]'
                  }`}
                >
                  <span
                    className={`shrink-0 rounded-full px-2 text-[9px] font-semibold uppercase tracking-[0.04em] leading-[1.7] ${
                      !tagged
                        ? 'bg-soft text-muted'
                        : quiet
                          ? 'bg-emerald-500/15 text-ok'
                          : 'bg-sky-500/15 text-info'
                    }`}
                  >
                    {ws.label || 'untagged'}
                  </span>
                  <span className="min-w-0 flex-1 text-[11px] leading-[1.5] text-body">
                    {!tagged
                      ? `${ws.name} is not tagged Business or Personal, so this starts on work hours. Right-click its tab to tag it.`
                      : quiet
                        ? 'This space is not work, so it starts quiet: weekly, in the evening. Change it below.'
                        : 'A work space, so it starts on work hours. Change it below.'}
                  </span>
                </div>
              )}
            </div>

            {/* The starter */}
            <div>
              <label className="mb-1.5 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                What kind of bot
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className={`rounded-lg border px-3 py-2.5 text-left ${
                      templateId === t.id
                        ? 'border-indigo-500/50 bg-indigo-500/[0.06]'
                        : 'border-line bg-page hover:border-line2'
                    }`}
                    onClick={() => setTemplateId(t.id)}
                  >
                    <div className="text-[12.5px] font-semibold text-ink">{t.name}</div>
                    <div className="mt-0.5 text-[10.5px] leading-[1.45] text-muted">{t.what}</div>
                    {(t.steps.length > 0 || t.skills.length > 0) && (
                      <div className="mt-1.5 text-[10px] text-faint">
                        {t.steps.length > 0 && `${t.steps.length} steps`}
                        {t.steps.length > 0 && t.skills.length > 0 && ' · '}
                        {t.skills.length > 0 && `${t.skills.length} skills`}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                Called
              </label>
              <input
                className="input w-full text-[12.5px]"
                value={name}
                onChange={(e) => {
                  setTouchedName(true)
                  setName(e.target.value)
                }}
              />
            </div>

            <div>
              <label className="mb-1 block text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                Its goal
              </label>
              <input
                autoFocus
                className="input w-full text-[12.5px]"
                placeholder={template?.goal_hint || 'What are you trying to get done here?'}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <p className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
                The one thing it will not guess. Without a goal it has nothing to judge a suggestion
                against.
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
            </div>

            {/* The steps, and the honest warning about where they land */}
            {template && template.steps.length > 0 && (
              <div className="rounded-lg border border-line bg-page px-3.5 py-3">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-[3px]"
                    checked={withPlan}
                    onChange={(e) => setWithPlan(e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-[12px] text-ink">
                      Start it with {template.steps.length} steps
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-[1.5] text-muted">
                      Written into this project’s <code>.devdeck</code> as work items — committed,
                      and visible to anyone who clones the repo. You can add them later instead.
                    </span>
                  </span>
                </label>
                <ul className="mt-2 flex flex-col gap-0.5 pl-[26px]">
                  {template.steps.slice(0, 3).map((s) => (
                    <li key={s} className="text-[10.5px] text-faint">
                      · {s}
                    </li>
                  ))}
                  {template.steps.length > 3 && (
                    <li className="text-[10.5px] text-faint">
                      and {template.steps.length - 3} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {template && template.standards.length > 0 && (
              <div className="rounded-lg border border-line bg-page px-3.5 py-3">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  What it will hold the work to
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {template.standards.map((s) => (
                    <li key={s} className="text-[11px] leading-[1.5] text-muted">
                      · {s}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10.5px] text-faint">
                  These go in the bot’s own file, where you can edit them. A standard you cannot
                  change is someone else’s.
                </p>
              </div>
            )}

            {err && <div className="text-[11.5px] text-err">{err}</div>}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <button
            className="btn-primary text-[12px]"
            disabled={nodeId == null || !goal.trim() || !name.trim() || busy}
            onClick={create}
          >
            Make it
          </button>
          <span className="text-[10.5px] text-faint">
            It will ask you six questions afterwards. You can skip any of them.
          </span>
        </div>
      </div>
    </div>
  )
}
