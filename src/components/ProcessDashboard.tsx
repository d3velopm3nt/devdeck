// Process dashboard: manage every service and terminal from one place.
// Shows all configured services (running or not) plus live terminals,
// with per-row actions — start (run), stop, restart, open, kill — and
// live CPU / memory / uptime / ports / health for running processes.

import { useMemo, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import type { ProcStat, SvcStatus } from '../lib/types'
import { openTerminalPanel, closeTerminalPanel } from '../lib/dock'
import { serviceDir } from '../lib/tree'

function fmtUptime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

interface Row {
  key: string
  kind: 'service' | 'terminal'
  id: number
  name: string
  status: SvcStatus | 'live'
  stat?: ProcStat
}

const STATUS_STYLE: Record<string, string> = {
  running: 'text-emerald-400',
  live: 'text-emerald-400',
  stopped: 'text-slate-500',
  crashed: 'text-red-400',
}

export function ProcessDashboard() {
  const { services, svcStates, stats, terminals, nodes } = useApp()
  const [busy, setBusy] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const svcRows: Row[] = services.map((s) => {
      const status = svcStates[s.id]?.status ?? 'stopped'
      const stat = stats.find((p) => p.kind === 'service' && p.id === s.id)
      return { key: `service-${s.id}`, kind: 'service', id: s.id, name: s.name, status, stat }
    })
    const termRows: Row[] = stats
      .filter((p) => p.kind === 'terminal')
      .map((p) => ({
        key: `terminal-${p.id}`,
        kind: 'terminal',
        id: p.id,
        name: terminals.find((t) => t.id === p.id)?.title ?? p.name,
        status: 'live',
        stat: p,
      }))
    return [...svcRows, ...termRows]
  }, [services, svcStates, stats, terminals])

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      alert(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#11141c] text-slate-300">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-500">
        <span>Processes</span>
        <span className="text-slate-600">·</span>
        <span>{rows.filter((r) => r.status === 'running' || r.status === 'live').length} running</span>
        <span className="text-slate-600">·</span>
        <span>{services.length} service(s)</span>
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-3 text-[12px] text-slate-500">
            No services or terminals yet. Add a service (Services panel) or open a terminal — they
            appear here to start, stop, restart, and monitor.
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[#161a24] text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                {['', 'Name', 'Status', 'PID', 'CPU %', 'Mem MB', 'Uptime', 'Ports', 'Actions'].map(
                  (h, i) => (
                    <th key={i} className="border-b border-slate-800 px-2 py-1.5 text-left font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = r.stat
                const running = r.status === 'running' || r.status === 'live'
                const svc = r.kind === 'service' ? services.find((s) => s.id === r.id) : undefined
                const port = svc?.health_port ?? null
                return (
                  <tr key={r.key} className="hover:bg-slate-800/30">
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] ${r.kind === 'service' ? 'text-indigo-400' : 'text-emerald-400'}`}>
                        {r.kind === 'service' ? '⚙' : '❯_'}
                      </span>
                    </td>
                    <td className="max-w-48 truncate px-2 py-1.5 text-slate-200">{r.name}</td>
                    <td className={`px-2 py-1.5 uppercase text-[10px] tracking-wide ${STATUS_STYLE[r.status] ?? 'text-slate-400'}`}>
                      {r.status === 'live' ? 'running' : r.status}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">{st?.pid ?? '—'}</td>
                    <td className={`px-2 py-1.5 font-mono ${st && st.cpu > 80 ? 'text-red-400' : st && st.cpu > 30 ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {st ? st.cpu.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{st ? st.mem_mb.toFixed(0) : '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">{st ? fmtUptime(st.uptime_secs) : '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-sky-400">
                      {st && st.ports.length ? (
                        <span className="flex flex-wrap gap-x-1.5">
                          {st.ports.map((p) => (
                            <button
                              key={p}
                              className="text-sky-400 hover:text-sky-300 hover:underline"
                              title={`Open http://localhost:${p}`}
                              onClick={() => void ipc.openUrl(`http://localhost:${p}`).catch((e) => alert(String(e)))}
                            >
                              {p}
                            </button>
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                        {r.kind === 'service' ? (
                          <>
                          {svc && serviceDir(nodes, svc) && (
                            <button
                              className="rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-[11px] text-slate-200 hover:border-slate-400"
                              title={`Reveal in File Explorer\n${serviceDir(nodes, svc)}`}
                              onClick={() => void ipc.revealInExplorer(serviceDir(nodes, svc)).catch((e) => alert(String(e)))}
                            >
                              📂 Folder
                            </button>
                          )}
                          {port != null && (
                            <button
                              className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-400 hover:bg-sky-500/25"
                              title={running ? `Open http://localhost:${port}` : `Opens http://localhost:${port} (not running)`}
                              onClick={() => void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))}
                            >
                              🌐 Open
                            </button>
                          )}
                          {running ? (
                            <>
                              <button
                                className="rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-[11px] text-slate-200 hover:border-slate-400 disabled:opacity-40"
                                disabled={busy === r.key}
                                title="Restart service"
                                onClick={() => void act(r.key, () => ipc.svcRestart(r.id))}
                              >
                                ⟳ Restart
                              </button>
                              <button
                                className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-500/25 disabled:opacity-40"
                                disabled={busy === r.key}
                                title="Stop service"
                                onClick={() => void act(r.key, () => ipc.svcStop(r.id))}
                              >
                                ■ Stop
                              </button>
                            </>
                          ) : (
                            <button
                              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40"
                              disabled={busy === r.key}
                              title="Start service"
                              onClick={() => void act(r.key, () => ipc.svcStart(r.id))}
                            >
                              ▶ Start
                            </button>
                          )}
                          </>
                        ) : (
                          <>
                            <button
                              className="rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-[11px] text-slate-200 hover:border-slate-400"
                              title="Open / focus terminal tab"
                              onClick={() => openTerminalPanel(r.id, r.name)}
                            >
                              ⮌ Open
                            </button>
                            <button
                              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-500/25"
                              title="Kill terminal session"
                              onClick={() =>
                                void act(r.key, async () => {
                                  await ipc.ptyKill(r.id)
                                  closeTerminalPanel(r.id)
                                  await useApp.getState().refreshTerminals()
                                })
                              }
                            >
                              ■ Kill
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
