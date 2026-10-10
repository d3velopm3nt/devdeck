import { useState } from 'react'
import { useApp } from '../../store'
import { openSpace } from '../../lib/dock'
import { SpaceSetup } from '../SpaceSetup'
import { BusinessSetup } from '../business/BusinessSetup'
import { TodayBusinesses } from '../business/TodayBusinesses'
import { Frame, Header } from './LearnStep'
import type { SetupNav } from './steps'

export function WorkLifeStep({ onDone, onClose, nav }: {
  onDone: () => void
  onClose?: () => void
  nav?: SetupNav
}) {
  const nodes = useApp((s) => s.nodes)
  const refresh = useApp((s) => s.refreshTree)
  const [adding, setAdding] = useState<'work' | 'life' | null>(null)
  const personal = nodes.filter((n) => n.kind === 'workspace' && n.label?.toLowerCase() === 'personal')
  const life = personal.find((n) => n.name.toLowerCase() === 'life')
  const closeCreation = () => {
    setAdding(null)
    void refresh()
    window.dispatchEvent(new CustomEvent('devdeck:businesses-changed'))
  }
  if (adding === 'work') return <BusinessSetup onClose={closeCreation} />
  return (
    <Frame step="spaces" onClose={onClose} nav={nav}>
      <Header icon="folder" title="Set up Work & Life" text="Your main assistant brings work and personal commitments together. Spaces hold context; shared managers and specialists handle assigned work. Workflow folders keep the process and progress so you can continue with another assistant." />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold text-ink">Work</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">Add companies with their own profiles, projects, repositories and mail. Shared functional managers can serve several companies; review each assignment during setup.</p>
          <button className="btn-primary mt-4 text-xs" onClick={() => setAdding('work')}>Set up Work</button>
        </section>
        <section className="rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold text-ink">Life</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">Family, Home, Finance, Health, Routines and Knowledge. Starts with a Life manager, an evening check-in and a Sunday review you can edit.</p>
          <button className="btn-primary mt-4 text-xs" onClick={() => life ? (onDone(), openSpace(life.id, life.name)) : setAdding('life')}>{life ? 'Open Life' : 'Set up Life'}</button>
          {personal.length > 0 && <p className="mt-3 text-xs text-muted">Existing personal spaces are kept: {personal.map((n) => n.name).join(', ')}. Creating Life adds a space; it does not move their contents.</p>}
        </section>
      </div>
      <TodayBusinesses />
      <p className="text-xs leading-relaxed text-muted">Connect an AI engine and review manager permissions before running AI work. Labels and schedules remain editable. Set up either side now, and return here from Today whenever you need.</p>
      <button className="btn-primary text-sm" onClick={onDone}>Go to Today</button>
      {adding === 'life' && <SpaceSetup initialStarter="life" onClose={closeCreation} />}
    </Frame>
  )
}
