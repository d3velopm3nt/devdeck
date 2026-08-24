// Managed long-running services, scoped to the selected project (plus
// globals). Click a service to edit it; the primary button starts/stops it and
// the ⋯ menu offers restart, view-logs, reveal, open-URL, edit and delete.

import { useMemo, useState } from 'react'
import type { ServiceDef } from '../lib/types'
import { useApp } from '../store'
import { openEditor, openInMain } from '../lib/dock'
import { subtreeIds, serviceDir } from '../lib/tree'
import * as ipc from '../lib/ipc'
import { PanelShell, RowTitle, ROW_CARD, ICON_BTN, useRowMenu } from './PanelShell'
import type { MenuItem } from './PopMenu'
import { Icon } from '../lib/icons'

export function ServicesPanel() {
  const { services, svcStates, nodes, selectedNode, scopeNode, refreshServices, focusServiceLogs, servicePort, requestStartService } = useApp()
  const sel = selectedNode()
  const node = scopeNode() // selection, else the active workspace
  const [busy, setBusy] = useState<number | null>(null)
  const { openMenu, menuNode } = useRowMenu()

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

  const del = async (s: ServiceDef) => {
    if (!confirm(`Delete service “${s.name}”?`)) return
    await ipc.serviceDelete(s.id)
    await refreshServices()
  }

  const viewLogs = (s: ServiceDef) => {
    openInMain('logs', 'logs', 'Logs')
    focusServiceLogs(s.name)
  }

  const overflow = (s: ServiceDef, running: boolean): MenuItem[] => {
    const dir = serviceDir(nodes, s)
    const port = servicePort(s.id)
    return [
      { icon: 'restart', label: 'Restart', disabled: !running, onClick: () => void act(s.id, () => ipc.svcRestart(s.id)) },
      { icon: 'logs', label: 'View logs', onClick: () => viewLogs(s) },
      ...(port != null
        ? [{ icon: 'globe', label: `Open http://localhost:${port}`, onClick: () => void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e))) }]
        : []),
      { icon: 'reveal', label: 'Reveal in File Explorer', disabled: !dir, onClick: () => void ipc.revealInExplorer(dir).catch((e) => alert(String(e))) },
      { separator: true, label: '' },
      { icon: 'edit', label: 'Edit service…', onClick: () => openEditor('service', s.id, s.name || 'Service') },
      { icon: 'delete', label: 'Delete service', danger: true, onClick: () => void del(s) },
    ]
  }

  return (
    <PanelShell
      scope={node ? `${node.kind}: ${node.name}` : 'Global'}
      addLabel="Service"
      onAdd={() => openEditor('service', 0, 'New service', sel?.id ?? null)}
      isEmpty={visible.length === 0}
      emptyText="No services yet. Click “+ Service” to create one — it opens an editor in the main window."
    >
      {visible.map((s) => {
        const st = svcStates[s.id]
        const running = st?.status === 'running'
        const crashed = st?.status === 'crashed'
        const port = servicePort(s.id)
        const sub = s.command + (port != null ? `  ·  :${port}` : '') + (running && st?.pid ? `  ·  pid ${st.pid}` : crashed ? `  ·  exit ${st?.exit_code ?? '?'}` : '')
        return (
          <div key={s.id} className={ROW_CARD}>
            <RowTitle
              badge={
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse bg-emerald-400' : crashed ? 'bg-red-400' : 'bg-slate-600'}`}
                  title={running ? 'Running' : crashed ? 'Crashed' : 'Stopped'}
                />
              }
              name={s.name || 'Service'}
              sub={sub}
              onClick={() => openEditor('service', s.id, s.name || 'Service')}
            />
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                className={
                  running
                    ? `${ICON_BTN} bg-red-500/15 text-red-400 hover:bg-red-500/30 hover:text-white`
                    : `${ICON_BTN} bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/35 hover:text-white`
                }
                disabled={busy === s.id}
                title={running ? 'Stop' : 'Start'}
                onClick={() => void act(s.id, () => (running ? ipc.svcStop(s.id) : requestStartService(s)))}
              >
                <Icon name={running ? 'stop' : 'run'} size={13} />
              </button>
              <button className={ICON_BTN} title="More actions" onClick={(e) => openMenu(e, overflow(s, running))}>
                <Icon name="more" size={14} />
              </button>
            </div>
          </div>
        )
      })}
      {menuNode}
    </PanelShell>
  )
}
