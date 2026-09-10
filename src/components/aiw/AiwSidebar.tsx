// The Assistant sidebar.
//
// Two things changed here, and the second is why the first was possible.
//
// **The projects list is gone.** It used to sit at the bottom of this sidebar,
// which meant the app had two lists of the same repos and picking one in the
// Explorer told this one nothing. The Explorer and the section row now answer
// "which project"; this answers "what about all of them".
//
// **Ten flat items became three groups.** Watch is what moves, Record is what
// accumulates, Set up is what you configure once. Setup came out of a buried
// Settings page for one reason worth stating: with it hidden, agents quietly
// running the mock provider looked exactly like agents doing real work.
//
// Above all of it sits what is happening right now, because the first thing
// you want from this screen is who is working and who is stuck — not which
// page to open.

import { useEffect } from 'react'
import { Icon, type IconName } from '../../lib/icons'
import { useAiw, type AiwPage } from '../../lib/aiwStore'
import { aiw, initials } from '../../lib/aiw'

type Item = { page: AiwPage; icon: IconName; label: string }

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    // Things that move.
    title: 'Watch',
    items: [
      { page: 'agents', icon: 'agent', label: 'Agents' },
      { page: 'conflicts', icon: 'conflict', label: 'Conflicts' },
      { page: 'tests', icon: 'ok', label: 'Tests' },
    ],
  },
  {
    // Things that accumulate.
    title: 'Record',
    items: [
      { page: 'features', icon: 'list', label: 'Features' },
      { page: 'context', icon: 'context', label: 'Context' },
      { page: 'decisions', icon: 'decision', label: 'Decisions' },
      { page: 'knowledge', icon: 'note', label: 'Knowledge' },
      { page: 'git', icon: 'commit', label: 'Git' },
    ],
  },
]

const num = (n: number) => ({ n, tone: 'text-faint' })

export function AiwSidebar() {
  const a = useAiw()

  // Load once, and keep the live tail running while this view is mounted.
  useEffect(() => {
    if (!a.ready) void a.bootstrap()
    let stop: (() => void) | undefined
    void aiw.onEvent((e) => a.pushEvent(e)).then((un) => {
      stop = un
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const working = a.sessions.filter((s) => s.status === 'working' || s.status === 'planning')
  const openConflicts = a.conflicts.filter((c) => !c.resolved).length
  const scripted = a.agents.filter((x) => x.id !== 'assistant' && x.provider === 'mock').length

  const count = (p: AiwPage): { n: number; tone: string } | null => {
    if (p === 'features') return num(a.features.length)
    if (p === 'agents') return working.length ? { n: working.length, tone: 'text-ok' } : num(0)
    if (p === 'conflicts')
      return openConflicts ? { n: openConflicts, tone: 'text-warn font-semibold' } : num(0)
    if (p === 'decisions') return num(a.decisions.length)
    if (p === 'tests') return num(a.testRuns.length)
    return null
  }

  const row = ({ page, icon, label }: Item) => {
    const c = count(page)
    const on = a.page === page
    return (
      <button
        key={page}
        className={`flex items-center gap-2 rounded px-2 py-[5px] text-left text-[12px] ${
          on ? 'bg-raise font-semibold text-ink' : 'text-dim hover:bg-hover hover:text-ink'
        }`}
        onClick={() => a.setPage(page)}
      >
        <Icon name={icon} size={13} className={on ? 'text-indigo-400' : ''} />
        {label}
        {c && c.n > 0 && <span className={`ml-auto text-[10px] ${c.tone}`}>{c.n}</span>}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Icon name="ai" size={14} className="text-indigo-400" />
        <span className="text-[12.5px] font-semibold text-ink">Assistant</span>
        <button
          className="btn-ghost ml-auto inline-flex items-center gap-1 text-[11px]"
          title="Reload projects, sessions, conflicts and activity"
          onClick={() => void a.refresh()}
        >
          <Icon name="update" size={11} /> Sync
        </button>
      </div>

      {/* Right now — above the navigation, because it is the only part that
          changes minute to minute. */}
      <div className="shrink-0 border-b border-line bg-page px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
            Right now
          </span>
          <span className="ml-auto text-[10px] text-muted">
            {a.projects.length} project{a.projects.length === 1 ? '' : 's'}
          </span>
        </div>

        {working.length === 0 && a.approvals.length === 0 ? (
          <div className="mt-1.5 text-[11px] text-muted">Nothing running.</div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {a.approvals.map((r) => (
              <button
                key={r.id}
                className="flex items-center gap-2 text-left"
                title={r.detail}
                onClick={() => a.setPage('agents')}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/16 text-[8px] font-bold text-warn">
                  {initials(a.agents.find((x) => x.id === r.agent_id)?.name ?? r.agent_id)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-body">{r.summary}</span>
                <span className="shrink-0 text-[9.5px] font-semibold text-warn">waiting</span>
              </button>
            ))}
            {working.map((s) => (
              <button
                key={s.id}
                className="flex items-center gap-2 text-left"
                onClick={() => a.setPage('agents')}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/16 text-[8px] font-bold text-ok">
                  {initials(s.agent_name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-body">
                  {s.agent_name}
                </span>
                <span className="shrink-0 text-[9.5px] text-muted">{s.feature_id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {/* Assistant first. Everything below it is a surface you *watch*;
            this is the one you use, and it is the only place in the app you
            can talk to the thing. Grouping the sidebar by what-kind-of-page
            once cost it its entry here, which is a good argument for it not
            being in a group at all. */}
        <div className="flex flex-col gap-px px-1.5 pt-2">
          <button
            className={`flex w-full items-center gap-2 rounded px-2 py-[5px] text-left text-[12px] ${
              a.page === 'chat'
                ? 'bg-raise font-semibold text-ink'
                : 'text-dim hover:bg-hover hover:text-ink'
            }`}
            onClick={() => a.setPage('chat')}
          >
            <Icon name="ai" size={13} className={a.page === 'chat' ? 'text-indigo-400' : ''} />
            Assistant
            {a.conversations.length > 0 && (
              <span className="ml-auto text-[10px] text-faint">{a.conversations.length}</span>
            )}
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded px-2 py-[5px] text-left text-[12px] ${
              a.page === 'overview'
                ? 'bg-raise font-semibold text-ink'
                : 'text-dim hover:bg-hover hover:text-ink'
            }`}
            onClick={() => a.setPage('overview')}
          >
            <Icon
              name="layout"
              size={13}
              className={a.page === 'overview' ? 'text-indigo-400' : ''}
            />
            Overview
          </button>
        </div>

        {GROUPS.map((g) => (
          <div key={g.title} className="mt-1.5">
            <div className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
              {g.title}
            </div>
            <div className="flex flex-col gap-px px-1.5">{g.items.map(row)}</div>
          </div>
        ))}

        {/* Set up, promoted out of a Settings page. "4 mock" is the difference
            between real work and fixture output, and it was invisible while it
            lived two clicks away. */}
        <div className="mt-1.5">
          <div className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-faint">
            Set up
          </div>
          <div className="flex flex-col gap-px px-1.5">
            <button
              className={`flex items-center gap-2 rounded px-2 py-[5px] text-left text-[12px] ${
                a.page === 'skills'
                  ? 'bg-raise font-semibold text-ink'
                  : 'text-dim hover:bg-hover hover:text-ink'
              }`}
              onClick={() => a.setPage('skills')}
            >
              <Icon
                name="puzzle"
                size={13}
                className={a.page === 'skills' ? 'text-indigo-400' : ''}
              />
              Skills
            </button>
            <button
              className={`flex items-center gap-2 rounded px-2 py-[5px] text-left text-[12px] ${
                a.page === 'settings'
                  ? 'bg-raise font-semibold text-ink'
                  : 'text-dim hover:bg-hover hover:text-ink'
              }`}
              onClick={() => a.setPage('settings')}
            >
              <Icon
                name="settings"
                size={13}
                className={a.page === 'settings' ? 'text-indigo-400' : ''}
              />
              Providers &amp; agents
              {scripted > 0 && (
                <span
                  className="ml-auto rounded bg-amber-500/14 px-1 text-[9.5px] font-semibold text-warn"
                  title={`${scripted} agent${scripted === 1 ? '' : 's'} still run the mock provider, which follows a script instead of thinking`}
                >
                  {scripted} mock
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* The demo button used to live here, pinned to the bottom, where it
          crowded the Set up group above it. It is still on the Overview empty
          state, which is the moment you actually want it — with no projects
          yet. Once you have some, a permanent button that seeds fixtures is
          closer to a hazard than a shortcut. */}
    </div>
  )
}
