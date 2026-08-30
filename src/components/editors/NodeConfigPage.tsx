// What a node *is*, and what lives in it.
//
// This is the page for everything the app has no dedicated page for. A repo
// has the project dashboard; a Topic, an Area, a Client has this. It is a
// working surface rather than a settings form — the contents come first and
// identity sits above them — because for a node with no repo behind it, this
// is the only place it exists.
//
// The one rule worth knowing: **a folder is what makes something a project.**
// Choose one here and the node becomes a project (commands, services, git,
// terminals all become possible); remove it and it goes back to being a
// container. Nothing else about it changes, and you never pick a "kind" —
// picking a folder is the same decision, asked in a way you can answer.

import { useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { openSpace, openNodeSetup, openNodeConfig } from '../../lib/dock'
import { nodeColor } from '../../lib/spaces'

export function NodeConfigPage({ params }: IDockviewPanelProps<{ id: number }>) {
  const { nodes, commands, services, refreshTree, setSelectedNode, labels } = useApp()
  const node = useMemo(() => nodes.find((n) => n.id === params.id) ?? null, [nodes, params.id])

  const [busy, setBusy] = useState(false)
  const [dir, setDir] = useState('')

  // The node's own folder, so it can be revealed and so the page can say
  // plainly where its context will live.
  useEffect(() => {
    void ipc.vaultDir(params.id).then(setDir).catch(() => setDir(''))
  }, [params.id])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[12.5px] text-muted">
        This node no longer exists.
      </div>
    )
  }

  const children = nodes.filter((n) => n.parent_id === node.id)
  const ownCommands = commands.filter((c) => c.project_id === node.id)
  const ownServices = services.filter((s) => s.project_id === node.id)
  const isProject = node.kind === 'project'

  const rename = (name: string) => {
    const v = name.trim()
    if (!v || v === node.name) return
    void ipc.vaultRename(node.id, v).then(() => refreshTree()).catch((e) => alert(String(e)))
  }

  const setLabel = (label: string) => {
    void ipc.vaultSetMeta(node.id, { label }).then(() => refreshTree())
  }

  // Choosing a folder is what promotes a container into a project. Kind
  // follows the path rather than being a separate answer you have to give.
  const chooseFolder = async () => {
    const chosen = await openDialog({ directory: true, title: 'Which repository is this about?' })
    if (typeof chosen !== 'string') return
    setBusy(true)
    try {
      await ipc.vaultSetMeta(node.id, { repo: chosen })
      await refreshTree()
    } finally {
      setBusy(false)
    }
  }

  const clearFolder = async () => {
    if (ownCommands.length > 0 || ownServices.length > 0) {
      alert(
        'This node still has commands or services, which need a folder to run in. ' +
          'Move or delete them first.',
      )
      return
    }
    setBusy(true)
    try {
      await ipc.vaultSetMeta(node.id, { repo: '' })
      await refreshTree()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto bg-page">
      <div className="mx-auto max-w-[720px] px-6 py-6">

        {/* Identity */}
        <div className="flex items-start gap-3.5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
            style={{ background: nodeColor(node) }}
          >
            {node.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <input
              className="w-full bg-transparent text-[21px] font-semibold text-ink outline-none placeholder:text-faint"
              defaultValue={node.name}
              placeholder="Name this"
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                className="input w-[150px] px-2 py-0.5 text-[11.5px]"
                list="node-labels"
                defaultValue={node.label ?? ''}
                placeholder="Label (optional)"
                onBlur={(e) => setLabel(e.target.value)}
              />
              <datalist id="node-labels">
                {labels.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <span className="text-[11px] text-muted">
                {isProject ? 'Has a folder, so it can run things' : 'No folder — a container'}
              </span>
            </div>
          </div>
        </div>

        {/* Folder — the one field that changes what this node can do */}
        <section className="mt-6">
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            Repository
          </h3>
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3.5 py-2.5">
            <Icon name="folder" size={15} className={node.path ? 'text-ok' : 'text-faint'} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body">
              {node.path || 'Not linked to any code'}
            </span>
            <button className="btn-ghost text-[11.5px]" disabled={busy} onClick={() => void chooseFolder()}>
              {node.path ? 'Change…' : 'Choose…'}
            </button>
            {node.path && (
              <button className="btn-ghost text-[11.5px] text-dim" disabled={busy} onClick={() => void clearFolder()}>
                Remove
              </button>
            )}
          </div>
          {!node.path && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Point this at a repository and it becomes a project — commands, services, git and
              terminals all become available. Leave it unlinked and it stays a plain folder, which
              is what a topic wants.
            </p>
          )}
        </section>

        {/* This node's own folder — not the repo. Two different places, and
            confusing them is the whole reason this section is spelled out. */}
        <section className="mt-4">
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3.5 py-2">
            <Icon name="folder" size={14} className="text-dim" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={dir}>
              {dir || '…'}
            </span>
            <button
              className="btn-ghost text-[11px]"
              disabled={!dir}
              onClick={() => void ipc.revealInExplorer(dir).catch((e) => alert(String(e)))}
            >
              <Icon name="reveal" size={12} /> Reveal
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            This node&rsquo;s own folder. Notes and context you keep here travel with it.
          </p>
        </section>

        {/* Contents — the working half */}
        <section className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              Contents
            </h3>
            <span className="text-[10.5px] text-faint">{children.length}</span>
          </div>

          {children.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line2 px-4 py-6 text-center">
              <div className="text-[12.5px] text-dim">Nothing in here yet</div>
              <div className="mx-auto mt-1 max-w-[380px] text-[11px] leading-relaxed text-muted">
                Add something from the Explorer, or give this node a folder to make it a project
                in its own right.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {children.map((c) => (
                <button
                  key={c.id}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3.5 py-2.5 text-left hover:border-line2"
                  onClick={() => {
                    setSelectedNode(c.id)
                    if (c.kind === 'project') openSpace(c.id, c.name)
                    else openNodeConfig(c.id, c.name)
                  }}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[8.5px] font-bold text-white"
                    style={{ background: nodeColor(c) }}
                  >
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.name}</span>
                  {c.label && (
                    <span className="shrink-0 rounded bg-soft px-1.5 text-[9.5px] uppercase tracking-[0.04em] text-muted">
                      {c.label}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {c.path ? 'project' : 'container'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Where the richer views live, when they exist for this node */}
        {isProject && (
          <section className="mt-6 flex flex-wrap gap-2">
            <button className="btn-ghost text-[11.5px]" onClick={() => openSpace(node.id, node.name)}>
              <Icon name="view" size={13} /> Open dashboard
            </button>
            <button className="btn-ghost text-[11.5px]" onClick={() => openNodeSetup(node.id, node.name)}>
              <Icon name="tool" size={13} /> Set up tools
            </button>
            <span className="self-center text-[11px] text-muted">
              {ownCommands.length} commands · {ownServices.length} services
            </span>
          </section>
        )}
      </div>
    </div>
  )
}
