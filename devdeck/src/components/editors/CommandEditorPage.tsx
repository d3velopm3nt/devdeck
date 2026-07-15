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
import { nodeLabel, ownerNodes } from '../../lib/tree'
import { EditorShell, Field, Row } from './EditorShell'

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
  const { commands, nodes, refreshCommands, selectedNode } = useApp()
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

  const pickDir = async () => {
    const dir = await openDialog({ directory: true, title: 'Working directory' })
    if (typeof dir === 'string') set({ cwd: dir })
  }

  const save = async () => {
    if (!cmd.name.trim() || !cmd.command.trim()) return
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

  return (
    <EditorShell
      icon="⌘"
      kind="Command"
      title={id > 0 ? cmd.name || 'Command' : 'New command'}
      subtitle="Runs in a new terminal, an existing terminal, or the background."
      onCancel={() => props.api.close()}
      onSave={() => void save()}
      canSave={!!cmd.name.trim() && !!cmd.command.trim()}
      onDelete={id > 0 ? () => void remove() : undefined}
      extraActions={
        id > 0 && (
          <button
            className="btn-ghost"
            onClick={() => void runCommandInNewTerminal(cmd)}
            title="Run in a new terminal"
          >
            ▶ Run
          </button>
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
          className="input w-full font-mono"
          placeholder="e.g. npm run dev"
          value={cmd.command}
          onChange={(e) => set({ command: e.target.value })}
        />
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
      <Field label="Shell override (optional)">
        <input
          className="input w-full font-mono"
          placeholder="empty = default shell"
          value={cmd.shell}
          onChange={(e) => set({ shell: e.target.value })}
        />
      </Field>
    </EditorShell>
  )
}
