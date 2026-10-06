// Render production Deck surfaces with explicit fixture data, never shipped in the app.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { DeckPanel, type DeckView } from '../src/widget/DeckPanel'
import { DECK_DEFAULTS } from '../src/lib/deck'
import { useApp } from '../src/store'
import { SEED } from './seed'

const now = Date.now()
let focus: unknown =
  new URLSearchParams(location.search).get('view') === 'focus'
    ? { id: 1, goal: 'DevDeck connector', started_at: now - 24000 }
    : null
const fixture = SEED as Record<
  string,
  (args?: Record<string, unknown>) => unknown
>
const settings: Record<string, unknown> = {}
fixture.setting_get = (args) => settings[String(args?.key)] ?? null
fixture.setting_set = (args) => {
  settings[String(args?.key)] = args?.value
}
fixture.focus_current = () => focus
fixture.focus_start = () =>
  (focus = { id: 2, goal: 'DevDeck connector', started_at: Date.now() })
fixture.focus_end = () => {
  focus = null
}
fixture.calendar_range = () =>
  ['Team planning', 'Exercise reminder', 'MineX review'].map((title, i) => ({
    id: String(i),
    title,
    kind: 'schedule',
    sort: ['Project sync', 'Personal', 'Product discussion'][i],
    space: ['DevDeck', 'Home', 'MineX'][i],
    at: now + (i + 1) * 3600000,
    end: now + (i + 2) * 3600000,
  }))
useApp.setState({
  nodes: [
    { id: 1, name: 'Personal', kind: 'workspace' },
    { id: 2, name: 'Develtech', kind: 'workspace' },
    { id: 3, name: 'InnoTrack', kind: 'workspace' },
    { id: 4, name: 'Home', kind: 'project', parent_id: 1 },
    { id: 5, name: 'DevDeck', kind: 'project', parent_id: 2 },
    { id: 6, name: 'MineX', kind: 'project', parent_id: 3 },
  ] as never,
})
export function Preview() {
  const [view, setView] = useState<DeckView>(
    (new URLSearchParams(location.search).get('view') as DeckView) || 'today',
  )
  return (
    <DeckPanel
      view={view}
      settings={DECK_DEFAULTS}
      updates={[
        {
          id: '1',
          title: 'Sampling workflow updated',
          space: 'MineX',
          kind: 'info',
          at: now - 120000,
        },
        {
          id: '2',
          title: 'Connector ready for review',
          space: 'DevDeck',
          kind: 'approval',
          at: now - 300000,
        },
      ]}
      side="right"
      onLauncherMouseDown={() => setView(view === 'menu' ? 'today' : 'menu')}
      onIcon={() => setView('menu')}
      onView={setView}
      onFull={() => {}}
      onSettings={() => {}}
      onDock={() => {}}
    />
  )
}
createRoot(document.getElementById('root')!).render(<Preview />)
