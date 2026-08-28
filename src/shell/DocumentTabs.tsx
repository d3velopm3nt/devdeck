// Open documents, from anywhere.
//
// Dockview already draws a tab per panel — but only inside the dock, and the
// dock is only on screen in the Projects view. Sitting in the AI Workspace
// with three terminals running, there was no sign they existed and no way back
// except a list buried in the DevDeck menu.
//
// So this row appears exactly when dockview's own tabs are not visible. It is
// deliberately not a second permanent tab bar: dockview's tabs are attached to
// a *group*, which is what makes split views and drag-to-rearrange work, and
// duplicating them full-time would put two rows of the same names on screen.

import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { dockApi } from '../lib/dock'
import { Icon, type IconName } from '../lib/icons'

type Doc = { id: string; title: string; component: string; active: boolean }

export function DocumentTabs() {
  const { railView, setRailView } = useApp()
  const [docs, setDocs] = useState<Doc[]>([])

  useEffect(() => {
    const api = dockApi()
    if (!api) return
    const read = () =>
      setDocs(
        api.panels.map((p) => ({
          id: p.id,
          title: p.title ?? p.id,
          component: p.view?.contentComponent ?? '',
          active: api.activePanel?.id === p.id,
        })),
      )
    read()
    // One subscription covers adds, removes, renames and focus changes; the
    // alternative is four listeners that can disagree with each other.
    const sub = api.onDidLayoutChange(read)
    return () => sub.dispose()
    // The dock outlives every rail view, so this binds once. Re-reading on
    // railView keeps the list honest if a panel closed while we were away.
  }, [railView])

  // Nothing to offer, or dockview is already showing its own tabs.
  if (railView === 'projects' || docs.length === 0) return null

  return (
    <div className="flex h-[29px] shrink-0 items-stretch border-b border-line bg-app">
      <div className="flex shrink-0 items-center gap-1.5 pl-3 pr-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
        Open
      </div>
      <div className="flex min-w-0 items-stretch overflow-x-auto">
        {docs.map((d) => (
          <button
            key={d.id}
            className={`flex shrink-0 items-center gap-1.5 border-r border-line px-2.5 text-[11.5px] ${
              d.active ? 'bg-page text-ink' : 'text-dim hover:bg-hover/40 hover:text-ink'
            }`}
            title={d.title}
            onClick={() => {
              // Focus first, then reveal: switching the view before the panel
              // is active shows whatever was last on top for a frame.
              dockApi()?.getPanel(d.id)?.api.setActive()
              setRailView('projects')
            }}
          >
            <Icon name={iconFor(d.component)} size={12} className="shrink-0 text-muted" />
            <span className="max-w-[170px] truncate">{d.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function iconFor(component: string): IconName {
  if (component === 'terminal') return 'terminal'
  if (component === 'service-detail') return 'service'
  if (component === 'space-detail') return 'project'
  if (component === 'node-setup') return 'settings'
  return 'layout'
}
