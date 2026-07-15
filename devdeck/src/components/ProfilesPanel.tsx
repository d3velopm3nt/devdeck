// Launch profiles. Click a profile to edit it in a main-window tab; the
// Launch button fires all its steps (services, commands, terminals,
// layout) in one click.

import { useState } from 'react'
import { useApp } from '../store'
import { openEditor } from '../lib/dock'
import { launchProfile } from '../lib/runner'
import { subtreeIds } from '../lib/tree'

export function ProfilesPanel() {
  const { profiles, nodes, selectedNode } = useApp()
  const node = selectedNode()
  const [launching, setLaunching] = useState<number | null>(null)

  const scope = node ? new Set(subtreeIds(nodes, node.id)) : null
  const visible = profiles.filter(
    (p) => p.project_id === null || (scope?.has(p.project_id) ?? false),
  )

  return (
    <div className="flex h-full flex-col bg-[#11141c] text-slate-300">
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5">
        <span className="text-[11px] text-slate-500">Launch profiles</span>
        <button
          className="btn-primary text-[11px]"
          onClick={() => openEditor('profile', 0, 'New profile', node?.id ?? null)}
        >
          + Profile
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {visible.length === 0 && (
          <div className="p-2 text-[12px] text-slate-500">
            A launch profile prepares a whole dev environment in one click: start services, run
            commands, open terminals, restore a layout. Click “+ Profile” to create one.
          </div>
        )}
        {visible.map((p) => {
          let count = 0
          try {
            count = (JSON.parse(p.steps) as unknown[]).length
          } catch {
            /* ignore */
          }
          return (
            <div
              key={p.id}
              className="group flex items-center gap-2 rounded border border-slate-800 bg-[#151923] px-2 py-1.5 hover:border-slate-600"
            >
              <span className="shrink-0 text-indigo-400">⚡</span>
              <button
                className="min-w-0 flex-1 cursor-pointer text-left"
                title="Click to edit"
                onClick={() => openEditor('profile', p.id, p.name || 'Profile')}
              >
                <div className="truncate text-[12.5px] text-slate-200">{p.name}</div>
                <div className="text-[10.5px] text-slate-500">{count} step(s)</div>
              </button>
              <button
                className="btn-primary text-[11px]"
                disabled={launching === p.id}
                onClick={async () => {
                  setLaunching(p.id)
                  try {
                    await launchProfile(p)
                  } finally {
                    setLaunching(null)
                  }
                }}
              >
                {launching === p.id ? 'Launching…' : '⚡ Launch'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
