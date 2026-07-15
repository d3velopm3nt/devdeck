// Setup page (main-window tab) for a project or folder.
//   Project → configure its base path (the repo/app root).
//   Folder  → configure its subpath (relative to the project base path)
//             with an optional absolute-path override.

import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { findNode, projectOf, resolveDir } from '../../lib/tree'
import { EditorShell, Field } from './EditorShell'
import { openTerminal } from '../../lib/runner'

type Params = { id: number }

export function NodeSetupPage(props: IDockviewPanelProps<Params>) {
  const { nodes, refreshTree } = useApp()
  const id = props.params.id
  const node = useMemo(() => findNode(nodes, id), [nodes, id])

  const [name, setName] = useState(node?.name ?? '')
  const [path, setPath] = useState(node?.path ?? '')
  const [relPath, setRelPath] = useState(node?.rel_path ?? '')

  if (!node) {
    return <div className="p-6 text-slate-500">This item no longer exists.</div>
  }
  const isProject = node.kind === 'project'
  const project = projectOf(nodes, node)

  // Live preview of the resolved directory using the edited values.
  const preview = resolveDir(nodes, { ...node, name, path, rel_path: relPath })

  const browse = async (setter: (v: string) => void, title: string) => {
    const dir = await openDialog({ directory: true, title })
    if (typeof dir === 'string') setter(dir)
  }

  const save = async () => {
    if (!name.trim()) return
    await ipc.nodeUpdate(id, { name: name.trim(), path, relPath })
    await refreshTree()
    props.api.close()
  }

  return (
    <EditorShell
      icon={isProject ? '▣' : '▤'}
      kind={isProject ? 'Project' : 'Folder'}
      title={name || (isProject ? 'Project' : 'Folder')}
      subtitle={
        isProject
          ? 'An app / repository root. Its folders and commands resolve under this base path.'
          : 'A location inside the project. Commands and services here run in its directory.'
      }
      onCancel={() => props.api.close()}
      onSave={() => void save()}
      canSave={!!name.trim()}
      extraActions={
        preview ? (
          <button className="btn-ghost" title="Open a terminal here" onClick={() => void openTerminal(undefined, preview)}>
            ❯ Terminal
          </button>
        ) : null
      }
    >
      <Field label="Name">
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      {isProject ? (
        <Field label="Base path (repo / app root)">
          <div className="flex gap-1">
            <input
              className="input w-full font-mono"
              placeholder="C:\code\my-app"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <button className="btn-ghost shrink-0" onClick={() => void browse(setPath, 'Project base path')}>
              …
            </button>
          </div>
        </Field>
      ) : (
        <>
          <Field label="Subpath (relative to project base path)">
            <input
              className="input w-full font-mono"
              placeholder="apps/web-app"
              value={relPath}
              onChange={(e) => setRelPath(e.target.value)}
            />
          </Field>
          <div className="text-[11px] text-slate-500">
            Project base:{' '}
            <span className="font-mono text-slate-400">{project?.path || '(project has no base path yet)'}</span>
          </div>
          <Field label="Absolute path override (optional)">
            <div className="flex gap-1">
              <input
                className="input w-full font-mono"
                placeholder="leave empty to use base path + subpath"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
              <button className="btn-ghost shrink-0" onClick={() => void browse(setPath, 'Folder path')}>
                …
              </button>
            </div>
          </Field>
        </>
      )}

      <div className="rounded border border-slate-700 bg-[#151923] px-3 py-2 text-[12px]">
        <span className="text-slate-500">Resolves to: </span>
        <span className="font-mono text-emerald-400">{preview || '(no directory)'}</span>
      </div>
    </EditorShell>
  )
}
