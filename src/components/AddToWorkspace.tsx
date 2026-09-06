// Adding something to a workspace, from one place.
//
// The Explorer could already make all four of these; you just could not find
// the door. The `+` in its header said "a project, topic or anything else" and
// called `addNode()`, which asks for a name and makes a *folder* — every time,
// whatever you meant. And `Add project…` existed only on a solution's
// right-click menu, so from a workspace there was no way in at all.
//
// So this adds no capability. It names the four things in the words a person
// would use, asks only what each one actually needs, and hands the work to the
// calls that were already there.
//
// **Nothing is created behind your back.** A project points at a folder you
// choose; it is never copied, moved, or initialised as a repository. `git init`
// somewhere in your folders is the kind of helpfulness you stop trusting an app
// for, so it is not on this list.

import { useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import { Icon, type IconName } from '../lib/icons'
import { useApp } from '../store'
import type { TreeNode } from '../lib/types'

/// What you can add. Ordered by what people reach for, not by what the tree
/// calls things.
type Kind = 'project' | 'github' | 'area' | 'folder'

const KINDS: { id: Kind; icon: IconName; title: string; what: string }[] = [
  {
    id: 'project',
    icon: 'project',
    title: 'A code project on this machine',
    what: 'Choose the repository folder. It records the path and opens setup.',
  },
  {
    id: 'github',
    icon: 'github',
    title: 'A code project from GitHub',
    what: 'Clone it into the workspace, then set it up.',
  },
  {
    id: 'area',
    icon: 'folder',
    title: 'An area with no code',
    what: 'Clients, Marketing, Money. Holds notes, routines and a manager — no repository.',
  },
  {
    id: 'folder',
    icon: 'folder',
    title: 'A folder inside a project',
    what: 'A subpath of a repository you already have.',
  },
]

export function AddToWorkspace({
  workspaceId,
  onClose,
  onCreated,
  onGithub,
}: {
  /// Which workspace this lands in. Chosen before opening, so the sheet never
  /// has to ask a question the caller already knew the answer to.
  workspaceId: number
  onClose: () => void
  /// The node that was made, and which kind it was — the caller decides where
  /// to take you next, because that differs per kind.
  onCreated: (node: TreeNode, kind: Kind) => void
  onGithub: () => void
}) {
  const nodes = useApp((s) => s.nodes)
  const [kind, setKind] = useState<Kind | null>(null)
  const [name, setName] = useState('')
  const [into, setInto] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const ws = nodes.find((n) => n.id === workspaceId)
  /// Somewhere to put a subfolder. A project is the only thing that has a
  /// repository behind it, so it is the only thing a subpath means anything in.
  const projects = useMemo(
    () => nodes.filter((n) => n.kind === 'project' && n.parent_id === workspaceId),
    [nodes, workspaceId],
  )

  const fail = (e: unknown) => {
    setErr(String(e))
    setBusy(false)
  }

  /// Point at a folder that already exists. The name comes from the folder, so
  /// there is nothing to type.
  const fromFolder = async () => {
    setErr('')
    const dir = await openDialog({
      directory: true,
      title: 'Select the project folder (the repository root)',
    }).catch(() => null)
    if (typeof dir !== 'string') return
    setBusy(true)
    try {
      const leaf = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
      const created = await ipc.vaultCreate(workspaceId, leaf)
      await ipc.vaultSetMeta(created.id, { repo: dir })
      onCreated(created, 'project')
    } catch (e) {
      fail(e)
    }
  }

  const make = async () => {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    setErr('')
    try {
      const parent = kind === 'folder' ? (into ?? workspaceId) : workspaceId
      const created = await ipc.vaultCreate(parent, n)
      onCreated(created, kind === 'folder' ? 'folder' : 'area')
    } catch (e) {
      fail(e)
    }
  }

  const pick = (k: Kind) => {
    setErr('')
    if (k === 'project') return void fromFolder()
    if (k === 'github') {
      onGithub()
      return
    }
    if (k === 'folder') setInto(projects[0]?.id ?? null)
    setKind(k)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="flex w-[520px] flex-col rounded-xl border border-line2 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
            <Icon name="add" size={14} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">
              Add to {ws?.name ?? 'this workspace'}
            </div>
            <div className="text-[11px] text-muted">
              {kind == null
                ? 'Four things, and it says which is which.'
                : kind === 'area'
                  ? 'A space with no repository behind it.'
                  : 'A subpath of a project you already have.'}
            </div>
          </div>
          <button className="ml-auto text-muted hover:text-ink" onClick={onClose} title="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        {err && (
          <div className="border-b border-red-500/25 bg-red-500/[0.06] px-4 py-2 text-[11.5px] text-err">
            {err}
          </div>
        )}

        {kind == null ? (
          <div className="flex flex-col gap-0.5 p-2">
            {KINDS.map((k) => {
              // Nowhere to put a subfolder is a true thing to say, rather than
              // a menu item that opens onto an empty list.
              const off = k.id === 'folder' && projects.length === 0
              return (
                <button
                  key={k.id}
                  className={`flex items-start gap-3 rounded-md px-2.5 py-2.5 text-left ${
                    off ? 'opacity-45' : 'hover:bg-hover'
                  }`}
                  disabled={off || busy}
                  title={off ? 'This workspace has no projects yet' : undefined}
                  onClick={() => pick(k.id)}
                >
                  <span className="mt-px flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-soft text-dim">
                    <Icon name={k.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-ink">{k.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-[1.5] text-muted">
                      {off ? 'This workspace has no projects yet.' : k.what}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {kind === 'folder' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Inside
                </span>
                <select
                  className="input w-full"
                  value={into ?? ''}
                  onChange={(e) => setInto(Number(e.target.value))}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Called
              </span>
              <input
                autoFocus
                className="input w-full"
                placeholder={kind === 'area' ? 'Marketing' : 'packages/api'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void make()
                  if (e.key === 'Escape') setKind(null)
                }}
              />
            </label>

            <p className="text-[11px] leading-[1.55] text-muted">
              {kind === 'area'
                ? 'A folder in the vault, and nothing on disk outside it. Give it a manager later, or never.'
                : 'The name is the subpath inside that project, so it can have slashes in it.'}
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost text-[12px]" onClick={() => setKind(null)}>
                Back
              </button>
              <button
                className="btn-primary text-[12px]"
                disabled={busy || !name.trim()}
                onClick={() => void make()}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
