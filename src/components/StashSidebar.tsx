// Stash's contextual sidebar: groups, the projects clips were captured in,
// and the smart type tags. Fixed chrome like the Explorer — no tab chrome,
// no dock panel.

import { useApp } from '../store'
import { Icon, type IconName } from '../lib/icons'
import type { StashCounts, StashFilter } from '../lib/types'

const GROUPS: Array<{ key: StashFilter; icon: IconName; label: string; tint: string }> = [
  { key: 'clips', icon: 'clip', label: 'Clips', tint: 'text-dim' },
  { key: 'code', icon: 'code', label: 'Code & SQL', tint: 'text-viol' },
  { key: 'links', icon: 'link', label: 'Links', tint: 'text-indigo-300' },
  { key: 'errors', icon: 'alert', label: 'Errors', tint: 'text-err' },
  { key: 'secrets', icon: 'secret', label: 'Flagged secrets', tint: 'text-warn' },
]

const countFor = (c: StashCounts | null, key: StashFilter): number => (c ? c[key] : 0)

function Row({
  icon,
  label,
  tint,
  n,
  active,
  onClick,
}: {
  icon: IconName
  label: string
  tint?: string
  n?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
        active ? 'bg-raise text-ink' : 'text-body hover:bg-hover/50'
      }`}
      onClick={onClick}
    >
      <Icon name={icon} size={13} className={active ? undefined : tint} />
      <span className="truncate">{label}</span>
      {n != null && <span className="ml-auto font-mono text-[10px] text-muted">{n}</span>}
    </button>
  )
}

function Tag({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded-full border px-2 py-[2px] font-mono text-[10px] ${
        active
          ? 'border-transparent bg-indigo-500/20 text-indigo-300'
          : 'border-line2 text-dim hover:bg-hover/50'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function StashSidebar() {
  const { stashCounts: counts, stashFilters: f, setStashFilters, createStashNote } = useApp()

  // Picking a group clears the type tag (and vice-versa) — the two both
  // narrow by type, so combining them mostly produces an empty list.
  const pickGroup = (filter: StashFilter) => setStashFilters({ filter, itemType: '' })
  const pickType = (t: string) =>
    setStashFilters({ filter: 'all', itemType: f.itemType === t ? '' : t })
  const pickProject = (id: number | null, none: boolean) => {
    const active = none ? f.noProject : f.projectId === id
    setStashFilters({ projectId: active ? null : id, noProject: active ? false : none })
  }
  // User tags stack with a group filter — "pinned things tagged tyrex bug" is
  // a sensible thing to ask for, unlike "links that are json".
  const pickTag = (name: string) => setStashFilters({ tag: f.tag === name ? '' : name })

  return (
    <div className="flex h-full flex-col bg-app">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Icon name="stash" size={14} className="text-indigo-400" />
        <span className="text-[12.5px] font-semibold text-ink">Stash</span>
        <button
          className="btn-ghost ml-auto inline-flex items-center gap-1 text-[11px]"
          title="Write a note — an item you type, that never touched the clipboard"
          onClick={() => void createStashNote('', '')}
        >
          <Icon name="add" size={11} /> Note
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        <Row
          icon="list"
          label="All items"
          n={countFor(counts, 'all')}
          active={f.filter === 'all' && !f.itemType}
          onClick={() => pickGroup('all')}
        />
        <Row
          icon="star"
          label="Pinned"
          tint="text-warn"
          n={countFor(counts, 'pinned')}
          active={f.filter === 'pinned'}
          onClick={() => pickGroup('pinned')}
        />
        <Row
          icon="image"
          label="Screenshots"
          tint="text-ok"
          n={countFor(counts, 'screenshots')}
          active={f.filter === 'screenshots'}
          onClick={() => pickGroup('screenshots')}
        />
        <Row
          icon="note"
          label="Notes"
          tint="text-indigo-300"
          n={countFor(counts, 'notes')}
          active={f.filter === 'notes'}
          onClick={() => pickGroup('notes')}
        />

        {counts && counts.tags.length > 0 && (
          <>
            <div className="flex items-center px-2 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
              Tags
              {f.tag && (
                <button
                  className="ml-auto normal-case tracking-normal text-muted hover:text-ink"
                  onClick={() => setStashFilters({ tag: '' })}
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 px-2">
              {counts.tags.map((t) => (
                <Tag
                  key={t.id}
                  label={`${t.name} · ${t.n}`}
                  active={f.tag === t.name}
                  onClick={() => pickTag(t.name)}
                />
              ))}
            </div>
          </>
        )}

        <div className="px-2 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
          Types
        </div>
        {GROUPS.map((g) => (
          <Row
            key={g.key}
            icon={g.icon}
            label={g.label}
            tint={g.tint}
            n={countFor(counts, g.key)}
            active={f.filter === g.key}
            onClick={() => pickGroup(g.key)}
          />
        ))}

        {counts && counts.projects.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
              Captured in
            </div>
            <div className="flex flex-wrap gap-1.5 px-2">
              {counts.projects.map((p) => {
                const none = p.project_id == null
                return (
                  <Tag
                    key={p.project_id ?? 'none'}
                    label={`${none ? 'no project' : p.name || `#${p.project_id}`} · ${p.n}`}
                    active={none ? f.noProject : f.projectId === p.project_id}
                    onClick={() => pickProject(p.project_id, none)}
                  />
                )
              })}
            </div>
          </>
        )}

        {counts && counts.types.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
              Smart tags
            </div>
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {counts.types.map((t) => (
                <Tag
                  key={t.item_type}
                  label={`${t.item_type} · ${t.n}`}
                  active={f.itemType === t.item_type}
                  onClick={() => pickType(t.item_type)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
