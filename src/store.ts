// Central Zustand store: one store, sliced by concern. Event handlers
// (App.tsx) push backend events in; components subscribe to slices.

import { create } from 'zustand'
import * as ipc from './lib/ipc'
import type { GitInfo } from './lib/ipc'
import { findNode, projectOf, resolveDir, serviceDir, subtreeIds } from './lib/tree'
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
  ConnDef,
  QueryResult,
  SavedQuery,
  StashCounts,
  StashEdit,
  StashFilter,
  StashItem,
  StashStatus,
  SvcState,
  TreeNode,
} from './lib/types'

const LOG_UI_LIMIT = 5000

export type Theme = 'dark' | 'light'
export type RailView = 'home' | 'projects' | 'stash' | 'connections' | 'machine' | 'settings'
export type BottomTab = 'logs' | 'processes'

/** What the Stash view is currently showing. `noProject` narrows to clips
 *  captured outside any project (the sidebar's "no project" tag). */
export interface StashFilters {
  filter: StashFilter
  itemType: string
  /** Exact user tag name ('' = any). */
  tag: string
  projectId: number | null
  noProject: boolean
  query: string
}
/** The slide-over editor sheet target: which entity kind, its id (0 = new),
 *  and the project to pre-select for new items. */
export interface SheetState {
  kind: 'command' | 'service' | 'profile'
  id: number
  projectId: number | null
}

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
  /** Git branch info per project node id (only repos appear). */
  gitByNode: Record<number, GitInfo>
  /** Background auto-fetch of git status (learns what's to pull). */
  gitMonitorEnabled: boolean
  /** Minutes between background fetches when monitoring is on. */
  gitMonitorIntervalMin: number

  // ui
  selectedNodeId: number | null
  /** The workspace the Explorer is currently showing. Workspaces are switched,
   *  not browsed in the tree. */
  activeWorkspaceId: number | null
  hotkey: string
  /** Request the Log viewer to filter its output. `n` bumps so asking for
   *  the same thing twice still refocuses. `search` also drives its text
   *  box — that's how a stacktrace clip jumps you to matching log lines. */
  logFocus: { name: string; n: number; search?: string } | null
  /** App color theme; applied as data-theme on <html>, persisted to settings. */
  theme: Theme
  /** Which rail view the shell is showing. */
  railView: RailView
  /** The slide-over editor sheet, or null when closed. */
  sheet: SheetState | null
  /** Bottom bar (Logs/Processes) UI state — global across rail views. */
  bottomTab: BottomTab
  bottomCollapsed: boolean

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
  /** Resolve the current git branch for every project node into `gitByNode`. */
  refreshGit: () => Promise<void>
  /** Fetch remote-tracking refs for the active workspace's repos, then update
   *  ahead/behind. This is the networked monitoring pass. */
  fetchGitStatus: () => Promise<void>
  /** Persist + apply the git-monitor settings. */
  setGitMonitor: (enabled: boolean, intervalMin: number) => Promise<void>
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
  /** Reveal the Logs tab filtered to `term` across every source. */
  searchLogs: (term: string) => void
  setTheme: (t: Theme) => Promise<void>
  setRailView: (v: RailView) => void
  openSheet: (s: SheetState) => void
  closeSheet: () => void
  /** Reveal the bottom bar on the given tab (expands if collapsed). */
  showBottom: (tab: BottomTab) => void
  setBottomTab: (tab: BottomTab) => void
  setBottomCollapsed: (collapsed: boolean) => void

  // Stash — the clip vault. The list carries previews only; `stashDetail`
  // holds the one selected row with its full content fetched on demand.
  stashItems: StashItem[]
  stashCounts: StashCounts | null
  stashStatus: StashStatus | null
  stashFilters: StashFilters
  stashSelectedId: number | null
  stashDetail: StashItem | null
  stashLoading: boolean
  /** The detail pane is in edit mode. Set when you create a note, so a blank
   *  one opens ready to type into rather than as an empty card. */
  stashEditing: boolean
  setStashEditing: (editing: boolean) => void
  refreshStash: () => Promise<void>
  refreshStashCounts: () => Promise<void>
  refreshStashStatus: () => Promise<void>
  setStashFilters: (patch: Partial<StashFilters>) => void
  selectStashItem: (id: number | null) => Promise<void>
  /** A clip was just captured — re-read the list if the view is showing.
   *  Debounced, so a bulk import doesn't requery once per file. */
  ingestStashItem: () => void
  /** The debounced body of `ingestStashItem`; not called directly. */
  doIngest: () => void
  toggleStashPin: (id: number) => Promise<void>
  deleteStashItem: (id: number) => Promise<void>
  setStashCapture: (enabled: boolean) => Promise<void>
  /** Save a title/content/note edit. Rejects with the backend's reason when
   *  the new content is secret-shaped — callers should surface it. */
  updateStashItem: (edit: StashEdit) => Promise<void>
  /** Write a note from scratch and select it. */
  createStashNote: (title: string, content: string) => Promise<void>
  addStashTags: (id: number, input: string) => Promise<void>
  removeStashTag: (id: number, name: string) => Promise<void>

  // Connections — the SQL layer.
  connections: ConnDef[]
  connQueries: SavedQuery[]
  connSelectedId: number | null
  connSql: string
  connResult: QueryResult | null
  connRunning: boolean
  /** Reachability per connection, shown the way service status is. */
  connStatus: Record<number, 'ok' | 'bad' | 'unknown' | 'testing'>
  /** Which connection the editor sheet is on (0 = new), or null when closed. */
  connEditing: number | null
  refreshConnections: () => Promise<void>
  refreshConnQueries: () => Promise<void>
  selectConnection: (id: number | null) => Promise<void>
  setConnSql: (sql: string) => void
  runConnQuery: () => Promise<void>
  testConnection: (id: number) => Promise<void>
  openConnEditor: (id: number | null) => void
  closeConnEditor: () => void

  // Machine Setup. Held here rather than in the component because
  // `machine_status` shells out to winget and scoop and takes seconds — with
  // component-local state, every trip to another rail view and back paid that
  // cost again.
  machinePkgs: ipc.MachinePackage[]
  machineWinget: string[]
  machineScoop: string[]
  machineAvail: { winget: boolean; scoop: boolean }
  machineLoading: boolean
  /** 0 = never loaded. Used to skip the slow path on remount. */
  machineLoadedAt: number
  /** Seed + list the catalog and read installed state. No-op once loaded
   *  unless `force`. */
  loadMachine: (seed: ipc.MachinePackage[], force?: boolean) => Promise<void>
  refreshMachinePkgs: () => Promise<void>

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

/** Trailing-edge timer for `ingestStashItem`. */
let ingestTimer: number | undefined

const RAIL_KEY = 'devdeck.railView'
const loadRailView = (): RailView => {
  const v = localStorage.getItem(RAIL_KEY)
  return v === 'projects' || v === 'stash' || v === 'connections' || v === 'machine' || v === 'settings'
    ? v
    : 'home'
}

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
  gitByNode: {},
  gitMonitorEnabled: true,
  gitMonitorIntervalMin: 5,
  selectedNodeId: null,
  activeWorkspaceId: loadActiveWs(),
  hotkey: 'ctrl+shift+Space',
  theme: 'dark',
  railView: loadRailView(),
  sheet: null,
  bottomTab: (localStorage.getItem('devdeck.bottom.tab') as BottomTab) || 'logs',
  bottomCollapsed: localStorage.getItem('devdeck.bottom.collapsed') === '1',
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
    void get().refreshGit()
  },
  refreshCommands: async () => set({ commands: await ipc.commandsList() }),
  refreshServices: async () => set({ services: await ipc.servicesList() }),
  refreshProfiles: async () => set({ profiles: await ipc.profilesList() }),
  refreshLayouts: async () => set({ layouts: await ipc.layoutsList() }),
  refreshTerminals: async () => set({ terminals: await ipc.ptyList() }),
  refreshRecents: async () => set({ recents: await ipc.recentsList() }),
  refreshGit: async () => {
    const { nodes } = get()
    const projects = nodes.filter((n) => n.kind === 'project')
    const entries = await Promise.all(
      projects.map(async (p) => {
        const dir = resolveDir(nodes, p)
        if (!dir) return [p.id, null] as const
        try {
          return [p.id, await ipc.gitInfo(dir)] as const
        } catch {
          return [p.id, null] as const
        }
      }),
    )
    const gitByNode: Record<number, GitInfo> = {}
    for (const [id, info] of entries) if (info?.is_repo) gitByNode[id] = info
    set({ gitByNode })
  },
  fetchGitStatus: async () => {
    const { nodes, activeWorkspaceId } = get()
    // Only the active workspace's projects — bounds the network work.
    const inWs = new Set(activeWorkspaceId != null ? subtreeIds(nodes, activeWorkspaceId) : [])
    const projects = nodes.filter((n) => n.kind === 'project' && inWs.has(n.id))
    for (const p of projects) {
      const dir = resolveDir(nodes, p)
      if (!dir) continue
      try {
        const info = await ipc.gitFetch(dir) // sequential: don't spawn N gits at once
        if (info?.is_repo) set((st) => ({ gitByNode: { ...st.gitByNode, [p.id]: info } }))
      } catch {
        /* offline / no creds — leave the last-known status in place */
      }
    }
  },
  setGitMonitor: async (enabled, intervalMin) => {
    const iv = Math.max(1, Math.round(intervalMin) || 5)
    set({ gitMonitorEnabled: enabled, gitMonitorIntervalMin: iv })
    await Promise.all([
      ipc.settingSet('git_monitor_enabled', enabled ? '1' : '0'),
      ipc.settingSet('git_monitor_interval_min', String(iv)),
    ])
  },

  bootstrap: async () => {
    const [nodes, commands, services, profiles, layouts, shells, terminals, states, logs, recents, hotkey, gitEnabled, gitInterval, savedTheme] =
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
        ipc.settingGet('git_monitor_enabled'),
        ipc.settingGet('git_monitor_interval_min'),
        ipc.settingGet('app_theme'),
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
      // Default monitoring on; only an explicit '0' disables it.
      gitMonitorEnabled: gitEnabled == null ? true : gitEnabled !== '0',
      gitMonitorIntervalMin: Math.max(1, Number(gitInterval) || 5),
      theme: savedTheme === 'light' ? 'light' : 'dark',
    })
    document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark'
    void get().refreshGit()
    void get().refreshConnections()
    void get().refreshConnQueries()
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

  stashItems: [],
  stashCounts: null,
  stashStatus: null,
  stashFilters: { filter: 'all', itemType: '', tag: '', projectId: null, noProject: false, query: '' },
  stashSelectedId: null,
  stashDetail: null,
  stashLoading: false,
  stashEditing: false,
  setStashEditing: (stashEditing) => set({ stashEditing }),

  refreshStash: async () => {
    const f = get().stashFilters
    set({ stashLoading: true })
    try {
      const stashItems = await ipc.stashList({
        query: f.query,
        filter: f.filter,
        item_type: f.itemType,
        tag: f.tag,
        project_id: f.projectId,
        no_project: f.noProject,
      })
      set({ stashItems })
      // Keep a selection only while it's still in the list; otherwise fall
      // back to the newest clip so the detail pane is never stale or blank.
      const { stashSelectedId } = get()
      const keep = stashSelectedId != null && stashItems.some((i) => i.id === stashSelectedId)
      if (!keep) await get().selectStashItem(stashItems[0]?.id ?? null)
    } finally {
      set({ stashLoading: false })
    }
  },
  refreshStashCounts: async () => set({ stashCounts: await ipc.stashCounts() }),
  refreshStashStatus: async () => set({ stashStatus: await ipc.stashStatus() }),
  setStashFilters: (patch) => {
    set((st) => ({ stashFilters: { ...st.stashFilters, ...patch } }))
    void get().refreshStash()
  },
  selectStashItem: async (id) => {
    set({ stashSelectedId: id, stashDetail: null, stashEditing: false })
    if (id == null) return
    try {
      const stashDetail = await ipc.stashGet(id)
      // A slower fetch for an item you've already navigated away from must
      // not overwrite the newer selection.
      if (get().stashSelectedId === id) set({ stashDetail })
    } catch {
      /* deleted from under us — the list refresh will catch up */
    }
  },
  ingestStashItem: () => {
    if (get().railView !== 'stash') return
    // Coalesce: importing a folder of screenshots fires one event per file,
    // and re-running the whole query per event would thrash the list while
    // you are trying to read it.
    window.clearTimeout(ingestTimer)
    ingestTimer = window.setTimeout(() => get().doIngest(), 250)
  },
  doIngest: () => {
    void get().refreshStash()
    void get().refreshStashCounts()
    // Another window (the capture toast) may have edited the open item. Patch
    // the detail in place rather than re-selecting, which would blank it.
    const id = get().stashSelectedId
    if (id != null) {
      void ipc
        .stashGet(id)
        .then((d) => {
          if (get().stashSelectedId === id) set({ stashDetail: d })
        })
        .catch(() => {})
    }
  },
  toggleStashPin: async (id) => {
    const item = get().stashItems.find((i) => i.id === id)
    if (!item) return
    await ipc.stashPin(id, !item.pinned)
    await Promise.all([get().refreshStash(), get().refreshStashCounts()])
    if (get().stashSelectedId === id) await get().selectStashItem(id)
  },
  deleteStashItem: async (id) => {
    await ipc.stashDelete(id)
    if (get().stashSelectedId === id) set({ stashSelectedId: null, stashDetail: null })
    await Promise.all([get().refreshStash(), get().refreshStashCounts()])
  },
  setStashCapture: async (enabled) => {
    await ipc.stashSetEnabled(enabled)
    await get().refreshStashStatus()
  },
  updateStashItem: async (edit) => {
    // Let the rejection propagate: the editor shows the reason inline, which
    // is the whole point of refusing a secret rather than silently dropping it.
    const item = await ipc.stashUpdate(edit)
    set({ stashDetail: item })
    await Promise.all([get().refreshStash(), get().refreshStashCounts()])
  },
  createStashNote: async (title, content) => {
    const item = await ipc.stashCreateNote(title, content)
    // Clear filters that would hide the note you just wrote.
    set((st) => ({
      stashFilters: { ...st.stashFilters, filter: 'all', itemType: '', tag: '', query: '' },
      stashSelectedId: item.id,
      stashDetail: item,
    }))
    await Promise.all([get().refreshStash(), get().refreshStashCounts()])
    await get().selectStashItem(item.id)
    set({ stashEditing: true })
  },
  // Both tag actions patch `stashDetail` in place from the returned list
  // rather than re-selecting the item. Re-selecting blanks the detail pane for
  // a beat, which unmounts the tag input mid-keystroke and loses whatever you
  // were typing after the comma.
  addStashTags: async (id, input) => {
    const tags = await ipc.stashTagAdd(id, [input])
    set((st) => ({
      stashDetail: st.stashDetail?.id === id ? { ...st.stashDetail, tags } : st.stashDetail,
    }))
    await Promise.all([get().refreshStash(), get().refreshStashCounts()])
  },
  removeStashTag: async (id, name) => {
    const tags = await ipc.stashTagRemove(id, name)
    set((st) => ({
      stashDetail: st.stashDetail?.id === id ? { ...st.stashDetail, tags } : st.stashDetail,
      // Removing the last use prunes the tag, so a filter on it would strand
      // the view on an empty list.
      stashFilters:
        st.stashFilters.tag === name ? { ...st.stashFilters, tag: '' } : st.stashFilters,
    }))
    await Promise.all([get().refreshStash(), get().refreshStashCounts()])
  },

  connections: [],
  connQueries: [],
  connSelectedId: null,
  connSql: '',
  connResult: null,
  connRunning: false,
  connStatus: {},
  connEditing: null,

  refreshConnections: async () => {
    const connections = await ipc.connList()
    set({ connections })
    // Keep the selection pointing at something real.
    const { connSelectedId } = get()
    if (connSelectedId != null && !connections.some((c) => c.id === connSelectedId)) {
      await get().selectConnection(connections[0]?.id ?? null)
    } else if (connSelectedId == null && connections.length > 0) {
      await get().selectConnection(connections[0].id)
    }
  },
  refreshConnQueries: async () => set({ connQueries: await ipc.connQueriesList() }),
  selectConnection: async (id) => {
    set({ connSelectedId: id, connResult: null })
    if (id != null) await get().refreshConnQueries()
  },
  setConnSql: (connSql) => set({ connSql }),
  runConnQuery: async () => {
    const { connSelectedId, connSql, connRunning } = get()
    if (connSelectedId == null || !connSql.trim() || connRunning) return
    set({ connRunning: true })
    try {
      const connResult = await ipc.connRun(connSelectedId, connSql)
      // A failed query still tells us the connection is unreachable vs merely
      // wrong, so only a transport-level failure flips the status dot.
      set((st) => ({
        connResult,
        connStatus: connResult.missing_tool
          ? { ...st.connStatus, [connSelectedId]: 'bad' }
          : st.connStatus,
      }))
    } catch (e) {
      set({
        connResult: {
          columns: [], rows: [], row_count: 0, truncated: false, ms: 0,
          error: String(e), missing_tool: '',
        },
      })
    } finally {
      set({ connRunning: false })
    }
  },
  testConnection: async (id) => {
    set((st) => ({ connStatus: { ...st.connStatus, [id]: 'testing' } }))
    try {
      const r = await ipc.connTest(id)
      set((st) => ({ connStatus: { ...st.connStatus, [id]: r.error ? 'bad' : 'ok' } }))
      if (r.error) set({ connResult: r })
    } catch {
      set((st) => ({ connStatus: { ...st.connStatus, [id]: 'bad' } }))
    }
  },
  openConnEditor: (connEditing) => set({ connEditing }),
  closeConnEditor: () => set({ connEditing: null }),

  machinePkgs: [],
  machineWinget: [],
  machineScoop: [],
  machineAvail: { winget: true, scoop: true },
  machineLoading: false,
  machineLoadedAt: 0,

  loadMachine: async (seed, force = false) => {
    if (get().machineLoading) return
    if (get().machineLoadedAt > 0 && !force) return
    set({ machineLoading: true })
    try {
      // Seeding is INSERT OR IGNORE, so it also picks up newly-shipped
      // packages on an existing install.
      await ipc.machinePackagesSeed(seed).catch(() => 0)
      await get().refreshMachinePkgs()
      const s = await ipc.machineStatus()
      set({
        machineWinget: s.winget.map((x) => x.toLowerCase()),
        machineScoop: s.scoop.map((x) => x.toLowerCase()),
        machineAvail: { winget: s.winget_available, scoop: s.scoop_available },
        machineLoadedAt: Date.now(),
      })
    } catch (e) {
      console.error('machine status failed', e)
      // Mark it loaded anyway: a failed probe shouldn't re-run the slow path
      // on every remount. Refresh is one click away.
      set({ machineLoadedAt: Date.now() })
    } finally {
      set({ machineLoading: false })
    }
  },
  refreshMachinePkgs: async () => {
    try {
      set({ machinePkgs: await ipc.machinePackagesList() })
    } catch (e) {
      console.error(e)
    }
  },

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
  setTheme: async (t) => {
    set({ theme: t })
    document.documentElement.dataset.theme = t
    await ipc.settingSet('app_theme', t)
  },
  setRailView: (v) => {
    localStorage.setItem(RAIL_KEY, v)
    set({ railView: v })
  },
  openSheet: (s) => set({ sheet: s }),
  closeSheet: () => set({ sheet: null }),
  showBottom: (tab) => {
    localStorage.setItem('devdeck.bottom.tab', tab)
    localStorage.setItem('devdeck.bottom.collapsed', '0')
    set({ bottomTab: tab, bottomCollapsed: false })
  },
  setBottomTab: (tab) => {
    localStorage.setItem('devdeck.bottom.tab', tab)
    set({ bottomTab: tab })
  },
  setBottomCollapsed: (collapsed) => {
    localStorage.setItem('devdeck.bottom.collapsed', collapsed ? '1' : '0')
    set({ bottomCollapsed: collapsed })
  },
  focusServiceLogs: (name) =>
    set((st) => ({ logFocus: { name, n: (st.logFocus?.n ?? 0) + 1 } })),
  searchLogs: (term) => {
    get().showBottom('logs')
    set((st) => ({ logFocus: { name: 'all', search: term, n: (st.logFocus?.n ?? 0) + 1 } }))
  },
}))
