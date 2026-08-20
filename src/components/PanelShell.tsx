// Shared scaffold + styling for the Explorer's bottom panels (Commands,
// Services, Profiles) so they read as one consistent surface: same header,
// same row cards, same action affordances (a primary button + a ⋯ overflow
// menu), same empty state.

import { useState, type MouseEvent, type ReactNode } from 'react'
import { PopMenu, type MenuItem } from './PopMenu'

// One row card — identical border/background/hover across every panel.
export const ROW_CARD =
  'group relative flex items-center gap-2 rounded-lg border border-slate-800 bg-[#151923] px-2.5 py-2 transition hover:border-slate-600'

// Small square icon button used for a row's inline actions.
export const ICON_BTN =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px] leading-none text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-30'

export function PanelShell({
  scope,
  addLabel,
  onAdd,
  isEmpty,
  emptyText,
  children,
}: {
  scope: string
  addLabel: string
  onAdd: () => void
  isEmpty: boolean
  emptyText: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col bg-[#11141c] text-slate-300">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-2 py-1.5">
        <span className="truncate text-[11px] text-slate-500">{scope}</span>
        <button className="btn-primary shrink-0 text-[11px]" onClick={onAdd}>
          + {addLabel}
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {isEmpty ? (
          <div className="p-2 text-[12px] leading-5 text-slate-500">{emptyText}</div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

// Uniform title block for a row: an optional leading badge, the name, and an
// optional mono sub-line beneath it.
export function RowTitle({
  badge,
  name,
  sub,
  onClick,
}: {
  badge?: ReactNode
  name: string
  sub?: ReactNode
  onClick?: () => void
}) {
  return (
    <button className="min-w-0 flex-1 cursor-pointer text-left" title="Click to edit" onClick={onClick}>
      <div className="flex items-center gap-1.5">
        {badge}
        <span className="truncate text-[12.5px] font-medium text-slate-200">{name}</span>
      </div>
      {sub != null && sub !== '' && (
        <div className="truncate font-mono text-[10.5px] text-slate-500">{sub}</div>
      )}
    </button>
  )
}

// Row overflow (⋯) menu, shared by every panel and styled like the sidebar's
// context menus.
export function useRowMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const openMenu = (e: MouseEvent, items: MenuItem[]) => {
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: r.right, y: r.bottom, items })
  }
  const menuNode = menu ? (
    <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
  ) : null
  return { openMenu, menuNode }
}
