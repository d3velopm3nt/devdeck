import { useRef } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Sparkles } from 'lucide-react'
import * as ipc from '../../lib/ipc'
import { aiw } from '../../lib/aiw'

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
    members.push({ role: m.role, name: m.name.slice(0,200), kind: m.kind, instructions: m.instructions, reports_to: typeof m.reports_to === 'string' ? m.reports_to : '', worker: '' })
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

function ProposalChart({ proposal }: { proposal: ipc.TeamProposal }) {
  const node = (member: ipc.TeamProposalMember): React.ReactNode => <li key={member.role}><div className="build-org-node"><strong>{member.name}</strong><span>{member.kind} · {member.role}</span></div>{proposal.members.some(m => m.reports_to === member.role) && <ul>{proposal.members.filter(m => m.reports_to === member.role).map(node)}</ul>}</li>
  return <div className="build-org" aria-label="Proposed team organogram"><ul>{proposal.members.filter(m => !m.reports_to).map(node)}</ul></div>
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
const useBuildDiscussion = create<BuildDiscussion>()(persist((): BuildDiscussion => ({
  proposal: null, created: null, creating: false, input: '', messages: [], choices: [], conversation: null, generation: 0, busy: false, error: '',
}), {
  name: 'devdeck.team-build-discussion',
  partialize: ({ input, messages, choices, conversation, proposal, created }) => ({ input, messages, choices, conversation, proposal, created }),
}))

export function TeamBuild({ workers = [], onCreated }: { workers?: ipc.Worker[]; onCreated?: (team: ipc.ReusableTeam) => void }) {
  const { input, messages, busy, error, choices, proposal, creating, created } = useBuildDiscussion()
  const setInput = (input: string) => useBuildDiscussion.setState({ input })
  const setError = (error: string) => useBuildDiscussion.setState({ error })
  const setBusy = (busy: boolean) => useBuildDiscussion.setState({ busy })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const restart = () => useBuildDiscussion.setState(state => ({
    proposal: null, created: null, creating: false, generation: state.generation + 1, conversation: null, messages: [], input: '', error: '', busy: false, choices: [],
  }))
  const send = async (answer?: string) => {
    const text = (answer ?? input).trim()
    if (!text || useBuildDiscussion.getState().busy || useBuildDiscussion.getState().creating) return
    const current = useBuildDiscussion.getState().generation
    setBusy(true); setError('')
    try {
      let id = useBuildDiscussion.getState().conversation
      if (!id) id = (await aiw.newConversation()).id
      if (current !== useBuildDiscussion.getState().generation) return
      useBuildDiscussion.setState({ conversation: id })
      const reply = await aiw.teamPlannerSend(id, text)
      if (current !== useBuildDiscussion.getState().generation) return
      const parsed = parsePlannerReply(reply.reply)
      useBuildDiscussion.setState(state => ({
        choices: parsed.choices,
        proposal: parsed.proposalIssue ? null : parsed.proposal ?? state.proposal,
        error: parsed.proposalIssue || '',
        created: parsed.proposal ? null : state.created,
        messages: [...state.messages, { role: 'You', text }, { role: 'Team Builder', text: parsed.text }],
        input: '',
      }))
    } catch (e) { if (current === useBuildDiscussion.getState().generation) setError(String(e)) }
    finally { if (current === useBuildDiscussion.getState().generation) setBusy(false) }
  }
  const build = async () => {
    const state = useBuildDiscussion.getState()
    if (!state.proposal || state.creating || state.busy) return
    useBuildDiscussion.setState({ creating: true, error: '' })
    try {
      const team = await ipc.teamBuilderCreate(state.proposal)
      useBuildDiscussion.setState({ created: team })
      onCreated?.(team)
    } catch (e) { setError(String(e)) }
    finally { useBuildDiscussion.setState({ creating: false }) }
  }
  return <section className="team-build-conversation">
    <div className="flex items-center justify-between gap-3"><span className="wf-eyebrow">DESIGN YOUR TEAM</span><button className="wf-secondary" disabled={creating} onClick={restart}>New discussion</button></div>
    <h2>Start with what you want to accomplish.</h2>
    <p>Discuss the work, refine the roles, and shape the team before opening the organogram.</p>
    {!messages.length && <div className="team-build-starters">{['Build and maintain a software product', 'Research topics and produce reports', 'Review code and improve quality'].map(text => <button className="wf-secondary" key={text} onClick={() => setInput(text)}>{text}</button>)}</div>}
    <div className="team-build-messages" aria-live="polite">{messages.map((message, index) => <article key={index}><strong>{message.role === 'Team planner' ? 'Team Builder' : message.role}</strong><p>{message.text}</p></article>)}</div>
    {!!choices.length && <div className="team-build-choices" aria-label="Suggested answers">{choices.map(choice => <button className="wf-secondary" key={choice} disabled={busy || creating} onClick={() => void send(choice)}>{choice}</button>)}<button className="wf-secondary" disabled={busy || creating} onClick={() => inputRef.current?.focus()}>Other / write my own</button></div>}
    {proposal && <section className="build-proposal" aria-label="Review team proposal">
      <header><div><span className="wf-eyebrow">{created ? 'TEAM SAVED' : 'PROPOSED TEAM'}</span><h3>{proposal.name}</h3><p>{proposal.description}</p></div><span className="wf-badge">{proposal.members.length} members</span></header>
      <ProposalChart proposal={proposal} />
      <div className="build-member-list">{proposal.members.map((member, index) => <article key={member.role}><div><strong>{member.name}</strong><span className="wf-muted">{member.reports_to ? `Reports to ${member.reports_to}` : 'Team lead'}</span><p>{member.instructions}</p></div><label>Library agent<select aria-label={`Agent for ${member.role}`} className="input" disabled={creating || busy || !!created} value={member.worker} onChange={e => useBuildDiscussion.setState({ proposal: { ...proposal, members: proposal.members.map((m,i) => i === index ? { ...m, worker: e.target.value } : m) } })}><option value="">Create new agent</option>{workers.map(w => <option key={w.handle} value={w.handle}>{w.name}</option>)}</select></label></article>)}</div>
      <p className="wf-muted">New agents start with Claude Code / Sonnet, a 20-minute and $2 budget, and no unattended permissions. Review their model, skills, and tools in the designer before running work. Saving starts no tasks.</p>
      <div className="wf-actions">{created ? <button className="wf-primary" onClick={() => onCreated?.(created)}>Open saved team</button> : <button className="wf-primary" disabled={creating || busy} onClick={() => void build()}>{creating ? 'Creating team…' : 'Create team'}</button>}<span className="wf-muted">{created ? 'Edit this team in the designer. A new proposal creates a separate team.' : 'Ask for changes below before creating.'}</span></div>
    </section>}
    <form onSubmit={event => { event.preventDefault(); void send() }}><label htmlFor="team-build-prompt">{messages.length ? "Your reply or additional details" : "What should this team do?"}</label><textarea ref={inputRef} id="team-build-prompt" value={input} onChange={event => setInput(event.target.value)} placeholder="Add your own answer, preferences, or constraints..." rows={3} disabled={busy || creating} /><div className="wf-actions"><button className="wf-primary" disabled={busy || creating || !input.trim()}><Sparkles size={14} />{busy ? 'Thinking...' : messages.length ? 'Send reply' : 'Discuss my team'}</button>{!!messages.length && <button type="button" className="wf-secondary" disabled={busy || creating} onClick={() => void send('Propose a rough team now using what I have already shared. State assumptions instead of asking more questions.')}>Propose team now</button>}</div></form>
    {error && <p role="alert" className="text-err">{error}</p>}
    <p className="team-build-note">Team Builder proposes the structure. You review it, then create the team and its Library agents together. New discussions use your latest agent settings.</p>
  </section>
}
