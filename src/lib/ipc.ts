// Typed wrappers around the Tauri IPC surface. One place to see the
// whole backend API.

import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CommandDef,
  DetectedCommand,
  LayoutDef,
  LogEntry,
  ProcStat,
  ProfileDef,
  PtyInfo,
  Recent,
  ServiceDef,
  ShellDef,
  Activity,
  ConnDef,
  ServiceRun,
  QueryResult,
  QueryRun,
  SavedQuery,
  StashCounts,
  StashEdit,
  StashItem,
  StashQuery,
  StashStatus,
  TagCount,
  SvcState,
  TreeNode,
} from './types'

// ---- tree ----
export const treeList = () => invoke<TreeNode[]>('tree_list')
export const nodeCreate = (
  parentId: number | null,
  kind: string,
  name: string,
  path?: string | null,
  relPath?: string | null,
) => invoke<TreeNode>('node_create', { parentId, kind, name, path: path ?? null, relPath: relPath ?? null })
export const nodeRename = (id: number, name: string) => invoke<void>('node_rename', { id, name })
export const nodeUpdate = (
  id: number,
  fields: { name?: string; path?: string; relPath?: string; color?: string },
) =>
  invoke<void>('node_update', {
    id,
    name: fields.name ?? null,
    path: fields.path ?? null,
    relPath: fields.relPath ?? null,
    color: fields.color ?? null,
  })
export const nodeDelete = (id: number) => invoke<void>('node_delete', { id })

// ---- commands ----
export const commandsList = () => invoke<CommandDef[]>('commands_list')
export const commandSave = (cmd: CommandDef) => invoke<number>('command_save', { cmd })
export const scanProject = (dir: string) => invoke<DetectedCommand[]>('scan_project', { dir })
export const commandDelete = (id: number) => invoke<void>('command_delete', { id })

// ---- services ----
export const servicesList = () => invoke<ServiceDef[]>('services_list')
export const serviceSave = (svc: ServiceDef) => invoke<number>('service_save', { svc })
export const serviceDelete = (id: number) => invoke<void>('service_delete', { id })
export const svcStart = (id: number) => invoke<SvcState>('svc_start', { id })
export const svcStop = (id: number) => invoke<void>('svc_stop', { id })
export const svcRestart = (id: number) => invoke<void>('svc_restart', { id })
export const svcStates = () => invoke<SvcState[]>('svc_states')
export const runBackground = (name: string, command: string, cwd: string, shell?: string) =>
  invoke<SvcState>('run_background', { name, command, cwd, shell: shell ?? null })

// ---- profiles ----
export const profilesList = () => invoke<ProfileDef[]>('profiles_list')
export const profileSave = (profile: ProfileDef) => invoke<number>('profile_save', { profile })
export const profileDelete = (id: number) => invoke<void>('profile_delete', { id })

// ---- machine setup ----
export interface MachineStatus {
  winget: string[]
  scoop: string[]
  scoop_available: boolean
  winget_available: boolean
}
export interface InstallItem {
  id: string
  source: string
}
export interface ManifestPackage {
  id: string
  source: string
  elevate?: boolean
}
export interface Manifest {
  name: string
  version: number
  packages: ManifestPackage[]
  steps: unknown[]
  repos: unknown[]
}
export const machineStatus = () => invoke<MachineStatus>('machine_status')
export const machineInstall = (items: InstallItem[]) => invoke<void>('machine_install', { items })
export const machineInstallScoop = () => invoke<void>('machine_install_scoop')
export const machineSnapshot = (name: string, known: InstallItem[]) =>
  invoke<Manifest>('machine_snapshot', { name, known })
export const machineExport = (path: string, manifest: Manifest) =>
  invoke<void>('machine_export', { path, manifest })
export const machineImport = (path: string) => invoke<Manifest>('machine_import', { path })
export const machineShow = (id: string, source: string) => invoke<string>('machine_show', { id, source })
export const machineInstallPreview = (id: string, source: string) =>
  invoke<string>('machine_install_preview', { id, source })

// The editable, DB-backed catalog (curated packages seeded on first run).
export interface MachinePackage {
  id: string
  name: string
  source: string
  category: string
  blurb: string
  elevate: boolean
  custom: boolean
  hidden: boolean
  sort: number
}
export const machinePackagesList = () => invoke<MachinePackage[]>('machine_packages_list')
export const machinePackagesSeed = (packages: MachinePackage[]) =>
  invoke<number>('machine_packages_seed', { packages })
export const machinePackageSave = (pkg: MachinePackage) => invoke<void>('machine_package_save', { pkg })
export const machinePackageDelete = (id: string) => invoke<void>('machine_package_delete', { id })

export interface MachineItemEvent {
  id: string
  status: 'installing' | 'ok' | 'failed'
}
export function onMachineItem(cb: (e: MachineItemEvent) => void): Promise<UnlistenFn> {
  return listen<MachineItemEvent>('machine:item', (e) => cb(e.payload))
}
export function onMachineDone(cb: () => void): Promise<UnlistenFn> {
  return listen('machine:done', () => cb())
}

// ---- project setup ----
export interface RequiredTool {
  binary: string
  name: string
  pkg_id: string
  source: string
  installed: boolean
}
export interface SetupStep {
  label: string
  run: string
  done: boolean
}
export interface ProjectSetup {
  tools: RequiredTool[]
  steps: SetupStep[]
  ready: boolean
}
export const detectProjectSetup = (dir: string) => invoke<ProjectSetup>('detect_project_setup', { dir })
export const refreshPath = () => invoke<void>('refresh_path')
export const suggestInstall = (line: string) => invoke<RequiredTool | null>('suggest_install', { line })
export const runProjectSetup = (
  tools: { pkg_id: string; source: string }[],
  steps: string[],
  cwd: string,
) => invoke<void>('run_project_setup', { tools, steps, cwd })
export function onSetupDone(cb: (ok: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>('setup:done', (e) => cb(e.payload))
}
export const cloneRepo = (url: string, parent: string) => invoke<string>('clone_repo', { url, parent })

// ---- git ----
export interface GitInfo {
  is_repo: boolean
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}
/** Branch + ahead/behind from local refs — no network. */
export const gitInfo = (dir: string) => invoke<GitInfo>('git_info', { dir })
/** Quiet non-interactive fetch, then fresh status (learns what's to pull). */
export const gitFetch = (dir: string) => invoke<GitInfo>('git_fetch', { dir })
/** Fast-forward pull, streaming to Logs; emits git:done when finished. */
export const gitPull = (dir: string) => invoke<void>('git_pull', { dir })
export function onGitDone(cb: (ok: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>('git:done', (e) => cb(e.payload))
}

// ---- layouts ----
export const layoutsList = () => invoke<LayoutDef[]>('layouts_list')
export const layoutSave = (name: string, data: string) => invoke<void>('layout_save', { name, data })
export const layoutDelete = (id: number) => invoke<void>('layout_delete', { id })

// ---- settings ----
export const settingGet = (key: string) => invoke<string | null>('setting_get', { key })
export const settingSet = (key: string, value: string) => invoke<void>('setting_set', { key, value })
export const hotkeyApply = (spec: string) => invoke<void>('hotkey_apply', { spec })
export const shellsDetect = () => invoke<ShellDef[]>('shells_detect')
export const revealInExplorer = (path: string) => invoke<void>('reveal_in_explorer', { path })
export const openUrl = (url: string) => invoke<void>('open_url', { url })

// ---- example workspace ----
/** Writes the demo project to disk and seeds it; returns the new project id. */
export const seedExample = () => invoke<number>('seed_example')
export const exampleExists = () => invoke<boolean>('example_exists')

// ---- widget window ----
export const widgetToggle = () => invoke<void>('widget_toggle')
export const widgetShow = () => invoke<void>('widget_show')
export const widgetHide = () => invoke<void>('widget_hide')
export const widgetResize = (width: number, height: number) =>
  invoke<void>('widget_resize', { width, height })

export const focusMain = () => invoke<void>('focus_main')
/** Bring the widget into view without taking the keyboard. `sticky` keeps it
 *  up (a crash); otherwise it collapses itself after a few seconds. */
export const widgetPeek = (sticky = false) => invoke<void>('widget_peek_cmd', { sticky })

// ---- self-update ----
export interface UpdateInfo {
  /** False when the check couldn't reach the manifest — do NOT read that as
   *  "up to date". */
  ok: boolean
  current: string
  latest: string
  available: boolean
  via_scoop: boolean
  scoop_available: boolean
}
export const appUpdateInfo = () => invoke<UpdateInfo>('app_update_info')
export const appUpdate = () => invoke<void>('app_update')

// ---- recents ----
export const recentBump = (kind: 'command' | 'service', refId: number) =>
  invoke<void>('recent_bump', { kind, refId })
export const recentsList = () => invoke<Recent[]>('recents_list')

// ---- activity ----
export const activityList = (limit = 60) => invoke<Activity[]>('activity_list', { limit })
export const activityClear = () => invoke<void>('activity_clear')
/** Durable run history for one service: start, stop, duration, exit code. */
export const serviceRuns = (serviceId: number, limit = 25) =>
  invoke<ServiceRun[]>('service_runs', { serviceId, limit })
export function onActivity(cb: (a: Activity) => void): Promise<UnlistenFn> {
  return listen<Activity>('activity:new', (e) => cb(e.payload))
}

// ---- connections ----
export const connList = () => invoke<ConnDef[]>('conn_list')
export const connSave = (def: ConnDef) => invoke<number>('conn_save', { def })
export const connDelete = (id: number) => invoke<void>('conn_delete', { id })
/** Store a password in Windows Credential Manager. '' removes it. */
export const connSetPassword = (id: number, password: string) =>
  invoke<void>('conn_set_password', { id, password })
export const connClearPassword = (id: number) => invoke<void>('conn_clear_password', { id })
/** `select 1` against the connection — reachable or not, and why. */
export const connTest = (id: number) => invoke<QueryResult>('conn_test', { id })
export const connRun = (id: number, sql: string) => invoke<QueryResult>('conn_run', { id, sql })
export const connQueriesList = () => invoke<SavedQuery[]>('conn_queries_list')
export const connQuerySave = (query: SavedQuery) => invoke<number>('conn_query_save', { query })
export const connQueryDelete = (id: number) => invoke<void>('conn_query_delete', { id })
export const connRunsList = (connectionId: number, limit = 50) =>
  invoke<QueryRun[]>('conn_runs_list', { connectionId, limit })

// ---- stash ----
export const stashList = (q: Partial<StashQuery>) =>
  invoke<StashItem[]>('stash_list', {
    q: {
      query: q.query ?? '',
      filter: q.filter ?? 'all',
      item_type: q.item_type ?? '',
      tag: q.tag ?? '',
      project_id: q.project_id ?? null,
      no_project: q.no_project ?? false,
      limit: q.limit ?? 300,
    },
  })
/** Full row including `content` — the list omits it to stay small. */
export const stashGet = (id: number) => invoke<StashItem>('stash_get', { id })
/** Edit title / content / note. Rejects secret-shaped content with a reason. */
export const stashUpdate = (edit: StashEdit) => invoke<StashItem>('stash_update', { edit })
/** Write a note from scratch — an item that never touched the clipboard. */
export const stashCreateNote = (title: string, content: string) =>
  invoke<StashItem>('stash_create_note', { title, content })

// ---- stash tags ----
export const stashTagsList = () => invoke<TagCount[]>('stash_tags_list')
/** Each entry may itself be comma-separated, so one box can add several. */
export const stashTagAdd = (id: number, names: string[]) =>
  invoke<string[]>('stash_tag_add', { id, names })
export const stashTagRemove = (id: number, name: string) =>
  invoke<string[]>('stash_tag_remove', { id, name })
/** Remove a tag from every item at once. */
export const stashTagDelete = (tagId: number) => invoke<void>('stash_tag_delete', { tagId })
export const stashCounts = () => invoke<StashCounts>('stash_counts')
export const stashPin = (id: number, pinned: boolean) => invoke<void>('stash_pin', { id, pinned })
export const stashDelete = (id: number) => invoke<void>('stash_delete', { id })
/** Bump usage + arm the echo guard so copying doesn't re-capture the clip. */
export const stashMarkUsed = (id: number) => invoke<void>('stash_mark_used', { id })
/** Tell the capture thread which project it should stamp new clips with. */
export const stashSetContext = (
  projectId: number | null,
  projectName: string,
  workspaceName: string,
) => invoke<void>('stash_set_context', { projectId, projectName, workspaceName })
export const stashStatus = () => invoke<StashStatus>('stash_status')
export const stashSetEnabled = (enabled: boolean) => invoke<void>('stash_set_enabled', { enabled })
/** `toast` = show the capture toast · `auto_paste` = paste, don't just copy. */
export const stashSetOption = (key: 'toast' | 'auto_paste', value: boolean) =>
  invoke<void>('stash_set_option', { key, value })
/** Prune now using the saved window. Resolves with the number removed. */
export const stashPrune = () => invoke<number>('stash_prune')
/** Open a linked screenshot in the default image viewer. */
export const stashOpenFile = (id: number) => invoke<void>('stash_open_file', { id })
/** Save a retention window (days; 0 = forever) and apply it immediately. */
export const stashSetRetention = (days: number) => invoke<number>('stash_set_retention', { days })
export function onStashItem(cb: (item: StashItem) => void): Promise<UnlistenFn> {
  return listen<StashItem>('stash:item', (e) => cb(e.payload))
}
/** A screenshot landed in the watched folder and was stashed. */
export function onStashShot(cb: () => void): Promise<UnlistenFn> {
  return listen('stash:shot', () => cb())
}

// ---- stash copy / paste ----
export interface PasteResult {
  copied: boolean
  /** True only when the keystroke really reached another window — a false
   *  here is "it's on your clipboard", never a pretend paste. */
  pasted: boolean
}
/** Write a clip to the clipboard from the backend. Works from an unfocused
 *  window, unlike the webview's clipboard API. */
export const stashCopy = (id: number) => invoke<void>('stash_copy', { id })
/** Copy, and paste into the app you came from when auto-paste is on (or when
 *  `force` — that's ⇧⏎, an explicit ask). */
export const stashPaste = (id: number, force = false) =>
  invoke<PasteResult>('stash_paste', { id, force })
/** Snapshot the foreground window before DevDeck takes focus. */
export const stashRememberTarget = () => invoke<void>('stash_remember_target')

// ---- capture toast window ----
export const toastShow = (width: number, height: number) =>
  invoke<void>('toast_show', { width, height })
export const toastHide = () => invoke<void>('toast_hide')
export const toastFocus = () => invoke<void>('toast_focus')

/** Another window changed a stash item — tell whoever is displaying them. */
export const emitStashChanged = () => emit('devdeck:stash-changed', {})
export function onStashChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('devdeck:stash-changed', () => cb())
}

// ---- cross-window: app tour (widget drives the main window) ----
export type TourAction = 'workspace' | 'project' | 'command' | 'service' | 'profile' | 'open-main'
export const emitTourAction = (action: TourAction) =>
  emit('devdeck:tour-action', { action })
export function onTourAction(cb: (action: TourAction) => void): Promise<UnlistenFn> {
  return listen<{ action: TourAction }>('devdeck:tour-action', (e) => cb(e.payload.action))
}

// ---- cross-window: data changed (so the other window can refresh) ----
export const emitDataChanged = () => emit('devdeck:data-changed', {})
export function onDataChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('devdeck:data-changed', () => cb())
}

// ---- cross-window: widget asks the main IDE to open a terminal panel ----
export interface OpenTerminalReq {
  ptyId: number
  title: string
}
export const emitOpenTerminal = (ptyId: number, title: string) =>
  emit('devdeck:open-terminal', { ptyId, title } satisfies OpenTerminalReq)
export function onOpenTerminal(cb: (e: OpenTerminalReq) => void): Promise<UnlistenFn> {
  return listen<OpenTerminalReq>('devdeck:open-terminal', (e) => cb(e.payload))
}

// ---- pty ----
export const ptyCreate = (shell: string, cwd?: string | null, title?: string | null) =>
  invoke<PtyInfo>('pty_create', { shell, cwd: cwd ?? null, title: title ?? null })
export const ptyWrite = (id: number, data: string) => invoke<void>('pty_write', { id, data })
export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>('pty_resize', { id, cols, rows })
export const ptyKill = (id: number) => invoke<void>('pty_kill', { id })
export const ptyScrollback = (id: number) => invoke<string>('pty_scrollback', { id })
export const ptyList = () => invoke<PtyInfo[]>('pty_list')

// ---- logs ----
export const logsRecent = (limit?: number) => invoke<LogEntry[]>('logs_recent', { limit: limit ?? null })
export const logsClear = () => invoke<void>('logs_clear')
export const logsExport = (path: string) => invoke<number>('logs_export', { path })

// ---- events ----
export interface PtyOutputEvent {
  id: number
  data: string
}

export function onPtyOutput(cb: (e: PtyOutputEvent) => void): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>('pty:output', (e) => cb(e.payload))
}
export function onPtyExit(cb: (e: { id: number }) => void): Promise<UnlistenFn> {
  return listen<{ id: number }>('pty:exit', (e) => cb(e.payload))
}
export function onSvcLog(cb: (e: LogEntry) => void): Promise<UnlistenFn> {
  return listen<LogEntry>('svc:log', (e) => cb(e.payload))
}
export function onSvcStatus(cb: (e: SvcState) => void): Promise<UnlistenFn> {
  return listen<SvcState>('svc:status', (e) => cb(e.payload))
}
export function onStats(cb: (e: ProcStat[]) => void): Promise<UnlistenFn> {
  return listen<ProcStat[]>('stats:update', (e) => cb(e.payload))
}
