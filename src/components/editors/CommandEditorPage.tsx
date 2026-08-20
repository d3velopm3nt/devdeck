// Dedicated full-window editor page for a single command. Opened as a
// main-area tab from the Commands side panel (row click = edit,
// + New = create). Save refreshes the list and closes the tab.

import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../../lib/ipc'
import type { CommandDef } from '../../lib/types'
import { useApp } from '../../store'
import { runCommandInNewTerminal } from '../../lib/runner'
import { openEditor } from '../../lib/dock'
import { nodeLabel, ownerNodes } from '../../lib/tree'
import { EditorShell, Field, Row } from './EditorShell'
import { ShellSelect } from './ShellSelect'

type Params = { id: number; projectId?: number | null }

const blank = (ownerId: number | null): CommandDef => ({
  id: 0,
  project_id: ownerId,
  group_name: '',
  name: '',
  command: '',
  cwd: '',
  shell: '',
  sort: 0,
})

export function CommandEditorPage(props: IDockviewPanelProps<Params>) {
  const { commands, nodes, refreshCommands, refreshServices, selectedNode } = useApp()
  const id = props.params.id
  const owners = useMemo(() => ownerNodes(nodes), [nodes])

  const initial = useMemo(() => {
    if (id > 0) return commands.find((c) => c.id === id) ?? null
    return blank(props.params.projectId ?? selectedNode()?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const [cmd, setCmd] = useState<CommandDef | null>(initial)
  if (!cmd) {
    return <div className="p-6 text-slate-500">Command not found (it may have been deleted).</div>
  }
  const set = (patch: Partial<CommandDef>) => setCmd((c) => ({ ...c!, ...patch }))

  // Duplicate = another command in the same owner that runs the exact same
  // line. We key on the command, not the name, so you can't keep two copies
  // under different names.
  const trimmedCmd = cmd.command.trim()
  const dup = trimmedCmd
    ? commands.find(
        (c) => c.id !== cmd.id && c.project_id === cmd.project_id && c.command.trim() === trimmedCmd,
      )
    : undefined

  const pickDir = async () => {
    const dir = await openDialog({ directory: true, title: 'Working directory' })
    if (typeof dir === 'string') set({ cwd: dir })
  }

  const save = async () => {
    if (!cmd.name.trim() || !cmd.command.trim() || dup) return
    await ipc.commandSave(cmd)
    await refreshCommands()
    props.api.close()
  }

  const remove = async () => {
    if (!confirm(`Delete command "${cmd.name}"?`)) return
    await ipc.commandDelete(cmd.id)
    await refreshCommands()
    props.api.close()
  }

  // Convert this command into a supervised service, carrying over the shared
  // fields. Command-only settings (the Group) are dropped.
  const convertToService = async () => {
    if (!cmd.name.trim() || !cmd.command.trim()) return
    if (
      !confirm(
        `Convert command “${cmd.name}” into a service?\n\nIt will become a supervised background process (start/stop, logs, restart) instead of running in a terminal. The Group field isn't used by services.`,
      )
    )
      return
    const newId = await ipc.serviceSave({
      id: 0,
      project_id: cmd.project_id,
      name: cmd.name,
      command: cmd.command,
      cwd: cmd.cwd,
      env: '{}',
      auto_restart: false,
      health_port: null,
      shell: cmd.shell,
    })
    await ipc.commandDelete(cmd.id)
    await Promise.all([refreshCommands(), refreshServices()])
    props.api.close()
    openEditor('service', newId, cmd.name || 'Service')
  }

  return (
    <EditorShell
      icon="⌘"
      kind="Command"
      title={id > 0 ? cmd.name || 'Command' : 'New command'}
      subtitle="Runs in a new terminal, an existing terminal, or the background."
      onCancel={() => props.api.close()}
      onSave={() => void save()}
      canSave={!!cmd.name.trim() && !!cmd.command.trim() && !dup}
      onDelete={id > 0 ? () => void remove() : undefined}
      extraActions={
        id > 0 && (
          <>
            <button
              className="btn-ghost"
              onClick={() => void runCommandInNewTerminal(cmd)}
              title="Run in a new terminal"
            >
              ▶ Run
            </button>
            <button
              className="btn-ghost"
              onClick={() => void convertToService()}
              title="Turn this command into a supervised service"
            >
              ⚡ Convert to service
            </button>
          </>
        )
      }
    >
      <Row>
        <Field label="Name">
          <input className="input w-full" value={cmd.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Group">
          <input
            className="input w-full"
            placeholder="e.g. Build, Dev, Test"
            value={cmd.group_name}
            onChange={(e) => set({ group_name: e.target.value })}
          />
        </Field>
      </Row>
      <Field label="Command">
        <input
          className={`input w-full font-mono ${dup ? 'border-amber-500/60' : ''}`}
          placeholder="e.g. npm run dev"
          value={cmd.command}
          onChange={(e) => set({ command: e.target.value })}
        />
        {dup && (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-amber-400">
            <span>Duplicate — “{dup.name}” already runs this exact command here.</span>
            <button
              className="rounded border border-amber-500/40 px-1.5 py-px text-amber-300 hover:bg-amber-500/15"
              onClick={() => openEditor('command', dup.id, dup.name || 'Command')}
            >
              Edit it
            </button>
          </div>
        )}
      </Field>
      <Row>
        <Field label="Working directory (empty = the location's folder)">
          <div className="flex gap-1">
            <input
              className="input w-full"
              placeholder="inherits the project/folder directory"
              value={cmd.cwd}
              onChange={(e) => set({ cwd: e.target.value })}
            />
            <button className="btn-ghost shrink-0" onClick={() => void pickDir()} title="Browse">
              …
            </button>
          </div>
        </Field>
        <Field label="Belongs to">
          <select
            className="input w-full"
            value={cmd.project_id ?? ''}
            onChange={(e) => set({ project_id: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Global</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {nodeLabel(nodes, o)}
              </option>
            ))}
          </select>
        </Field>
      </Row>
      <Field label="Run with">
        <ShellSelect value={cmd.shell} onChange={(v) => set({ shell: v })} defaultLabel="Default (PowerShell)" />
      </Field>
    </EditorShell>
  )
}
