// Workspace → Project → Folder. A Project is an app/repo root (base
// path); Folders are locations inside it (subpath under the base path,
// or an absolute override). Managed through a right-click context menu
// with inline renaming — no blocking modals.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import type { CommandDef, NodeKind, ProfileDef, ServiceDef, SvcState, TreeNode } from '../lib/types'
import { useApp } from '../store'
import { openEditor, openInMain, openNodeSetup } from '../lib/dock'
import { focusCommandSession, launchProfile, openTerminal, runCommandInNewTerminal } from '../lib/runner'
import { resolveDir } from '../lib/tree'
import { nodeColor } from '../lib/spaces'
import { loadExampleWorkspace } from '../lib/example'
import { PopMenu, type MenuItem } from './PopMenu'

// The expand/collapse state is remembered across restarts so the tree
// reopens where you left it — a folder isn't "gone" after a restart, its
// project was just collapsed.
const EXPANDED_KEY = 'devdeck.tree.expanded.v1'
const CATS_KEY = 'devdeck.tree.collapsedCats.v1'

function loadSet<T extends string | number>(key: string): Set<T> {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(arr) ? (arr as T[]) : [])
  } catch {
    return new Set<T>()
  }
}

function saveSet<T>(key: string, set: Set<T>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

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

// A right-click / ⋯ menu can target a tree node, a command, or a service.
type MenuTarget =
  | { type: 'node'; node: TreeNode | null }
  | { type: 'command'; cmd: CommandDef }
  | { type: 'service'; svc: ServiceDef }

interface Menu {
  x: number
  y: number
  target: MenuTarget
}

// Category groups shown under a project/folder node. Each is a virtual
// "folder" that holds the node's commands, services, or profiles.
type Cat = 'commands' | 'services' | 'profiles'
const CAT_META: Record<Cat, { label: string; icon: string; color: string }> = {
  commands: { label: 'Commands', icon: '⌘', color: 'text-sky-400/80' },
  services: { label: 'Services', icon: '⚡', color: 'text-amber-400/80' },
  profiles: { label: 'Profiles', icon: '⧉', color: 'text-violet-400/80' },
}

export function Explorer() {
  const {
    nodes, commands, services, profiles, svcStates,
    selectedNodeId, setSelectedNode,
    activeWorkspaceId, activeWorkspace, setActiveWorkspace,
    refreshTree, refreshCommands, refreshServices, refreshProfiles, focusServiceLogs, servicePort,
    requestStartService,
  } = useApp()
  // The tree shows the active workspace's projects/folders — workspaces
  // themselves are switched from the header, not browsed in the tree.
  const workspaces = useMemo(() => nodes.filter((n) => n.kind === 'workspace'), [nodes])
  const roots = useMemo(
    () => (activeWorkspaceId == null ? [] : nodes.filter((n) => n.parent_id === activeWorkspaceId)),
    [nodes, activeWorkspaceId],
  )
  const ws = activeWorkspace()
  const [expanded, setExpanded] = useState<Set<number>>(() => loadSet<number>(EXPANDED_KEY))
  // Category groups are open by default; this holds the ones the user collapsed.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => loadSet<string>(CATS_KEY))

  useEffect(() => saveSet(EXPANDED_KEY, expanded), [expanded])
  useEffect(() => saveSet(CATS_KEY, collapsedCats), [collapsedCats])
  const [menu, setMenu] = useState<Menu | null>(null)
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [busySvc, setBusySvc] = useState<number | null>(null)
  const [launching, setLaunching] = useState<number | null>(null)

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
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const expand = (id: number) => setExpanded((prev) => new Set(prev).add(id))

  const catKey = (nodeId: number, cat: Cat) => `${nodeId}:${cat}`
  const toggleCat = (nodeId: number, cat: Cat) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      const k = catKey(nodeId, cat)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

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

  const addProject = async () => {
    if (activeWorkspaceId == null) return
    // A project is an app root — pick its base directory.
    const dir = await openDialog({ directory: true, title: 'Select the project base folder (repo root)' })
    if (typeof dir !== 'string') return
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const created = await ipc.nodeCreate(activeWorkspaceId, 'project', name, dir)
    await refreshTree()
    setSelectedNode(created.id)
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
    const name = prompt('Name for the new workspace', 'New workspace')
    if (name === null) return
    const created = await ipc.nodeCreate(null, 'workspace', name.trim() || 'New workspace')
    await refreshTree()
    setActiveWorkspace(created.id)
  }

  const renameWorkspace = async (w: TreeNode) => {
    const name = prompt('Rename workspace', w.name)
    if (name === null) return
    const n = name.trim()
    if (n && n !== w.name) {
      await ipc.nodeRename(w.id, n)
      await refreshTree()
    }
  }

  // Refresh the tree AND the item lists — a cascade delete removes a node's
  // commands/services/profiles in the DB, so the panels must reload too or they
  // keep showing items from a workspace you just deleted.
  const del = async (node: TreeNode) => {
    const label = node.kind === 'workspace' ? 'workspace' : node.kind
    if (!confirm(`Delete ${label} “${node.name}” and everything inside it?`)) return
    await ipc.nodeDelete(node.id)
    if (selectedNodeId === node.id) setSelectedNode(null)
    await Promise.all([refreshTree(), refreshCommands(), refreshServices(), refreshProfiles()])
  }

  const delCommand = async (cmd: CommandDef) => {
    if (!confirm(`Delete command “${cmd.name}”?`)) return
    await ipc.commandDelete(cmd.id)
    await refreshCommands()
  }

  const delService = async (svc: ServiceDef) => {
    if (!confirm(`Delete service “${svc.name}”?`)) return
    await ipc.serviceDelete(svc.id)
    await refreshServices()
  }

  // "View session": jump to a command's live terminal, or a service's logs.
  const viewCommand = (cmd: CommandDef) => {
    if (!focusCommandSession(cmd.id)) void runCommandInNewTerminal(cmd)
  }
  const viewService = (svc: ServiceDef) => {
    openInMain('logs', 'logs', 'Logs')
    focusServiceLogs(svc.name)
  }

  // The workspace switcher menu: pick a workspace, or manage them.
  const workspaceMenuItems = (): MenuItem[] => [
    ...workspaces.map((w) => ({
      icon: w.id === activeWorkspaceId ? '✓' : '⬢',
      label: w.name,
      onClick: () => setActiveWorkspace(w.id),
    })),
    { separator: true, label: '' },
    { icon: '＋', label: 'New workspace…', onClick: () => void addWorkspace() },
    ...(ws
      ? [
          { icon: '✎', label: 'Rename workspace…', onClick: () => void renameWorkspace(ws) },
          { icon: '🗑', label: 'Delete workspace', danger: true, onClick: () => void del(ws) },
        ]
      : []),
  ]

  const nodeMenuItems = (node: TreeNode | null): MenuItem[] => {
    if (!node) {
      return [
        { icon: '▣', label: 'New project', disabled: activeWorkspaceId == null, onClick: () => void addProject() },
      ]
    }
    const items: MenuItem[] = []

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
        { icon: '⧉', label: 'New profile', onClick: () => openEditor('profile', 0, 'New profile', node.id) },
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

  const commandMenuItems = (cmd: CommandDef): MenuItem[] => [
    { icon: '▶', label: 'Run in new terminal', onClick: () => void runCommandInNewTerminal(cmd) },
    { icon: '❯', label: 'View session', onClick: () => viewCommand(cmd) },
    { icon: '✎', label: 'Edit command…', onClick: () => openEditor('command', cmd.id, cmd.name || 'Command') },
    { separator: true, label: '' },
    { icon: '🗑', label: 'Delete command', danger: true, onClick: () => void delCommand(cmd) },
  ]

  const serviceMenuItems = (svc: ServiceDef): MenuItem[] => {
    const running = svcStates[svc.id]?.status === 'running'
    return [
      running
        ? { icon: '■', label: 'Stop', onClick: () => void actSvc(svc.id, () => ipc.svcStop(svc.id)) }
        : { icon: '▶', label: 'Start', onClick: () => void actSvc(svc.id, () => requestStartService(svc)) },
      { icon: '↻', label: 'Restart', disabled: !running, onClick: () => void actSvc(svc.id, () => ipc.svcRestart(svc.id)) },
      { icon: '☰', label: 'View logs', onClick: () => viewService(svc) },
      { icon: '✎', label: 'Edit service…', onClick: () => openEditor('service', svc.id, svc.name || 'Service') },
      { separator: true, label: '' },
      { icon: '🗑', label: 'Delete service', danger: true, onClick: () => void delService(svc) },
    ]
  }

  const menuItems = (target: MenuTarget): MenuItem[] => {
    if (target.type === 'command') return commandMenuItems(target.cmd)
    if (target.type === 'service') return serviceMenuItems(target.svc)
    return nodeMenuItems(target.node)
  }

  const renderService = (svc: ServiceDef, depth: number) => {
    const st: SvcState | undefined = svcStates[svc.id]
    const running = st?.status === 'running'
    const crashed = st?.status === 'crashed'
    const port = servicePort(svc.id) // saved, else the live detected port
    return (
      <div
        key={`svc-${svc.id}`}
        className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-slate-300 select-none hover:bg-slate-700/40"
        style={{ paddingLeft: `${depth * 14 + 22}px` }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, target: { type: 'service', svc } })
        }}
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
        {port != null && (
          <button
            className="hidden shrink-0 rounded px-1 text-[11px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
            title={running ? `Open http://localhost:${port}` : `Opens http://localhost:${port} (not running)`}
            onClick={() => void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))}
          >
            🌐
          </button>
        )}
        <button
          className="shrink-0 rounded px-1 text-[11px] hover:bg-slate-600 hover:text-white"
          disabled={busySvc === svc.id}
          title={running ? 'Stop' : 'Start'}
          onClick={() =>
            void actSvc(svc.id, () => (running ? ipc.svcStop(svc.id) : requestStartService(svc)))
          }
        >
          {running ? '■' : '▶'}
        </button>
        <button
          className="hidden shrink-0 rounded px-1 text-[12px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
          title="Actions"
          onClick={(e) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: rect.right, y: rect.bottom, target: { type: 'service', svc } })
          }}
        >
          ⋯
        </button>
      </div>
    )
  }

  const renderCommand = (cmd: CommandDef, depth: number) => (
    <div
      key={`cmd-${cmd.id}`}
      className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-slate-300 select-none hover:bg-slate-700/40"
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY, target: { type: 'command', cmd } })
      }}
    >
      <span className="w-5 shrink-0 text-center text-[13px] leading-none text-sky-400/80">⌘</span>
      <button
        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-slate-100"
        title="Click to edit command"
        onClick={() => openEditor('command', cmd.id, cmd.name || 'Command')}
      >
        {cmd.name}
      </button>
      <button
        className="hidden shrink-0 rounded px-1 text-[11px] hover:bg-slate-600 hover:text-white group-hover:block"
        title="Run in a new terminal"
        onClick={() => void runCommandInNewTerminal(cmd)}
      >
        ▶
      </button>
      <button
        className="hidden shrink-0 rounded px-1 text-[12px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setMenu({ x: rect.right, y: rect.bottom, target: { type: 'command', cmd } })
        }}
      >
        ⋯
      </button>
    </div>
  )

  const renderProfile = (profile: ProfileDef, depth: number) => (
    <div
      key={`prof-${profile.id}`}
      className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-slate-300 select-none hover:bg-slate-700/40"
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
    >
      <span className="w-5 shrink-0 text-center text-[13px] leading-none text-violet-400/80">⧉</span>
      <button
        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-slate-100"
        title="Click to edit profile"
        onClick={() => openEditor('profile', profile.id, profile.name || 'Profile')}
      >
        {profile.name}
      </button>
      <button
        className="shrink-0 rounded px-1 text-[11px] hover:bg-slate-600 hover:text-white"
        disabled={launching === profile.id}
        title="Launch profile"
        onClick={async () => {
          setLaunching(profile.id)
          try {
            await launchProfile(profile)
          } finally {
            setLaunching(null)
          }
        }}
      >
        {launching === profile.id ? '…' : '⚡'}
      </button>
    </div>
  )

  // One category group ("Commands"/"Services"/"Profiles") under a node.
  const renderCategory = (node: TreeNode, cat: Cat, count: number, depth: number, rows: ReactNode) => {
    const meta = CAT_META[cat]
    const open = !collapsedCats.has(catKey(node.id, cat))
    const addKind = cat === 'commands' ? 'command' : cat === 'services' ? 'service' : 'profile'
    return (
      <div key={`${node.id}-${cat}`}>
        <div
          className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-slate-400 select-none hover:bg-slate-700/40"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => count > 0 && toggleCat(node.id, cat)}
        >
          <span className={`w-5 shrink-0 text-center text-[14px] leading-none ${count > 0 ? 'cursor-pointer text-slate-400 hover:text-slate-200' : 'opacity-0'}`}>
            {open ? '▾' : '▸'}
          </span>
          <span className={`w-5 shrink-0 text-center text-[13px] leading-none ${meta.color}`}>{meta.icon}</span>
          <span className="flex-1 truncate uppercase tracking-wide">{meta.label}</span>
          <span className="shrink-0 pr-1 text-[10.5px] tabular-nums text-slate-600">{count || ''}</span>
          <button
            className="hidden shrink-0 rounded px-1 text-[12px] text-slate-400 hover:bg-slate-600 hover:text-white group-hover:block"
            title={`New ${addKind}`}
            onClick={(e) => {
              e.stopPropagation()
              openEditor(addKind, 0, `New ${addKind}`, node.id)
            }}
          >
            ＋
          </button>
        </div>
        {open && rows}
      </div>
    )
  }

  const renderNode = (node: TreeNode, depth: number) => {
    const children = nodes.filter((n) => n.parent_id === node.id)
    const nodeCommands = commands.filter((c) => c.project_id === node.id)
    const nodeServices = services.filter((s) => s.project_id === node.id)
    const nodeProfiles = profiles.filter((p) => p.project_id === node.id)
    // Category folders appear only when they actually hold something — a fresh
    // project/folder stays clean until you add commands/services/profiles.
    const showCommands = nodeCommands.length > 0
    const showServices = nodeServices.length > 0
    const showProfiles = nodeProfiles.length > 0
    const hasKids =
      children.length > 0 || showCommands || showServices || showProfiles
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
            setMenu({ x: e.clientX, y: e.clientY, target: { type: 'node', node } })
          }}
          title={sub || undefined}
        >
          <span
            className={`w-5 shrink-0 text-center text-[16px] leading-none text-slate-400 hover:text-slate-200 ${hasKids ? 'cursor-pointer' : 'opacity-0'}`}
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
              setMenu({ x: rect.right, y: rect.bottom, target: { type: 'node', node } })
            }}
          >
            ⋯
          </button>
        </div>
        {isOpen && (
          <>
            {children.map((c) => renderNode(c, depth + 1))}
            {showCommands &&
              renderCategory(
                node,
                'commands',
                nodeCommands.length,
                depth + 1,
                nodeCommands.map((c) => renderCommand(c, depth + 2)),
              )}
            {showServices &&
              renderCategory(
                node,
                'services',
                nodeServices.length,
                depth + 1,
                nodeServices.map((s) => renderService(s, depth + 2)),
              )}
            {showProfiles &&
              renderCategory(
                node,
                'profiles',
                nodeProfiles.length,
                depth + 1,
                nodeProfiles.map((p) => renderProfile(p, depth + 2)),
              )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#11141c]">
      {/* Workspace switcher + add project */}
      <div className="flex items-center justify-between gap-1 border-b border-slate-800 px-2 py-1.5">
        <button
          className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-[12.5px] font-medium text-slate-100 hover:bg-slate-700/50"
          title="Switch workspace"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setWsMenu({ x: r.left, y: r.bottom })
          }}
        >
          <span className="text-indigo-400">⬢</span>
          <span className="truncate">{ws?.name ?? 'No workspace'}</span>
          <span className="text-[10px] text-slate-500">▾</span>
        </button>
        <button
          className="shrink-0 rounded bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-indigo-600 disabled:opacity-40"
          title={activeWorkspaceId == null ? 'Create a workspace first' : 'Add a project to this workspace'}
          disabled={activeWorkspaceId == null}
          onClick={() => void addProject()}
        >
          + Project
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, target: { type: 'node', node: null } })
        }}
      >
        {workspaces.length === 0 ? (
          <div className="p-3 text-[12px] leading-5 text-slate-500">
            <p>
              No workspaces yet. A workspace groups related projects. Create one, then add projects
              (each an app / repo root) and folders inside them.
            </p>
            <button className="btn-primary mt-3 w-full text-[12px]" onClick={() => void addWorkspace()}>
              ＋ New workspace
            </button>
            <button
              className="btn-ghost mt-2 w-full text-[12px]"
              title="Create a small demo project you can actually run"
              onClick={() => void loadExampleWorkspace().catch((e) => alert(String(e)))}
            >
              ✨ Load example workspace
            </button>
          </div>
        ) : roots.length === 0 ? (
          <div className="p-3 text-[12px] leading-5 text-slate-500">
            <p>
              “{ws?.name}” has no projects yet. A project is an app / repo root with a base path;
              folders inside it are subpaths.
            </p>
            <button
              className="btn-primary mt-3 w-full text-[12px]"
              onClick={() => void addProject()}
            >
              ＋ Add a project
            </button>
          </div>
        ) : (
          roots.map((n) => renderNode(n, 0))
        )}
      </div>
      {menu && (
        <PopMenu x={menu.x} y={menu.y} items={menuItems(menu.target)} onClose={() => setMenu(null)} />
      )}
      {wsMenu && (
        <PopMenu x={wsMenu.x} y={wsMenu.y} items={workspaceMenuItems()} onClose={() => setWsMenu(null)} />
      )}
    </div>
  )
}
