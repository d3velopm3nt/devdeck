// Saved commands, grouped, scoped to the selected project (plus globals).
// Click a command to edit it; the ▶ button runs it in a new terminal and the
// ⋯ menu offers background / existing-terminal runs, edit and delete.

import { useMemo } from 'react'
import type { CommandDef } from '../lib/types'
import { useApp } from '../store'
import { openEditor } from '../lib/dock'
import { subtreeIds } from '../lib/tree'
import { runCommandInBackground, runCommandInNewTerminal, runCommandInTerminal } from '../lib/runner'
import { pmBadge, pmFromCommand } from '../lib/pm'
import * as ipc from '../lib/ipc'
import { PanelShell, RowTitle, ROW_CARD, ICON_BTN, useRowMenu } from './PanelShell'
import type { MenuItem } from './PopMenu'

export function CommandsPanel() {
  const { commands, terminals, nodes, selectedNode, scopeNode, refreshCommands } = useApp()
  const sel = selectedNode()
  const node = scopeNode() // selection, else the active workspace
  const { openMenu, menuNode } = useRowMenu()

  // Globals + commands owned by the scope node or anything under it.
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

  const del = async (c: CommandDef) => {
    if (!confirm(`Delete command “${c.name}”?`)) return
    await ipc.commandDelete(c.id)
    await refreshCommands()
  }

  const overflow = (c: CommandDef): MenuItem[] => [
    { icon: '⚙', label: 'Run in background (logs)', onClick: () => void runCommandInBackground(c) },
    ...(liveTerminals.length
      ? liveTerminals.map((t) => ({
          icon: '❯',
          label: `Run in #${t.id} ${t.title}`,
          onClick: () => void runCommandInTerminal(c, t.id),
        }))
      : []),
    { separator: true, label: '' },
    { icon: '✎', label: 'Edit command…', onClick: () => openEditor('command', c.id, c.name || 'Command') },
    { icon: '🗑', label: 'Delete command', danger: true, onClick: () => void del(c) },
  ]

  return (
    <PanelShell
      scope={node ? `${node.kind}: ${node.name}` : 'Global'}
      addLabel="Command"
      onAdd={() => openEditor('command', 0, 'New command', sel?.id ?? null)}
      isEmpty={groups.length === 0}
      emptyText="No commands yet. Click “+ Command” to create one — it opens an editor in the main window."
    >
      {groups.map(([group, cmds]) => (
        <div key={group} className="space-y-1.5">
          <div className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {group}
          </div>
          {cmds.map((c) => {
            const b = pmBadge(pmFromCommand(c.command) ?? '')
            return (
              <div key={c.id} className={ROW_CARD}>
                <RowTitle
                  badge={
                    b ? (
                      <span
                        className="shrink-0 rounded px-1 py-px text-[9px] font-semibold"
                        style={{ background: b.bg, color: b.color }}
                      >
                        {b.label}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-sky-400/80">⌘</span>
                    )
                  }
                  name={c.name || 'Command'}
                  sub={c.command}
                  onClick={() => openEditor('command', c.id, c.name || 'Command')}
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    className={`${ICON_BTN} bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/35 hover:text-white`}
                    title="Run in a new terminal"
                    onClick={() => void runCommandInNewTerminal(c)}
                  >
                    ▶
                  </button>
                  <button className={ICON_BTN} title="More actions" onClick={(e) => openMenu(e, overflow(c))}>
                    ⋯
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {menuNode}
    </PanelShell>
  )
}
