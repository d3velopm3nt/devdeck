// Home — the launch view. One screen for "what's going on right now":
// active processes (services + terminals), the recent activity feed, a
// master-log digest, and headline stats. Replaces the old Dashboard.

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { Icon, type IconName } from '../lib/icons'
import { openService, openSpace } from '../lib/dock'
import { findNode, projectOf, subtreeIds } from '../lib/tree'
import { fmtAgo, fmtUptime } from '../lib/time'
import type { ProcStat } from '../lib/types'

function StatChip({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="min-w-[130px] flex-1 rounded-[10px] border border-line bg-panel px-3 py-2.5">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">{k}</div>
      <div className={`mt-0.5 text-[20px] font-bold ${tone ?? 'text-ink'}`}>{v}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

function CardHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</span>
      <span className="h-px flex-1 bg-line" />
      {action && (
        <button className="text-[10.5px] text-indigo-400 hover:underline" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}

export function Home() {
  const {
    nodes, services, svcStates, stats, terminals, logs, recents, commands, gitByNode,
    activeWorkspaceId, showBottom, setRailView, servicePort,
  } = useApp()

  // Uptime / relative-time tick.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const statFor = (kind: ProcStat['kind'], id: number) => stats.find((p) => p.kind === kind && p.id === id)
  const projName = (projectId: number | null) => {
    const proj = projectOf(nodes, findNode(nodes, projectId))
    return proj?.name ?? ''
  }

  const running = useMemo(
    () => services.filter((s) => svcStates[s.id]?.status === 'running'),
    [services, svcStates],
  )
  const crashed = useMemo(
    () => services.filter((s) => svcStates[s.id]?.status === 'crashed'),
    [services, svcStates],
  )
  const liveTerms = useMemo(() => terminals.filter((t) => t.alive), [terminals])

  // Idle services from the active workspace only, so the list stays short.
  const idle = useMemo(() => {
    const inWs = new Set(activeWorkspaceId != null ? subtreeIds(nodes, activeWorkspaceId) : [])
    return services
      .filter((s) => (svcStates[s.id]?.status ?? 'stopped') === 'stopped')
      .filter((s) => s.project_id != null && inWs.has(s.project_id))
      .slice(0, 5)
  }, [services, svcStates, nodes, activeWorkspaceId])

  const behindCount = useMemo(
    () => Object.values(gitByNode).filter((g) => g.behind > 0).length,
    [gitByNode],
  )
  const errorCount = useMemo(() => logs.filter((l) => l.level === 'error').length, [logs])

  // Activity feed: recents (commands run / services started), newest first.
  const activity = useMemo(() => {
    return [...recents]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 14)
      .map((r) => {
        if (r.kind === 'service') {
          const s = services.find((x) => x.id === r.ref_id)
          return s ? { key: `s-${r.ref_id}-${r.ts}`, ts: r.ts, icon: 'service' as IconName, tone: 'text-ok bg-emerald-500/10', name: s.name, what: 'service started', sub: projName(s.project_id) } : null
        }
        const c = commands.find((x) => x.id === r.ref_id)
        return c ? { key: `c-${r.ref_id}-${r.ts}`, ts: r.ts, icon: 'command' as IconName, tone: 'text-info bg-sky-500/10', name: c.name, what: 'command ran', sub: projName(c.project_id) } : null
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recents, services, commands, nodes])

  const openBrowser = (port: number) =>
    void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))
  const jumpToService = (projectId: number | null) => {
    const proj = projectOf(nodes, findNode(nodes, projectId))
    setRailView('projects')
    if (proj) openSpace(proj.id, proj.name)
  }

  const lastLogs = logs.slice(-7)

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-page px-5 py-4">
      {/* stat strip */}
      <div className="flex flex-wrap gap-2.5">
        <StatChip
          k="Services"
          v={<>{running.length}<small className="text-[11px] font-semibold text-muted">/{services.length} running</small></>}
          tone={running.length > 0 ? 'text-ok' : undefined}
        />
        <StatChip k="Terminals" v={liveTerms.length} sub="live sessions" />
        <StatChip
          k="Repos behind"
          v={behindCount}
          sub={behindCount > 0 ? 'commits to pull' : 'all up to date'}
          tone={behindCount > 0 ? 'text-warn' : undefined}
        />
        <StatChip
          k="Crashed"
          v={crashed.length}
          sub={crashed.length ? 'needs attention' : 'none'}
          tone={crashed.length > 0 ? 'text-err' : undefined}
        />
        <StatChip k="Errors" v={errorCount} sub="in the log buffer" tone={errorCount > 0 ? 'text-err' : undefined} />
      </div>

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-[1.25fr_0.75fr] gap-3.5">
        {/* left column */}
        <div className="flex min-h-0 flex-col gap-3.5">
          <div className="rounded-xl border border-line bg-panel p-3.5">
            <CardHead title="Active processes" />
            {running.length === 0 && liveTerms.length === 0 && idle.length === 0 && (
              <div className="py-5 text-center text-[12px] text-muted">
                Nothing running. Start a service from Projects, or open a terminal.
              </div>
            )}
            {running.map((s) => {
              const st = statFor('service', s.id)
              const port = servicePort(s.id)
              return (
                <div key={`run-${s.id}`} className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line bg-raise/40 px-2.5 py-2 last:mb-0">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  <button
                    className="text-[12.5px] font-semibold text-ink hover:underline"
                    title="Open the service page"
                    onClick={() => openService(s.id, s.name)}
                  >
                    {s.name}
                  </button>
                  <button
                    className="text-[11px] font-medium text-indigo-400 hover:underline"
                    title="Open the project dashboard"
                    onClick={() => jumpToService(s.project_id)}
                  >
                    {projName(s.project_id)}
                  </button>
                  <span className="ml-auto flex items-center gap-2.5 font-mono text-[10.5px] text-muted">
                    {port != null && <span className="text-indigo-300">:{port}</span>}
                    <span>{fmtUptime(svcStates[s.id]?.started_at, now)}</span>
                    {st && <span>{st.cpu.toFixed(0)}%</span>}
                    {st && <span>{st.mem_mb.toFixed(0)}MB</span>}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {port != null && (
                      <button className="flex h-6 w-6 items-center justify-center rounded-md bg-soft text-dim hover:bg-hover hover:text-ink" title={`Open http://localhost:${port}`} onClick={() => openBrowser(port)}>
                        <Icon name="globe" size={12} />
                      </button>
                    )}
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10 text-err hover:bg-red-500/25"
                      title="Stop"
                      onClick={() => void ipc.svcStop(s.id).catch((e) => alert(String(e)))}
                    >
                      <Icon name="stop" size={11} />
                    </button>
                  </span>
                </div>
              )
            })}
            {liveTerms.map((t) => (
              <div key={`term-${t.id}`} className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line bg-raise/40 px-2.5 py-2 last:mb-0">
                <Icon name="terminal" size={12} className="shrink-0 text-ok/80" />
                <span className="truncate text-[12.5px] font-semibold text-ink">{t.title}</span>
                <span className="text-[11px] text-muted">terminal</span>
                <span className="ml-auto flex shrink-0 gap-1">
                  <button
                    className="flex h-6 items-center gap-1 rounded-md bg-soft px-2 text-[10.5px] text-dim hover:bg-hover hover:text-ink"
                    onClick={() => setRailView('projects')}
                  >
                    open <Icon name="external" size={10} />
                  </button>
                </span>
              </div>
            ))}
            {idle.map((s) => (
              <div key={`idle-${s.id}`} className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line/60 px-2.5 py-2 opacity-80 last:mb-0">
                <span className="h-2 w-2 rounded-full bg-faint/60" />
                <button
                  className="text-[12.5px] font-medium text-dim hover:text-ink hover:underline"
                  title="Open the service page"
                  onClick={() => openService(s.id, s.name)}
                >
                  {s.name}
                </button>
                <span className="text-[11px] text-muted">{projName(s.project_id)}</span>
                <span className="ml-auto font-mono text-[10.5px] text-faint">idle</span>
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/30"
                  title="Start"
                  onClick={() => void useApp.getState().requestStartService(s)}
                >
                  <Icon name="run" size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex min-h-[140px] flex-1 flex-col rounded-xl border border-line bg-panel p-3.5">
            <CardHead title="Master log" action="open full log →" onAction={() => showBottom('logs')} />
            <div className="min-h-0 flex-1 overflow-hidden font-mono text-[11px] leading-[1.75] text-dim">
              {lastLogs.length === 0 && <div className="py-4 text-center font-sans text-[12px] text-muted">No log output yet.</div>}
              {lastLogs.map((l) => (
                <div key={l.seq} className="truncate">
                  <span className="text-faint">{new Date(l.ts).toLocaleTimeString([], { hour12: false })}</span>{' '}
                  <span className="text-indigo-300">{l.service}</span>{' '}
                  <span className={l.level === 'error' ? 'text-err' : l.level === 'warn' ? 'text-warn' : ''}>{l.line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right column: activity feed */}
        <div className="flex min-h-0 flex-col rounded-xl border border-line bg-panel p-3.5">
          <CardHead title="Recent activity" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activity.length === 0 && (
              <div className="py-5 text-center text-[12px] text-muted">
                Run a command or start a service and it shows up here.
              </div>
            )}
            {activity.map((a) => (
              <div key={a.key} className="flex items-start gap-2.5 border-b border-line/60 py-2 text-[12px] text-dim last:border-b-0">
                <span className="w-[52px] shrink-0 pt-0.5 font-mono text-[9.5px] text-muted">{fmtAgo(a.ts, now)}</span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${a.tone}`}>
                  <Icon name={a.icon} size={11} />
                </span>
                <span className="min-w-0">
                  <b className="font-semibold text-ink">{a.name}</b> {a.what}
                  {a.sub && <span className="text-muted"> · {a.sub}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
