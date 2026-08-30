// Setup page (main-window tab) for a project or folder.
//   Project → configure its base path (the repo/app root) and scan the repo
//             for runnable scripts (npm/pnpm/cargo/…) to add as commands.
//   Folder  → configure its subpath (relative to the project base path)
//             with an optional absolute-path override.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { findNode, projectOf, resolveDir } from '../../lib/tree'
import { guessKind, guessPort, pmBadge } from '../../lib/pm'
import type { DetectedCommand } from '../../lib/types'
import { EditorShell, Field } from './EditorShell'
import { openTerminal } from '../../lib/runner'
import { Icon } from '../../lib/icons'

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
  // Per-row port for service rows, so an imported dev server keeps its port and
  // you don't re-enter it. Seeded from guessPort; '' means no port.
  const [ports, setPorts] = useState<Map<string, string>>(new Map())
  // Managers the user has switched off. Empty = show everything. A polyglot
  // repo legitimately has npm *and* cargo *and* make, so this is a filter
  // rather than a single choice — but it lets you cut a scan down to the one
  // toolchain you actually came to wire up.
  const [mgrOff, setMgrOff] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; updated: number; failed: number } | null>(null)

  // Scan as soon as the page opens for a project that has a path. Clicking
  // "Scan" was a step whose answer was never anything but yes — the moment you
  // point DevDeck at a repo, what it can build/run/test/deploy is the thing
  // you came to find out.
  //
  // It stops at *showing* you. Results arrive pre-selected, but writing a
  // dozen commands into your config unasked is a different act from listing
  // what's there, and only one of them is reversible with a glance.
  const autoScannedId = useRef<number | null>(null)
  useEffect(() => {
    const dir = node?.path ?? ''
    if (!node || !dir.trim() || autoScannedId.current === id) return
    autoScannedId.current = id
    setScanning(true)
    setScanErr(null)
    void ipc
      .scanProject(dir)
      .then((res) => {
        setScan(res)
        const key = (r: DetectedCommand) => `${r.dir} :: ${r.command}`
        const guessed = new Map(
          res.map(
            (r) => [key(r), r.service ? 'service' : guessKind(r.name, r.command)] as const,
          ),
        )
        setKinds(guessed)
        setPorts(new Map(res.map((r) => [key(r), guessPort(r.command)?.toString() ?? ''] as const)))
        // Pre-select what isn't already configured, kind-aware — the same rule
        // the manual scan uses.
        const have = {
          command: new Set(commands.filter((c) => c.project_id === node.id).map((c) => c.command)),
          service: new Set(services.filter((s) => s.project_id === node.id).map((s) => s.command)),
        }
        setPicked(
          new Set(
            res
              .filter((r) => !have[guessed.get(key(r)) ?? 'command'].has(r.command))
              .map(key),
          ),
        )
      })
      .catch((e) => {
        setScanErr(String(e))
        setScan([])
      })
      .finally(() => setScanning(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, node?.path])

  if (!node) {
    return <div className="p-6 text-muted">This item no longer exists.</div>
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

  // Rows are keyed by folder *and* command: `npm run dev` legitimately exists
  // in three places in a monorepo, and keying on the command alone made them
  // one row that ticked and un-ticked together.
  const keyOf = (r: DetectedCommand) => `${r.dir} :: ${r.command}`

  // The chosen kind for a row: an explicit user pick, else the scanner's hint,
  // else the name/command heuristic.
  const kindOf = (r: DetectedCommand): 'command' | 'service' =>
    kinds.get(keyOf(r)) ?? (r.service ? 'service' : guessKind(r.name, r.command))

  const rowStatus = (r: DetectedCommand): 'new' | 'added' | 'changed' => {
    if (kindOf(r) === 'service') {
      return svcByCommand.has(r.command) ? 'added' : svcByName.has(r.name) ? 'changed' : 'new'
    }
    return byCommand.has(r.command) ? 'added' : byName.has(r.name) ? 'changed' : 'new'
  }

  const setKind = (cmd: string, kind: 'command' | 'service') =>
    setKinds((prev) => new Map(prev).set(cmd, kind))

  // Port shown for a service row: an explicit user value, else the guess.
  const portOf = (r: DetectedCommand): string =>
    ports.get(keyOf(r)) ?? (guessPort(r.command)?.toString() ?? '')
  const setPort = (cmd: string, value: string) =>
    setPorts((prev) => new Map(prev).set(cmd, value.replace(/[^\d]/g, '')))

  /** Absolute working directory for a scanned row, or '' for the root. */
  const subDir = (r: DetectedCommand): string => {
    if (!r.dir) return ''
    const base = (preview || path).replace(/[\\/]+$/, '')
    return `${base}\\${r.dir.split('/').join('\\')}`
  }

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
      const guessed = new Map(
        res.map((r) => [keyOf(r), r.service ? 'service' : guessKind(r.name, r.command)] as const),
      )
      setKinds(guessed)
      // Pre-fill service ports from the tool's conventional port.
      setPorts(new Map(res.map((r) => [keyOf(r), guessPort(r.command)?.toString() ?? ''] as const)))
      // Pre-select only brand-new rows (existing / changed stay opt-in). Status
      // is kind-aware, so use the freshly-guessed kinds here.
      const statusWith = (r: DetectedCommand) => {
        if ((guessed.get(keyOf(r)) ?? 'command') === 'service') {
          return svcByCommand.has(r.command) ? 'added' : svcByName.has(r.name) ? 'changed' : 'new'
        }
        return byCommand.has(r.command) ? 'added' : byName.has(r.name) ? 'changed' : 'new'
      }
      setPicked(new Set(res.filter((r) => statusWith(r) === 'new').map(keyOf)))
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
    // Filtered-out rows are never added, even if they were picked before the
    // filter changed — what you see is what gets written.
    const rows = (scan ?? []).filter((r) => !mgrOff.has(r.manager) && picked.has(keyOf(r)))
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
            const p = portOf(r)
            // cwd is the subfolder the scanner found it in — without it a
            // command from apps/web would run at the repo root.
            await ipc.serviceSave({ id: 0, project_id: node.id, name: r.name, command: r.command, cwd: subDir(r), env: '', auto_restart: false, health_port: p ? Number(p) : null, shell: '' })
            added++
          }
        } else if (st === 'changed') {
          // Override the existing command with the same name (keeps its id).
          const ex = byName.get(r.name)!
          await ipc.commandSave({ ...ex, group_name: r.group, command: r.command })
          updated++
        } else {
          await ipc.commandSave({ id: 0, project_id: node.id, group_name: r.group, name: r.name, command: r.command, cwd: subDir(r), shell: '', sort: 0 })
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
    await ipc.vaultRename(id, name.trim())
    await ipc.vaultSetMeta(id, { repo: path })
    await refreshTree()
    props.api.close()
  }

  // One tally per detected manager, biggest first, so the chip row reads as
  // "this is a pnpm repo that also has cargo and make" at a glance.
  const managers = (() => {
    const by = new Map<string, { id: string; total: number; fresh: number }>()
    for (const r of scan ?? []) {
      const e = by.get(r.manager) ?? { id: r.manager, total: 0, fresh: 0 }
      e.total += 1
      if (rowStatus(r) === 'new') e.fresh += 1
      by.set(r.manager, e)
    }
    return [...by.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
  })()

  // What the list actually shows, and therefore what every count, bulk action
  // and the Add button operate on. Nothing hidden is ever silently added.
  const shown = (scan ?? []).filter((r) => !mgrOff.has(r.manager))

  const toggleMgr = (id: string) => {
    const next = new Set(mgrOff)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setMgrOff(next)
    // Drop selections that just went out of view, so "N selected" always
    // matches what you can see. Hiding a row must not smuggle it into Add.
    setPicked((p) => {
      const keep = new Set<string>()
      for (const r of scan ?? []) if (!next.has(r.manager) && p.has(keyOf(r))) keep.add(keyOf(r))
      return keep
    })
  }

  const newCount = shown.filter((r) => rowStatus(r) === 'new').length

  return (
    <EditorShell
      icon={isProject ? 'project' : 'folder'}
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
          <button className="btn-ghost inline-flex items-center gap-1" title="Open a terminal here" onClick={() => void openTerminal(undefined, preview)}>
            <Icon name="terminal" size={13} /> Terminal
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
          <div className="rounded-lg border border-line2 bg-raise p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-ink">Scan repo for scripts</div>
                <div className="text-[11px] text-muted">
                  Detect npm / pnpm / cargo / make / … scripts and add them as commands or services (dev servers are guessed as services — flip any row). Re-scan any time to pick up new ones.
                </div>
              </div>
              <button
                className="btn-primary inline-flex shrink-0 items-center gap-1 text-[12px]"
                disabled={!(preview || path).trim() || scanning}
                onClick={() => void runScan()}
              >
                {scanning ? (
                  'Scanning…'
                ) : scan ? (
                  <>
                    <Icon name="restart" size={13} /> Re-scan
                  </>
                ) : (
                  <>
                    <Icon name="search" size={13} /> Scan
                  </>
                )}
              </button>
            </div>

            {scanErr && <div className="mt-2 text-[11px] text-err">{scanErr}</div>}

            {scan &&
              (scan.length === 0 ? (
                <div className="mt-3 text-[11px] text-muted">No scripts found — check the base path points at the repo root.</div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {/* Toolchain filter. In a monorepo a scan spans several
                      managers at once; narrowing to one is usually the first
                      thing you want to do. */}
                  {managers.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line2 bg-soft p-1.5">
                      <span className="pl-1 pr-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">Toolchain</span>
                      {managers.map((m) => {
                        const b = pmBadge(m.id)
                        const on = !mgrOff.has(m.id)
                        const accent = b?.color ?? '#9BA3B2'
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMgr(m.id)}
                            title={`${m.total} row${m.total === 1 ? '' : 's'} from ${m.id}${m.fresh ? ` · ${m.fresh} new` : ''} — click to ${on ? 'hide' : 'show'}`}
                            className={`group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none transition-all ${
                              on ? 'border-line3 text-ink' : 'border-line2 text-muted hover:text-body'
                            }`}
                            style={on ? { background: b?.bg ?? 'rgba(255,255,255,0.06)', borderColor: accent } : undefined}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full transition-all ${on ? '' : 'opacity-40'}`}
                              style={{ background: accent, boxShadow: on ? `0 0 6px ${accent}` : undefined }}
                            />
                            <span className="font-semibold" style={on ? { color: accent } : undefined}>
                              {b?.label ?? m.id}
                            </span>
                            <span className={`rounded px-1 py-px font-mono text-[9.5px] ${on ? 'bg-black/25 text-ink' : 'bg-black/15 text-faint'}`}>{m.total}</span>
                          </button>
                        )
                      })}
                      {mgrOff.size > 0 && (
                        <button type="button" className="ml-auto pr-1 text-[10.5px] text-dim hover:text-ink" onClick={() => { setMgrOff(new Set()) }}>
                          Show all
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-[11px] text-dim">
                    <button className="hover:text-ink" onClick={() => setPicked(new Set(shown.filter((r) => rowStatus(r) === 'new').map(keyOf)))}>
                      Select new ({newCount})
                    </button>
                    <button className="hover:text-ink" title="Also select same-name commands whose command changed, to override them" onClick={() => setPicked(new Set(shown.filter((r) => rowStatus(r) !== 'added').map(keyOf)))}>
                      Select all + override
                    </button>
                    <button className="hover:text-ink" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                    <span className="ml-auto">
                      {picked.size} selected
                      {mgrOff.size > 0 && <span className="ml-1.5 text-faint">· {shown.length} of {scan.length} shown</span>}
                    </span>
                  </div>

                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                    {shown.length === 0 && (
                      <div className="rounded border border-dashed border-line2 px-2 py-3 text-center text-[11px] text-muted">
                        Every toolchain is hidden — {scan.length} rows filtered out.
                      </div>
                    )}
                    {shown.map((r) => {
                      const st = rowStatus(r)
                      const on = picked.has(keyOf(r))
                      const b = pmBadge(r.manager)
                      const ex = st === 'changed' ? byName.get(r.name) : undefined
                      return (
                        <label
                          key={keyOf(r)}
                          title={ex ? `Currently: ${ex.command}` : undefined}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 ${st === 'added' ? 'border-line opacity-50' : 'border-line2 hover:border-line3'}`}
                        >
                          <input type="checkbox" className="accent-indigo-500" disabled={st === 'added'} checked={st === 'added' || on} onChange={() => toggle(keyOf(r))} />
                          {b && (
                            <span
                              className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold"
                              style={{ background: b.bg, color: b.color }}
                            >
                              {b.label}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-[12.5px] text-ink">{r.name}</span>
                            <span className="ml-2 font-mono text-[10.5px] text-muted">{r.command}</span>
                            {r.dir && (
                              <span
                                className="ml-1.5 rounded bg-indigo-500/10 px-1.5 py-px font-mono text-[10px] text-indigo-300"
                                title={`Runs in ${r.dir}`}
                              >
                                {r.dir}
                              </span>
                            )}
                          </span>
                          {(() => {
                            const kind = kindOf(r)
                            return (
                              <span className="shrink-0 overflow-hidden rounded border border-line2 text-[10px] leading-none" title="Add as a one-shot command or a long-running service">
                                {(['command', 'service'] as const).map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    disabled={st === 'added'}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      setKind(keyOf(r), k)
                                    }}
                                    className={`inline-flex items-center gap-1 px-1.5 py-1 ${kind === k ? (k === 'service' ? 'bg-amber-500/25 text-warn' : 'bg-indigo-500/25 text-indigo-200') : 'text-muted hover:text-ink'}`}
                                  >
                                    {k === 'service' ? (
                                      <>
                                        <Icon name="service" size={12} /> Svc
                                      </>
                                    ) : (
                                      <>
                                        <Icon name="command" size={12} /> Cmd
                                      </>
                                    )}
                                  </button>
                                ))}
                              </span>
                            )
                          })()}
                          {kindOf(r) === 'service' && (
                            <input
                              className="w-14 shrink-0 rounded border border-line2 bg-page px-1 py-1 text-center text-[10.5px] text-body"
                              placeholder="port"
                              value={portOf(r)}
                              disabled={st === 'added'}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setPort(keyOf(r), e.target.value)}
                              title="Port this service serves on — saved so you can open it in the browser without re-entering it"
                            />
                          )}
                          {st === 'added' && <span className="shrink-0 text-[10px] text-ok">added</span>}
                          {st === 'changed' && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-warn">differs</span>}
                        </label>
                      )
                    })}
                  </div>

                  <div className="flex items-center gap-3">
                    <button className="btn-primary mt-1 text-[12px]" disabled={picked.size === 0} onClick={() => void addSelected()}>
                      {(() => {
                        const rows = shown.filter((r) => picked.has(keyOf(r)))
                        const a = rows.filter((r) => rowStatus(r) === 'new').length
                        const u = rows.filter((r) => rowStatus(r) === 'changed').length
                        return `Add ${a}${u ? ` · override ${u}` : ''}`
                      })()}
                    </button>
                    {result && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-ok">
                        <Icon name="check" size={12} /> Added {result.added}
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
          <div className="text-[11px] text-muted">
            Project base:{' '}
            <span className="font-mono text-dim">{project?.path || '(project has no base path yet)'}</span>
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

      <div className="rounded border border-line2 bg-raise px-3 py-2 text-[12px]">
        <span className="text-muted">Resolves to: </span>
        <span className="font-mono text-ok">{preview || '(no directory)'}</span>
      </div>
    </EditorShell>
  )
}
