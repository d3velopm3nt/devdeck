import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as ipc from './ipc'
import { useChatWorkspace } from './chatWorkspace'
import { useApp } from '../store'

export type TeamView = 'work' | 'messages'
type Navigation = {
  teams: ipc.ReusableTeam[]; error: string; loading: boolean; expanded: string[];
  directory: 'teams' | 'library' | 'discover'; team: string; view: TeamView; query: string;
  reload: () => Promise<void>;
}
let pending: Promise<void> | null = null
export const useTeamNavigation = create<Navigation>()(persist((set) => ({
  directory: 'teams', teams: [], error: '', loading: false, expanded: [], team: '', view: 'work', query: '',
  reload: () => {
    if (pending) return pending
    set({ loading: true })
    pending = ipc.reusableTeamsList().then(teams => { set({ teams, error: '' }) }).catch(e => { set({ error: String(e) }) }).finally(() => { pending = null; set({ loading: false }) })
    return pending
  },
}), { name: 'devdeck.team-navigation', partialize: ({ expanded, team, view }) => ({ expanded, team, view }) }))
export function openTeamView(team: string, view: TeamView) {
  useTeamNavigation.setState({ team, view, query: '' })
  useApp.getState().setTeamTab(view)
}

export function openTeams(team?: ipc.ReusableTeam) {
  useTeamNavigation.setState({ directory:'teams' })
  useChatWorkspace.setState({ designerTeam:team })
  useApp.getState().setRailView('workers')
}
