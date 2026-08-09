// Managed long-running services. Click a service to edit it in a
// main-window tab; Start / Stop / Restart control the process with live
// status from the backend.

import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { openEditor } from '../lib/dock'
import { subtreeIds, serviceDir } from '../lib/tree'
import * as ipc from '../lib/ipc'

// Small square icon button used for the row's inline actions.
const iconBtn =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px] leading-none transition disabled:opacity-30'

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
          const dir = serviceDir(nodes, s)
          return (
            <div
              key={s.id}
              className="group rounded-lg border border-slate-800 bg-[#151923] px-2.5 py-2 hover:border-slate-600"
            >
              {/* line 1: status dot + name + actions */}
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse bg-emerald-400' : st?.status === 'crashed' ? 'bg-red-400' : 'bg-slate-600'}`}
                  title={running ? 'Running' : st?.status === 'crashed' ? 'Crashed' : 'Stopped'}
                />
                <button
                  className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px] font-medium text-slate-200 hover:text-white"
                  title="Click to edit"
                  onClick={() => openEditor('service', s.id, s.name || 'Service')}
                >
                  {s.name || 'Service'}
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    className={`${iconBtn} text-slate-400 hover:bg-slate-700 hover:text-white`}
                    title={dir ? `Reveal in File Explorer\n${dir}` : 'No folder set for this service'}
                    disabled={!dir}
                    onClick={() => void ipc.revealInExplorer(dir).catch((e) => alert(String(e)))}
                  >
                    📂
                  </button>
                  {s.health_port != null && (
                    <button
                      className={`${iconBtn} text-slate-400 hover:bg-slate-700 hover:text-white`}
                      title={running ? `Open http://localhost:${s.health_port}` : `Opens http://localhost:${s.health_port} (service is not running)`}
                      onClick={() => void ipc.openUrl(`http://localhost:${s.health_port}`).catch((e) => alert(String(e)))}
                    >
                      🌐
                    </button>
                  )}
                  {running ? (
                    <>
                      <button
                        className={`${iconBtn} text-slate-300 hover:bg-slate-700 hover:text-white`}
                        disabled={busy === s.id}
                        title="Restart"
                        onClick={() => void act(s.id, () => ipc.svcRestart(s.id))}
                      >
                        ⟳
                      </button>
                      <button
                        className={`${iconBtn} bg-red-500/15 text-red-400 hover:bg-red-500/30`}
                        disabled={busy === s.id}
                        title="Stop"
                        onClick={() => void act(s.id, () => ipc.svcStop(s.id))}
                      >
                        ■
                      </button>
                    </>
                  ) : (
                    <button
                      className={`${iconBtn} bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/35`}
                      disabled={busy === s.id}
                      title="Start"
                      onClick={() => void act(s.id, () => ipc.svcStart(s.id))}
                    >
                      ▶
                    </button>
                  )}
                </div>
              </div>
              {/* line 2: command + port + pid / crash */}
              <div className="mt-1 flex items-center gap-2 pl-4">
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-500">{s.command}</span>
                {s.health_port != null && <span className="shrink-0 font-mono text-[10px] text-slate-500">:{s.health_port}</span>}
                {running && st?.pid && <span className="shrink-0 text-[10px] text-slate-600">pid {st.pid}</span>}
                {st?.status === 'crashed' && (
                  <span className="shrink-0 text-[10px] text-red-400">exit {st.exit_code ?? '?'}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
