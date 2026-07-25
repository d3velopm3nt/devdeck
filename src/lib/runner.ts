// Execution strategies: run saved commands in a new terminal, an
// existing terminal, or as a background process; launch profiles.

import * as ipc from './ipc'
import type { CommandDef, ProfileDef, ProfileStep } from './types'
import { openTerminalPanel, restoreLayout } from './dock'
import { findNode, resolveDir } from './tree'
import { useApp } from '../store'

const DEFAULT_SHELL = () => {
  const shells = useApp.getState().shells
  return shells.find((s) => s.name === 'PowerShell 7')?.command ?? shells[0]?.command ?? 'powershell.exe'
}

/// A command's own cwd, else the resolved directory of the project/folder
/// it belongs to.
function commandCwd(cmd: CommandDef): string {
  if (cmd.cwd.trim() !== '') return cmd.cwd
  const { nodes } = useApp.getState()
  return resolveDir(nodes, findNode(nodes, cmd.project_id))
}

export async function openTerminal(shell?: string, cwd?: string, title?: string): Promise<number> {
  const info = await ipc.ptyCreate(shell ?? DEFAULT_SHELL(), cwd ?? null, title ?? null)
  await useApp.getState().refreshTerminals()
  openTerminalPanel(info.id, info.title)
  return info.id
}

export async function runCommandInNewTerminal(cmd: CommandDef) {
  if (cmd.id > 0) void ipc.recentBump('command', cmd.id)
  const shell = cmd.shell.trim() !== '' ? cmd.shell : DEFAULT_SHELL()
  const id = await openTerminal(shell, commandCwd(cmd), cmd.name)
  injectWhenReady(id, cmd.command)
}

/// Type a command into a freshly-spawned shell only once it has printed its
/// prompt — writing before the ConPTY/PSReadLine is ready drops the first
/// keystroke (so `npx …` would run as `px …`). The leading space is a second
/// safety net: it's ignored by cmd/PowerShell/bash, and absorbs a lost char.
function injectWhenReady(ptyId: number, command: string) {
  let done = false
  let unlisten: (() => void) | null = null
  const timer = setTimeout(fire, 1500) // fallback if no prompt output arrives
  function fire() {
    if (done) return
    done = true
    clearTimeout(timer)
    unlisten?.()
    void ipc.ptyWrite(ptyId, ' ' + command + '\r')
  }
  void ipc.onPtyOutput((e) => {
    if (e.id === ptyId && !done) {
      // Prompt seen — give the shell a beat to finish initializing, then type.
      setTimeout(fire, 180)
    }
  }).then((un) => {
    unlisten = un
    if (done) un()
  })
}

export async function runCommandInTerminal(cmd: CommandDef, ptyId: number) {
  if (cmd.id > 0) void ipc.recentBump('command', cmd.id)
  await ipc.ptyWrite(ptyId, cmd.command + '\r')
}

export async function runCommandInBackground(cmd: CommandDef) {
  if (cmd.id > 0) void ipc.recentBump('command', cmd.id)
  await ipc.runBackground(cmd.name, cmd.command, commandCwd(cmd), cmd.shell || undefined)
}

export async function launchProfile(profile: ProfileDef) {
  let steps: ProfileStep[] = []
  try {
    steps = JSON.parse(profile.steps) as ProfileStep[]
  } catch {
    return
  }
  const state = useApp.getState()
  for (const step of steps) {
    try {
      if (step.type === 'service') {
        await ipc.svcStart(step.id)
      } else if (step.type === 'command') {
        const cmd = state.commands.find((c) => c.id === step.id)
        if (cmd) await runCommandInNewTerminal(cmd)
      } else if (step.type === 'terminal') {
        await openTerminal(step.shell || undefined, step.cwd || undefined)
      } else if (step.type === 'layout') {
        const layout = state.layouts.find((l) => l.id === step.id)
        if (layout) restoreLayout(layout.data)
      }
    } catch (e) {
      console.error('profile step failed', step, e)
    }
  }
}
