// A goal, as one page.
//
// This replaces the thread that used to sit here. Three lists — Goals,
// Features, Work — all opened the same feature chat, so whatever you clicked,
// at whatever level, you landed in the same stream.
//
// **Almost nothing in that stream was conversation.** Smith asking for a
// shell, Smith's blocked report, a wake report, "Smith started on w04" — every
// one of them was *about a work item*, and the stream had flattened them into
// prose with the subject lost. That is why you could read Smith's question and
// not be able to answer it: the question rendered as a sentence in a chat
// instead of as a control on the item it was blocking.
//
// So each of those goes back onto the thing it is about, and the page carries
// no chat box at all. You steer a manager by editing its goal — the sentence
// at the top is the standing instruction its wake actually reads, not a label
// describing one.
//
// **The goal here is the manager's, from `_bot.md`.** The feature's own `goal:`
// is a different sentence — what *done* looks like — and is shown as that. They
// were confused once and the confusion cost: Studio's plan carried a truncated
// copy of its manager's instruction in the "what done looks like" slot, the
// board showed the cut sentence, and editing it would have changed nothing
// about what Studio does.

import { useCallback, useEffect, useState } from 'react'
import { useAiw } from '../../lib/aiwStore'
import type { GoalRow } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { fmtAgo } from '../../lib/time'
import type { Board } from './TeamPage'

/// Colour per status. Blocked is the only warm one: it is the only status that
/// is asking you for something.
function statusDot(status: string): string {
  // Violet, and its own colour on purpose: a proposal is not work yet. It is
  // the one status nothing can start from, so it must not look like the ones
  // that can.
  if (status === 'proposed') return 'bg-violet-400'
  // Built is not done and must not look like it: the files exist on a branch
  // nobody has read, and the main line has none of them.
  if (status === 'built') return 'bg-sky-400'
  if (status === 'done') return 'bg-line3'
  if (status === 'blocked') return 'bg-amber-400'
  if (status === 'in-progress') return 'bg-emerald-400'
  if (status === 'claimed') return 'bg-indigo-400'
  return 'bg-line2'
}

/// What a worker is asking for, in one line.
///
/// The whole command, not a summary: you are being asked to allow *this*, and
/// a paraphrase is not the thing you would be allowing.
function askLine(a: ipc.Ask): string {
  const c = a.input?.command
  if (typeof c === 'string' && c.trim()) return c.trim()
  const d = a.input?.description
  if (typeof d === 'string' && d.trim()) return d.trim()
  return a.tool
}

export function GoalPage({ goal, board }: { goal: GoalRow; board: Board }) {
  const a = useAiw()
  const [bot, setBot] = useState<ipc.Bot | null>(null)
  const [runs, setRuns] = useState<ipc.Run[]>([])
  const [asks, setAsks] = useState<Record<string, ipc.Ask[]>>({})
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  // The handle, never the name: `bot_get` reads `<handle>.md`, so looking a
  // manager up by what it is *called* only worked because Windows filenames
  // are case-insensitive.
  const handle = goal.managed_handle ?? ''

  const load = useCallback(async () => {
    setErr('')
    await a.loadAllWork()
    try {
      const [b, rs] = await Promise.all([
        handle ? ipc.botGet(handle) : Promise.resolve(null),
        ipc.runsList(goal.node_id),
      ])
      setBot(b)
      setRuns(rs)
      // Only a live run can still be answered. Asking after the fact would
      // put a pair of buttons under a question nobody is waiting on.
      const live = rs.filter((r) => r.status === 'running')
      const got = await Promise.all(
        live.map((r) => ipc.workerAsks(r.id).then((q) => [r.id, q] as const).catch(() => [r.id, []] as const)),
      )
      setAsks(Object.fromEntries(got))
    } catch (e) {
      setErr(String(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, goal.node_id])

  useEffect(() => {
    void load()
    setDraft(null)
  }, [load])

  /// Every feature this manager owns in this space. A manager is responsible
  /// for features rather than for a folder, and the goal it is working to
  /// spans all of them — so showing one and hiding the rest would be showing
  /// you a part and calling it the whole.
  ///
  /// Only when there *is* a manager. Grouping on an empty handle put every
  /// unmanaged feature in a space onto one page, so picking Innotrack's
  /// engineering plan also showed its product plan as if one thing owned both.
  /// A feature nobody manages is its own page and nothing else's.
  ///
  /// Matched on the handle, like the lookup. Matching on `managed_by` — the
  /// name — compared "Studio" against "studio" and found nothing, so the page
  /// rendered a manager with no plan at all.
  const shown = handle
    ? board.rows.filter((r) => r.node_id === goal.node_id && r.managed_handle === handle)
    : [goal]

  const workFor = (featureId: string) =>
    a.allWork.find((f) => Number(f.project_id) === goal.node_id && f.feature_id === featureId)

  /// Claims still held. A released claim naming an agent who finished hours
  /// ago reads exactly like one being worked on now.
  const held = new Map(
    a.claims
      .filter((c) => c.status === 'active' && c.work_item_id)
      .map((c) => [c.work_item_id as string, c.agent_id]),
  )

  /// The most recent run for a work item, which is the one worth showing.
  const runFor = (itemId: string) =>
    runs
      .filter((r) => r.item === itemId)
      .sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)))[0]

  const decide = async (featureId: string, ids: string[], yes: boolean) => {
    setErr('')
    setBusy(ids.join(',') || featureId)
    try {
      const n = yes
        ? await ipc.workAgree(goal.node_id, featureId, ids)
        : await ipc.workDecline(goal.node_id, featureId, ids)
      if (n === 0) setErr('Nothing moved — those were not proposals any more.')
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  const merge = async (featureId: string) => {
    setErr('')
    setBusy(featureId)
    try {
      setNote(await ipc.workMerge(goal.node_id, featureId))
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  const answerAsk = async (run: string, ask: string, allow: boolean) => {
    setErr('')
    setBusy(ask)
    try {
      await ipc.workerAnswer(run, ask, allow)
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  const saveGoal = async () => {
    if (!bot || draft == null || draft.trim() === bot.goal.trim()) {
      setDraft(null)
      return
    }
    setErr('')
    setBusy('goal')
    try {
      const saved = await ipc.botSave({
        nodeId: bot.node_id,
        name: bot.name,
        goal: draft.trim(),
        every: bot.every,
        atMin: bot.at_min,
        days: bot.days,
        body: bot.body,
        skills: bot.skills,
        agent: bot.agent,
        team: bot.team,
        wakeIntent: bot.wake_intent,
      })
      setBot(saved)
      setDraft(null)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-[760px]">
        {/* A manager's page is named after the manager; a feature nobody
            manages is named after itself, rather than claiming a manager it
            does not have. */}
        <div className="flex items-baseline gap-2">
          <h2 className="text-[17px] font-semibold text-ink">
            {bot?.name ?? (handle || goal.feature_name)}
          </h2>
          <span className="text-[11.5px] text-muted">
            {bot || handle ? `manages ${goal.space}` : `in ${goal.space}`}
          </span>
        </div>

        {err && (
          <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11.5px] text-err">
            {err}
          </div>
        )}
        {note && (
          <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11.5px] text-ok">
            {note}
          </div>
        )}

        {/* The instruction. Editing this is how you steer — there is nothing
            else to type into, by design. */}
        {bot ? (
          <div className="mt-4">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
                The instruction
              </span>
              <span className="text-[10.5px] text-faint">
                what it reads when it wakes — change this to change what it does
              </span>
            </div>
            <textarea
              id="goal-instruction"
              className="w-full resize-y rounded-lg border border-line2 bg-panel px-3 py-2 text-[12.5px] leading-relaxed text-body outline-none focus:border-indigo-500/60"
              rows={3}
              value={draft ?? bot.goal}
              disabled={busy === 'goal'}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void saveGoal()}
            />
            {draft != null && draft.trim() !== bot.goal.trim() && (
              <div className="mt-1 flex items-center gap-2">
                <button className="btn-primary px-2 py-0.5 text-[11px]" onClick={() => void saveGoal()}>
                  Save
                </button>
                <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setDraft(null)}>
                  Discard
                </button>
                <span className="text-[10.5px] text-faint">it takes effect on the next wake</span>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
              {bot.worker ? (
                <span>
                  worker <span className="text-body">{bot.worker}</span>
                </span>
              ) : (
                <span className="text-faint">no worker — it can plan, and hand to nobody</span>
              )}
              {bot.every && (
                <span>
                  wakes {bot.every}{' '}
                  {String(Math.floor(bot.at_min / 60)).padStart(2, '0')}:
                  {String(bot.at_min % 60).padStart(2, '0')}
                </span>
              )}
              {bot.stop_at.length > 0 && <span>stops at: {bot.stop_at.join(' · ')}</span>}
              {!!bot.last_woke && <span>woke {fmtAgo(bot.last_woke, Date.now())}</span>}
            </div>

            {/* What it said last time it woke.
                A wake report is not a work item and has no run to hang off, so
                the thread was the only place it appeared — and deleting the
                thread without this would have quietly thrown away the one
                account of what a manager did all night. */}
            {bot.last_note?.trim() && (
              <div
                className={`mt-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${
                  bot.last_ok
                    ? 'border-line2 bg-panel text-dim'
                    : 'border-amber-500/30 bg-amber-500/[0.06] text-dim'
                }`}
              >
                <span className="text-faint">last wake · </span>
                {bot.last_note?.trim()}
              </div>
            )}
          </div>
        ) : (
          /* "Nobody owns this" and "I have not read it yet" are different
             things, and saying the first while the second is true is the
             update checker's old bug in miniature: a failed read wearing the
             face of an answer. */
          <div className="mt-4 rounded-lg border border-line2 bg-panel px-3 py-2 text-[11.5px] text-muted">
            {handle
              ? 'Reading its file…'
              : 'No manager owns this yet, so there is no standing instruction to edit.'}
          </div>
        )}

        {/* Its features, and the work under each. */}
        {shown.map((f) => {
          const work = workFor(f.feature_id)
          const items = work?.items ?? []
          const proposed = items.filter((i) => i.status === 'proposed')
          return (
            <div key={f.feature_id} className="mt-6">
              <div className="flex items-baseline gap-2 border-b border-line pb-1">
                <h3 className="text-[13.5px] font-semibold text-ink">{f.feature_name}</h3>
                {/* Two numbers, because they are two different facts and
                    one of them used to swallow the other: built is on a
                    branch, done is on the main line. */}
                <span className="ml-auto text-[10.5px] text-muted">
                  {items.filter((i) => i.status === 'built').length > 0 && (
                    <span className="text-info">
                      {items.filter((i) => i.status === 'built').length} built ·{' '}
                    </span>
                  )}
                  {items.filter((i) => i.status === 'done').length} of {items.length} done
                </span>
              </div>
              {/* A feature's own goal is a different sentence from its
                  manager's: what *done* looks like, not what to keep doing.
                  Studio's plan carries a copy of the manager's instruction in
                  that slot — written there by `bots::ensure_plan` — so showing
                  it would print the same sentence twice under two different
                  names. The copy is the bug; not repeating it is the least
                  this page can do about it. */}
              {f.goal && f.goal.trim() !== (bot?.goal ?? '').trim() && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
                  <span className="text-faint">done looks like: </span>
                  {f.goal}
                </p>
              )}

              {/* The goal ships, not an item: its branch carries every item
                  on it. Shown only when something is actually built, so the
                  control appears exactly when it means something. */}
              {items.some((i) => i.status === 'built') && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-3 py-1.5">
                  <span className="min-w-0 flex-1 text-[11.5px] text-dim">
                    {items.filter((i) => i.status === 'built').length} built on{' '}
                    <code className="font-mono text-[10.5px] text-muted">
                      devdeck/{f.feature_id}
                    </code>{' '}
                    — on a branch, not on the main line.
                  </span>
                  <button
                    className="btn-primary shrink-0 px-2 py-0.5 text-[11px]"
                    disabled={busy !== null}
                    onClick={() => void merge(f.feature_id)}
                  >
                    Merge
                  </button>
                </div>
              )}

              {proposed.length > 0 && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-violet-500/25 bg-violet-500/[0.07] px-3 py-1.5">
                  <span className="min-w-0 flex-1 text-[11.5px] text-dim">
                    {bot?.name ?? 'A manager'} suggests {proposed.length}. Nothing starts until you
                    say so.
                  </span>
                  <button
                    className="btn-primary shrink-0 px-2 py-0.5 text-[11px]"
                    disabled={busy !== null}
                    onClick={() => void decide(f.feature_id, [], true)}
                  >
                    Agree to all
                  </button>
                  <button
                    className="btn-ghost shrink-0 px-2 py-0.5 text-[11px]"
                    disabled={busy !== null}
                    onClick={() => void decide(f.feature_id, [], false)}
                  >
                    No
                  </button>
                </div>
              )}

              {items.length === 0 && (
                <p className="mt-2 text-[11.5px] text-faint">Nothing on this plan yet.</p>
              )}

              <div className="mt-1">
                {items.map((i) => {
                  const by = held.get(i.id)
                  const run = runFor(i.id)
                  const open = run ? (asks[run.id] ?? []) : []
                  return (
                    <div key={i.id} className="border-b border-line/60 py-1.5 last:border-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusDot(i.status)}`}
                        />
                        <span
                          className={`min-w-0 flex-1 text-[12px] ${
                            i.status === 'done' ? 'text-muted line-through' : 'text-body'
                          }`}
                        >
                          {i.title}
                        </span>
                        {i.status === 'proposed' ? (
                          <>
                            <button
                              className="btn-primary shrink-0 px-2 py-0.5 text-[10.5px]"
                              disabled={busy !== null}
                              onClick={() => void decide(f.feature_id, [i.id], true)}
                            >
                              Agree
                            </button>
                            <button
                              className="btn-ghost shrink-0 px-2 py-0.5 text-[10.5px]"
                              disabled={busy !== null}
                              onClick={() => void decide(f.feature_id, [i.id], false)}
                            >
                              No
                            </button>
                          </>
                        ) : i.status === 'built' ? (
                          /* Built is a state, not a button. Its goal's branch
                             carries every item on it, so merging one alone is
                             not a thing that can happen — the control for that
                             belongs to the goal. */
                          <span className="shrink-0 text-[10.5px] text-info">on the branch</span>
                        ) : by ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 text-[9.5px] font-semibold text-ok">
                            {by}
                          </span>
                        ) : i.assignee ? (
                          <span className="shrink-0 text-[10.5px] text-muted">{i.assignee}</span>
                        ) : (
                          <span className="shrink-0 text-[10.5px] text-faint">nobody</span>
                        )}
                      </div>

                      {/* A question is a control on the item it blocks, not a
                          sentence in a stream somewhere else. */}
                      {open.map((q) => (
                        <div
                          key={q.id}
                          className="ml-4 mt-1 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-dim">
                              {run?.worker_name ?? 'It'} needs {q.tool} and cannot without a yes
                            </div>
                            <code className="mt-0.5 block truncate font-mono text-[10.5px] text-muted">
                              {askLine(q)}
                            </code>
                          </div>
                          <button
                            className="btn-primary shrink-0 px-2 py-0.5 text-[10.5px]"
                            disabled={busy !== null}
                            onClick={() => void answerAsk(q.run, q.id, true)}
                          >
                            Yes
                          </button>
                          <button
                            className="btn-ghost shrink-0 px-2 py-0.5 text-[10.5px]"
                            disabled={busy !== null}
                            onClick={() => void answerAsk(q.run, q.id, false)}
                          >
                            No
                          </button>
                        </div>
                      ))}

                      {/* What happened to it, under it. The receipts were the
                          record in the thread, and they stay the record — filed
                          on the item rather than in a stream. */}
                      {run && (
                        <div className="ml-4 mt-1 text-[10.5px] leading-relaxed text-faint">
                          <span className={run.ok ? 'text-muted' : 'text-warn'}>{run.status}</span>
                          {' · '}
                          {run.worker_name}
                          {run.files.length > 0 && ` · ${run.files.length} file${run.files.length === 1 ? '' : 's'}`}
                          {run.branch && ` · ${run.branch}`}
                          {run.verdict && (
                            <div className="mt-0.5 whitespace-pre-wrap text-muted">
                              {run.verdict.split('\n')[0]}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="mt-8 flex items-center gap-2 text-[10.5px] text-faint">
          <button className="flex items-center gap-1 hover:text-ink" onClick={() => void load()}>
            <Icon name="update" size={11} /> Read it again
          </button>
          <span>Items live in each feature&rsquo;s work.md in the vault.</span>
        </div>
      </div>
    </div>
  )
}
