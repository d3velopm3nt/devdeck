import type * as ipc from '../../lib/ipc'

export function ProposalChart({ proposal, onSelect }: { proposal: ipc.TeamProposal; onSelect?: (role: string) => void }) {
  const node = (member: ipc.TeamProposalMember): React.ReactNode => <li key={member.role}><button type="button" className="build-org-node" aria-label={'Inspect ' + member.name} onClick={() => onSelect?.(member.role)}><strong>{member.name}</strong><span>{member.kind} · {member.role}</span></button>{proposal.members.some(m => m.reports_to === member.role) && <ul>{proposal.members.filter(m => m.reports_to === member.role).map(node)}</ul>}</li>
  return <div className="build-org" aria-label="Proposed team organogram"><ul>{proposal.members.filter(m => !m.reports_to).map(node)}</ul></div>
}
