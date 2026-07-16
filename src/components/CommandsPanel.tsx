// Saved commands, grouped, scoped to the selected project (plus
// globals). Click a command to edit it in a main-window tab; the Run
// button (and ⋯ menu) launch it in a new terminal, an existing
// terminal, or the background.

import { useMemo, useState } from 'react'
import type { CommandDef } from '../lib/types'
import { useApp } from '../store'
import { openEditor } from '../lib/dock'
import { subtreeIds } from '../lib/tree'
import { runCommandInBackground, runCommandInNewTerminal, runCommandInTerminal } from '../lib/runner'

export function CommandsPanel() {
  const { commands, terminals, nodes, selectedNode } = useApp()
  const node = selectedNode()
  const [runMenu, setRunMenu] = useState<number | null>(null)

  // Show globals + commands owned by the selected node or any node under
  // it (so a project shows all its folders' commands; a folder shows its
  // own). With nothing selected, show only globals.
  const scope = useMemo(() => (node ? new Set(subtreeIds(nodes, node.id)) : null), [nodes, node])
  const visible = useMemo(
    () => commands.filter((c) => c.project_id === null || (scope?.has(c.project_id) ?? false)),
    [commands, scope],
  )
  const groups = useMemo(() => {
    const map = new Map<string, CommandDef[]>()
    for (const c of visible) {
      const g = c.group_name || 'General'
      map.set(g, [...(map.get(g) ?? []), c])
    }
    return [...map.entries()]
  }, [visible])

  const liveTerminals = terminals.filter((t) => t.alive)

  return (
    <div className="flex h-full flex-col bg-[#11141c] text-slate-300">
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5">
        <span className="text-[11px] text-slate-500">
          {node ? `${node.kind}: ${node.name}` : 'Global commands'}
        </span>
        <button
          className="btn-primary text-[11px]"
          onClick={() => openEditor('command', 0, 'New command', node?.id ?? null)}
        >
          + Command
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {groups.length === 0 && (
          <div className="p-2 text-[12px] text-slate-500">
            No commands yet. Click “+ Command” to create one — it opens an editor in the main
            window.
          </div>
        )}
        {groups.map(([group, cmds]) => (
          <div key={group}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group}
            </div>
            <div className="space-y-1">
              {cmds.map((c) => (
                <div
                  key={c.id}
                  className="group relative flex items-center gap-2 rounded border border-slate-800 bg-[#151923] px-2 py-1.5 hover:border-slate-600"
                >
                  <button
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title="Click to edit"
                    onClick={() => openEditor('command', c.id, c.name || 'Command')}
                  >
                    <div className="truncate text-[12.5px] text-slate-200">{c.name}</div>
                    <div className="truncate font-mono text-[10.5px] text-slate-500">{c.command}</div>
                  </button>
                  <button
                    className="btn-primary text-[11px]"
                    title="Run in new terminal"
                    onClick={() => void runCommandInNewTerminal(c)}
                  >
                    ▶ Run
                  </button>
                  <button
                    className="btn-ghost text-[11px]"
                    title="More run options"
                    onClick={() => setRunMenu(runMenu === c.id ? null : c.id)}
                  >
                    ⋯
                  </button>
                  {runMenu === c.id && (
                    <div className="absolute right-2 top-full z-20 mt-1 w-56 rounded border border-slate-700 bg-[#1a1f2b] p-1 shadow-xl">
                      <button
                        className="menu-item"
                        onClick={() => {
                          setRunMenu(null)
                          void runCommandInBackground(c)
                        }}
                      >
                        Run in background (logs)
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => {
                          setRunMenu(null)
                          openEditor('command', c.id, c.name || 'Command')
                        }}
                      >
                        Edit command…
                      </button>
                      <div className="my-1 border-t border-slate-700" />
                      <div className="px-2 py-0.5 text-[10px] uppercase text-slate-500">
                        Run in existing terminal
                      </div>
                      {liveTerminals.length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-slate-500">no open terminals</div>
                      )}
                      {liveTerminals.map((t) => (
                        <button
                          key={t.id}
                          className="menu-item"
                          onClick={() => {
                            setRunMenu(null)
                            void runCommandInTerminal(c, t.id)
                          }}
                        >
                          #{t.id} {t.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
