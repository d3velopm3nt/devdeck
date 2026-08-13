// Setup page (main-window tab) for a project or folder.
//   Project → configure its base path (the repo/app root) and scan the repo
//             for runnable scripts (npm/pnpm/cargo/…) to add as commands.
//   Folder  → configure its subpath (relative to the project base path)
//             with an optional absolute-path override.

import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { findNode, projectOf, resolveDir } from '../../lib/tree'
import { pmBadge } from '../../lib/pm'
import type { DetectedCommand } from '../../lib/types'
import { EditorShell, Field } from './EditorShell'
import { openTerminal } from '../../lib/runner'

type Params = { id: number }

export function NodeSetupPage(props: IDockviewPanelProps<Params>) {
  const { nodes, commands, refreshTree, refreshCommands } = useApp()
  const id = props.params.id
  const node = useMemo(() => findNode(nodes, id), [nodes, id])

  const [name, setName] = useState(node?.name ?? '')
  const [path, setPath] = useState(node?.path ?? '')
  const [relPath, setRelPath] = useState(node?.rel_path ?? '')

  // Repo-scan state.
  const [scan, setScan] = useState<DetectedCommand[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState<string | null>(null)

  if (!node) {
    return <div className="p-6 text-slate-500">This item no longer exists.</div>
  }
  const isProject = node.kind === 'project'
  const project = projectOf(nodes, node)

  // Live preview of the resolved directory using the edited values.
  const preview = resolveDir(nodes, { ...node, name, path, rel_path: relPath })

  // Commands already on this project — used to de-dupe scan results.
  const existing = new Set(commands.filter((c) => c.project_id === node.id).map((c) => c.command))

  const browse = async (setter: (v: string) => void, title: string) => {
    const dir = await openDialog({ directory: true, title })
    if (typeof dir === 'string') setter(dir)
  }

  const runScan = async () => {
    const dir = preview || path
    if (!dir.trim()) return
    setScanning(true)
    setScanErr(null)
    try {
      const res = await ipc.scanProject(dir)
      setScan(res)
      // pre-select everything not already added
      setPicked(new Set(res.filter((r) => !existing.has(r.command)).map((r) => r.command)))
    } catch (e) {
      setScanErr(String(e))
      setScan([])
    } finally {
      setScanning(false)
    }
  }

  const toggle = (cmd: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(cmd)) n.delete(cmd)
      else n.add(cmd)
      return n
    })

  const addSelected = async () => {
    const toAdd = (scan ?? []).filter((r) => picked.has(r.command) && !existing.has(r.command))
    for (const r of toAdd) {
      await ipc.commandSave({
        id: 0,
        project_id: node.id,
        group_name: r.group,
        name: r.name,
        command: r.command,
        cwd: '',
        shell: '',
        sort: 0,
      })
    }
    await refreshCommands()
    setPicked(new Set())
  }

  const save = async () => {
    if (!name.trim()) return
    await ipc.nodeUpdate(id, { name: name.trim(), path, relPath })
    await refreshTree()
    props.api.close()
  }

  const newCount = (scan ?? []).filter((r) => !existing.has(r.command)).length

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
        <>
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

          {/* ---- Scan repo for scripts ---- */}
          <div className="rounded-lg border border-slate-700 bg-[#151923] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-slate-200">Scan repo for scripts</div>
                <div className="text-[11px] text-slate-500">
                  Detect npm / pnpm / cargo / make / … scripts and add them as commands. Re-scan any time to pick up new ones.
                </div>
              </div>
              <button
                className="btn-primary shrink-0 text-[12px]"
                disabled={!(preview || path).trim() || scanning}
                onClick={() => void runScan()}
              >
                {scanning ? 'Scanning…' : scan ? '↻ Re-scan' : '🔍 Scan'}
              </button>
            </div>

            {scanErr && <div className="mt-2 text-[11px] text-red-400">{scanErr}</div>}

            {scan &&
              (scan.length === 0 ? (
                <div className="mt-3 text-[11px] text-slate-500">No scripts found — check the base path points at the repo root.</div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <button className="hover:text-slate-200" onClick={() => setPicked(new Set(scan.filter((r) => !existing.has(r.command)).map((r) => r.command)))}>
                      Select new ({newCount})
                    </button>
                    <button className="hover:text-slate-200" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                    <span className="ml-auto">{picked.size} selected</span>
                  </div>

                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                    {scan.map((r) => {
                      const added = existing.has(r.command)
                      const on = picked.has(r.command)
                      const b = pmBadge(r.manager)
                      return (
                        <label
                          key={r.manager + '|' + r.command}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 ${added ? 'border-slate-800 opacity-50' : 'border-slate-700 hover:border-slate-600'}`}
                        >
                          <input type="checkbox" className="accent-indigo-500" disabled={added} checked={added || on} onChange={() => toggle(r.command)} />
                          {b && (
                            <span
                              className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold"
                              style={{ background: b.bg, color: b.color }}
                            >
                              {b.label}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-[12.5px] text-slate-200">{r.name}</span>
                            <span className="ml-2 font-mono text-[10.5px] text-slate-500">{r.command}</span>
                          </span>
                          {added && <span className="shrink-0 text-[10px] text-emerald-400">added</span>}
                        </label>
                      )
                    })}
                  </div>

                  <button className="btn-primary mt-1 text-[12px]" disabled={picked.size === 0} onClick={() => void addSelected()}>
                    Add {picked.size} command{picked.size === 1 ? '' : 's'}
                  </button>
                </div>
              ))}
          </div>
        </>
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
