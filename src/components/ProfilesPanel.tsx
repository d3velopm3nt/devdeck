// Launch profiles, scoped to the selected project (plus globals). Click a
// profile to edit it; the primary button launches all its steps and the ⋯ menu
// offers edit and delete.

import { useMemo, useState } from 'react'
import type { ProfileDef } from '../lib/types'
import { useApp } from '../store'
import { openEditor } from '../lib/dock'
import { launchProfile } from '../lib/runner'
import { subtreeIds } from '../lib/tree'
import * as ipc from '../lib/ipc'
import { PanelShell, RowTitle, ROW_CARD, ICON_BTN, useRowMenu } from './PanelShell'
import type { MenuItem } from './PopMenu'
import { Icon } from '../lib/icons'

const stepCount = (p: ProfileDef): number => {
  try {
    return (JSON.parse(p.steps) as unknown[]).length
  } catch {
    return 0
  }
}

export function ProfilesPanel() {
  const { profiles, nodes, selectedNode, scopeNode, refreshProfiles } = useApp()
  const sel = selectedNode()
  const node = scopeNode() // selection, else the active workspace
  const [launching, setLaunching] = useState<number | null>(null)
  const { openMenu, menuNode } = useRowMenu()

  const scope = useMemo(() => (node ? new Set(subtreeIds(nodes, node.id)) : null), [nodes, node])
  const visible = useMemo(
    () => profiles.filter((p) => p.project_id === null || (scope?.has(p.project_id) ?? false)),
    [profiles, scope],
  )

  const launch = async (p: ProfileDef) => {
    setLaunching(p.id)
    try {
      await launchProfile(p)
    } finally {
      setLaunching(null)
    }
  }

  const del = async (p: ProfileDef) => {
    if (!confirm(`Delete profile “${p.name}”?`)) return
    await ipc.profileDelete(p.id)
    await refreshProfiles()
  }

  const overflow = (p: ProfileDef): MenuItem[] => [
    { icon: 'edit', label: 'Edit profile…', onClick: () => openEditor('profile', p.id, p.name || 'Profile') },
    { icon: 'delete', label: 'Delete profile', danger: true, onClick: () => void del(p) },
  ]

  return (
    <PanelShell
      scope={node ? `${node.kind}: ${node.name}` : 'Global'}
      addLabel="Profile"
      onAdd={() => openEditor('profile', 0, 'New profile', sel?.id ?? null)}
      isEmpty={visible.length === 0}
      emptyText="A launch profile prepares a whole dev environment in one click: start services, run commands, open terminals, restore a layout. Click “+ Profile” to create one."
    >
      {visible.map((p) => {
        const n = stepCount(p)
        return (
          <div key={p.id} className={ROW_CARD}>
            <RowTitle
              badge={<span className="flex shrink-0 items-center text-violet-400/80"><Icon name="profile" size={13} /></span>}
              name={p.name || 'Profile'}
              sub={`${n} step${n === 1 ? '' : 's'}`}
              onClick={() => openEditor('profile', p.id, p.name || 'Profile')}
            />
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                className={`${ICON_BTN} bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/35 hover:text-white`}
                disabled={launching === p.id}
                title="Launch profile"
                onClick={() => void launch(p)}
              >
                <Icon name={launching === p.id ? 'spinner' : 'service'} size={13} spin={launching === p.id} />
              </button>
              <button className={ICON_BTN} title="More actions" onClick={(e) => openMenu(e, overflow(p))}>
                ⋯
              </button>
            </div>
          </div>
        )
      })}
      {menuNode}
    </PanelShell>
  )
}
