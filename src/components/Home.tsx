// Home — the launch view and workspace dashboard. Spaces you can jump into,
// headline counters, the live sessions, what's broken, recent activity, and a
// master-log digest. Read-mostly with quick actions (open, stop, start).

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { Icon, type IconName } from '../lib/icons'
import { openService, openSpace, openTerminalPanel } from '../lib/dock'
import { findNode, projectOf, subtreeIds } from '../lib/tree'
import { nodeColor, avatarLabel, projectUsage, rankSpaces } from '../lib/spaces'
import { fmtAgo, fmtUptime } from '../lib/time'
import type { LogEntry, ProcStat, TreeNode } from '../lib/types'

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// One space (project) card: colour spine, avatar, name, live counts.
function SpaceCard({ project, topUsed }: { project: TreeNode; topUsed: boolean }) {
  const { nodes, services, commands, svcStates } = useApp()
  const scope = useMemo(() => new Set(subtreeIds(nodes, project.id)), [nodes, project.id])
  const svc = services.filter((s) => s.project_id != null && scope.has(s.project_id))
  const running = svc.filter((s) => svcStates[s.id]?.status === 'running').length
  const cmds = commands.filter((c) => c.project_id != null && scope.has(c.project_id)).length
  const color = nodeColor(project)

  return (
    <button
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-raise px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-line2 hover:shadow-lg"
      onClick={() => openSpace(project.id, project.name)}
      title={`Open ${project.name}`}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[14px] font-bold text-white"
        style={{ background: `linear-gradient(135deg, ${color}, ${hexA(color, 0.6)})` }}
      >
        {avatarLabel(project.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{project.name}</span>
          {topUsed && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
              style={{ background: hexA(color, 0.18), color }}
            >
              <Icon name="star" size={10} /> most used
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted">
          {running > 0 && (
            <span className="flex items-center gap-1 text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {running} live
            </span>
          )}
          <span>{svc.length} svc</span>
          <span>{cmds} cmd</span>
        </div>
      </div>
      <span className="flex items-center text-faint transition group-hover:translate-x-0.5 group-hover:text-dim">
        <Icon name="arrow-right" size={14} />
      </span>
    </button>
  )
}

function StatCard({
  label,
  value,
  sub,
  accent = 'text-ink',
  onClick,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: string
  onClick?: () => void
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-raise px-3 py-2.5 ${onClick ? 'cursor-pointer hover:border-line2' : ''}`}
      onClick={onClick}
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold leading-none ${accent}`}>{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-muted">{sub}</div>}
    </div>
  )
}

function CardHead({ title, count, action, onAction }: { title: string; count?: React.ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</span>
      <span className="h-px flex-1 bg-line" />
      {count != null && <span className="text-[10.5px] text-muted">{count}</span>}
      {action && (
        <button className="text-[10.5px] text-indigo-400 hover:underline" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}

const LEVEL_STYLE: Record<string, string> = {
  error: 'text-err',
  warn: 'text-warn',
  info: 'text-dim',
  debug: 'text-muted',
}

export function Home() {
  const {
    nodes, services, svcStates, stats, terminals, logs, recents, commands, gitByNode, activity,
    activeWorkspaceId, showBottom, focusServiceLogs, servicePort, requestStartService,
  } = useApp()

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const statFor = (kind: ProcStat['kind'], id: number) => stats.find((p) => p.kind === kind && p.id === id)
  const projName = (projectId: number | null) => projectOf(nodes, findNode(nodes, projectId))?.name ?? ''

  const usage = useMemo(
    () => projectUsage(nodes, commands, services, recents),
    [nodes, commands, services, recents],
  )
  const workspaces = useMemo(() => nodes.filter((n) => n.kind === 'workspace'), [nodes])
  const topSpaceId = useMemo(() => {
    let best: number | null = null
    let bestScore = 0
    for (const [id, u] of Object.entries(usage)) {
      if (u.score > bestScore) {
        bestScore = u.score
        best = Number(id)
      }
    }
    return best
  }, [usage])

  const summary = useMemo(() => {
    let running = 0
    let crashed = 0
    for (const s of services) {
      const st = svcStates[s.id]?.status ?? 'stopped'
      if (st === 'running') running++
      else if (st === 'crashed') crashed++
    }
    const cpu = stats.reduce((a, p) => a + p.cpu, 0)
    const mem = stats.reduce((a, p) => a + p.mem_mb, 0)
    return {
      running,
      crashed,
      stopped: services.length - running - crashed,
      liveTerms: terminals.filter((t) => t.alive),
      cpu,
      mem,
      errors: logs.filter((l) => l.level === 'error').length,
      warns: logs.filter((l) => l.level === 'warn').length,
      projects: nodes.filter((n) => n.kind === 'project').length,
      folders: nodes.filter((n) => n.kind === 'folder').length,
      workspaces: workspaces.length,
      behind: Object.values(gitByNode).filter((g) => g.behind > 0).length,
    }
  }, [nodes, services, svcStates, stats, terminals, logs, workspaces, gitByNode])

  // Idle services in the active workspace — a short quick-start list.
  const idle = useMemo(() => {
    const inWs = new Set(activeWorkspaceId != null ? subtreeIds(nodes, activeWorkspaceId) : [])
    return services
      .filter((s) => (svcStates[s.id]?.status ?? 'stopped') === 'stopped')
      .filter((s) => s.project_id != null && inWs.has(s.project_id))
      .slice(0, 4)
  }, [services, svcStates, nodes, activeWorkspaceId])

  const running = useMemo(
    () => services.filter((s) => svcStates[s.id]?.status === 'running'),
    [services, svcStates],
  )

  // Issue feed: crashed services + recent warn/error log lines, newest first.
  const issues = useMemo(() => {
    const crashed = services
      .filter((s) => svcStates[s.id]?.status === 'crashed')
      .map((s) => ({
        key: `crash-${s.id}`,
        ts: svcStates[s.id]?.started_at ?? 0,
        level: 'error' as const,
        service: s.name,
        line: `Service crashed${svcStates[s.id]?.exit_code != null ? ` (exit ${svcStates[s.id]?.exit_code})` : ''}`,
      }))
    const logIssues: Array<{ key: string; ts: number; level: LogEntry['level']; service: string; line: string }> = logs
      .filter((l) => l.level === 'error' || l.level === 'warn')
      .slice(-30)
      .reverse()
      .map((l) => ({ key: `log-${l.seq}`, ts: l.ts, level: l.level, service: l.service, line: l.line }))
    return [...crashed, ...logIssues].slice(0, 30)
  }, [services, svcStates, logs])

  // The real activity stream. This used to be derived from `recents`, which
  // only stores the *last* time something ran — so two runs looked like one
  // and a crash looked like nothing at all.
  const activityFeed = useMemo(() => {
    const look: Record<string, { icon: IconName; tone: string }> = {
      service: { icon: 'service', tone: 'text-ok bg-emerald-500/10' },
      query: { icon: 'database', tone: 'text-viol bg-violet-500/10' },
      git: { icon: 'github', tone: 'text-info bg-sky-500/10' },
      clip: { icon: 'clip', tone: 'text-indigo-300 bg-indigo-500/10' },
      screenshot: { icon: 'image', tone: 'text-ok bg-emerald-500/10' },
    }
    return activity.slice(0, 14).map((a) => {
      const l = look[a.kind] ?? { icon: 'info' as IconName, tone: 'text-dim bg-white/5' }
      return {
        key: `a-${a.id}`,
        ts: a.ts,
        // A failure gets the alert glyph and red, whatever kind it was.
        icon: a.ok ? l.icon : ('alert' as IconName),
        tone: a.ok ? l.tone : 'text-err bg-red-500/10',
        name: a.title,
        what: a.detail,
        sub: a.project_name,
        onClick:
          a.kind === 'service' && a.ref_id != null
            ? () => {
                const s = services.find((x) => x.id === a.ref_id)
                if (s) openService(s.id, s.name)
              }
            : undefined,
      }
    })
  }, [activity, services])

  const openBrowser = (port: number) =>
    void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))

  const lastLogs = logs.slice(-6)

  return (
    <div className="flex h-full flex-col bg-page text-body">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">
          <span className="text-indigo-400">❯_</span> Dashboard
        </span>
        <span className="text-faint">·</span>
        <span className="text-[11px] text-muted">
          {summary.workspaces} workspace{summary.workspaces === 1 ? '' : 's'} · {summary.projects} project
          {summary.projects === 1 ? '' : 's'} · {summary.folders} folder{summary.folders === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <button className="btn-ghost text-[11px]" title="Show the Processes panel" onClick={() => showBottom('processes')}>
          Processes
        </button>
        <button className="btn-ghost text-[11px]" title="Show the Logs panel" onClick={() => showBottom('logs')}>
          Logs
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-3">
        {/* spaces, grouped by workspace */}
        {workspaces.length > 0 && (
          <div className="space-y-3">
            {workspaces.map((ws) => {
              const projects = rankSpaces(
                nodes.filter((n) => n.kind === 'project' && n.parent_id === ws.id),
                usage,
              )
              return (
                <section key={ws.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex items-center text-indigo-400"><Icon name="workspace" size={14} /></span>
                    <span className="text-[13px] font-semibold text-ink">{ws.name}</span>
                    <span className="text-[11px] text-muted">
                      {projects.length} space{projects.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {projects.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-line px-3 py-4 text-[12px] text-muted">
                      No spaces yet — add a Project to this workspace in the Explorer.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {projects.map((p) => (
                        <SpaceCard key={p.id} project={p} topUsed={p.id === topSpaceId} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

        {/* summary counters */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard
            label="Services running"
            value={<span>{summary.running}<span className="text-[14px] text-muted">/{services.length}</span></span>}
            accent={summary.running ? 'text-ok' : 'text-body'}
            sub={summary.stopped > 0 ? `${summary.stopped} stopped` : 'all up'}
          />
          <StatCard label="Terminals" value={summary.liveTerms.length} sub="live sessions" />
          <StatCard
            label="Crashed"
            value={summary.crashed}
            accent={summary.crashed ? 'text-err' : 'text-body'}
            sub={summary.crashed ? 'needs attention' : 'none'}
          />
          <StatCard
            label="Repos behind"
            value={summary.behind}
            accent={summary.behind ? 'text-warn' : 'text-body'}
            sub={summary.behind ? 'commits to pull' : 'up to date'}
          />
          <StatCard
            label="Errors"
            value={summary.errors}
            accent={summary.errors ? 'text-err' : 'text-body'}
            sub={`${summary.warns} warning${summary.warns === 1 ? '' : 's'}`}
            onClick={() => showBottom('logs')}
          />
          <StatCard label="CPU" value={<span>{summary.cpu.toFixed(0)}<span className="text-[14px] text-muted">%</span></span>} sub="all tracked procs" />
          <StatCard label="Memory" value={<span>{summary.mem.toFixed(0)}<span className="text-[14px] text-muted"> MB</span></span>} sub="resident" />
        </div>

        {/* active sessions | errors & warnings */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-3">
            <CardHead title="Active sessions" count={running.length + summary.liveTerms.length} />
            {running.length === 0 && summary.liveTerms.length === 0 && idle.length === 0 && (
              <div className="py-5 text-center text-[12px] text-muted">
                Nothing running. Start a service or open a terminal.
              </div>
            )}
            {running.map((s) => {
              const st = statFor('service', s.id)
              const port = servicePort(s.id)
              return (
                <div key={`run-${s.id}`} className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line bg-raise/40 px-2.5 py-2 last:mb-0">
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                  <button className="truncate text-[12.5px] font-semibold text-ink hover:underline" title="Open the service page" onClick={() => openService(s.id, s.name)}>
                    {s.name}
                  </button>
                  <span className="shrink-0 text-[11px] font-medium text-indigo-400">{projName(s.project_id)}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2.5 font-mono text-[10.5px] text-muted">
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
            {summary.liveTerms.map((t) => (
              <div key={`term-${t.id}`} className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line bg-raise/40 px-2.5 py-2 last:mb-0">
                <Icon name="terminal" size={12} className="shrink-0 text-ok/80" />
                <button className="truncate text-[12.5px] font-semibold text-ink hover:underline" title="Jump to this terminal" onClick={() => openTerminalPanel(t.id, t.title)}>
                  {t.title}
                </button>
                <span className="shrink-0 text-[11px] text-muted">terminal</span>
                <span className="ml-auto font-mono text-[10.5px] text-muted">pid {t.pid}</span>
              </div>
            ))}
            {idle.map((s) => (
              <div key={`idle-${s.id}`} className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line/60 px-2.5 py-2 opacity-80 last:mb-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-faint/60" />
                <button className="truncate text-[12.5px] font-medium text-dim hover:text-ink hover:underline" title="Open the service page" onClick={() => openService(s.id, s.name)}>
                  {s.name}
                </button>
                <span className="shrink-0 text-[11px] text-muted">{projName(s.project_id)}</span>
                <span className="ml-auto font-mono text-[10.5px] text-faint">idle</span>
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/30"
                  title="Start"
                  onClick={() => void requestStartService(s)}
                >
                  <Icon name="run" size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-panel p-3">
            <CardHead title="Errors & warnings" action="view all →" onAction={() => showBottom('logs')} />
            {issues.length === 0 ? (
              <div className="py-5 text-center text-[12px] text-muted">No errors or warnings.</div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto">
                {issues.map((i) => (
                  <button
                    key={i.key}
                    className="flex w-full items-start gap-2 border-b border-line/60 py-1.5 text-left last:border-b-0 hover:bg-hover/40"
                    onClick={() => {
                      showBottom('logs')
                      focusServiceLogs(i.service)
                    }}
                    title={`Show ${i.service} logs`}
                  >
                    <span className="w-[52px] shrink-0 pt-px font-mono text-[9.5px] text-muted">
                      {i.ts ? new Date(i.ts).toLocaleTimeString([], { hour12: false }) : ''}
                    </span>
                    <span className={`shrink-0 text-[10px] font-semibold uppercase ${LEVEL_STYLE[i.level] ?? 'text-dim'}`}>{i.level}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">
                      <span className="text-indigo-400">{i.service}</span> {i.line}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* recent activity | master log */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-3">
            <CardHead title="Recent activity" />
            {activityFeed.length === 0 ? (
              <div className="py-5 text-center text-[12px] text-muted">
                Start a service, run a query or copy something — it shows up here.
              </div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto">
                {activityFeed.map((a) => (
                  <div key={a.key} className="flex items-start gap-2.5 border-b border-line/60 py-2 text-[12px] text-dim last:border-b-0">
                    <span className="w-[52px] shrink-0 pt-0.5 font-mono text-[9.5px] text-muted">{fmtAgo(a.ts, now)}</span>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${a.tone}`}>
                      <Icon name={a.icon} size={11} />
                    </span>
                    <span className="min-w-0">
                      {a.onClick ? (
                        <button className="font-semibold text-ink hover:underline" onClick={a.onClick}>{a.name}</button>
                      ) : (
                        <b className="font-semibold text-ink">{a.name}</b>
                      )}{' '}
                      {a.what && <span className="text-dim">{a.what}</span>}
                      {a.sub && <span className="text-muted"> · {a.sub}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col rounded-xl border border-line bg-panel p-3">
            <CardHead title="Master log" action="open full log →" onAction={() => showBottom('logs')} />
            <div className="max-h-[220px] min-h-[80px] flex-1 overflow-y-auto font-mono text-[11px] leading-[1.75] text-dim">
              {lastLogs.length === 0 && (
                <div className="py-5 text-center font-sans text-[12px] text-muted">No log output yet.</div>
              )}
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
      </div>
    </div>
  )
}
