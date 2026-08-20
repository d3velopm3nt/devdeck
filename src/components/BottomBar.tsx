// Collapsible, resizable bottom bar hosting the Logs and Processes views —
// always available beneath the dock, like an editor's output panel. Height and
// collapsed/active-tab state are owned by App (persisted to localStorage).

import { useEffect, useRef } from 'react'
import { LogViewer } from './LogViewer'
import { ProcessDashboard } from './ProcessDashboard'
import { useApp } from '../store'

export type BottomTab = 'logs' | 'processes'

const MIN_H = 140
const bottomChrome = 220 // leave room for the top bar + a slice of the dock

export function BottomBar({
  tab,
  onTab,
  collapsed,
  onToggleCollapsed,
  height,
  onHeight,
}: {
  tab: BottomTab
  onTab: (t: BottomTab) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  height: number
  onHeight: (h: number) => void
}) {
  const { logs, svcStates } = useApp()
  const drag = useRef<{ startY: number; startH: number } | null>(null)

  // Drag the top edge to resize (dragging up grows the panel).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const next = drag.current.startH - (e.clientY - drag.current.startY)
      const max = Math.max(MIN_H, window.innerHeight - bottomChrome)
      onHeight(Math.min(max, Math.max(MIN_H, next)))
    }
    const up = () => (drag.current = null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [onHeight])

  const runningCount = Object.values(svcStates).filter((s) => s.status === 'running').length

  const TabBtn = ({ id, label, badge }: { id: BottomTab; label: string; badge?: number }) => {
    const active = !collapsed && tab === id
    return (
      <button
        className={`flex items-center gap-1.5 border-b-2 px-2.5 py-1 text-[11.5px] transition ${
          active
            ? 'border-indigo-400 text-slate-100'
            : 'border-transparent text-slate-500 hover:text-slate-300'
        }`}
        onClick={() => {
          if (collapsed) onToggleCollapsed()
          onTab(id)
        }}
      >
        {label}
        {badge != null && badge > 0 && (
          <span className="rounded bg-slate-700/70 px-1 text-[9.5px] tabular-nums text-slate-300">{badge}</span>
        )}
      </button>
    )
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-slate-800 bg-[#11141c]">
      {/* resize handle (hidden when collapsed) */}
      {!collapsed && (
        <div
          className="h-1 cursor-ns-resize bg-transparent hover:bg-indigo-500/40"
          onPointerDown={(e) => {
            drag.current = { startY: e.clientY, startH: height }
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          }}
        />
      )}

      {/* header: tabs + collapse toggle */}
      <div className="flex items-center gap-1 px-1">
        <TabBtn id="logs" label="Logs" badge={logs.length} />
        <TabBtn id="processes" label="Processes" badge={runningCount} />
        <div className="flex-1" />
        <button
          className="rounded px-2 py-1 text-[12px] text-slate-400 hover:bg-slate-700 hover:text-white"
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {/* body */}
      {!collapsed && (
        <div style={{ height }} className="min-h-0 border-t border-slate-800">
          {tab === 'logs' ? <LogViewer /> : <ProcessDashboard />}
        </div>
      )}
    </div>
  )
}
