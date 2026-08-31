// Workspaces, as tabs.
//
// A workspace used to be a dropdown buried in the Explorer, which made it feel
// like a filter on one list of projects. It is not — it is the frame everything
// else sits in, so it belongs in the chrome, and switching one should feel like
// switching windows rather than changing a setting.
//
// The status is the point of having them side by side: a tab tells you what is
// happening in a workspace you are *not* looking at, which a dropdown never
// could. Three signals, each only present when it has something to say —
// running services, git drift, and an agent that wants you. A tab with nothing
// to report shows nothing, so the ones that light up mean something.
//
// Right-click is where rename and delete live. They used to hang off the
// Explorer's workspace switcher; when the rail took over solution-picking that
// switcher went, and these went with it — the menu was still built, just
// unreachable.

import { useMemo, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { avatarLabel, nodeColor } from '../lib/spaces'
import { findNode, subtreeIds, workspaceOf } from '../lib/tree'
import { PopMenu, type MenuItem } from '../components/PopMenu'
import { useAiw } from '../lib/aiwStore'

export function WorkspaceTabs() {
  const {
    nodes,
    services,
    svcStates,
    gitByNode,
    activeWorkspaceId,
    setActiveWorkspace,
    refreshTree,
    labels,
  } = useApp()
  const aiw = useAiw()
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null)

  const workspaces = useMemo(() => nodes.filter((n) => n.kind === 'workspace'), [nodes])

  // Everything a tab can say, computed once per workspace.
  const stats = useMemo(() => {
    const out = new Map<number, { running: number; behind: number; working: number; waiting: number }>()
    const get = (id: number) => {
      let s = out.get(id)
      if (!s) {
        s = { running: 0, behind: 0, working: 0, waiting: 0 }
        out.set(id, s)
      }
      return s
    }

    // Walk from the service to its workspace rather than assuming a shape — a
    // service can hang off a folder, and a folder's parent is the project.
    for (const svc of services) {
      if (svcStates[svc.id]?.status !== 'running') continue
      const ws = workspaceOf(nodes, findNode(nodes, svc.project_id ?? null))
      if (ws) get(ws.id).running += 1
    }

    for (const [nodeId, g] of Object.entries(gitByNode)) {
      if (!g?.behind) continue
      const ws = workspaceOf(nodes, findNode(nodes, Number(nodeId)))
      if (ws) get(ws.id).behind += g.behind
    }

    // Agents are keyed by AI project id, which is the tree node id as a string.
    const wsOfProject = (projectId: string) => {
      const id = Number(projectId)
      return Number.isFinite(id) ? workspaceOf(nodes, findNode(nodes, id)) : null
    }
    for (const s of aiw.sessions) {
      if (s.status !== 'working' && s.status !== 'planning') continue
      const ws = wsOfProject(s.project_id)
      if (ws) get(ws.id).working += 1
    }
    for (const r of aiw.approvals) {
      const ws = r.project_id ? wsOfProject(r.project_id) : null
      if (ws) get(ws.id).waiting += 1
    }
    return out
  }, [nodes, services, svcStates, gitByNode, aiw.sessions, aiw.approvals])

  const menuItems = (id: number): MenuItem[] => {
    const w = findNode(nodes, id)
    if (!w) return []

    // Tagging a workspace is not decoration. A bot drafted in a space tagged
    // Personal starts quiet and out of work hours; one in a Business space
    // starts on them. Until this menu existed there was no way to say which a
    // workspace was, so the draft guessed from the name.
    const tags: MenuItem[] = labels
      .filter((l) => l !== w.label)
      .map((l) => ({
        icon: 'tag' as const,
        label: l,
        onClick: () =>
          void ipc.vaultSetMeta(w.id, { label: l }).then(() => refreshTree()),
      }))
    if (w.label) {
      tags.push({
        icon: 'close',
        label: `Clear “${w.label}”`,
        onClick: () => void ipc.vaultSetMeta(w.id, { label: '' }).then(() => refreshTree()),
      })
    }

    return [
      ...tags,
      { separator: true, label: '' },
      {
        icon: 'edit',
        label: 'Rename workspace…',
        onClick: () => {
          const name = prompt('Rename workspace', w.name)
          if (name === null) return
          const v = name.trim()
          if (!v || v === w.name) return
          void ipc.vaultRename(w.id, v).then(() => refreshTree()).catch((e) => alert(String(e)))
        },
      },
      {
        icon: 'delete',
        label: 'Delete workspace',
        danger: true,
        onClick: () => {
          // Deleting cascades to everything inside, so say how much.
          const inside = subtreeIds(nodes, w.id).length - 1
          const warning = inside > 0 ? `\n\nThis also removes ${inside} thing${inside === 1 ? '' : 's'} inside it.` : ''
          if (!confirm(`Delete the workspace folder “${w.name}”?${warning}`)) return
          void ipc.vaultDelete(w.id).then(() => refreshTree()).catch((e) => alert(String(e)))
        },
      },
    ]
  }

  return (
    <div className="flex min-w-0 items-stretch overflow-x-auto">
      {workspaces.map((w) => {
        const active = w.id === activeWorkspaceId
        const s = stats.get(w.id)
        const running = s?.running ?? 0
        const behind = s?.behind ?? 0
        const working = s?.working ?? 0
        const waiting = s?.waiting ?? 0

        return (
          <button
            key={w.id}
            className={`group flex shrink-0 items-center gap-2 border-r border-line px-3 py-1.5 text-left ${
              active
                ? 'bg-page text-ink shadow-[inset_0_2px_0_theme(colors.indigo.500)]'
                : 'text-dim hover:bg-hover/40 hover:text-ink'
            }`}
            title={w.name}
            onClick={() => setActiveWorkspace(w.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, id: w.id })
            }}
          >
            {/* Its own initials in its own colour: the tabs are told apart by
                shape rather than by reading them. */}
            <span
              className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-[9.5px] font-bold ${
                active ? 'text-white' : 'bg-hover text-muted'
              }`}
              style={active ? { background: nodeColor(w) } : undefined}
            >
              {avatarLabel(w.name)}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="flex items-center gap-1.5">
                <span
                  className={`max-w-[150px] truncate text-[12.5px] ${active ? 'font-semibold' : ''}`}
                >
                  {w.name}
                </span>
                {w.label && (
                  <span className="shrink-0 rounded-full bg-soft px-1.5 text-[8.5px] font-semibold uppercase tracking-[0.04em] text-muted">
                    {w.label}
                  </span>
                )}
              </span>
              {/* Always present. It used to appear only when a count was
                  non-zero, which made a quiet workspace look identical to one
                  before any of this existed. */}
              <span className="mt-0.5 flex items-center gap-2 text-[10px]">
                {running === 0 && behind === 0 && working === 0 && waiting === 0 && (
                  <span className="text-faint">Idle</span>
                )}
                  {running > 0 && (
                    <span className="flex items-center gap-1 text-ok">
                      <span className="h-[5px] w-[5px] rounded-full bg-emerald-400" />
                      {running} running
                    </span>
                  )}
                  {behind > 0 && (
                    <span className="flex items-center gap-0.5 text-warn" title={`${behind} to pull`}>
                      <Icon name="arrow-down" size={9} />
                      {behind}
                    </span>
                  )}
                  {working > 0 && (
                    <span className="flex items-center gap-0.5 text-info" title={`${working} agent(s) working`}>
                      <Icon name="agent" size={9} />
                      {working}
                    </span>
                  )}
                  {waiting > 0 && (
                    <span
                      className="flex items-center gap-0.5 font-semibold text-warn"
                      title={`${waiting} waiting on you`}
                    >
                      <Icon name="alert" size={9} />
                      {waiting} waiting
                    </span>
                  )}
              </span>
            </span>
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
            try {
              // A workspace is a top-level folder; depth is what makes it one.
              const created = await ipc.vaultCreate(null, name.trim() || 'New workspace')
              await refreshTree()
              setActiveWorkspace(created.id)
            } catch (e) {
              alert(String(e))
            }
          })()
        }}
      >
        <Icon name="add" size={13} />
      </button>

      {menu && (
        <PopMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
