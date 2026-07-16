// Typed wrappers around the Tauri IPC surface. One place to see the
// whole backend API.

import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
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
export const commandDelete = (id: number) => invoke<void>('command_delete', { id })

// ---- services ----
export const servicesList = () => invoke<ServiceDef[]>('services_list')
export const serviceSave = (svc: ServiceDef) => invoke<number>('service_save', { svc })
export const serviceDelete = (id: number) => invoke<void>('service_delete', { id })
export const svcStart = (id: number) => invoke<SvcState>('svc_start', { id })
export const svcStop = (id: number) => invoke<void>('svc_stop', { id })
export const svcRestart = (id: number) => invoke<void>('svc_restart', { id })
export const svcStates = () => invoke<SvcState[]>('svc_states')
export const runBackground = (name: string, command: string, cwd: string) =>
  invoke<SvcState>('run_background', { name, command, cwd })

// ---- profiles ----
export const profilesList = () => invoke<ProfileDef[]>('profiles_list')
export const profileSave = (profile: ProfileDef) => invoke<number>('profile_save', { profile })
export const profileDelete = (id: number) => invoke<void>('profile_delete', { id })

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

// ---- recents ----
export const recentBump = (kind: 'command' | 'service', refId: number) =>
  invoke<void>('recent_bump', { kind, refId })
export const recentsList = () => invoke<Recent[]>('recents_list')

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
