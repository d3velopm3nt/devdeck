// Collapsible, resizable bottom bar hosting the Logs and Processes views —
// always available beneath the dock, like an editor's output panel. Height and
// collapsed/active-tab state are owned by App (persisted to localStorage).

import { useEffect, useRef } from 'react'
import { LogViewer } from './LogViewer'
import { ProcessDashboard } from './ProcessDashboard'
import { EventStream } from './EventStream'
import { useAiw } from '../lib/aiwStore'
import { useApp } from '../store'
import { Icon } from '../lib/icons'

export type BottomTab = 'logs' | 'processes' | 'events'

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
  const events = useAiw((s) => s.events)
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
            ? 'border-indigo-400 text-ink'
            : 'border-transparent text-muted hover:text-body'
        }`}
        onClick={() => {
          if (collapsed) onToggleCollapsed()
          onTab(id)
        }}
      >
        {label}
        {badge != null && badge > 0 && (
          <span className="rounded bg-soft px-1 text-[9.5px] tabular-nums text-body">{badge}</span>
        )}
      </button>
    )
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-panel">
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
        {/* The AI Workspace's bus, in the order it happened. Beside the log
            rather than inside the Assistant: when an agent does something
            surprising you want the events without leaving the page you were
            on. */}
        <TabBtn id="events" label="Events" badge={events.length} />
        <div className="flex-1" />
        <button
          className="flex items-center rounded px-2 py-1 text-dim hover:bg-hover hover:text-ink"
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
          onClick={onToggleCollapsed}
        >
          <Icon name={collapsed ? 'caret-up' : 'chevron-down'} size={14} />
        </button>
      </div>

      {/* body */}
      {!collapsed && (
        <div style={{ height }} className="min-h-0 border-t border-line">
          {tab === 'logs' ? (
            <LogViewer />
          ) : tab === 'events' ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* Say what this is. "What happened" lives in three places now —
                  the thread that did it, the Inbox for anything addressed to
                  you, and Logs for raw process output. This is none of those:
                  it is the bus itself, kept for when something surprising
                  happened and the narrated version is the wrong tool. */}
              <div className="shrink-0 border-b border-line px-3 py-1 text-[10.5px] text-faint">
                The raw event bus, in order, for debugging. What agents and bots
                actually said is in their threads.
              </div>
              <div className="min-h-0 flex-1">
                <EventStream />
              </div>
            </div>
          ) : (
            <ProcessDashboard />
          )}
        </div>
      )}
    </div>
  )
}
