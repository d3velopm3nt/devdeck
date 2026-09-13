// Today — the front door.
//
// Home counted services, repos behind and crashed processes. All true, none of
// it what a Thursday looks like: point the app at a life and that dashboard has
// nothing to say, because every number on it is about code.
//
// This is the merge point instead. Five things used to speak to you from five
// places — the Inbox, a node's thread, a bot's thread, mail, and a reminder
// that fired — and knowing what wanted you meant visiting all five. They arrive
// here together, ranked by what they cost you to ignore:
//
//   * **Needs you** — an agent stopped on a clock, a bot's question, a reply
//     somebody is waiting on. Answerable from the row where that is possible.
//   * **The day** — what has a time on it, from the calendar.
//   * **You said you'd** — recurring things that have not happened, with the
//     uncomfortable part said out loud: how many times they have been missed.
//   * **Ticking over** — bots, repos and services, in one line each. This is
//     the whole of the old dashboard, and the size is the point: it is the
//     part of the morning that needs nothing from you.
//
// The area chips narrow this page and only this page. They are not the old
// workspace tabs moved down: those claimed to be a frame every view sat in,
// and most views ignored them.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import { aiw, ago } from '../lib/aiw'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { openLife, openNodeThread, openSpace } from '../lib/dock'
import { findNode, workspaceOf } from '../lib/tree'
import { DAY_MS, hhmm, startOfDay } from '../lib/calendarWindow'

/// A section heading. Small, upper, and always followed by a line saying what
/// the section is for — a heading alone makes you learn the page.
function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
        {title}
      </span>
      {note && <span className="text-[10px] text-faint">{note}</span>}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-line bg-panel">{children}</div>
}

function Dot({ tone }: { tone: string }) {
  return <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${tone}`} />
}

/// A row that leads somewhere. A div that navigates is a button everywhere
/// except to a keyboard, so it is a button.
function Row({
  children,
  onClick,
  tint,
}: {
  children: React.ReactNode
  onClick?: () => void
  tint?: string
}) {
  const cls = `flex w-full items-center gap-2.5 border-t border-line px-3 py-2.5 text-left first:border-t-0 ${
    tint ?? ''
  } ${onClick ? 'hover:bg-hover/40' : ''}`
  if (!onClick) return <div className={cls}>{children}</div>
  return (
    <button className={cls} onClick={onClick}>
      {children}
    </button>
  )
}

export function Today() {
  const app = useApp()
  const a = useAiw()
  const { nodes, todayArea, setTodayArea } = app
  const [items, setItems] = useState<ipc.CalendarItem[] | null>(null)
  const [schedules, setSchedules] = useState<ipc.Schedule[]>([])

  // Its own data, and its own live tail. Today is the first thing on screen on
  // a cold start, before the Assistant has been opened — without this it would
  // say nothing needs you, which is the one wrong answer it must never give.
  useEffect(() => {
    if (!a.ready) void a.bootstrap()
    else void a.refreshApprovals()
    let stop: (() => void) | undefined
    void aiw.onEvent((e) => useAiw.getState().pushEvent(e)).then((un) => {
      stop = un
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    const from = startOfDay(new Date()).getTime()
    // Best effort, and separately: a calendar that will not answer must not
    // blank the reminders beside it.
    setItems(await ipc.calendarRange(from, from + DAY_MS).catch(() => []))
    setSchedules(await ipc.schedulesList().catch(() => []))
  }, [])
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // The areas, in tree order. Only workspaces: a chip per client would be a
  // second tree, and the tree is one click away.
  const areas = useMemo(() => nodes.filter((n) => n.parent_id == null), [nodes])

  /// Does this belong to the area now selected? Anything without a node
  /// belongs to all of them — an approval from a project you have since moved
  /// is still an approval, and hiding it because its area cannot be worked out
  /// would be the worst way to lose one.
  const inArea = useCallback(
    (nodeId?: number | null) => {
      if (todayArea == null) return true
      if (nodeId == null) return false
      return workspaceOf(nodes, findNode(nodes, nodeId))?.id === todayArea
    },
    [todayArea, nodes],
  )

  const nodeIdOf = useCallback(
    (projectId?: string | null) => {
      if (!projectId) return null
      const n = nodes.find((x) => String(x.id) === projectId)
      return n?.id ?? null
    },
    [nodes],
  )
  const nameOf = useCallback(
    (nodeId?: number | null) => (nodeId == null ? '' : (findNode(nodes, nodeId)?.name ?? '')),
    [nodes],
  )

  // -- needs you ------------------------------------------------------------

  const [deciding, setDeciding] = useState<string | null>(null)
  /// Answer an approval from the row it is on.
  ///
  /// The list refreshes itself from the event tail, but not instantly — and a
  /// button that stays put after you press it reads as one that did nothing.
  /// So the row is held disabled until the store has caught up.
  const decide = async (id: string, decision: 'allow' | 'deny') => {
    setDeciding(id)
    try {
      await a.resolveApproval(id, decision)
    } finally {
      setDeciding(null)
    }
  }

  const approvals = a.approvals.filter((r) => inArea(nodeIdOf(r.project_id)))
  const blockers = a.conflicts.filter((c) => !c.resolved && inArea(nodeIdOf(c.project_id)))
  const unreadMail = app.mailCounts?.unread ?? 0
  const needs = approvals.length + blockers.length + (todayArea == null && unreadMail > 0 ? 1 : 0)

  // -- the day --------------------------------------------------------------

  const day = (items ?? [])
    .filter((i) => inArea(i.node_id))
    .slice()
    .sort((x, y) => x.at - y.at)

  // -- you said you'd -------------------------------------------------------
  //
  // A recurring reminder that has not run today, and how long it has been.
  // Only reminders: a command or a bot that has not fired is the machine's
  // business, not a promise you made.
  const startToday = startOfDay(new Date()).getTime()
  const owed = schedules
    .filter((s) => s.enabled && s.kind === 'reminder' && s.every !== 'once')
    .filter((s) => inArea(s.node_id))
    .filter((s) => !s.last_run || s.last_run < startToday)
    .map((s) => ({
      s,
      // Whole days since it last ran. Never run at all is not "0 days ago",
      // and saying so beats inventing a number.
      missed: s.last_run ? Math.floor((Date.now() - s.last_run) / DAY_MS) : null,
    }))
    .sort((x, y) => (y.missed ?? 999) - (x.missed ?? 999))
    .slice(0, 5)

  // -- ticking over ---------------------------------------------------------

  const running = Object.entries(app.svcStates).filter(([, v]) => v.status === 'running').length
  const behind = Object.entries(app.gitByNode)
    .filter(([id]) => inArea(Number(id)))
    .filter(([, g]) => (g?.behind ?? 0) > 0)
  const workingBots = a.sessions.filter((s) => s.status === 'working' || s.status === 'planning')

  const heading =
    needs === 0
      ? 'Nothing is waiting on you.'
      : `${needs} thing${needs === 1 ? '' : 's'} want${needs === 1 ? 's' : ''} you. Everything else is ticking over.`

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="shrink-0 px-7 pb-3 pt-5">
        <div className="flex items-end gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </h1>
            <p className="mt-1 text-[12.5px] text-dim">{heading}</p>
          </div>
          <div className="flex-1" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            className={`h-[24px] rounded-full border px-2.5 text-[11px] ${
              todayArea == null
                ? 'border-line2 bg-raise text-ink'
                : 'border-line2 bg-transparent text-dim hover:bg-hover/50'
            }`}
            onClick={() => setTodayArea(null)}
          >
            All
          </button>
          {areas.map((n) => (
            <button
              key={n.id}
              className={`h-[24px] rounded-full border px-2.5 text-[11px] ${
                todayArea === n.id
                  ? 'border-line2 bg-raise text-ink'
                  : 'border-line2 bg-transparent text-dim hover:bg-hover/50'
              }`}
              onClick={() => setTodayArea(todayArea === n.id ? null : n.id)}
            >
              {n.name}
            </button>
          ))}
          <span className="ml-2 text-[10.5px] text-faint">
            narrows this page, and only this page
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-5 overflow-auto px-7 pb-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <section>
            {/* The rest of setup, for anyone who met the assistant before
                these steps existed. Goes away once Home is a space. */}
            {!nodes.some((x) => x.kind === 'workspace' && x.name === 'Home') && (
              <button
                className="mb-3 flex w-full items-center gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-left hover:bg-indigo-500/10"
                onClick={() => window.dispatchEvent(new CustomEvent('devdeck:setup', { detail: 'learn' }))}
              >
                <Icon name="ai" size={13} className="text-indigo-400" />
                <span className="text-[12px] text-ink">Finish setting up</span>
                <span className="text-[11px] text-muted">
                  read your mail, say who is in your life, make Home a space
                </span>
              </button>
            )}
            <div className="mb-3 flex items-center gap-2">
              <button className="btn-ghost text-[11.5px]" onClick={() => openLife()}>
                <Icon name="contacts" size={12} /> Your life
              </button>
              <span className="text-[10.5px] text-faint">the people, kept on this machine</span>
            </div>
            <Head title="Needs you" note="approvals, questions, a reply" />
            {needs === 0 ? (
              <Card>
                <Row>
                  <Dot tone="bg-line2" />
                  <span className="text-[12px] text-muted">
                    Nothing here. That is the normal state, not an empty one.
                  </span>
                </Row>
              </Card>
            ) : (
              <Card>
                {approvals.map((r) => (
                  <Row key={r.id} tint="bg-amber-500/[0.06]">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-500/15 text-[8.5px] font-bold text-warn">
                      {r.agent_id.slice(0, 2).toUpperCase()}
                    </span>
                    <button
                      className="min-w-0 flex-1 text-left"
                      title={r.summary || 'Open it in the Inbox'}
                      onClick={() => app.setRailView('inbox')}
                    >
                      <span className="block truncate text-[12.5px] text-ink">
                        {r.summary || `${r.agent_id} wants to run ${r.tool}${r.action ? `.${r.action}` : ''}`}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {r.agent_id} · {nameOf(nodeIdOf(r.project_id)) || 'no space'} ·{' '}
                        {ago(r.requested_at)}
                      </span>
                    </button>
                    {/* Answerable here. An agent is stopped on a clock, and
                        sending you somewhere else to say yes spends the part
                        of the wait that matters — the whole reason this row
                        is on the first screen rather than only in the Inbox. */}
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        className="btn-primary text-[11px]"
                        disabled={deciding === r.id}
                        onClick={() => void decide(r.id, 'allow')}
                      >
                        {deciding === r.id ? '…' : 'Approve'}
                      </button>
                      <button
                        className="btn-ghost text-[11px]"
                        disabled={deciding === r.id}
                        onClick={() => void decide(r.id, 'deny')}
                      >
                        Deny
                      </button>
                    </span>
                  </Row>
                ))}
                {blockers.map((c) => (
                  <Row key={c.id} onClick={() => app.setRailView('inbox')}>
                    <Icon name="alert" size={14} className="shrink-0 text-err" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{c.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {nameOf(nodeIdOf(c.project_id)) || 'no space'} · blocked
                      </span>
                    </span>
                  </Row>
                ))}
                {todayArea == null && unreadMail > 0 && (
                  <Row onClick={() => app.setRailView('mail')}>
                    <Icon name="mail" size={14} className="shrink-0 text-info" />
                    <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                      {unreadMail} unread {unreadMail === 1 ? 'message' : 'messages'}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-muted">Mail</span>
                  </Row>
                )}
              </Card>
            )}
          </section>

          <section>
            <Head title="The day" note="from your calendar" />
            {items === null ? (
              <Card>
                <Row>
                  <Icon name="update" size={12} spin className="text-muted" />
                  <span className="text-[12px] text-muted">Reading the day…</span>
                </Row>
              </Card>
            ) : day.length === 0 ? (
              <Card>
                <Row onClick={() => app.setRailView('calendar')}>
                  <Dot tone="bg-line2" />
                  <span className="flex-1 text-[12px] text-muted">
                    Nothing on the calendar today.
                  </span>
                  <span className="text-[10.5px] text-faint">Calendar</span>
                </Row>
              </Card>
            ) : (
              <Card>
                {day.map((i) => (
                  <Row
                    key={i.id}
                    onClick={() =>
                      i.node_id ? openNodeThread(i.node_id, i.title) : app.setRailView('calendar')
                    }
                  >
                    <span className="w-[42px] shrink-0 text-[11px] tabular-nums text-muted">
                      {hhmm(i.at)}
                    </span>
                    <Dot
                      tone={
                        i.status === 'done'
                          ? 'bg-emerald-400'
                          : i.past
                            ? 'bg-line2'
                            : 'bg-indigo-400'
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[12.5px] ${
                          i.status === 'done' ? 'text-dim line-through' : 'text-ink'
                        }`}
                      >
                        {i.title}
                      </span>
                    </span>
                    {i.space && (
                      <span className="shrink-0 text-[10.5px] text-muted">{i.space}</span>
                    )}
                  </Row>
                ))}
              </Card>
            )}
          </section>

          {owed.length > 0 && (
            <section>
              <Head title="You said you'd" note="recurring, and not done today" />
              <Card>
                {owed.map(({ s, missed }) => (
                  <Row
                    key={s.id}
                    onClick={() =>
                      s.node_id ? openNodeThread(s.node_id, s.name) : app.setRailView('calendar')
                    }
                  >
                    <Dot tone={missed != null && missed >= 2 ? 'bg-red-400' : 'bg-line2'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{s.name}</span>
                    </span>
                    {missed == null ? (
                      <span className="shrink-0 text-[10.5px] text-muted">never run</span>
                    ) : missed >= 2 ? (
                      <span className="shrink-0 text-[10.5px] text-err">
                        {missed} days since
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[10.5px] text-muted">
                      {nameOf(s.node_id) || s.every}
                    </span>
                  </Row>
                ))}
              </Card>
            </section>
          )}
        </div>

        <div className="flex w-[330px] shrink-0 flex-col gap-5">
          <section>
            <Head title="Ticking over" note="nothing to do here" />
            <Card>
              {workingBots.length > 0 ? (
                workingBots.slice(0, 3).map((s) => (
                  <Row key={s.id} onClick={() => app.setTeamTab('bots')}>
                    <Dot tone="bg-emerald-400" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-body">
                      {s.agent_id}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-muted">{s.status}</span>
                  </Row>
                ))
              ) : (
                <Row>
                  <Dot tone="bg-line2" />
                  <span className="flex-1 text-[12px] text-muted">No bot is working</span>
                </Row>
              )}
              {behind.slice(0, 3).map(([id, g]) => (
                <Row key={id} onClick={() => openSpace(Number(id), nameOf(Number(id)))}>
                  <Dot tone="bg-amber-400" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-body">
                    {nameOf(Number(id))}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-muted">
                    {g?.branch} · {g?.behind} behind
                  </span>
                </Row>
              ))}
              <Row onClick={() => app.setRailView('home')}>
                <Dot tone={running > 0 ? 'bg-emerald-400' : 'bg-line2'} />
                <span className="flex-1 text-[12px] text-muted">
                  {running > 0
                    ? `${running} service${running === 1 ? '' : 's'} running`
                    : 'No services running'}
                </span>
                <span className="shrink-0 text-[10.5px] text-faint">Dashboard</span>
              </Row>
            </Card>
          </section>

          <section>
            <Head title="Ask anything" />
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-left hover:bg-hover/40"
              onClick={() => {
                const first = areas.find((n) => n.id === todayArea) ?? areas[0]
                if (first) openNodeThread(first.id, first.name)
              }}
            >
              <Icon name="ai" size={14} className="shrink-0 text-indigo-400" />
              <span className="flex-1 truncate text-[11.5px] text-muted">
                What needs me before this afternoon?
              </span>
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
