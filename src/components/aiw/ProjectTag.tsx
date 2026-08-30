// A project, named with the workspace it belongs to.
//
// These spots used to render `project_id` directly, which is a tree node id —
// so the UI said "12 · auth-refresh" and expected you to know what 12 was. The
// Assistant spans every workspace, so the workspace is not decoration here: it
// is what tells two same-named projects apart.

import { useProjectLabels } from '../../lib/aiwLabels'

export function ProjectTag({
  id,
  className = '',
}: {
  id: string | null | undefined
  className?: string
}) {
  const label = useProjectLabels()
  const p = label(id)
  if (!p) return null

  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1 ${className}`}>
      {p.workspace && (
        <>
          {/* Dimmer than the project: it is context for the name, not the name. */}
          <span className="truncate text-faint">{p.workspace}</span>
          <span className="text-faint">/</span>
        </>
      )}
      <span className="truncate">{p.name}</span>
    </span>
  )
}
