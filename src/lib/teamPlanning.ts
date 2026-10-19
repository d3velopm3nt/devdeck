import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as ipc from './ipc'

export function parsePlannerReply(reply: string): { text: string; choices: string[]; proposal?: ipc.TeamProposal; proposalIssue?: string } {
  try {
    const value = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (typeof value.message !== 'string' || !value.message.trim()) throw new Error('Missing message')
    const proposal = parseProposal(value.proposal)
    return { proposal, proposalIssue: value.proposal && !proposal ? 'The proposed structure could not be loaded. Ask Team Builder to revise it, or use Propose team now.' : undefined, text: value.message, choices: Array.isArray(value.choices) ? [...new Set<string>(value.choices.filter((choice: unknown): choice is string => typeof choice === 'string' && !!choice.trim()).map((choice: string) => choice.trim()))].slice(0, 4) : [] }
  } catch { return { text: reply, choices: [] } }
}

function parseProposal(value: unknown): ipc.TeamProposal | undefined {
  if (!value || typeof value !== 'object') return undefined
  const p = value as Record<string, unknown>
  if (typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.members) || !p.members.length || p.members.length > 20) return undefined
  const members: ipc.TeamProposalMember[] = []
  for (const m of p.members) {
    if (!m || typeof m.role !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(m.role) || typeof m.name !== 'string' || !m.name.trim() || !['manager', 'specialist', 'worker'].includes(m.kind) || typeof m.instructions !== 'string' || m.instructions.length > 20000) return undefined
    members.push({ role: m.role, name: m.name.slice(0,200), kind: m.kind, instructions: m.instructions, reports_to: typeof m.reports_to === 'string' ? m.reports_to : '', worker: typeof m.worker === 'string' ? m.worker : '' })
  }
  if (new Set(members.map(m => m.role)).size !== members.length) return undefined
  const roots = members.filter(m => !m.reports_to)
  if (roots.length !== 1 || roots[0].kind !== 'manager') return undefined
  for (const member of members) {
    const seen = new Set([member.role]); let parent = member.reports_to
    while (parent) {
      if (seen.has(parent)) return undefined
      seen.add(parent)
      const manager = members.find(m => m.role === parent)
      if (!manager || manager.kind !== 'manager') return undefined
      parent = manager.reports_to
    }
  }
  return { id: `team-${crypto.randomUUID().replaceAll('-', '').slice(0,24)}`, name: p.name.slice(0,200), description: typeof p.description === 'string' ? p.description.slice(0,20000) : '', members }
}

type BuildDiscussion = {
  proposal: ipc.TeamProposal | null
  created: ipc.ReusableTeam | null
  creating: boolean
  input: string
  messages: { role: string; text: string }[]
  choices: string[]
  conversation: string | null
  generation: number
  busy: boolean
  error: string
}
export const useBuildDiscussion = create<BuildDiscussion>()(persist((): BuildDiscussion => ({
  proposal: null, created: null, creating: false, input: '', messages: [], choices: [], conversation: null, generation: 0, busy: false, error: '',
}), {
  name: 'devdeck.team-build-discussion',
  partialize: ({ input, messages, choices, conversation, proposal, created }) => ({ input, messages, choices, conversation, proposal, created }),
}))

/** Read a human-facing preview even when the persisted JSON summary is truncated. */
export function plannerPreview(text: string): string {
  if (!text.trim().startsWith('{')) return text
  const match = text.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (!match) return 'Team discussion'
  try { return JSON.parse('"' + match[1] + '"') as string } catch { return 'Team discussion' }
}
