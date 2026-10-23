import type { LibraryItem, LibrarySource, Worker } from './ipc'

export interface SuggestedStep { id: string; title: string; instructions: string }
export interface InstructionSource { repo: string; commit: string; path: string; text: string }

/** Read the pinned attribution written by this import flow. Display metadata only. */
export function instructionOrigin(text: string): Pick<InstructionSource, 'repo' | 'commit' | 'path'> | null {
  const match = text.match(/^Source: https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/blob\/([a-f0-9]{40})\/(AGENTS\.md)\r?\n/i)
  return match ? { repo: match[1], commit: match[2], path: match[3] } : null
}

/** Conservative extraction: only an explicit process heading with an ordered list.
 * Fences are opaque. Conditions and the complete original remain in shared context.
 * Suggestions never execute, and their order must be reviewed before saving. */
export function suggestWorkflow(text: string): SuggestedStep[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let fence = '', depth = 0, active = false
  const steps: SuggestedStep[] = []
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (marker) {
      if (active && steps.length) steps[steps.length - 1].instructions += `\n${line}`
      if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = ''
      continue
    }
    if (fence) { if (active && steps.length) steps[steps.length - 1].instructions += `\n${line}`; continue }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) {
      if (active && heading[1].length <= depth) break
      if (!active && /^(?:agent\s+)?(?:workflow|process|procedure)(?:\s|$)/i.test(heading[2])) {
        // Prefer the explicit section inside a document named "Agent workflow".
        if (heading[1].length === 1 && lines.some(l => /^##\s+(?:workflow|process|procedure)\s*$/i.test(l))) continue
        active = true; depth = heading[1].length
      }
      continue
    }
    if (!active) continue
    const item = line.match(/^\d+[.)]\s+(.+)$/)
    if (item) {
      const title = item[1].match(/^\*\*(.+?)\*\*/)?.[1] || item[1].split(/(?<=[.!?])\s/)[0]
      steps.push({ id: `step-${steps.length + 1}`, title: title.replace(/[.:]$/, '').slice(0, 120), instructions: item[1] })
      if (steps.length > 100) return []
    } else if (steps.length) steps[steps.length - 1].instructions += `\n${line}`
  }
  return steps.map(s => ({ ...s, instructions: s.instructions.trim() }))
}

export function sourceContext(source: InstructionSource): string {
  return `Source: https://github.com/${source.repo}/blob/${source.commit}/${source.path}\n\n${source.text}`
}

export function agentFromInstructions(source: InstructionSource, name: string, skills: string[], model: string): Worker {
  return { handle: '', name: name.trim(), what: `Repository agent from ${source.repo}`, category: 'worker', profile: 'Custom',
    brief: '', skills, kit: '', runner: 'claude-code', model, writes: 'branch', minutes: 20, usd: 2,
    spaces: [], unattended: false, allow: [], allow_until: '', created_at: '', body: sourceContext(source) }
}

/** IDs alone are insufficient: a same-named skill may belong to another author. */
export function matchingSkills(source: LibrarySource, installed: LibraryItem[]): Set<string> {
  return new Set(source.items.filter(candidate => candidate.kind === 'skill' && installed.some(item =>
    item.kind === 'skill' && item.id === candidate.id && item.repo === source.repo && item.commit === source.commit && item.path === candidate.path,
  )).map(item => item.id))
}

export function workflowFromInstructions(source: InstructionSource, title: string, steps: SuggestedStep[], worker: string, target: number): string {
  const definition = { title: title.trim(), steps: steps.map((step, i) => ({ ...step, worker, target, needs: i ? [steps[i - 1].id] : [] })) }
  // JSON is valid YAML and safely quotes untrusted titles and multiline text.
  return `---\n${JSON.stringify(definition, null, 2)}\n---\n\n# Original instructions and conditions\n\n${sourceContext(source)}\n`
}

export async function readRepositoryInstructions(repo: string, commit: string, signal: AbortSignal): Promise<InstructionSource | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Inspect a repository revision first.')
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/AGENTS.md?ref=${commit}`, { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Could not read AGENTS.md (${response.status}). Retry after checking GitHub access.`)
  const data = await response.json()
  if (data.encoding !== 'base64' || data.size > 200_000 || typeof data.content !== 'string') throw new Error('AGENTS.md must be a text file up to 200 KB.')
  const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), c => c.charCodeAt(0))
  if (bytes.length > 200_000 || bytes.includes(0)) throw new Error('AGENTS.md must be a text file up to 200 KB.')
  return { repo, commit, path: 'AGENTS.md', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
}
