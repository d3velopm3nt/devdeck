// Central Zustand store: one store, sliced by concern. Event handlers
// (App.tsx) push backend events in; components subscribe to slices.

import { create } from 'zustand'
import * as ipc from './lib/ipc'
import { findNode, projectOf, serviceDir } from './lib/tree'
import type {
  CommandDef,
  LayoutDef,
  LogEntry,
  ProcStat,
  ProfileDef,
  PtyInfo,
  Recent,
  ServiceDef,
  ShellDef,
  SvcState,
  TreeNode,
} from './lib/types'

const LOG_UI_LIMIT = 5000

export interface AppState {
  // data
  nodes: TreeNode[]
  commands: CommandDef[]
  services: ServiceDef[]
  profiles: ProfileDef[]
  layouts: LayoutDef[]
  shells: ShellDef[]
  terminals: PtyInfo[]
  svcStates: Record<number, SvcState>
  stats: ProcStat[]
  logs: LogEntry[]
  recents: Recent[]

  // ui
  selectedNodeId: number | null
  /** The workspace the Explorer is currently showing. Workspaces are switched,
   *  not browsed in the tree. */
  activeWorkspaceId: number | null
  hotkey: string
  /** Request the Log viewer to filter to a service's output. `n` bumps so
   *  re-selecting the same service refocuses. */
  logFocus: { name: string; n: number } | null

  // derived helpers
  selectedNode: () => TreeNode | null
  selectedProject: () => TreeNode | null
  activeWorkspace: () => TreeNode | null
  /** Node whose subtree scopes the panels: the selection, else the workspace. */
  scopeNode: () => TreeNode | null
  /** Effective port for a service: its saved health_port, else the live port
   *  the monitor detected for the running process (null if neither). */
  servicePort: (id: number) => number | null

  // loaders
  refreshTree: () => Promise<void>
  refreshCommands: () => Promise<void>
  refreshServices: () => Promise<void>
  refreshProfiles: () => Promise<void>
  refreshLayouts: () => Promise<void>
  refreshTerminals: () => Promise<void>
  refreshRecents: () => Promise<void>
  bootstrap: () => Promise<void>

  // event ingestion
  appendLog: (e: LogEntry) => void
  setLogs: (e: LogEntry[]) => void
  clearLogs: () => void
  setStats: (s: ProcStat[]) => void
  /** Persist the monitor-detected port into any running service that has no
   *  health_port set — so an imported service gets its port automatically. */
  adoptDetectedPorts: () => void
  updateSvcState: (s: SvcState) => void
  markPtyExited: (id: number) => void

  setSelectedNode: (id: number | null) => void
  setActiveWorkspace: (id: number | null) => void
  setHotkey: (h: string) => void
  focusServiceLogs: (name: string) => void

  // Project Setup: a start blocked on a "prepare" prompt (missing tools /
  // bootstrap), plus a passive "install this missing tool" hint from errors.
  setupPrompt: { svc: ServiceDef; setup: ipc.ProjectSetup; dir: string } | null
  requestStartService: (svc: ServiceDef) => Promise<void>
  dismissSetup: () => void
  installHint: ipc.RequiredTool | null
  setInstallHint: (t: ipc.RequiredTool | null) => void
}

// Pick the most likely user-facing port from a process's listeners: prefer a
// conventional dev-server port, else the lowest non-privileged one.
const bestPort = (ports?: number[]): number | null => {
  if (!ports || ports.length === 0) return null
  const sorted = [...ports].sort((a, b) => a - b)
  return sorted.find((p) => p >= 3000 && p <= 9999) ?? sorted.find((p) => p >= 1024) ?? sorted[0]
}

// Services we're currently writing an auto-detected port to (in-flight guard so
// the 2s stats tick doesn't queue duplicate saves).
const adoptingPorts = new Set<number>()

const AW_KEY = 'devdeck.activeWorkspace'
const loadActiveWs = (): number | null => {
  const v = Number(localStorage.getItem(AW_KEY))
  return Number.isFinite(v) && v > 0 ? v : null
}
const persistActiveWs = (id: number | null) => {
  try {
    localStorage.setItem(AW_KEY, id != null ? String(id) : '')
  } catch {
    /* storage unavailable */
  }
}
// Keep the active workspace pointing at a real workspace (first one as fallback).
const resolveActiveWs = (nodes: TreeNode[], current: number | null): number | null => {
  const workspaces = nodes.filter((n) => n.kind === 'workspace')
  if (current != null && workspaces.some((w) => w.id === current)) return current
  return workspaces[0]?.id ?? null
}

export const useApp = create<AppState>((set, get) => ({
  nodes: [],
  commands: [],
  services: [],
  profiles: [],
  layouts: [],
  shells: [],
  terminals: [],
  svcStates: {},
  stats: [],
  logs: [],
  recents: [],
  selectedNodeId: null,
  activeWorkspaceId: loadActiveWs(),
  hotkey: 'ctrl+shift+Space',
  logFocus: null,

  selectedNode: () => {
    const { nodes, selectedNodeId } = get()
    return findNode(nodes, selectedNodeId)
  },

  // Nearest project for the current selection (itself if a project, else
  // walk up; a folder's owning app).
  selectedProject: () => {
    const { nodes, selectedNodeId } = get()
    return projectOf(nodes, findNode(nodes, selectedNodeId))
  },

  activeWorkspace: () => {
    const { nodes, activeWorkspaceId } = get()
    return findNode(nodes, activeWorkspaceId)
  },

  scopeNode: () => {
    const { nodes, selectedNodeId, activeWorkspaceId } = get()
    return findNode(nodes, selectedNodeId) ?? findNode(nodes, activeWorkspaceId)
  },

  servicePort: (id) => {
    const { services, stats } = get()
    const saved = services.find((s) => s.id === id)?.health_port
    if (saved != null) return saved
    const st = stats.find((s) => s.kind === 'service' && s.id === id)
    return bestPort(st?.ports)
  },

  refreshTree: async () => {
    const nodes = await ipc.treeList()
    const activeWorkspaceId = resolveActiveWs(nodes, get().activeWorkspaceId)
    persistActiveWs(activeWorkspaceId)
    set({ nodes, activeWorkspaceId })
  },
  refreshCommands: async () => set({ commands: await ipc.commandsList() }),
  refreshServices: async () => set({ services: await ipc.servicesList() }),
  refreshProfiles: async () => set({ profiles: await ipc.profilesList() }),
  refreshLayouts: async () => set({ layouts: await ipc.layoutsList() }),
  refreshTerminals: async () => set({ terminals: await ipc.ptyList() }),
  refreshRecents: async () => set({ recents: await ipc.recentsList() }),

  bootstrap: async () => {
    const [nodes, commands, services, profiles, layouts, shells, terminals, states, logs, recents, hotkey] =
      await Promise.all([
        ipc.treeList(),
        ipc.commandsList(),
        ipc.servicesList(),
        ipc.profilesList(),
        ipc.layoutsList(),
        ipc.shellsDetect(),
        ipc.ptyList(),
        ipc.svcStates(),
        ipc.logsRecent(2000),
        ipc.recentsList(),
        ipc.settingGet('hotkey'),
      ])
    const svcStates: Record<number, SvcState> = {}
    for (const s of states) svcStates[s.id] = s
    const activeWorkspaceId = resolveActiveWs(nodes, get().activeWorkspaceId)
    persistActiveWs(activeWorkspaceId)
    set({
      nodes,
      commands,
      services,
      profiles,
      layouts,
      shells,
      terminals,
      svcStates,
      logs,
      recents,
      activeWorkspaceId,
      hotkey: hotkey ?? 'ctrl+shift+Space',
    })
  },

  appendLog: (e) =>
    set((st) => {
      const logs = st.logs.length >= LOG_UI_LIMIT ? [...st.logs.slice(-LOG_UI_LIMIT + 1), e] : [...st.logs, e]
      return { logs }
    }),
  setLogs: (logs) => set({ logs }),
  clearLogs: () => set({ logs: [] }),
  setStats: (stats) => set({ stats }),
  adoptDetectedPorts: () => {
    const { services, stats } = get()
    for (const st of stats) {
      if (st.kind !== 'service' || !st.ports || st.ports.length === 0) continue
      const svc = services.find((s) => s.id === st.id)
      if (!svc || svc.health_port != null || adoptingPorts.has(st.id)) continue
      const port = bestPort(st.ports)
      if (port == null) continue
      adoptingPorts.add(st.id)
      void ipc
        .serviceSave({ ...svc, health_port: port })
        .then(() => get().refreshServices())
        .catch(() => {})
        .finally(() => adoptingPorts.delete(st.id))
    }
  },
  updateSvcState: (s) => set((st) => ({ svcStates: { ...st.svcStates, [s.id]: s } })),
  markPtyExited: (id) =>
    set((st) => ({
      terminals: st.terminals.map((t) => (t.id === id ? { ...t, alive: false } : t)),
    })),

  setupPrompt: null,
  installHint: null,
  requestStartService: async (svc) => {
    const { nodes } = get()
    const dir = serviceDir(nodes, svc)
    // No folder to inspect → just start.
    if (!dir) return void (await ipc.svcStart(svc.id))
    try {
      const setup = await ipc.detectProjectSetup(dir)
      if (setup.ready) {
        await ipc.svcStart(svc.id)
      } else {
        set({ setupPrompt: { svc, setup, dir } })
      }
    } catch {
      await ipc.svcStart(svc.id)
    }
  },
  dismissSetup: () => set({ setupPrompt: null }),
  setInstallHint: (t) => set({ installHint: t }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setActiveWorkspace: (id) => {
    persistActiveWs(id)
    // Switching workspace clears any selection from the previous one.
    set({ activeWorkspaceId: id, selectedNodeId: null })
  },
  setHotkey: (h) => set({ hotkey: h }),
  focusServiceLogs: (name) =>
    set((st) => ({ logFocus: { name, n: (st.logFocus?.n ?? 0) + 1 } })),
}))
