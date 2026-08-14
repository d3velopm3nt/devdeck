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
import { guessKind, pmBadge } from '../../lib/pm'
import type { DetectedCommand } from '../../lib/types'
import { EditorShell, Field } from './EditorShell'
import { openTerminal } from '../../lib/runner'

type Params = { id: number }

export function NodeSetupPage(props: IDockviewPanelProps<Params>) {
  const { nodes, commands, services, refreshTree, refreshCommands, refreshServices } = useApp()
  const id = props.params.id
  const node = useMemo(() => findNode(nodes, id), [nodes, id])

  const [name, setName] = useState(node?.name ?? '')
  const [path, setPath] = useState(node?.path ?? '')
  const [relPath, setRelPath] = useState(node?.rel_path ?? '')

  // Repo-scan state.
  const [scan, setScan] = useState<DetectedCommand[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Per-row chosen kind (command vs service), keyed by the detected command
  // string. Seeded from guessKind on scan; the user can flip each row.
  const [kinds, setKinds] = useState<Map<string, 'command' | 'service'>>(new Map())
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; updated: number; failed: number } | null>(null)

  if (!node) {
    return <div className="p-6 text-slate-500">This item no longer exists.</div>
  }
  const isProject = node.kind === 'project'
  const project = projectOf(nodes, node)

  // Live preview of the resolved directory using the edited values.
  const preview = resolveDir(nodes, { ...node, name, path, rel_path: relPath })

  // Existing commands/services on this project — used to de-dupe scan results by
  // both the exact command and the name. Status of a scanned row (relative to
  // its chosen kind):
  //   added   — identical command already exists in that bucket (skip)
  //   changed — same name exists but a different command (offer to override)
  //   new     — not present
  const projectCommands = commands.filter((c) => c.project_id === node.id)
  const projectServices = services.filter((s) => s.project_id === node.id)
  const byCommand = new Set(projectCommands.map((c) => c.command))
  const byName = new Map(projectCommands.map((c) => [c.name, c]))
  const svcByCommand = new Set(projectServices.map((s) => s.command))
  const svcByName = new Map(projectServices.map((s) => [s.name, s]))

  // The chosen kind for a row: an explicit user pick, else the heuristic guess.
  const kindOf = (r: DetectedCommand): 'command' | 'service' =>
    kinds.get(r.command) ?? guessKind(r.name, r.command)

  const rowStatus = (r: DetectedCommand): 'new' | 'added' | 'changed' => {
    if (kindOf(r) === 'service') {
      return svcByCommand.has(r.command) ? 'added' : svcByName.has(r.name) ? 'changed' : 'new'
    }
    return byCommand.has(r.command) ? 'added' : byName.has(r.name) ? 'changed' : 'new'
  }

  const setKind = (cmd: string, kind: 'command' | 'service') =>
    setKinds((prev) => new Map(prev).set(cmd, kind))

  const browse = async (setter: (v: string) => void, title: string) => {
    const dir = await openDialog({ directory: true, title })
    if (typeof dir === 'string') setter(dir)
  }

  const runScan = async () => {
    const dir = preview || path
    if (!dir.trim()) return
    setScanning(true)
    setScanErr(null)
    setResult(null)
    try {
      const res = await ipc.scanProject(dir)
      setScan(res)
      // Seed each row's kind from the heuristic (user can flip before adding).
      const guessed = new Map(res.map((r) => [r.command, guessKind(r.name, r.command)] as const))
      setKinds(guessed)
      // Pre-select only brand-new rows (existing / changed stay opt-in). Status
      // is kind-aware, so use the freshly-guessed kinds here.
      const statusWith = (r: DetectedCommand) => {
        if ((guessed.get(r.command) ?? 'command') === 'service') {
          return svcByCommand.has(r.command) ? 'added' : svcByName.has(r.name) ? 'changed' : 'new'
        }
        return byCommand.has(r.command) ? 'added' : byName.has(r.name) ? 'changed' : 'new'
      }
      setPicked(new Set(res.filter((r) => statusWith(r) === 'new').map((r) => r.command)))
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
    const rows = (scan ?? []).filter((r) => picked.has(r.command))
    let added = 0
    let updated = 0
    let failed = 0
    for (const r of rows) {
      const st = rowStatus(r)
      if (st === 'added') continue // identical — nothing to do
      try {
        if (kindOf(r) === 'service') {
          if (st === 'changed') {
            // Override the same-named service (keeps its id + settings).
            const ex = svcByName.get(r.name)!
            await ipc.serviceSave({ ...ex, command: r.command })
            updated++
          } else {
            await ipc.serviceSave({ id: 0, project_id: node.id, name: r.name, command: r.command, cwd: '', env: '', auto_restart: false, health_port: null, shell: '' })
            added++
          }
        } else if (st === 'changed') {
          // Override the existing command with the same name (keeps its id).
          const ex = byName.get(r.name)!
          await ipc.commandSave({ ...ex, group_name: r.group, command: r.command })
          updated++
        } else {
          await ipc.commandSave({ id: 0, project_id: node.id, group_name: r.group, name: r.name, command: r.command, cwd: '', shell: '', sort: 0 })
          added++
        }
      } catch {
        failed++
      }
    }
    await refreshCommands()
    await refreshServices()
    await refreshTree()
    setPicked(new Set())
    setResult({ added, updated, failed })
  }

  const save = async () => {
    if (!name.trim()) return
    await ipc.nodeUpdate(id, { name: name.trim(), path, relPath })
    await refreshTree()
    props.api.close()
  }

  const newCount = (scan ?? []).filter((r) => rowStatus(r) === 'new').length

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
                  Detect npm / pnpm / cargo / make / … scripts and add them as commands or services (dev servers are guessed as services — flip any row). Re-scan any time to pick up new ones.
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
                    <button className="hover:text-slate-200" onClick={() => setPicked(new Set(scan.filter((r) => rowStatus(r) === 'new').map((r) => r.command)))}>
                      Select new ({newCount})
                    </button>
                    <button className="hover:text-slate-200" title="Also select same-name commands whose command changed, to override them" onClick={() => setPicked(new Set(scan.filter((r) => rowStatus(r) !== 'added').map((r) => r.command)))}>
                      Select all + override
                    </button>
                    <button className="hover:text-slate-200" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                    <span className="ml-auto">{picked.size} selected</span>
                  </div>

                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                    {scan.map((r) => {
                      const st = rowStatus(r)
                      const on = picked.has(r.command)
                      const b = pmBadge(r.manager)
                      const ex = st === 'changed' ? byName.get(r.name) : undefined
                      return (
                        <label
                          key={r.manager + '|' + r.command}
                          title={ex ? `Currently: ${ex.command}` : undefined}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 ${st === 'added' ? 'border-slate-800 opacity-50' : 'border-slate-700 hover:border-slate-600'}`}
                        >
                          <input type="checkbox" className="accent-indigo-500" disabled={st === 'added'} checked={st === 'added' || on} onChange={() => toggle(r.command)} />
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
                          {(() => {
                            const kind = kindOf(r)
                            return (
                              <span className="shrink-0 overflow-hidden rounded border border-slate-700 text-[10px] leading-none" title="Add as a one-shot command or a long-running service">
                                {(['command', 'service'] as const).map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    disabled={st === 'added'}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      setKind(r.command, k)
                                    }}
                                    className={`px-1.5 py-1 ${kind === k ? (k === 'service' ? 'bg-amber-500/25 text-amber-300' : 'bg-indigo-500/25 text-indigo-200') : 'text-slate-500 hover:text-slate-300'}`}
                                  >
                                    {k === 'service' ? '⚡ Svc' : '⌘ Cmd'}
                                  </button>
                                ))}
                              </span>
                            )
                          })()}
                          {st === 'added' && <span className="shrink-0 text-[10px] text-emerald-400">added</span>}
                          {st === 'changed' && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-400">differs</span>}
                        </label>
                      )
                    })}
                  </div>

                  <div className="flex items-center gap-3">
                    <button className="btn-primary mt-1 text-[12px]" disabled={picked.size === 0} onClick={() => void addSelected()}>
                      {(() => {
                        const rows = scan.filter((r) => picked.has(r.command))
                        const a = rows.filter((r) => rowStatus(r) === 'new').length
                        const u = rows.filter((r) => rowStatus(r) === 'changed').length
                        return `Add ${a}${u ? ` · override ${u}` : ''}`
                      })()}
                    </button>
                    {result && (
                      <span className="mt-1 text-[11px] text-emerald-400">
                        ✓ Added {result.added}
                        {result.updated ? `, overrode ${result.updated}` : ''}
                        {result.failed ? `, ${result.failed} failed` : ''} — see the Commands / Services panels.
                      </span>
                    )}
                  </div>
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
