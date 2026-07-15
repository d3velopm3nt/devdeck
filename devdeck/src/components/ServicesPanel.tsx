// Managed long-running services. Click a service to edit it in a
// main-window tab; Start / Stop / Restart control the process with live
// status from the backend.

import { useMemo, useState } from 'react'
import type { SvcState } from '../lib/types'
import { useApp } from '../store'
import { openEditor } from '../lib/dock'
import { subtreeIds } from '../lib/tree'
import * as ipc from '../lib/ipc'

function statusBadge(s?: SvcState) {
  const status = s?.status ?? 'stopped'
  const map = {
    running: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
    stopped: 'bg-slate-600/20 text-slate-400 border-slate-600/50',
    crashed: 'bg-red-500/15 text-red-400 border-red-500/40',
  } as const
  return (
    <span className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${map[status]}`}>
      {status}
      {s?.exit_code != null && status !== 'running' ? ` (${s.exit_code})` : ''}
    </span>
  )
}

export function ServicesPanel() {
  const { services, svcStates, nodes, selectedNode } = useApp()
  const node = selectedNode()
  const [busy, setBusy] = useState<number | null>(null)

  const scope = useMemo(() => (node ? new Set(subtreeIds(nodes, node.id)) : null), [nodes, node])
  const visible = useMemo(
    () => services.filter((s) => s.project_id === null || (scope?.has(s.project_id) ?? false)),
    [services, scope],
  )

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id)
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
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5">
        <span className="text-[11px] text-slate-500">
          {node ? `${node.kind}: ${node.name}` : 'All services'}
        </span>
        <button
          className="btn-primary text-[11px]"
          onClick={() => openEditor('service', 0, 'New service', node?.id ?? null)}
        >
          + Service
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {visible.length === 0 && (
          <div className="p-2 text-[12px] text-slate-500">
            No services. Click “+ Service” to create one — it opens an editor in the main window.
          </div>
        )}
        {visible.map((s) => {
          const st = svcStates[s.id]
          const running = st?.status === 'running'
          return (
            <div
              key={s.id}
              className="group flex items-center gap-2 rounded border border-slate-800 bg-[#151923] px-2 py-1.5 hover:border-slate-600"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse bg-emerald-400' : st?.status === 'crashed' ? 'bg-red-400' : 'bg-slate-600'}`} />
              <button
                className="min-w-0 flex-1 cursor-pointer text-left"
                title="Click to edit"
                onClick={() => openEditor('service', s.id, s.name || 'Service')}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] text-slate-200">{s.name}</span>
                  {statusBadge(st)}
                  {running && st?.pid && <span className="text-[10px] text-slate-500">pid {st.pid}</span>}
                </div>
                <div className="truncate font-mono text-[10.5px] text-slate-500">{s.command}</div>
              </button>
              {!running ? (
                <button className="btn-primary text-[11px]" disabled={busy === s.id} onClick={() => void act(s.id, () => ipc.svcStart(s.id))}>
                  ▶ Start
                </button>
              ) : (
                <>
                  <button className="btn-ghost text-[11px]" disabled={busy === s.id} onClick={() => void act(s.id, () => ipc.svcRestart(s.id))}>
                    ⟳
                  </button>
                  <button className="btn-danger text-[11px]" disabled={busy === s.id} onClick={() => void act(s.id, () => ipc.svcStop(s.id))}>
                    ■ Stop
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
