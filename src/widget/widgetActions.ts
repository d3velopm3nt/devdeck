// Actions the Command Widget performs against the shared backend.
// Terminals opened from the widget render in the MAIN IDE window's dock
// (the widget is a compact launcher, not a terminal host), so we create
// the PTY here and ask the main window to attach a panel to it.

import * as ipc from '../lib/ipc'
import type { CommandDef, ServiceDef, TreeNode } from '../lib/types'
import { findNode, resolveDir } from '../lib/tree'
import { useApp } from '../store'

const defaultShell = (): string => {
  const shells = useApp.getState().shells
  return shells.find((s) => s.name === 'PowerShell 7')?.command ?? shells[0]?.command ?? 'powershell.exe'
}

function ownerDir(nodes: TreeNode[], ownerId: number | null): string {
  return resolveDir(nodes, findNode(nodes, ownerId))
}

/// Run a command from the widget as a background process — captured in
/// the log bus and tracked as a running "action" the widget can show.
/// Deliberately does NOT open or focus the main IDE window.
export async function widgetRunCommand(cmd: CommandDef) {
  const { nodes } = useApp.getState()
  if (cmd.id > 0) void ipc.recentBump('command', cmd.id)
  const cwd = cmd.cwd.trim() !== '' ? cmd.cwd : ownerDir(nodes, cmd.project_id)
  await ipc.runBackground(cmd.name, cmd.command, cwd)
}

/// Open an interactive terminal in the main IDE window (the explicit >_
/// action). This one does bring the IDE forward, since a terminal you
/// can't see is useless.
export async function widgetOpenTerminal(dir: string, title: string) {
  const info = await ipc.ptyCreate(defaultShell(), dir || null, title)
  await ipc.emitOpenTerminal(info.id, info.title)
  await ipc.focusMain()
}

export async function widgetStartService(svc: ServiceDef) {
  await ipc.svcStart(svc.id)
}
export async function widgetStopService(svc: ServiceDef) {
  await ipc.svcStop(svc.id)
}
export async function widgetRestartService(svc: ServiceDef) {
  await ipc.svcRestart(svc.id)
}

/// Service working directory (for its terminal button).
export function serviceDir(nodes: TreeNode[], svc: ServiceDef): string {
  return svc.cwd.trim() !== '' ? svc.cwd : ownerDir(nodes, svc.project_id)
}
