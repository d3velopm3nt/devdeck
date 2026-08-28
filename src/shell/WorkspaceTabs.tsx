// Workspaces, as tabs.
//
// A workspace used to be a dropdown buried in the Explorer, which made it feel
// like a filter on one list of projects. It is not — it is the frame everything
// else sits in, so it belongs in the chrome, and switching one should feel like
// switching windows rather than changing a setting.
//
// The dot is the point of having them side by side: it tells you something is
// running in a workspace you are not looking at, which a dropdown never could.

import { useMemo } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'

export function WorkspaceTabs() {
  const { nodes, services, svcStates, activeWorkspaceId, setActiveWorkspace, refreshTree } =
    useApp()

  const workspaces = useMemo(() => nodes.filter((n) => n.kind === 'workspace'), [nodes])

  // Which workspaces have something running. Walk from the service to its
  // project to its workspace, rather than assuming a shape — a service can
  // hang off a folder, and a folder's parent is the project.
  const busy = useMemo(() => {
    const parentOf = new Map(nodes.map((n) => [n.id, n.parent_id]))
    const workspaceOf = (id: number | null): number | null => {
      // Bounded: a malformed parent chain must not spin here.
      for (let hops = 0; id != null && hops < 8; hops++) {
        const node = nodes.find((n) => n.id === id)
        if (!node) return null
        if (node.kind === 'workspace') return node.id
        id = parentOf.get(id) ?? null
      }
      return null
    }
    const out = new Set<number>()
    for (const svc of services) {
      if (svcStates[svc.id]?.status !== 'running') continue
      const ws = workspaceOf(svc.project_id ?? null)
      if (ws != null) out.add(ws)
    }
    return out
  }, [nodes, services, svcStates])

  return (
    <div className="flex min-w-0 items-stretch overflow-x-auto">
      {workspaces.map((w) => {
        const active = w.id === activeWorkspaceId
        return (
          <button
            key={w.id}
            className={`flex shrink-0 items-center gap-1.5 border-r border-line px-3 text-[12.5px] ${
              active
                ? 'bg-page font-semibold text-ink shadow-[inset_0_2px_0_theme(colors.indigo.500)]'
                : 'text-dim hover:bg-hover/40 hover:text-ink'
            }`}
            title={w.name}
            onClick={() => setActiveWorkspace(w.id)}
          >
            <Icon name="workspace" size={13} className={active ? 'text-indigo-400' : 'text-muted'} />
            <span className="max-w-[160px] truncate">{w.name}</span>
            {busy.has(w.id) && (
              <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-emerald-400" />
            )}
          </button>
        )
      })}

      <button
        className="flex shrink-0 items-center border-r border-line px-2.5 text-faint hover:bg-hover/40 hover:text-dim"
        title="New workspace"
        onClick={() => {
          const name = prompt('Name for the new workspace', 'New workspace')
          if (name === null) return
          void (async () => {
            const created = await ipc.nodeCreate(null, 'workspace', name.trim() || 'New workspace')
            await refreshTree()
            setActiveWorkspace(created.id)
          })()
        }}
      >
        <Icon name="add" size={13} />
      </button>
    </div>
  )
}
