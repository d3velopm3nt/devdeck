// The service page — a document showing everything DevDeck knows about one
// service: live status (uptime, pid, cpu, mem), its configuration, run
// history, and a tail of its own log output. Editing the config opens the
// slide-over sheet; this page is about *observing and operating* the service.

import { useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { Icon } from '../lib/icons'
import { openEditor, openSpace } from '../lib/dock'
import { findNode, projectOf, serviceDir } from '../lib/tree'
import { fmtAgo, fmtUptime } from '../lib/time'

function InfoCell({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-raise px-3 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">{k}</div>
      <div className={`mt-0.5 truncate text-[12.5px] text-ink ${mono ? 'font-mono text-[11.5px]' : ''}`}>
        {children}
      </div>
    </div>
  )
}

export function ServiceDetailPage(props: IDockviewPanelProps<{ id: number }>) {
  const serviceId = props.params.id
  const {
    services, nodes, svcStates, stats, logs, recents,
    servicePort, requestStartService, showBottom, focusServiceLogs,
  } = useApp()
  const [busy, setBusy] = useState(false)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])

  const svc = services.find((s) => s.id === serviceId)
  const st = svc ? svcStates[svc.id] : undefined
  const running = st?.status === 'running'
  const crashed = st?.status === 'crashed'
  const stat = stats.find((p) => p.kind === 'service' && p.id === serviceId)
  const port = svc ? servicePort(svc.id) : null
  const proj = svc ? projectOf(nodes, findNode(nodes, svc.project_id)) : null
  const recent = recents.find((r) => r.kind === 'service' && r.ref_id === serviceId)

  // This service's slice of the master log, newest last.
  const svcLogs = useMemo(
    () => (svc ? logs.filter((l) => l.service === svc.name).slice(-40) : []),
    [logs, svc],
  )

  if (!svc) {
    return (
      <div className="flex h-full items-center justify-center bg-page text-[12.5px] text-muted">
        Service not found — it may have been deleted.
      </div>
    )
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      alert(String(e))
    } finally {
      setBusy(false)
    }
  }

  const dir = serviceDir(nodes, svc)
  const statusLabel = running ? 'running' : crashed ? `crashed${st?.exit_code != null ? ` · exit ${st.exit_code}` : ''}` : 'stopped'

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-page px-5 py-4">
      {/* header */}
      <div className="flex items-center gap-3">
        <span
          className={`h-3 w-3 shrink-0 rounded-full ${
            running ? 'animate-pulse bg-emerald-400' : crashed ? 'bg-red-400' : 'bg-faint'
          }`}
        />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <h2 className="truncate text-[19px] font-semibold tracking-tight text-ink">{svc.name}</h2>
            {proj && (
              <button
                className="text-[12px] font-medium text-indigo-400 hover:underline"
                title="Open the project dashboard"
                onClick={() => openSpace(proj.id, proj.name)}
              >
                {proj.name}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5 font-mono text-[10.5px] text-muted">
            <span className={running ? 'text-ok' : crashed ? 'text-err' : ''}>{statusLabel}</span>
            {running && st?.started_at != null && <span>up {fmtUptime(st.started_at, now)}</span>}
            {running && st?.pid != null && <span>pid {st.pid}</span>}
            {port != null && <span className="text-indigo-400">:{port}</span>}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {port != null && (
            <button
              className="btn-ghost inline-flex items-center gap-1 text-[11.5px]"
              title={`Open http://localhost:${port}`}
              onClick={() => void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))}
            >
              <Icon name="globe" size={12} /> Open
            </button>
          )}
          <button
            className="btn-ghost inline-flex items-center gap-1 text-[11.5px]"
            title="Filter the bottom Logs to this service"
            onClick={() => {
              showBottom('logs')
              focusServiceLogs(svc.name)
            }}
          >
            <Icon name="logs" size={12} /> Logs
          </button>
          <button
            className="btn-ghost inline-flex items-center gap-1 text-[11.5px]"
            title="Edit this service"
            onClick={() => openEditor('service', svc.id, svc.name)}
          >
            <Icon name="edit" size={12} /> Edit
          </button>
          {running ? (
            <>
              <button
                className="btn-ghost inline-flex items-center gap-1 text-[11.5px]"
                disabled={busy}
                onClick={() => void act(() => ipc.svcRestart(svc.id))}
              >
                <Icon name="restart" size={12} /> Restart
              </button>
              <button
                className="btn-danger inline-flex items-center gap-1 text-[11.5px]"
                disabled={busy}
                onClick={() => void act(() => ipc.svcStop(svc.id))}
              >
                <Icon name="stop" size={12} /> Stop
              </button>
            </>
          ) : (
            <button
              className="btn-primary inline-flex items-center gap-1 text-[11.5px]"
              disabled={busy}
              onClick={() => void act(() => requestStartService(svc))}
            >
              <Icon name="run" size={12} /> Start
            </button>
          )}
        </div>
      </div>

      {/* live stats */}
      <div className="mt-4 grid grid-cols-4 gap-2.5">
        <InfoCell k="Status">
          <span className={running ? 'text-ok' : crashed ? 'text-err' : 'text-dim'}>{statusLabel}</span>
        </InfoCell>
        <InfoCell k="Uptime">{running && st?.started_at != null ? fmtUptime(st.started_at, now) : '—'}</InfoCell>
        <InfoCell k="CPU">{stat ? `${stat.cpu.toFixed(1)}%` : '—'}</InfoCell>
        <InfoCell k="Memory">{stat ? `${stat.mem_mb.toFixed(0)} MB` : '—'}</InfoCell>
      </div>

      {/* configuration */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Configuration</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <InfoCell k="Command" mono>{svc.command}</InfoCell>
          <InfoCell k="Directory" mono>{dir || '—'}</InfoCell>
          <InfoCell k="Shell">{svc.shell || 'Default (PowerShell)'}</InfoCell>
          <InfoCell k="Port">
            {svc.health_port != null
              ? `:${svc.health_port} (saved)`
              : port != null
                ? `:${port} (detected)`
                : 'none'}
          </InfoCell>
          <InfoCell k="Auto-restart">{svc.auto_restart ? 'on' : 'off'}</InfoCell>
          <InfoCell k="Environment" mono>{svc.env && svc.env !== '{}' ? svc.env : '—'}</InfoCell>
        </div>
      </div>

      {/* run history */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Run history</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          <InfoCell k="Times started">{recent?.count ?? 0}</InfoCell>
          <InfoCell k="Last started">
            {st?.started_at != null ? fmtAgo(st.started_at, now) : recent ? fmtAgo(recent.ts, now) : 'never'}
          </InfoCell>
          <InfoCell k="Last exit code">{st?.exit_code != null ? String(st.exit_code) : '—'}</InfoCell>
          <InfoCell k="PID">{running && st?.pid != null ? String(st.pid) : '—'}</InfoCell>
        </div>
      </div>

      {/* recent output */}
      <div className="mt-4 flex min-h-[160px] flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Recent output</span>
          <span className="h-px flex-1 bg-line" />
          <button
            className="text-[10.5px] text-indigo-400 hover:underline"
            onClick={() => {
              showBottom('logs')
              focusServiceLogs(svc.name)
            }}
          >
            open full log →
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-raise px-3 py-2 font-mono text-[11px] leading-[1.7] text-dim">
          {svcLogs.length === 0 && (
            <div className="py-5 text-center font-sans text-[12px] text-muted">
              No output captured yet — start the service and its logs land here.
            </div>
          )}
          {svcLogs.map((l) => (
            <div key={l.seq} className="truncate">
              <span className="text-faint">{new Date(l.ts).toLocaleTimeString([], { hour12: false })}</span>{' '}
              <span className={l.level === 'error' ? 'text-err' : l.level === 'warn' ? 'text-warn' : ''}>{l.line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
