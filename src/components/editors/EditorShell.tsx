// Shared chrome for the dedicated editor pages: header with icon +
// title, a scrollable body, and a sticky action bar.

import type { ReactNode } from 'react'
import { Icon } from '../../lib/icons'

/** Props contract for editor pages hosted in the slide-over Sheet. A
 *  structural subset of dockview's panel props, so pages need no host
 *  awareness: params + a close() to dismiss. */
export interface EditorPageProps<P> {
  params: P
  api: { close: () => void }
}

export function EditorShell({
  icon,
  kind,
  title,
  subtitle,
  children,
  onCancel,
  onSave,
  canSave,
  onDelete,
  extraActions,
}: {
  icon: string
  kind: string
  title: string
  subtitle?: string
  children: ReactNode
  onCancel: () => void
  onSave: () => void
  canSave: boolean
  onDelete?: () => void
  extraActions?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col bg-panel text-body">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-indigo-500/15 text-indigo-400">
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {kind} editor
          </div>
          <div className="truncate text-[16px] font-semibold text-ink">{title}</div>
          {subtitle && <div className="text-[12px] text-muted">{subtitle}</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-3">{children}</div>
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-panel px-5 py-3">
        {onDelete && (
          <button className="btn-danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <div className="flex-1" />
        {extraActions}
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!canSave} onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}
