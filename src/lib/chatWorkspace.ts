import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { aiw } from './aiw'
import { useAiw } from './aiwStore'
import type { TeamProposal, ReusableTeam } from './ipc'
import { parsePlannerReply, useBuildDiscussion } from './teamPlanning'

export type PanelView = 'team' | 'workflow' | 'context' | 'activity' | 'browser' | 'files' | 'canvas' | 'home' | 'run'
type Subject = { run?: { id: string; title: string }; workItem?: string; draft?: string; planning?: boolean; team?: ReusableTeam; proposal?: TeamProposal | null; choices?: string[]; error?: string; saved?: boolean }
type Workspace = {
  split: boolean; inspector: boolean; tabs: PanelView[]; tab: PanelView; width: number; listWidth: number; inspectorWidth: number; designerTeam?: ReusableTeam; pinned: string[]; subjects: Record<string, Subject>; pending: string | null
  patch: (id: string, update: Partial<Subject>) => void
}
export const useChatWorkspace = create<Workspace>()(persist((set) => ({
  split: false, inspector: window.innerWidth > 760, tabs: ['home'], tab: 'home', width: 560, listWidth: 208, inspectorWidth: 270, pinned: [], subjects: {}, pending: null,
  patch: (id, update) => set(s => ({ subjects: { ...s.subjects, [id]: { ...s.subjects[id], ...update } } })),
}), { name: 'devdeck.chat-workspace.v1', partialize: ({ split, inspector, tabs, tab, width, listWidth, inspectorWidth, pinned, subjects }) => ({ split, inspector, tabs, tab, width, listWidth, inspectorWidth, pinned, subjects }) }))

/** Adopt the existing record without copying or recreating its messages. */
export async function migrateBuildDiscussion() {
  const legacy = useBuildDiscussion.getState()
  if (!legacy.conversation || useChatWorkspace.getState().subjects[legacy.conversation]) return
  const assistant = useAiw.getState().agents.find(a => a.id === 'assistant')
  const proposal = legacy.proposal && assistant ? { ...legacy.proposal, connection: legacy.proposal.connection ?? { provider: assistant.provider, model: assistant.model } } : legacy.proposal
  useChatWorkspace.getState().patch(legacy.conversation, { planning: true, draft: legacy.input, proposal, choices: legacy.choices, saved: !!legacy.created, team: legacy.created ?? undefined })
}

export async function sendTeamMessage(id: string, text: string) {
  const w = useChatWorkspace.getState()
  if (w.pending || useAiw.getState().sending) return
  const subject = w.subjects[id] ?? {}
  const assistant = useAiw.getState().agents.find(a => a.id === 'assistant')
  useChatWorkspace.setState({ pending: id })
  w.patch(id, { error: '', draft: subject.draft === text ? '' : subject.draft })
  try {
    const reply = await aiw.teamPlannerSend(id, text, subject.team?.id)
    const parsed = parsePlannerReply(reply.reply)
    const proposal = parsed.proposalIssue ? null : parsed.proposal ? { ...parsed.proposal,
      target: subject.team ? { id: subject.team.id, revision: subject.team.revision } : undefined,
      connection: assistant ? { provider: assistant.provider, model: assistant.model } : undefined,
    } : subject.proposal
    useChatWorkspace.getState().patch(id, { proposal, choices: parsed.choices, saved: parsed.proposal ? false : subject.saved, error: parsed.proposalIssue ?? '' })
    if (parsed.proposal && useAiw.getState().conversation?.id === id) useChatWorkspace.setState({ split: true, tab: 'team' })
    if (useAiw.getState().conversation?.id === id) await useAiw.getState().openConversation(id)
    await useAiw.getState().loadConversations()
  } catch (e) { useChatWorkspace.getState().patch(id, { error: String(e), draft: useChatWorkspace.getState().subjects[id]?.draft || text }) }
  finally { useChatWorkspace.setState({ pending: null }) }
}

/** Keep receipt inspection beside the conversation that opened it. */
export function openChatRun(conversation: string, run: string, title: string) {
  useChatWorkspace.getState().patch(conversation, { run: { id: run, title } })
  useChatWorkspace.setState(w => ({ split: true, tab: 'run', tabs: [...new Set([...w.tabs, w.tab, 'run' as const])] }))
}
