// Dedicated full-window editor page for a single service. Opened as a
// main-area tab from the Services side panel.

import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../../lib/ipc'
import type { ServiceDef } from '../../lib/types'
import { useApp } from '../../store'
import { nodeLabel, ownerNodes, serviceDir } from '../../lib/tree'
import { EditorShell, Field, Row } from './EditorShell'
import { ShellSelect } from './ShellSelect'

type Params = { id: number; projectId?: number | null }

const blank = (ownerId: number | null): ServiceDef => ({
  id: 0,
  project_id: ownerId,
  name: '',
  command: '',
  cwd: '',
  env: '{}',
  auto_restart: false,
  health_port: null,
  shell: '',
})

export function ServiceEditorPage(props: IDockviewPanelProps<Params>) {
  const { services, nodes, refreshServices, selectedNode } = useApp()
  const id = props.params.id
  const owners = useMemo(() => ownerNodes(nodes), [nodes])

  const initial = useMemo(() => {
    if (id > 0) return services.find((s) => s.id === id) ?? null
    return blank(props.params.projectId ?? selectedNode()?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const [svc, setSvc] = useState<ServiceDef | null>(initial)

  // Env is stored as a JSON object string; edit it as KEY=value lines.
  // Must stay above the early return below — hooks can't run conditionally.
  const envText = useMemo(() => {
    try {
      const obj = JSON.parse(svc?.env || '{}') as Record<string, string>
      return Object.entries(obj)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    } catch {
      return ''
    }
  }, [svc?.env])

  if (!svc) {
    return <div className="p-6 text-slate-500">Service not found (it may have been deleted).</div>
  }
  const set = (patch: Partial<ServiceDef>) => setSvc((s) => ({ ...s!, ...patch }))

  const pickDir = async () => {
    const dir = await openDialog({ directory: true, title: 'Working directory' })
    if (typeof dir === 'string') set({ cwd: dir })
  }

  const setEnvFromText = (text: string) => {
    const obj: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const i = line.indexOf('=')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    set({ env: JSON.stringify(obj) })
  }

  const save = async () => {
    if (!svc.name.trim() || !svc.command.trim()) return
    await ipc.serviceSave(svc)
    await refreshServices()
    props.api.close()
  }

  const remove = async () => {
    if (!confirm(`Delete service "${svc.name}"?`)) return
    await ipc.serviceDelete(svc.id)
    await refreshServices()
    props.api.close()
  }

  return (
    <EditorShell
      icon="⚡"
      kind="Service"
      title={id > 0 ? svc.name || 'Service' : 'New service'}
      subtitle="A long-running dev process DevDeck starts, monitors, and logs."
      onCancel={() => props.api.close()}
      onSave={() => void save()}
      canSave={!!svc.name.trim() && !!svc.command.trim()}
      onDelete={id > 0 ? () => void remove() : undefined}
    >
      <Row>
        <Field label="Name">
          <input className="input w-full" value={svc.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Belongs to">
          <select
            className="input w-full"
            value={svc.project_id ?? ''}
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
      <Field label="Command">
        <input
          className="input w-full font-mono"
          placeholder="e.g. npm run dev"
          value={svc.command}
          onChange={(e) => set({ command: e.target.value })}
        />
      </Field>
      <Field label="Run with">
        <ShellSelect value={svc.shell} onChange={(v) => set({ shell: v })} defaultLabel="Default (cmd.exe)" />
      </Field>
      <Row>
        <Field label="Working directory (empty = the location's folder)">
          <div className="flex gap-1">
            <input
              className="input w-full"
              placeholder="inherits the project/folder directory"
              value={svc.cwd}
              onChange={(e) => set({ cwd: e.target.value })}
            />
            <button className="btn-ghost shrink-0" onClick={() => void pickDir()} title="Browse">
              …
            </button>
            <button
              className="btn-ghost shrink-0"
              title={serviceDir(nodes, svc) ? `Reveal in File Explorer\n${serviceDir(nodes, svc)}` : 'Set a working directory or a location first'}
              disabled={!serviceDir(nodes, svc)}
              onClick={() => void ipc.revealInExplorer(serviceDir(nodes, svc)).catch((e) => alert(String(e)))}
            >
              📂
            </button>
          </div>
        </Field>
        <Field label="Port (health check)">
          <input
            className="input w-full"
            placeholder="e.g. 3000"
            value={svc.health_port ?? ''}
            onChange={(e) => set({ health_port: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
      </Row>
      <Field label="Environment (KEY=value per line)">
        <textarea
          className="input h-24 w-full font-mono"
          placeholder={'NODE_ENV=development\nPORT=3000'}
          value={envText}
          onChange={(e) => setEnvFromText(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] text-slate-400">
        <input
          type="checkbox"
          checked={svc.auto_restart}
          onChange={(e) => set({ auto_restart: e.target.checked })}
        />
        Auto-restart on crash
      </label>
    </EditorShell>
  )
}
