import type { GoalRow } from '../../lib/aiw'
import { useApp } from '../../store'
import { BotsPage } from '../BotsPage'
import { WorkPage } from '../work/WorkPage'

/** Legacy goal controls share this board contract with the Work hub. */
export interface Board { rows: GoalRow[]; error: string | null; loaded: boolean }
export function TeamPage() {
  const tab = useApp(s => s.teamTab)
  // Preserve saved deep links to the former Bots view.
  return tab === 'bots' ? <BotsPage compact/> : <WorkPage/>
}
