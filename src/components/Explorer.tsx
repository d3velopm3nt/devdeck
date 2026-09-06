// Workspace → Project → Folder. A Project is an app/repo root (base
// path); Folders are locations inside it (subpath under the base path,
// or an absolute override). Managed through a right-click context menu
// with inline renaming — no blocking modals.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import type { CommandDef, NodeKind, ProfileDef, ServiceDef, SvcState, TreeNode } from '../lib/types'
import { useApp } from '../store'
import { useAiw } from '../lib/aiwStore'
import {
  openAiwDoc,
  openBot,
  openEditor,
  openFile,
  openNodeConfig,
  openNodeSetup,
  openNodeThread,
  openService,
  openSpace,
} from '../lib/dock'
import { focusCommandSession, launchProfile, openTerminal, runCommandInNewTerminal } from '../lib/runner'
import { findNode, resolveDir } from '../lib/tree'
import { SPACE_TAGS, labelColor, nodeColor } from '../lib/spaces'
import { loadExampleWorkspace } from '../lib/example'
import { PopMenu, type MenuItem } from './PopMenu'
import { CAPTURE_ADD, CAPTURE_EXPAND, CAPTURE_FILE_ROOT, CAPTURE_GIT, CAPTURE_VAULT } from '../lib/devCapture'
import { BotCreate } from './bot/BotCreate'
import { AddToWorkspace } from './AddToWorkspace'
import { GitHubImportModal } from './GitHubImportModal'
import { Icon } from '../lib/icons'

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
  workspace: 'workspace',
  solution: 'solution',
  project: 'project',
  folder: 'folder',
}

const KIND_COLOR: Record<NodeKind, string> = {
  workspace: 'text-indigo-400',
  solution: 'text-viol',
  project: 'text-ok',
  folder: 'text-dim',
}

const KIND_LABEL: Record<NodeKind, string> = {
  workspace: 'Workspace',
  solution: 'Solution',
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
  commands: { label: 'Commands', icon: 'command', color: 'text-info/80' },
  services: { label: 'Services', icon: 'service', color: 'text-warn/80' },
  profiles: { label: 'Profiles', icon: 'profile', color: 'text-viol/80' },
}

/// Ask for something the first time it is rendered.
///
/// The tree loads a folder when you expand it, which is the right rule and
/// leaves one gap: a branch that was already open when the app started — from
/// last time, or from the screenshot harness — was never expanded by anyone.
function FetchOnce({ load }: { load: () => void }) {
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export function Explorer() {
  const {
    nodes, commands, services, profiles, svcStates, gitByNode, changesByNode,
    selectedNodeId, setSelectedNode, setRailView,
    activeWorkspaceId, activeWorkspace, setActiveWorkspace,
    activeSolutionId, setActiveSolution, createSolution, labels, touchRecent,
    bots, refreshBots,
    refreshTree, refreshCommands, refreshServices, refreshProfiles, focusServiceLogs, servicePort,
    requestStartService, treeError, treeLoading, retryBootstrap,
  } = useApp()
  // The tree shows the active workspace's projects/folders — workspaces
  // themselves are switched from the header, not browsed in the tree.
  const workspaces = useMemo(() => nodes.filter((n) => n.kind === 'workspace'), [nodes])

  // Solutions of the active workspace. The switcher only appears when there is
  // at least one — a tree with none looks exactly as it always has.
  const solutions = useMemo(
    () =>
      activeWorkspaceId == null
        ? []
        : nodes.filter((n) => n.kind === 'solution' && n.parent_id === activeWorkspaceId),
    [nodes, activeWorkspaceId],
  )
  const activeSolution = useMemo(
    () => solutions.find((s) => s.id === activeSolutionId) ?? null,
    [solutions, activeSolutionId],
  )

  // Scoped to a solution when one is picked, otherwise the whole workspace —
  // which still shows solutions as branches, so nothing is hidden by default.
  // The tree starts at the workspace itself, not at its children.
  //
  // It used to start one level down, so there was no way to land on Innotrack —
  // only on something inside it. That made the workspace a frame rather than a
  // place: you could not tag it, configure it, or give it a bot, even though it
  // is a real folder in the vault with its own `_devdeck.md`. Scoping to a
  // solution still starts at that solution, because then the solution is what
  // you picked.
  const roots = useMemo(() => {
    if (activeWorkspaceId == null) return []
    if (activeSolution) return nodes.filter((n) => n.parent_id === activeSolution.id)
    const ws = nodes.find((n) => n.id === activeWorkspaceId)
    return ws ? [ws] : []
  }, [nodes, activeWorkspaceId, activeSolution])
  const ws = activeWorkspace()
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const saved = loadSet<number>(EXPANDED_KEY)
    // Screenshot harness: open these branches on load, because this session
    // cannot click one open. Empty in every shipped build.
    for (const id of CAPTURE_EXPAND.split(',').map(Number).filter(Boolean)) saved.add(id)
    return saved
  })

  // The workspace row is open when you arrive, or the tree would look empty
  // until you clicked it. You can still collapse it; this only seeds it.
  useEffect(() => {
    if (activeWorkspaceId == null) return
    setExpanded((prev) => (prev.has(activeWorkspaceId) ? prev : new Set(prev).add(activeWorkspaceId)))
  }, [activeWorkspaceId])
  // Category groups are open by default; this holds the ones the user collapsed.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => loadSet<string>(CATS_KEY))

  useEffect(() => saveSet(EXPANDED_KEY, expanded), [expanded])
  useEffect(() => saveSet(CATS_KEY, collapsedCats), [collapsedCats])
  const [menu, setMenu] = useState<Menu | null>(null)
  // What is on disk under a node, and which folders are open. Keyed
  // `<nodeId>:<rel>`, so two nodes can each have a `src` open at once.
  const [files, setFiles] = useState<Record<string, ipc.FileRow[]>>({})
  const [fileErr, setFileErr] = useState<Record<string, string>>({})
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  /// Which of a node's two directories the tree is showing, per node.
  ///
  /// `work` is where things run — the repository, when the node names one.
  /// `vault` is where what we know lives: the folder under the vault root
  /// holding `.devdeck`, `_bot.md` and the features. They are different
  /// questions and the tree used to answer only the first, which made the
  /// vault invisible in an app built around keeping one.
  const [fileRoot, setFileRoot] = useState<Record<number, 'work' | 'vault'>>({})
  /// The vault read from its own root, rather than through a node.
  ///
  /// The tree above is the *registered* vault: workspaces, projects, folders
  /// that have a row. That is the right default and it hides two things —
  /// anything in the vault nobody has registered, and `.devdeck/team`, which
  /// belongs to no node by design now that a manager is not a folder. This is
  /// the view for looking at what the app has actually written down.
  const [wholeOpen, setWholeOpen] = useState(CAPTURE_VAULT !== '')
  const [whole, setWhole] = useState<Record<string, ipc.FileRow[]>>({})
  const [wholeErr, setWholeErr] = useState<Record<string, string>>({})
  const [wholeDirs, setWholeDirs] = useState<Set<string>>(
    new Set(CAPTURE_VAULT ? CAPTURE_VAULT.split(',') : []),
  )
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null)
  const [ghOpen, setGhOpen] = useState(false)
  /// Which workspace the Add sheet is pointed at, or null when it is shut.
  const [addTo, setAddTo] = useState<number | null>(null)
  /// A git refusal that arrives synchronously, per node — "no remote to push
  /// to" and its kin. Everything a running git command says goes to Logs.
  const [gitErr, setGitErr] = useState<Record<number, string>>({})
  // Screenshot harness: a sheet nobody can click is a sheet nobody can check.
  useEffect(() => {
    if (CAPTURE_ADD && activeWorkspaceId != null) setAddTo(activeWorkspaceId)
    if (CAPTURE_GIT) {
      // Deferred: the dock has no api until it has mounted, and openAiwDoc
      // silently does nothing before then.
      const n = findNode(nodes, Number(CAPTURE_GIT))
      if (n) window.setTimeout(() => openAiwDoc('git', String(n.id), n.name), 1500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])
  const [newBotFor, setNewBotFor] = useState<number | null>(null)
  const [filtering, setFiltering] = useState(false)
  const [filter, setFilter] = useState('')
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
      await ipc.vaultRename(node.id, name)
      await refreshTree()
    }
  }

  // Add creates a container and opens its config page. The folder picker used
  // to be the first question, which quietly asserted that everything is a
  // repo — and a Topic has no folder at all. Choosing a folder on that page is
  // what promotes it to a project.
  // `addNode` used to live here: a `prompt()` for a name, and always a
  // folder. Every caller now opens the Add sheet instead, which asks what
  // you meant first — so the one function that could only ever make one of
  // the four things is gone rather than left as a fifth way in.

  const addProjectTo = async (parentId: number) => {
    const dir = await openDialog({ directory: true, title: 'Select the project base folder (repo root)' })
    if (typeof dir !== 'string') return
    // Windows hands back `F:\Work\thing`, so a `/`-only split named the
    // project after the whole path.
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const created = await ipc.vaultCreate(parentId, name)
    await ipc.vaultSetMeta(created.id, { repo: dir })
    expand(parentId)
    await refreshTree()
    setSelectedNode(created.id)
    openNodeSetup(created.id, name)
  }

  const addSolution = async () => {
    if (activeWorkspaceId == null) return
    const name = prompt('Name for the new solution', 'New solution')
    if (name === null) return
    const created = await createSolution(name.trim() || 'New solution')
    if (created) {
      setSelectedNode(created.id)
      expand(created.id)
    }
  }

  const addFolder = async (parent: TreeNode) => {
    // Default the subpath to the folder name; user tunes it in setup.
    const created = await ipc.vaultCreate(parent.id, 'new-folder')
    expand(parent.id)
    await refreshTree()
    beginRename(created)
  }

  const addWorkspace = async () => {
    const name = prompt('Name for the new workspace', 'New workspace')
    if (name === null) return
    const created = await ipc.vaultCreate(null, name.trim() || 'New workspace')
    await refreshTree()
    setActiveWorkspace(created.id)
  }

  const renameWorkspace = async (w: TreeNode) => {
    const name = prompt('Rename workspace', w.name)
    if (name === null) return
    const n = name.trim()
    if (n && n !== w.name) {
      await ipc.vaultRename(w.id, n)
      await refreshTree()
    }
  }

  // Refresh the tree AND the item lists — a cascade delete removes a node's
  // commands/services/profiles in the DB, so the panels must reload too or they
  // keep showing items from a workspace you just deleted.
  const del = async (node: TreeNode) => {
    const label = node.kind === 'workspace' ? 'workspace' : node.kind
    // This removes the folder from disk, not just a row — say so.
    if (!confirm(`Delete the ${label} folder “${node.name}” and everything inside it?`)) return
    await ipc.vaultDelete(node.id)
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
    useApp.getState().showBottom('logs')
    focusServiceLogs(svc.name)
  }

  // Push a project's branch. Same shape as the pull below: fire and let the
  // Logs bus and `git:done` tell the story, because a push can take a while
  // and a button that waits for it looks broken.
  const pushProject = async (node: TreeNode) => {
    const dir = resolveDir(nodes, node)
    if (!dir) return
    try {
      await ipc.gitPush(dir)
      setGitErr((prev) => ({ ...prev, [node.id]: '' }))
    } catch (e) {
      // A refusal here is synchronous and specific ("no remote to push to"),
      // so it belongs on screen. Everything the push itself has to say goes
      // to the Logs bus, which is where a long-running command belongs.
      setGitErr((prev) => ({ ...prev, [node.id]: String(e) }))
    }
  }

  // Fast-forward pull for a project. Streams to Logs; git:done refreshes counts.
  const pullProject = async (node: TreeNode) => {
    const dir = resolveDir(nodes, node)
    if (!dir) return
    useApp.getState().showBottom('logs')
    try {
      await ipc.gitPull(dir)
    } catch (e) {
      alert(String(e))
    }
  }

  // The workspace switcher menu: pick a workspace, or manage them.
  const workspaceMenuItems = (): MenuItem[] => [
    ...workspaces.map((w) => ({
      icon: w.id === activeWorkspaceId ? 'check' : 'workspace',
      label: w.name,
      onClick: () => setActiveWorkspace(w.id),
    })),
    { separator: true, label: '' },
    { icon: 'add', label: 'New workspace…', onClick: () => void addWorkspace() },
    ...(ws
      ? [
          { icon: 'edit', label: 'Rename workspace…', onClick: () => void renameWorkspace(ws) },
          { icon: 'delete', label: 'Delete workspace', danger: true, onClick: () => void del(ws) },
        ]
      : []),
  ]

  const nodeMenuItems = (node: TreeNode | null): MenuItem[] => {
    if (!node) {
      return [
        // The same sheet as everywhere else. Two menu items called "Add…"
        // that did different things is how the folder-every-time surprise
        // stayed hidden for so long.
        {
          icon: 'add',
          label: 'Add…',
          disabled: activeWorkspaceId == null,
          onClick: () => activeWorkspaceId != null && setAddTo(activeWorkspaceId),
        },
        { icon: 'solution', label: 'New solution…', disabled: activeWorkspaceId == null, onClick: () => void addSolution() },
      ]
    }
    const items: MenuItem[] = []

    // The label registry, offered rather than typed. Free text still works —
    // the config page has a field for it — but the common case is one of these.
    //
    // A workspace is the exception: it carries Business or Personal, which is
    // a different question with different consequences, so it is offered those
    // and only those.
    for (const l of node.kind === 'workspace' ? SPACE_TAGS : labels) {
      if (l === node.label) continue
      items.push({
        icon: 'tag',
        label: l,
        onClick: () => void ipc.vaultSetMeta(node.id, { label: l }).then(() => refreshTree()),
      })
    }
    if (node.label) {
      items.push({
        icon: 'close',
        label: `Clear “${node.label}”`,
        onClick: () => void ipc.vaultSetMeta(node.id, { label: '' }).then(() => refreshTree()),
      })
    }
    items.push({ separator: true, label: '' })

    if (node.kind === 'solution') {
      items.push({
        icon: 'view',
        label: 'Show only this solution',
        onClick: () => setActiveSolution(node.id),
      })
      items.push({ icon: 'project', label: 'Add project…', onClick: () => void addProjectTo(node.id) })
    }

    // A workspace is the thing people actually right-click when they want to
    // put something in it, and it was the one place with no way to.
    if (node.kind === 'workspace') {
      items.push({ icon: 'add', label: 'Add…', onClick: () => setAddTo(node.id) })
      items.push({
        icon: 'project',
        label: 'Add project…',
        onClick: () => void addProjectTo(node.id),
      })
    }

    if (node.kind === 'project') {
      items.push({ icon: 'view', label: 'Open dashboard', onClick: () => openSpace(node.id, node.name) })
    }
    if (node.kind === 'workspace' || node.kind === 'project' || node.kind === 'folder') {
      // A bot is a file in this folder, so it belongs on this menu rather than
      // behind a rail view — the same rule that put every other document here.
      const bot = bots.find((b) => b.node_id === node.id)
      items.push(
        bot
          ? { icon: 'bot', label: `Open ${bot.name}`, onClick: () => openBot(node.id, bot.name) }
          : { icon: 'bot', label: 'Give it a bot…', onClick: () => setNewBotFor(node.id) },
      )
      items.push({ icon: 'folder', label: 'New folder', onClick: () => void addFolder(node) })
      const dir = resolveDir(nodes, node)
      items.push(
        {
          icon: 'settings',
          label:
            node.kind === 'project'
              ? 'Project settings…'
              : node.kind === 'workspace'
                ? 'Workspace settings…'
                : 'Configure folder…',
          onClick: () => openNodeSetup(node.id, node.name),
        },
        { icon: 'terminal', label: 'Open terminal here', disabled: !dir, onClick: () => void openTerminal(undefined, dir) },
        { icon: 'command', label: 'New command', onClick: () => openEditor('command', 0, 'New command', node.id) },
        { icon: 'service', label: 'New service', onClick: () => openEditor('service', 0, 'New service', node.id) },
        { icon: 'profile', label: 'New profile', onClick: () => openEditor('profile', 0, 'New profile', node.id) },
        {
        icon: 'reveal',
        label: 'Reveal in File Explorer',
        onClick: () =>
          void ipc
            .vaultDir(node.id)
            .then((d) => ipc.revealInExplorer(d))
            .catch((e) => alert(String(e))),
      },
      )
    }
    items.push(
      { separator: true, label: '' },
      { icon: 'edit', label: 'Rename', onClick: () => beginRename(node) },
      { icon: 'delete', label: `Delete ${KIND_LABEL[node.kind].toLowerCase()}`, danger: true, onClick: () => void del(node) },
    )
    return items
  }

  const commandMenuItems = (cmd: CommandDef): MenuItem[] => [
    { icon: 'run', label: 'Run in new terminal', onClick: () => void runCommandInNewTerminal(cmd) },
    { icon: 'view', label: 'View session', onClick: () => viewCommand(cmd) },
    { icon: 'edit', label: 'Edit command…', onClick: () => openEditor('command', cmd.id, cmd.name || 'Command') },
    { separator: true, label: '' },
    { icon: 'delete', label: 'Delete command', danger: true, onClick: () => void delCommand(cmd) },
  ]

  const serviceMenuItems = (svc: ServiceDef): MenuItem[] => {
    const running = svcStates[svc.id]?.status === 'running'
    return [
      { icon: 'view', label: 'Open page', onClick: () => openService(svc.id, svc.name || 'Service') },
      running
        ? { icon: 'stop', label: 'Stop', onClick: () => void actSvc(svc.id, () => ipc.svcStop(svc.id)) }
        : { icon: 'run', label: 'Start', onClick: () => void actSvc(svc.id, () => requestStartService(svc)) },
      { icon: 'restart', label: 'Restart', disabled: !running, onClick: () => void actSvc(svc.id, () => ipc.svcRestart(svc.id)) },
      { icon: 'logs', label: 'View logs', onClick: () => viewService(svc) },
      { icon: 'edit', label: 'Edit service…', onClick: () => openEditor('service', svc.id, svc.name || 'Service') },
      { separator: true, label: '' },
      { icon: 'delete', label: 'Delete service', danger: true, onClick: () => void delService(svc) },
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
        className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-body select-none hover:bg-hover"
        style={{ paddingLeft: `${depth * 14 + 22}px` }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY, target: { type: 'service', svc } })
        }}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse bg-emerald-400' : crashed ? 'bg-red-400' : 'bg-faint'}`}
        />
        <span className="flex w-5 shrink-0 items-center justify-center text-warn/80">
          <Icon name="service" size={14} />
        </span>
        <button
          className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-ink"
          title="Open the service page"
          onClick={() => openService(svc.id, svc.name || 'Service')}
        >
          {svc.name}
        </button>
        {port != null && (
          <button
            className="hidden shrink-0 items-center rounded px-1 text-dim hover:bg-hover hover:text-ink group-hover:flex"
            title={running ? `Open http://localhost:${port}` : `Opens http://localhost:${port} (not running)`}
            onClick={() => void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))}
          >
            <Icon name="globe" size={13} />
          </button>
        )}
        <button
          className="flex shrink-0 items-center rounded px-1 hover:bg-hover hover:text-ink"
          disabled={busySvc === svc.id}
          title={running ? 'Stop' : 'Start'}
          onClick={() =>
            void actSvc(svc.id, () => (running ? ipc.svcStop(svc.id) : requestStartService(svc)))
          }
        >
          <Icon name={running ? 'stop' : 'run'} size={13} />
        </button>
        <button
          className="hidden shrink-0 items-center rounded px-1 text-dim hover:bg-hover hover:text-ink group-hover:flex"
          title="Actions"
          onClick={(e) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: rect.right, y: rect.bottom, target: { type: 'service', svc } })
          }}
        >
          <Icon name="more" size={14} />
        </button>
      </div>
    )
  }

  const renderCommand = (cmd: CommandDef, depth: number) => (
    <div
      key={`cmd-${cmd.id}`}
      className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-body select-none hover:bg-hover"
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY, target: { type: 'command', cmd } })
      }}
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-info/80">
        <Icon name="command" size={13} />
      </span>
      <button
        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-ink"
        title="Click to edit command"
        onClick={() => openEditor('command', cmd.id, cmd.name || 'Command')}
      >
        {cmd.name}
      </button>
      <button
        className="hidden shrink-0 items-center rounded px-1 hover:bg-hover hover:text-ink group-hover:flex"
        title="Run in a new terminal"
        onClick={() => void runCommandInNewTerminal(cmd)}
      >
        <Icon name="run" size={13} />
      </button>
      <button
        className="hidden shrink-0 items-center rounded px-1 text-dim hover:bg-hover hover:text-ink group-hover:flex"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setMenu({ x: rect.right, y: rect.bottom, target: { type: 'command', cmd } })
        }}
      >
        <Icon name="more" size={14} />
      </button>
    </div>
  )

  const renderProfile = (profile: ProfileDef, depth: number) => (
    <div
      key={`prof-${profile.id}`}
      className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-body select-none hover:bg-hover"
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-viol/80">
        <Icon name="profile" size={13} />
      </span>
      <button
        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-ink"
        title="Click to edit profile"
        onClick={() => openEditor('profile', profile.id, profile.name || 'Profile')}
      >
        {profile.name}
      </button>
      <button
        className="flex shrink-0 items-center rounded px-1 hover:bg-hover hover:text-ink"
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
        <Icon name={launching === profile.id ? 'spinner' : 'run'} size={13} spin={launching === profile.id} />
      </button>
    </div>
  )

  // One category group ("Commands"/"Services"/"Profiles") under a node.
  // The Assistant, read (never written) from here. Projects are the same
  // records on both sides now, so this is a lookup rather than a second list.
  const {
    sessions: aiwSessions,
    approvals: aiwApprovals,
    features: aiwFeatures,
    projectId: aiwProjectId,
    selectFeature,
  } = useAiw()

  const renderCategory = (node: TreeNode, cat: Cat, count: number, depth: number, rows: ReactNode) => {
    const meta = CAT_META[cat]
    const open = !collapsedCats.has(catKey(node.id, cat))
    const addKind = cat === 'commands' ? 'command' : cat === 'services' ? 'service' : 'profile'
    return (
      <div key={`${node.id}-${cat}`}>
        <div
          className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-dim select-none hover:bg-hover"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => count > 0 && toggleCat(node.id, cat)}
        >
          <span className={`flex w-5 shrink-0 items-center justify-center ${count > 0 ? 'cursor-pointer text-dim hover:text-ink' : 'opacity-0'}`}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          </span>
          <span className={`flex w-5 shrink-0 items-center justify-center ${meta.color}`}>
            <Icon name={meta.icon} size={13} />
          </span>
          <span className="flex-1 truncate">{meta.label}</span>
          {count > 0 && (
            <span className="mr-1 shrink-0 rounded-full bg-soft px-1.5 text-[10px] tabular-nums text-muted">
              {count}
            </span>
          )}
          <button
            className="hidden shrink-0 items-center rounded px-1 text-dim hover:bg-hover hover:text-ink group-hover:flex"
            title={`New ${addKind}`}
            onClick={(e) => {
              e.stopPropagation()
              openEditor(addKind, 0, `New ${addKind}`, node.id)
            }}
          >
            <Icon name="add" size={14} />
          </button>
        </div>
        {open && rows}
      </div>
    )
  }

  /// The files under a node, on disk.
  ///
  /// The tree used to stop at the vault, and under each project it carried
  /// five rows that were not folders at all — Assistant, Context, Git,
  /// Commands, Services wearing folder costumes. Those are things a node
  /// *has*, and they are on its page now. This is what a tree is actually
  /// for: where things are.
  ///
  /// Loaded when you expand and never before: a vault of thirty repositories
  /// would otherwise read every one of them to draw a sidebar.
  const rootOf = (nodeId: number): 'work' | 'vault' =>
    fileRoot[nodeId] ?? ((CAPTURE_FILE_ROOT as 'work' | 'vault') || 'work')
  /// Keyed by root as well as path: the two sides have different trees, and a
  /// cache that forgot which one it read would show the repository's folders
  /// under the vault's name.
  const dirKey = (nodeId: number, rel: string) => `${nodeId}:${rootOf(nodeId)}:${rel}`

  const loadDir = (nodeId: number, rel: string) => {
    const k = dirKey(nodeId, rel)
    if (files[k] || fileErr[k]) return
    void ipc
      .nodeFiles(nodeId, rel, rootOf(nodeId))
      .then((rows) => setFiles((f) => ({ ...f, [k]: rows })))
      // "I could not read this folder" and "this folder is empty" must never
      // render the same, so the failure is kept and shown.
      .catch((e) => setFileErr((x) => ({ ...x, [k]: String(e) })))
  }

  const toggleDir = (nodeId: number, rel: string) => {
    const k = dirKey(nodeId, rel)
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else {
        next.add(k)
        loadDir(nodeId, rel)
      }
      return next
    })
  }

  const loadWhole = (rel: string) => {
    if (whole[rel] || wholeErr[rel]) return
    void ipc
      .vaultFiles(rel)
      // Same rule as the node tree: "I could not read this" and "this is
      // empty" must never render the same.
      .then((rows) => setWhole((f) => ({ ...f, [rel]: rows })))
      .catch((e) => setWholeErr((x) => ({ ...x, [rel]: String(e) })))
  }

  // Screenshot harness: open the section and the folders it names, since a
  // collapsed tree photographs as a single grey line.
  useEffect(() => {
    if (!CAPTURE_VAULT) return
    loadWhole('')
    for (const rel of CAPTURE_VAULT.split(',')) loadWhole(rel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleWhole = (rel: string) => {
    setWholeDirs((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else {
        next.add(rel)
        loadWhole(rel)
      }
      return next
    })
  }

  const renderWhole = (rel: string, depth: number): ReactNode => {
    const rows = whole[rel]
    const err = wholeErr[rel]
    const pad = { paddingLeft: `${depth * 14 + 6}px` }
    if (err) {
      return (
        <div key={`w-${rel}-err`} className="px-1.5 py-0.5 text-[11px] text-err" style={pad}>
          <span className="pl-10">could not read this folder — {err}</span>
        </div>
      )
    }
    if (!rows) {
      return (
        <div key={`w-${rel}-load`} className="px-1.5 py-0.5 text-[11px] text-muted" style={pad}>
          <span className="pl-10">reading the folder…</span>
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <div key={`w-${rel}-empty`} className="px-1.5 py-0.5 text-[11px] text-faint" style={pad}>
          <span className="pl-10">nothing in this folder</span>
        </div>
      )
    }
    return rows.map((r) => {
      const open = wholeDirs.has(r.rel)
      // `.devdeck` and the team inside it are what this view exists to show,
      // so they are marked rather than merely present.
      const isDeck = r.name === '.devdeck'
      return (
        <div key={`w-${r.rel}`}>
          <div
            className="group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-body select-none hover:bg-hover"
            style={pad}
            title={r.rel}
            onClick={() => (r.dir ? toggleWhole(r.rel) : openFile(0, r.rel, 'whole'))}
          >
            <span className="flex w-5 shrink-0 items-center justify-center text-dim">
              {r.dir && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />}
            </span>
            <span
              className={`flex w-5 shrink-0 items-center justify-center ${
                isDeck ? 'text-indigo-400' : 'text-faint'
              }`}
            >
              <Icon name={r.dir ? 'folder' : 'note'} size={12} />
            </span>
            <span className={`min-w-0 flex-1 truncate ${isDeck ? 'text-indigo-400' : ''}`}>
              {r.name}
            </span>
          </div>
          {r.dir && open && renderWhole(r.rel, depth + 1)}
        </div>
      )
    })
  }

  const renderFiles = (node: TreeNode, rel: string, depth: number): ReactNode => {
    const k = dirKey(node.id, rel)
    const rows = files[k]
    const err = fileErr[k]
    const pad = { paddingLeft: `${depth * 14 + 6}px` }

    if (err) {
      return (
        <div key={`${k}-err`} className="px-1.5 py-0.5 text-[11px] text-err" style={pad}>
          <span className="pl-10">could not read this folder — {err}</span>
        </div>
      )
    }
    if (!rows) {
      return (
        <div key={`${k}-load`} className="px-1.5 py-0.5 text-[11px] text-muted" style={pad}>
          <span className="pl-10">reading the folder…</span>
        </div>
      )
    }
    // A child node already has a row of its own; the folder behind it would be
    // the same place on screen twice.
    const owned = new Set(
      rel === '' ? nodes.filter((n) => n.parent_id === node.id).map((x) => x.name.toLowerCase()) : [],
    )
    const visible = rows.filter((r) => !(r.dir && owned.has(r.name.toLowerCase())))
    if (visible.length === 0) {
      return (
        <div key={`${k}-empty`} className="px-1.5 py-0.5 text-[11px] text-faint" style={pad}>
          <span className="pl-10">nothing else in this folder</span>
        </div>
      )
    }
    return visible.map((r) => {
      const childKey = dirKey(node.id, r.rel)
      const open = openDirs.has(childKey)
      return (
        <div key={childKey}>
          <div
            className="group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-body select-none hover:bg-hover"
            style={pad}
            title={r.rel}
            onClick={() => {
              if (r.dir) toggleDir(node.id, r.rel)
              else openFile(node.id, r.rel, rootOf(node.id))
            }}
          >
            <span className="flex w-5 shrink-0 items-center justify-center text-dim">
              {r.dir && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />}
            </span>
            <span className="flex w-5 shrink-0 items-center justify-center text-faint">
              <Icon name={r.dir ? 'folder' : 'note'} size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.item && (
              <span
                className="mr-1 shrink-0 rounded-full bg-indigo-500/12 px-1.5 text-[9px] font-semibold uppercase tracking-[0.03em] text-indigo-400"
                title={`Work items on “${r.item}” name this path`}
              >
                {r.item}
              </span>
            )}
          </div>
          {r.dir && open && renderFiles(node, r.rel, depth + 1)}
        </div>
      )
    })
  }

  /// Two words that say which directory you are looking at.
  ///
  /// Deliberately a switch rather than two branches of one tree: a node's
  /// repository and its vault folder are both "this node", and showing them
  /// as siblings would suggest one contains the other. Switching also drops
  /// the open folders for that node — the paths on the other side are not the
  /// same paths, and carrying them over would open nothing and look broken.
  const renderRootSwitch = (node: TreeNode, depth: number): ReactNode => {
    const here = rootOf(node.id)
    const pad = { paddingLeft: `${depth * 14 + 6}px` }
    const pick = (want: 'work' | 'vault') => {
      if (want === here) return
      setFileRoot((r) => ({ ...r, [node.id]: want }))
      setOpenDirs((prev) => {
        const next = new Set<string>()
        for (const k of prev) if (!k.startsWith(`${node.id}:`)) next.add(k)
        return next
      })
    }
    const tab = (want: 'work' | 'vault', label: string, title: string) => (
      <button
        className={`rounded px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
          here === want ? 'bg-indigo-500/14 text-indigo-400' : 'text-faint hover:text-dim'
        }`}
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          pick(want)
        }}
      >
        {label}
      </button>
    )
    return (
      <div
        key={`${node.id}-root`}
        className="flex items-center gap-1 py-0.5 select-none"
        style={pad}
      >
        <span className="flex w-5 shrink-0" />
        {tab('work', 'Repo', 'The repository — where commands and terminals run')}
        {tab('vault', 'Vault', 'The vault folder — .devdeck, _bot.md and the features')}
      </div>
    )
  }

  /// What is happening in this project right now, and what it is working on.
  ///
  /// Above the category folders rather than inside them: those answer "what
  /// exists", and a running service is a different question from a configured
  /// one. Ranking rather than filtering, because the folders are also where
  /// you go to START a stopped service — hiding them would hide the button.
  ///
  /// Only rendered for a project, and only when there is something to say, so
  /// an idle project stays as quiet as it was before.
  const renderLive = (node: TreeNode, depth: number): ReactNode => {
    const pid = String(node.id)
    const agents = aiwSessions.filter(
      (x) => x.project_id === pid && (x.status === 'working' || x.status === 'planning'),
    )
    const waiting = aiwApprovals.filter((r) => r.project_id === pid)
    if (agents.length === 0 && waiting.length === 0) return null

    const pad = { paddingLeft: `${depth * 14 + 6}px` }
    return (
      <div key={`${node.id}-live`}>
        {waiting.map((r) => (
          <div
            key={r.id}
            className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-body select-none hover:bg-hover"
            style={pad}
            title={r.detail}
            onClick={() => {
              setSelectedNode(node.id)
              setRailView('aiworkspace')
            }}
          >
            <span className="w-5 shrink-0" />
            <span className="flex w-5 shrink-0 items-center justify-center text-warn">
              <Icon name="alert" size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate">{r.summary}</span>
            <span className="shrink-0 pr-1 text-[10px] font-semibold text-warn">waiting</span>
          </div>
        ))}
        {agents.map((x) => (
          <div
            key={x.id}
            className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-body select-none hover:bg-hover"
            style={pad}
            title={`${x.agent_name} · ${x.feature_id}`}
            onClick={() => {
              setSelectedNode(node.id)
              setRailView('aiworkspace')
            }}
          >
            <span className="w-5 shrink-0" />
            <span className="flex w-5 shrink-0 items-center justify-center text-indigo-400">
              <Icon name="agent" size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate">{x.agent_name}</span>
            <span className="shrink-0 pr-1 text-[10px] text-ok">working</span>
          </div>
        ))}
      </div>
    )
  }

  /// The features this project is working on. Only for the project the AI
  /// Workspace currently has selected: it loads features one project at a
  /// time, and drawing an empty list for the others would say "no features"
  /// when the truth is "not loaded".
  const renderFeatures = (node: TreeNode, depth: number): ReactNode => {
    if (aiwProjectId !== String(node.id) || aiwFeatures.length === 0) return null
    const pad = { paddingLeft: `${depth * 14 + 6}px` }
    return (
      <div key={`${node.id}-features`}>
        <div
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-dim select-none"
          style={pad}
        >
          <span className="w-5 shrink-0" />
          <span className="flex w-5 shrink-0 items-center justify-center text-viol">
            <Icon name="list" size={13} />
          </span>
          <span className="flex-1 truncate">Features</span>
          <span className="shrink-0 pr-1 text-[10.5px] tabular-nums text-faint">
            {aiwFeatures.length}
          </span>
        </div>
        {aiwFeatures.slice(0, 8).map((f) => (
          <div
            key={f.id}
            className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-body select-none hover:bg-hover"
            style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}
            title={f.goal}
            onClick={() => {
              setSelectedNode(node.id)
              void selectFeature(f.id)
              setRailView('projects')
              openAiwDoc('features', String(node.id), node.name)
            }}
          >
            <span className="w-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {f.conflicts > 0 && (
              <span className="shrink-0 pr-1 text-[10px] font-semibold text-warn">
                {f.conflicts}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Filtering keeps a node when it matches, when anything it owns matches, or
  // when a descendant does — an ancestor that vanished would take its matching
  // children off screen with it. Null means no filter is running.
  const q = filter.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!q) return null
    const named = (n: { name: string }) => n.name.toLowerCase().includes(q)
    const hit = new Set<number>()
    for (const n of nodes) {
      const own =
        named(n) ||
        commands.some((c) => c.project_id === n.id && named(c)) ||
        services.some((sv) => sv.project_id === n.id && named(sv)) ||
        profiles.some((pr) => pr.project_id === n.id && named(pr))
      if (!own) continue
      let cur: TreeNode | null = n
      while (cur) {
        hit.add(cur.id)
        cur = findNode(nodes, cur.parent_id)
      }
    }
    return hit
  }, [q, nodes, commands, services, profiles])

  /// Git, as a row rather than only a chip on the project.
  ///
  /// The branch and the ahead/behind counts sit up on the project line, which
  /// is right for a glance and wrong for "I want to commit". This is the way
  /// in: how much is uncommitted, and a click to the page that commits it.
  /// Only for a node that actually has a repository — a folder with no git in
  /// it should not grow a Git row that can say nothing.
  const renderGit = (node: TreeNode, depth: number): ReactNode => {
    const g = gitByNode[node.id]
    if (!g?.is_repo) return null
    const changed = changesByNode[node.id]
    return (
      <div
        key={`${node.id}-git`}
        className="group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-dim select-none hover:bg-hover hover:text-body"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        title={
          changed == null
            ? `On ${g.branch ?? 'an unknown branch'} — open the Git page`
            : `${changed} uncommitted change${changed === 1 ? '' : 's'} on ${g.branch ?? '?'}`
        }
        onClick={() => {
          setSelectedNode(node.id)
          openAiwDoc('git', String(node.id), node.name)
        }}
      >
        <span className="w-5 shrink-0" />
        <span className="flex w-5 shrink-0 items-center justify-center text-indigo-400">
          <Icon name="commit" size={13} />
        </span>
        <span className="flex-1 truncate">Git</span>
        {/* A count we never took is left blank rather than drawn as zero:
            "nothing to commit" is a claim, and we would be guessing at it. */}
        {changed != null && changed > 0 && (
          <span className="mr-1 shrink-0 rounded-full bg-soft px-1.5 text-[10px] tabular-nums text-muted">
            {changed}
          </span>
        )}
      </div>
    )
  }

  const renderNode = (node: TreeNode, depth: number) => {
    if (visible && !visible.has(node.id)) return null
    const children = nodes.filter((n) => n.parent_id === node.id)
    const nodeCommands = commands.filter((c) => c.project_id === node.id)
    const nodeServices = services.filter((s) => s.project_id === node.id)
    const nodeProfiles = profiles.filter((p) => p.project_id === node.id)
    // Category folders appear only when they actually hold something — a fresh
    // project/folder stays clean until you add commands/services/profiles.
    const showCommands = nodeCommands.length > 0
    const showServices = nodeServices.length > 0
    const showProfiles = nodeProfiles.length > 0
    // A project always has something inside it: the folder it points at. Left
    // out of this, a repository with no configured commands drew no chevron at
    // all, so the one thing it definitely contains — its files — looked like
    // nothing.
    const hasKids =
      node.kind === 'project' ||
      children.length > 0 ||
      showCommands ||
      showServices ||
      showProfiles
    const isOpen = visible ? true : expanded.has(node.id)
    const selected = selectedNodeId === node.id
    const renaming = renamingId === node.id
    const sub = node.kind === 'folder' ? node.path || node.rel_path : node.kind === 'project' ? node.path : ''

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1.5 rounded px-1.5 py-1 text-[13px] select-none ${
            selected ? 'bg-indigo-500/20 text-ink' : 'text-body hover:bg-hover'
          } ${renaming ? '' : 'cursor-pointer'}`}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => {
            if (renaming) return
            setSelectedNode(node.id)
            // Opening a folder is what makes it recent. A workspace is not one
            // of them — it is the frame, and it already has a tab.
            if (node.kind !== 'workspace') touchRecent(node.id)
            // A project's click opens its dashboard (the space page); settings
            // stay on double-click / context menu. A workspace opens the same
            // page a folder does — it is one, and it has context of its own.
            // Every node is a conversation, so a click opens its thread. Its
            // dashboard, its settings and its context are on that page, one
            // click further — which is what the five pseudo-rows under every
            // project used to be for.
            openNodeThread(node.id, node.name)
          }}
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
            className={`flex w-5 shrink-0 items-center justify-center text-dim hover:text-ink ${hasKids ? 'cursor-pointer' : 'opacity-0'}`}
            onClick={(e) => {
              e.stopPropagation()
              if (node.kind === 'project' && !expanded.has(node.id)) loadDir(node.id, '')
              toggle(node.id)
            }}
          >
            <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={15} />
          </span>
          <span
            className={`flex w-5 shrink-0 items-center justify-center ${node.kind === 'project' ? '' : KIND_COLOR[node.kind]}`}
            style={node.kind === 'project' ? { color: nodeColor(node) } : undefined}
          >
            <Icon name={KIND_ICON[node.kind]} size={15} />
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
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
              <span className="truncate">{node.name}</span>
              {node.label && (
                <span
                  className="shrink-0 rounded-full px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-[0.04em]"
                  style={{
                    background: `${labelColor(node.label)}28`,
                    color: labelColor(node.label),
                  }}
                >
                  {node.label}
                </span>
              )}
            </span>
          )}
          {node.kind === 'project' && gitByNode[node.id]?.branch && (() => {
            const g = gitByNode[node.id]!
            return (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted">
                <span
                  className="flex items-center gap-1"
                  title={
                    g.detached
                      ? `Detached HEAD at ${g.branch}`
                      : `On branch ${g.branch}${g.upstream ? ` · tracking ${g.upstream}` : ' · no upstream'}`
                  }
                >
                  <Icon name="github" size={10} className="shrink-0" />
                  <span className="max-w-[72px] truncate">{g.branch}</span>
                </span>
                {g.behind > 0 && (
                  <button
                    className="flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-warn hover:bg-amber-500/30"
                    title={`${g.behind} commit${g.behind === 1 ? '' : 's'} to pull — click to pull (fast-forward)`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void pullProject(node)
                    }}
                  >
                    <Icon name="arrow-down" size={9} />
                    {g.behind}
                  </button>
                )}
                {g.ahead > 0 && (
                  <button
                    className="flex items-center gap-0.5 rounded px-0.5 hover:bg-hover hover:text-ink"
                    title={`${g.ahead} commit${g.ahead === 1 ? '' : 's'} to push — click to push`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void pushProject(node)
                    }}
                  >
                    <Icon name="arrow-up" size={9} />
                    {g.ahead}
                  </button>
                )}
                {/* Uncommitted work, next to the branch it is on. Only ever
                    drawn from a count we actually took — a project missing
                    from `changesByNode` is one we could not ask, and drawing
                    a calm zero for it would be a lie. */}
                {(changesByNode[node.id] ?? 0) > 0 && (
                  <button
                    className="flex items-center gap-0.5 rounded bg-indigo-500/15 px-1 text-indigo-300 hover:bg-indigo-500/30"
                    title={`${changesByNode[node.id]} uncommitted change${
                      changesByNode[node.id] === 1 ? '' : 's'
                    } — click to review and commit`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedNode(node.id)
                      openAiwDoc('git', String(node.id), node.name)
                    }}
                  >
                    <Icon name="commit" size={9} />
                    {changesByNode[node.id]}
                  </button>
                )}
              </span>
            )
          })()}
          {/* Adding to *this* workspace, without going through a menu to
              find out it is not there. */}
          {node.kind === 'workspace' && (
            <button
              className="hidden items-center rounded px-1 text-dim hover:bg-hover hover:text-ink group-hover:flex"
              title={`Add to ${node.name}`}
              onClick={(e) => {
                e.stopPropagation()
                setAddTo(node.id)
              }}
            >
              <Icon name="add" size={14} />
            </button>
          )}
          <button
            className="hidden items-center rounded px-1 text-dim hover:bg-hover hover:text-ink group-hover:flex"
            title="Actions"
            onClick={(e) => {
              e.stopPropagation()
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setSelectedNode(node.id)
              setMenu({ x: rect.right, y: rect.bottom, target: { type: 'node', node } })
            }}
          >
            <Icon name="more" size={15} />
          </button>
        </div>
        {/* A git refusal sits under the row that caused it, open or not —
            "no remote to push to" answers a click that would otherwise look
            like it did nothing at all. */}
        {gitErr[node.id] && (
          <div
            className="flex items-start gap-1.5 py-0.5 pr-2 text-[11px] leading-4 text-err"
            style={{ paddingLeft: `${depth * 14 + 32}px` }}
          >
            <Icon name="alert" size={11} className="mt-px shrink-0" />
            <span className="min-w-0 flex-1">{gitErr[node.id]}</span>
            <button
              className="shrink-0 text-faint hover:text-ink"
              title="Dismiss"
              onClick={(e) => {
                e.stopPropagation()
                setGitErr((prev) => ({ ...prev, [node.id]: '' }))
              }}
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        )}
        {isOpen && (
          <>
            {/* Everything this project *is*, before the files it contains.
                These were briefly folded into one collapsed "Project" row.
                That made the tree shorter and the app worse: a service you
                cannot see is a service you cannot start, and the row that
                hid them was one more thing to know about. They are back, and
                they are above the file list rather than below it — under a
                repository's files they sat past a screen of scrolling, which
                is where they used to be and the reason they were easy to
                lose. Each is still collapsible on its own. */}
            {node.kind === 'project' && renderLive(node, depth + 1)}
            {children.map((c) => renderNode(c, depth + 1))}
            {node.kind === 'project' && renderFeatures(node, depth + 1)}
            {node.kind === 'project' && renderGit(node, depth + 1)}
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
                nodeServices.map((sv) => renderService(sv, depth + 2)),
              )}
            {showProfiles &&
              renderCategory(
                node,
                'profiles',
                nodeProfiles.length,
                depth + 1,
                nodeProfiles.map((pr) => renderProfile(pr, depth + 2)),
              )}
            {node.kind === 'project' && renderRootSwitch(node, depth + 1)}
            {node.kind === 'project' && renderFiles(node, '', depth + 1)}
            {node.kind === 'project' &&
              !files[dirKey(node.id, '')] &&
              !fileErr[dirKey(node.id, '')] && (
                <FetchOnce load={() => loadDir(node.id, '')} />
              )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* No workspace switcher here any more — the tabs in the top bar are
          the switcher, and having both meant the current workspace was named
          twice on screen a few pixels apart. What is left is what the tree
          cannot do for itself: getting a project into it. */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink"
          title={activeSolution ? `Showing ${activeSolution.name}` : undefined}
        >
          {activeSolution ? activeSolution.name : 'Explorer'}
        </span>

        {/* Quiet icon actions. The two filled buttons that lived here were the
            heaviest thing on the panel and were competing with the tree for
            the same glance; the tree is what you came to read. */}
        <button
          className={`flex shrink-0 items-center rounded p-1 ${
            filtering ? 'bg-hover text-ink' : 'text-dim hover:bg-hover hover:text-ink'
          }`}
          title="Filter the tree"
          onClick={() => {
            setFiltering((f) => !f)
            if (filtering) setFilter('')
          }}
        >
          <Icon name="search" size={14} />
        </button>
        {/* It used to be a bare + whose tooltip promised "a project, topic or
            anything else" and always made a folder. A button that names one
            thing and does another is worse than no button. */}
        <button
          className="btn-primary shrink-0 px-2 py-0.5 text-[11.5px] disabled:opacity-40"
          title={
            activeWorkspaceId == null
              ? 'Create a workspace first'
              : 'Add a project, an area, or a folder'
          }
          disabled={activeWorkspaceId == null}
          onClick={() => activeWorkspaceId != null && setAddTo(activeWorkspaceId)}
        >
          <Icon name="add" size={12} /> Add
        </button>
        <button
          className="flex shrink-0 items-center rounded p-1 text-dim hover:bg-hover hover:text-ink"
          title="Collapse everything"
          onClick={() => {
            setExpanded(new Set())
          }}
        >
          <Icon name="caret-up" size={14} />
        </button>
        <button
          className="flex shrink-0 items-center rounded p-1 text-dim hover:bg-hover hover:text-ink disabled:opacity-40"
          title="More"
          disabled={activeWorkspaceId == null}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4, target: { type: 'node', node: null } })
          }}
        >
          <Icon name="more" size={14} />
        </button>
      </div>

      {/* The filter, only once you ask for it — a permanent search box on a
          three-item tree is furniture. */}
      {filtering && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <input
            autoFocus
            className="input w-full px-2 py-1 text-[11.5px]"
            placeholder="Filter projects, commands, services"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('')
                setFiltering(false)
              }
            }}
          />
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, target: { type: 'node', node: null } })
        }}
      >
        {treeError ? (
          /* A read that failed is not an empty deck. Saying "No workspaces
             yet" here would be the update-checker mistake again: reporting a
             failure as a clean, empty success. */
          <div className="p-3 text-[12px] leading-5">
            <div className="flex items-center gap-1.5 font-medium text-err">
              <Icon name="alert" size={14} className="shrink-0" />
              Couldn’t load your workspaces
            </div>
            <p className="mt-1.5 text-muted">
              Nothing has been deleted — this is a read that failed, not an empty deck. Your
              workspaces and projects are still in the local database.
            </p>
            <p className="mt-1.5 break-words font-mono text-[11px] text-faint">{treeError}</p>
            <button
              className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 text-[12px]"
              onClick={() => void retryBootstrap()}
            >
              <Icon name="update" size={14} spin={treeLoading} /> Retry
            </button>
          </div>
        ) : treeLoading && nodes.length === 0 ? (
          <div className="flex items-center gap-1.5 p-3 text-[12px] text-muted">
            <Icon name="update" size={13} spin /> Loading your workspaces…
          </div>
        ) : workspaces.length === 0 ? (
          <div className="p-3 text-[12px] leading-5 text-muted">
            <p>
              No workspaces yet. A workspace groups related projects. Create one, then add projects
              (each an app / repo root) and folders inside them.
            </p>
            <button className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 text-[12px]" onClick={() => void addWorkspace()}>
              <Icon name="add" size={14} /> New workspace
            </button>
            <button
              className="btn-ghost mt-2 flex w-full items-center justify-center gap-1.5 text-[12px]"
              title="Create a small demo project you can actually run"
              onClick={() => void loadExampleWorkspace().catch((e) => alert(String(e)))}
            >
              <Icon name="example" size={14} /> Load example workspace
            </button>
          </div>
        ) : roots.length === 0 ? (
          <div className="p-3 text-[12px] leading-5 text-muted">
            <p className="text-body">Nothing in “{ws?.name}” yet.</p>
            <p className="mt-1">
              A workspace holds code projects and areas like Marketing or Money.
            </p>
            {/* The empty state is where a person is most stuck, so it is the
                one place worth spelling the choice out rather than opening a
                menu of four. */}
            <button
              className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 text-[12px]"
              disabled={activeWorkspaceId == null}
              onClick={() => activeWorkspaceId != null && setAddTo(activeWorkspaceId)}
            >
              <Icon name="add" size={14} /> Add a code project
            </button>
            <button
              className="btn-ghost mt-1.5 flex w-full items-center justify-center gap-1.5 text-[12px]"
              disabled={activeWorkspaceId == null}
              onClick={() => activeWorkspaceId != null && setAddTo(activeWorkspaceId)}
            >
              An area with no code
            </button>
          </div>
        ) : (
          roots.map((n) => renderNode(n, 0))
        )}

        {/* The vault itself, at the bottom because it is the thing you go
            looking for rather than the thing you work in. */}
        <div className="mt-2 border-t border-line pt-2">
          <div
            className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] select-none hover:bg-hover"
            title="Everything under the vault root, including .devdeck"
            onClick={() => {
              setWholeOpen((o) => !o)
              loadWhole('')
            }}
          >
            <span className="flex w-5 shrink-0 items-center justify-center text-dim">
              <Icon name={wholeOpen ? 'chevron-down' : 'chevron-right'} size={13} />
            </span>
            <span className="flex w-5 shrink-0 items-center justify-center text-faint">
              <Icon name="package" size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate text-dim">Whole vault</span>
          </div>
          {wholeOpen && renderWhole('', 1)}
        </div>
      </div>
      {menu && (
        <PopMenu x={menu.x} y={menu.y} items={menuItems(menu.target)} onClose={() => setMenu(null)} />
      )}
      {wsMenu && (
        <PopMenu x={wsMenu.x} y={wsMenu.y} items={workspaceMenuItems()} onClose={() => setWsMenu(null)} />
      )}
      {ghOpen && <GitHubImportModal onClose={() => setGhOpen(false)} />}
      {addTo != null && (
        <AddToWorkspace
          workspaceId={addTo}
          onClose={() => setAddTo(null)}
          onGithub={() => {
            setAddTo(null)
            setGhOpen(true)
          }}
          onCreated={(created, kind) => {
            setAddTo(null)
            expand(created.parent_id ?? addTo)
            void refreshTree().then(() => {
              setSelectedNode(created.id)
              // A project has a repository to point at and a name to confirm,
              // so it opens setup. An area or a folder is finished already.
              if (kind === 'project') openNodeSetup(created.id, created.name)
              else openNodeConfig(created.id, created.name)
            })
          }}
        />
      )}
      {newBotFor != null && (
        <BotCreate
          nodeId={newBotFor}
          onClose={() => setNewBotFor(null)}
          onCreated={(b) => {
            setNewBotFor(null)
            void refreshBots()
            openBot(b.node_id, b.name, true)
          }}
        />
      )}
    </div>
  )
}
