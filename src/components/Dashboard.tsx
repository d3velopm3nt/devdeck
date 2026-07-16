// At-a-glance overview of the whole workspace: summary counters, the
// live active sessions (running services + open terminals), and a feed
// of recent errors / warnings / crashes. Read-mostly, with a few quick
// actions (open in browser, stop, jump to logs).

import { useMemo } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { openSingleton, openTerminalPanel, openSpace } from '../lib/dock'
import { subtreeIds } from '../lib/tree'
import { nodeColor, avatarLabel, projectUsage, rankSpaces } from '../lib/spaces'
import type { LogEntry, ProcStat, TreeNode } from '../lib/types'

function fmtUptime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function StatCard({
  label,
  value,
  sub,
  accent = 'text-slate-100',
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
      className={`rounded-lg border border-slate-800 bg-[#151923] px-3 py-2.5 ${
        onClick ? 'cursor-pointer hover:border-slate-600' : ''
      }`}
      onClick={onClick}
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold leading-none ${accent}`}>{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-slate-500">{sub}</div>}
    </div>
  )
}

const LEVEL_STYLE: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-slate-400',
  debug: 'text-slate-500',
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// One space (project) card: icon avatar, name, live counts, run controls.
function SpaceCard({ project, topUsed }: { project: TreeNode; topUsed: boolean }) {
  const { nodes, services, commands, svcStates } = useApp()
  const scope = useMemo(() => new Set(subtreeIds(nodes, project.id)), [nodes, project.id])
  const svc = services.filter((s) => s.project_id != null && scope.has(s.project_id))
  const running = svc.filter((s) => svcStates[s.id]?.status === 'running').length
  const cmds = commands.filter((c) => c.project_id != null && scope.has(c.project_id)).length
  const color = nodeColor(project)

  return (
    <button
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-slate-800 bg-[#151923] px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-slate-600 hover:shadow-lg"
      style={{ boxShadow: 'none' }}
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
          <span className="truncate text-[13px] font-medium text-slate-100">{project.name}</span>
          {topUsed && (
            <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide" style={{ background: hexA(color, 0.18), color }}>
              ★ most used
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-slate-500">
          {running > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {running} live
            </span>
          )}
          <span>{svc.length} svc</span>
          <span>{cmds} cmd</span>
        </div>
      </div>
      <span className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-300">→</span>
    </button>
  )
}

export function Dashboard() {
  const { nodes, services, commands, svcStates, stats, terminals, logs, recents } = useApp()

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
    const liveTerms = terminals.filter((t) => t.alive)
    const cpu = stats.reduce((a, p) => a + p.cpu, 0)
    const mem = stats.reduce((a, p) => a + p.mem_mb, 0)
    const errors = logs.filter((l) => l.level === 'error').length
    const warns = logs.filter((l) => l.level === 'warn').length
    const projects = nodes.filter((n) => n.kind === 'project').length
    const folders = nodes.filter((n) => n.kind === 'folder').length
    const workspaces = nodes.filter((n) => n.kind === 'workspace').length
    return { running, crashed, stopped: services.length - running - crashed, liveTerms, cpu, mem, errors, warns, projects, folders, workspaces }
  }, [nodes, services, svcStates, stats, terminals, logs])

  // Active sessions: running services first (with live stats), then terminals.
  const sessions = useMemo(() => {
    const statFor = (kind: 'service' | 'terminal', id: number): ProcStat | undefined =>
      stats.find((p) => p.kind === kind && p.id === id)
    const svc = services
      .filter((s) => svcStates[s.id]?.status === 'running')
      .map((s) => ({
        key: `svc-${s.id}`,
        kind: 'service' as const,
        id: s.id,
        name: s.name,
        port: s.health_port,
        pid: svcStates[s.id]?.pid ?? null,
        stat: statFor('service', s.id),
      }))
    const term = terminals
      .filter((t) => t.alive)
      .map((t) => ({
        key: `term-${t.id}`,
        kind: 'terminal' as const,
        id: t.id,
        name: t.title,
        port: null as number | null,
        pid: t.pid,
        stat: statFor('terminal', t.id),
      }))
    return [...svc, ...term]
  }, [services, svcStates, terminals, stats])

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
      .slice(-40)
      .reverse()
      .map((l) => ({ key: `log-${l.seq}`, ts: l.ts, level: l.level, service: l.service, line: l.line }))
    return [...crashed, ...logIssues].slice(0, 50)
  }, [services, svcStates, logs])

  const openBrowser = (port: number) =>
    void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))

  return (
    <div className="flex h-full flex-col bg-[#0f131b] text-slate-300">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-[#11141c] px-3 py-2">
        <span className="text-[13px] font-semibold text-slate-100">
          <span className="text-indigo-400">❯_</span> Dashboard
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-[11px] text-slate-500">
          {summary.workspaces} workspace{summary.workspaces === 1 ? '' : 's'} · {summary.projects} project
          {summary.projects === 1 ? '' : 's'} · {summary.folders} folder{summary.folders === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <button
          className="btn-ghost text-[11px]"
          title="Open the Processes panel"
          onClick={() => openSingleton('processes', 'processes', 'Processes')}
        >
          Processes
        </button>
        <button
          className="btn-ghost text-[11px]"
          title="Open the Logs panel"
          onClick={() => openSingleton('logs', 'logs', 'Logs')}
        >
          Logs
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-3">
        {/* Workspaces & most-used spaces */}
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
                    <span className="text-[13px] text-indigo-400">⬢</span>
                    <span className="text-[13px] font-semibold text-slate-200">{ws.name}</span>
                    <span className="text-[11px] text-slate-500">
                      {projects.length} space{projects.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {projects.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-[12px] text-slate-500">
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

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Services running"
            value={<span>{summary.running}<span className="text-[14px] text-slate-500">/{services.length}</span></span>}
            accent={summary.running ? 'text-emerald-400' : 'text-slate-300'}
            sub={summary.stopped > 0 ? `${summary.stopped} stopped` : 'all up'}
            onClick={() => openSingleton('services', 'services', 'Services')}
          />
          <StatCard
            label="Terminals"
            value={summary.liveTerms.length}
            accent={summary.liveTerms.length ? 'text-sky-400' : 'text-slate-300'}
            sub="live sessions"
          />
          <StatCard
            label="Crashed"
            value={summary.crashed}
            accent={summary.crashed ? 'text-red-400' : 'text-slate-300'}
            sub={summary.crashed ? 'needs attention' : 'none'}
          />
          <StatCard
            label="Errors"
            value={summary.errors}
            accent={summary.errors ? 'text-red-400' : 'text-slate-300'}
            sub={`${summary.warns} warning${summary.warns === 1 ? '' : 's'}`}
            onClick={() => openSingleton('logs', 'logs', 'Logs')}
          />
          <StatCard
            label="CPU"
            value={<span>{summary.cpu.toFixed(0)}<span className="text-[14px] text-slate-500">%</span></span>}
            accent={summary.cpu > 80 ? 'text-red-400' : summary.cpu > 40 ? 'text-amber-400' : 'text-slate-300'}
            sub="all tracked procs"
          />
          <StatCard
            label="Memory"
            value={<span>{summary.mem >= 1024 ? (summary.mem / 1024).toFixed(1) : summary.mem.toFixed(0)}<span className="text-[14px] text-slate-500">{summary.mem >= 1024 ? ' GB' : ' MB'}</span></span>}
            sub="resident"
          />
        </div>

        {/* Active sessions + Issues */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Active sessions */}
          <section className="rounded-lg border border-slate-800 bg-[#11141c]">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active sessions</span>
              <span className="text-[11px] text-slate-500">{sessions.length}</span>
            </div>
            <div className="divide-y divide-slate-800/70">
              {sessions.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-slate-500">
                  Nothing running. Start a service or open a terminal.
                </div>
              )}
              {sessions.map((s) => (
                <div key={s.key} className="group flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-800/30">
                  <span className={`text-[10px] ${s.kind === 'service' ? 'text-amber-400/80' : 'text-emerald-400'}`}>
                    {s.kind === 'service' ? '⚡' : '❯_'}
                  </span>
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-white"
                    title={s.kind === 'terminal' ? 'Open terminal tab' : undefined}
                    onClick={() => s.kind === 'terminal' && openTerminalPanel(s.id, s.name)}
                  >
                    {s.name}
                  </button>
                  {s.stat && s.stat.ports.length > 0 && (
                    <span className="hidden gap-1 font-mono text-[10.5px] text-sky-400 sm:flex">
                      {s.stat.ports.slice(0, 3).map((p) => (
                        <button key={p} className="hover:underline" title={`Open http://localhost:${p}`} onClick={() => openBrowser(p)}>
                          :{p}
                        </button>
                      ))}
                    </span>
                  )}
                  {s.stat && (
                    <span className="hidden w-14 text-right font-mono text-[10.5px] text-slate-500 md:block">
                      {fmtUptime(s.stat.uptime_secs)}
                    </span>
                  )}
                  {s.stat && (
                    <span className="hidden w-12 text-right font-mono text-[10.5px] text-slate-500 md:block">
                      {s.stat.mem_mb.toFixed(0)}mb
                    </span>
                  )}
                  {s.kind === 'service' ? (
                    <>
                      {s.port != null && (
                        <button
                          className="hidden shrink-0 rounded px-1 text-[11px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
                          title={`Open http://localhost:${s.port}`}
                          onClick={() => openBrowser(s.port!)}
                        >
                          🌐
                        </button>
                      )}
                      <button
                        className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10.5px] text-red-400 hover:bg-red-500/25"
                        title="Stop service"
                        onClick={() => void ipc.svcStop(s.id).catch((e) => alert(String(e)))}
                      >
                        ■
                      </button>
                    </>
                  ) : (
                    <span className="w-6" />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Issues */}
          <section className="rounded-lg border border-slate-800 bg-[#11141c]">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Errors &amp; warnings
              </span>
              <button
                className="text-[11px] text-slate-500 hover:text-slate-300"
                onClick={() => openSingleton('logs', 'logs', 'Logs')}
              >
                view all →
              </button>
            </div>
            <div className="divide-y divide-slate-800/70">
              {issues.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-slate-500">No errors or warnings. 🎉</div>
              )}
              {issues.map((i) => (
                <div key={i.key} className="flex items-start gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-800/30">
                  <span className={`mt-px text-[10px] uppercase ${LEVEL_STYLE[i.level]}`}>{i.level}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-slate-300" title={i.line}>{i.line}</div>
                    <div className="text-[10px] text-slate-500">
                      {i.service}
                      {i.ts ? ` · ${fmtTime(i.ts)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
