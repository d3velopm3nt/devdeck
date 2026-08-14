// Central Zustand store: one store, sliced by concern. Event handlers
// (App.tsx) push backend events in; components subscribe to slices.

import { create } from 'zustand'
import * as ipc from './lib/ipc'
import { findNode, projectOf } from './lib/tree'
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
  hotkey: string
  /** Request the Log viewer to filter to a service's output. `n` bumps so
   *  re-selecting the same service refocuses. */
  logFocus: { name: string; n: number } | null

  // derived helpers
  selectedNode: () => TreeNode | null
  selectedProject: () => TreeNode | null

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
  updateSvcState: (s: SvcState) => void
  markPtyExited: (id: number) => void

  setSelectedNode: (id: number | null) => void
  setHotkey: (h: string) => void
  focusServiceLogs: (name: string) => void
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

  refreshTree: async () => set({ nodes: await ipc.treeList() }),
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
  updateSvcState: (s) => set((st) => ({ svcStates: { ...st.svcStates, [s.id]: s } })),
  markPtyExited: (id) =>
    set((st) => ({
      terminals: st.terminals.map((t) => (t.id === id ? { ...t, alive: false } : t)),
    })),

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setHotkey: (h) => set({ hotkey: h }),
  focusServiceLogs: (name) =>
    set((st) => ({ logFocus: { name, n: (st.logFocus?.n ?? 0) + 1 } })),
}))
