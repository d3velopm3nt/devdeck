// Workspace → Project → Folder. A Project is an app/repo root (base
// path); Folders are locations inside it (subpath under the base path,
// or an absolute override). Managed through a right-click context menu
// with inline renaming — no blocking modals.

import { useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import type { NodeKind, ServiceDef, SvcState, TreeNode } from '../lib/types'
import { useApp } from '../store'
import { openEditor, openNodeSetup } from '../lib/dock'
import { openTerminal } from '../lib/runner'
import { resolveDir } from '../lib/tree'
import { nodeColor } from '../lib/spaces'
import { PopMenu, type MenuItem } from './PopMenu'

const KIND_ICON: Record<NodeKind, string> = {
  workspace: '⬢',
  project: '▣',
  folder: '▤',
}

const KIND_COLOR: Record<NodeKind, string> = {
  workspace: 'text-indigo-400',
  project: 'text-emerald-400',
  folder: 'text-slate-400',
}

const KIND_LABEL: Record<NodeKind, string> = {
  workspace: 'Workspace',
  project: 'Project',
  folder: 'Folder',
}

interface Menu {
  x: number
  y: number
  node: TreeNode | null
}

export function Explorer() {
  const { nodes, services, svcStates, selectedNodeId, setSelectedNode, refreshTree } = useApp()
  const roots = useMemo(() => nodes.filter((n) => n.parent_id === null), [nodes])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [busySvc, setBusySvc] = useState<number | null>(null)

  const actSvc = async (id: number, fn: () => Promise<unknown>) => {
    setBusySvc(id)
    try {
      await fn()
    } catch (e) {
      alert(String(e))
    } finally {
      setBusySvc(null)
    }
  }

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const expand = (id: number) => setExpanded((prev) => new Set(prev).add(id))

  const beginRename = (node: TreeNode) => {
    setDraft(node.name)
    setRenamingId(node.id)
  }
  const commitRename = async (node: TreeNode) => {
    const name = draft.trim()
    setRenamingId(null)
    if (name && name !== node.name) {
      await ipc.nodeRename(node.id, name)
      await refreshTree()
    }
  }

  const addProject = async (workspace: TreeNode) => {
    // A project is an app root — pick its base directory.
    const dir = await openDialog({ directory: true, title: 'Select the project base folder (repo root)' })
    if (typeof dir !== 'string') return
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const created = await ipc.nodeCreate(workspace.id, 'project', name, dir)
    expand(workspace.id)
    await refreshTree()
    openNodeSetup(created.id, name)
  }

  const addFolder = async (parent: TreeNode) => {
    // Default the subpath to the folder name; user tunes it in setup.
    const created = await ipc.nodeCreate(parent.id, 'folder', 'new-folder', null, 'new-folder')
    expand(parent.id)
    await refreshTree()
    beginRename(created)
  }

  const addWorkspace = async () => {
    const created = await ipc.nodeCreate(null, 'workspace', 'New workspace')
    await refreshTree()
    beginRename(created)
  }

  const del = async (node: TreeNode) => {
    if (!confirm(`Delete ${node.kind} “${node.name}” and everything inside it?`)) return
    await ipc.nodeDelete(node.id)
    if (selectedNodeId === node.id) setSelectedNode(null)
    await refreshTree()
  }

  const menuItems = (node: TreeNode | null): MenuItem[] => {
    if (!node) {
      return [{ icon: '＋', label: 'New workspace', onClick: () => void addWorkspace() }]
    }
    const items: MenuItem[] = []

    if (node.kind === 'workspace') {
      items.push({ icon: '▣', label: 'New project', onClick: () => void addProject(node) })
    }
    if (node.kind === 'project' || node.kind === 'folder') {
      items.push({ icon: '▤', label: 'New folder', onClick: () => void addFolder(node) })
      const dir = resolveDir(nodes, node)
      items.push(
        {
          icon: '⚙',
          label: node.kind === 'project' ? 'Project settings…' : 'Configure folder…',
          onClick: () => openNodeSetup(node.id, node.name),
        },
        { icon: '❯', label: 'Open terminal here', disabled: !dir, onClick: () => void openTerminal(undefined, dir) },
        { icon: '⌘', label: 'New command', onClick: () => openEditor('command', 0, 'New command', node.id) },
        { icon: '⚡', label: 'New service', onClick: () => openEditor('service', 0, 'New service', node.id) },
        { icon: '↗', label: 'Reveal in File Explorer', disabled: !dir, onClick: () => void ipc.revealInExplorer(dir).catch((e) => alert(String(e))) },
      )
    }
    items.push(
      { separator: true, label: '' },
      { icon: '✎', label: 'Rename', onClick: () => beginRename(node) },
      { icon: '🗑', label: `Delete ${KIND_LABEL[node.kind].toLowerCase()}`, danger: true, onClick: () => void del(node) },
    )
    return items
  }

  const renderService = (svc: ServiceDef, depth: number) => {
    const st: SvcState | undefined = svcStates[svc.id]
    const running = st?.status === 'running'
    const crashed = st?.status === 'crashed'
    return (
      <div
        key={`svc-${svc.id}`}
        className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-slate-300 select-none hover:bg-slate-700/40"
        style={{ paddingLeft: `${depth * 14 + 22}px` }}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse bg-emerald-400' : crashed ? 'bg-red-400' : 'bg-slate-600'}`}
        />
        <span className="w-5 shrink-0 text-center text-[14px] leading-none text-amber-400/80">⚡</span>
        <button
          className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-slate-100"
          title="Click to edit service"
          onClick={() => openEditor('service', svc.id, svc.name || 'Service')}
        >
          {svc.name}
        </button>
        {svc.health_port != null && (
          <button
            className="hidden shrink-0 rounded px-1 text-[11px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
            title={running ? `Open http://localhost:${svc.health_port}` : `Opens http://localhost:${svc.health_port} (not running)`}
            onClick={() => void ipc.openUrl(`http://localhost:${svc.health_port}`).catch((e) => alert(String(e)))}
          >
            🌐
          </button>
        )}
        <button
          className="shrink-0 rounded px-1 text-[11px] hover:bg-slate-600 hover:text-white"
          disabled={busySvc === svc.id}
          title={running ? 'Stop' : 'Start'}
          onClick={() =>
            void actSvc(svc.id, () => (running ? ipc.svcStop(svc.id) : ipc.svcStart(svc.id)))
          }
        >
          {running ? '■' : '▶'}
        </button>
      </div>
    )
  }

  const renderNode = (node: TreeNode, depth: number) => {
    const children = nodes.filter((n) => n.parent_id === node.id)
    const nodeServices = services.filter((s) => s.project_id === node.id)
    const hasKids = children.length > 0 || nodeServices.length > 0
    const isOpen = expanded.has(node.id)
    const selected = selectedNodeId === node.id
    const renaming = renamingId === node.id
    const sub = node.kind === 'folder' ? node.path || node.rel_path : node.kind === 'project' ? node.path : ''

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1.5 rounded px-1.5 py-1 text-[13px] select-none ${
            selected ? 'bg-indigo-500/20 text-slate-100' : 'text-slate-300 hover:bg-slate-700/40'
          } ${renaming ? '' : 'cursor-pointer'}`}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => !renaming && setSelectedNode(node.id)}
          onDoubleClick={() => {
            if (renaming) return
            if (node.kind === 'project' || node.kind === 'folder') openNodeSetup(node.id, node.name)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSelectedNode(node.id)
            setMenu({ x: e.clientX, y: e.clientY, node })
          }}
          title={sub || undefined}
        >
          <span
            className={`w-3.5 text-[12px] text-slate-500 ${hasKids ? 'cursor-pointer' : 'opacity-0'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.id)
            }}
          >
            {isOpen ? '▾' : '▸'}
          </span>
          <span
            className={`w-5 shrink-0 text-center text-[17px] leading-none ${node.kind === 'project' ? '' : KIND_COLOR[node.kind]}`}
            style={node.kind === 'project' ? { color: nodeColor(node) } : undefined}
          >
            {KIND_ICON[node.kind]}
          </span>
          {renaming ? (
            <input
              autoFocus
              className="input flex-1 px-1 py-0 text-[12.5px]"
              value={draft}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => void commitRename(node)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(node)
                if (e.key === 'Escape') setRenamingId(null)
              }}
            />
          ) : (
            <span className="flex-1 truncate">{node.name}</span>
          )}
          <button
            className="hidden rounded px-1 text-[13px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
            title="Actions"
            onClick={(e) => {
              e.stopPropagation()
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setSelectedNode(node.id)
              setMenu({ x: rect.right, y: rect.bottom, node })
            }}
          >
            ⋯
          </button>
        </div>
        {isOpen && (
          <>
            {children.map((c) => renderNode(c, depth + 1))}
            {nodeServices.map((s) => renderService(s, depth + 1))}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#11141c]">
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Explorer
        </span>
        <button
          className="rounded bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-indigo-600"
          onClick={() => void addWorkspace()}
        >
          + Workspace
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
      >
        {roots.length === 0 && (
          <div className="p-3 text-[12px] leading-5 text-slate-500">
            No workspaces yet. Right-click here or use “+ Workspace”. Then add a Project (an app /
            repo root with a base path), and Folders inside it (each a subpath under that base
            path). Commands, services, and terminals run in the selected project or folder.
          </div>
        )}
        {roots.map((n) => renderNode(n, 0))}
      </div>
      {menu && (
        <PopMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
