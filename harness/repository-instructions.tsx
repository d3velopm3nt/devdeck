import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { useApp } from '../src/store'
import { RepositoryInstructionsImport } from '../src/components/agents/RepositoryInstructionsImport'
import type { LibraryItem, LibrarySource, Worker } from '../src/lib/ipc'
import '../src/index.css'
import '../src/components/agents/workforce.css'

const text = '# Agent workflow\n\nApply only the parts relevant to the task. Ship only when requested.\n\n## Workflow\n\n1. **Isolate.** Preserve the task worktree.\n2. **Build.** Follow project conventions.\n3. **Prove.** Verify changed behavior.\n4. **Ship.** Only when requested.\n\n## Other rules\n\nPreserve source conditions.\n'
const source: LibrarySource = { repo: 'author/skills', commit: 'a'.repeat(40), licence: 'MIT', branch: 'main', note: '', kits: [], items: ['new-feature', 'code-structure', 'evidence-driven-testing', 'before-and-after', 'greploop', 'greploop-apps', 'unslop'].map(id => ({ id, kind: 'skill', name: id, path: `${id}/SKILL.md`, what: 'Original repository skill', have: false })) }
let installed: LibraryItem[] = []
let workers: Worker[] = []
const calls: { command: string; args: unknown }[] = []
const handlers = SEED as Record<string, (args: Record<string, unknown>) => unknown>
handlers.library_list = () => installed
handlers.workers_list = () => workers
handlers.library_install = args => {
  calls.push({ command: 'import', args })
  installed = source.items.filter(i => (args.ids as string[]).includes(i.id)).map(i => ({ ...i, repo: source.repo, commit: source.commit, licence: 'MIT', added_at: '', chars: 10 }))
  return { items: installed, missed: [] }
}
handlers.worker_save = args => {
  calls.push({ command: 'agent', args })
  if (workers.length) throw new Error('An agent with that name already exists. Choose another name.')
  const worker = { ...(args.worker as Worker), handle: 'author-repository-agent' }; workers = [worker]; return worker
}
handlers.folder_workflow_save = args => { calls.push({ command: 'workflow', args }); if (args.workflow === 'existing') throw new Error('This workflow changed. Reload before saving.'); return { path: '.devdeck/workflows/repo.md', raw: args.raw } }
const actualFetch = window.fetch.bind(window)
window.fetch = (input, init) => String(input).startsWith('https://api.github.com/repos/author/skills/contents/AGENTS.md') ? Promise.resolve(Response.json({ size: text.length, encoding: 'base64', content: btoa(text) })) : actualFetch(input, init)
useApp.setState({ nodes: [{ id: 42, name: 'Demo project', kind: 'project', parent_id: null, path: '.', rel_path: '', dir: '.', sort: 0, color: null, label: null }] })
Object.assign(window, { __instructionCalls: calls, __removeSkill: () => { installed = [] } })
const root = createRoot(document.getElementById('root')!)
let generation = 0
const render = () => root.render(<main className="workforce p-6" style={{ maxWidth: 820, margin: '0 auto' }}><p className="wf-muted mb-4">Browser fixture · simulated saves, no agents run</p><RepositoryInstructionsImport key={generation++} source={source}/></main>)
Object.assign(window, { __remountInstructions: render })
render()
