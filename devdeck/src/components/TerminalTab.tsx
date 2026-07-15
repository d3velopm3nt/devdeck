// Custom dockview tab for terminal panels. Closing the tab asks whether
// to keep the backend session running (reattach later) or end it (kill
// the shell) — terminals are persistent, so closing a tab must not
// silently orphan or silently kill the session.

import { useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { PopMenu } from './PopMenu'

function ptyIdFromPanel(id: string): number | null {
  const m = /^terminal-(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}

export function TerminalTab(props: IDockviewPanelHeaderProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const title = props.api.title ?? 'terminal'
  const ptyId = ptyIdFromPanel(props.api.id)

  const closeKeep = () => props.api.close()
  const closeEnd = async () => {
    if (ptyId != null) {
      try {
        await ipc.ptyKill(ptyId)
      } catch {
        /* already gone */
      }
      await useApp.getState().refreshTerminals()
    }
    props.api.close()
  }

  return (
    <div className="flex h-full items-center gap-2 px-2">
      <span className="truncate text-[12px]">
        <span className="mr-1 text-emerald-400/80">❯</span>
        {title}
      </span>
      <button
        className="rounded px-1 text-[13px] leading-none text-slate-500 hover:bg-slate-600 hover:text-white"
        title="Close terminal"
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom })
        }}
      >
        ×
      </button>
      {menu && (
        <PopMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { icon: '▣', label: 'Close tab · keep session running', onClick: closeKeep },
            { icon: '■', label: 'Close tab · end session', danger: true, onClick: () => void closeEnd() },
          ]}
        />
      )}
    </div>
  )
}
