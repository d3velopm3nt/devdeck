import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { LibraryPanel } from '../src/components/workers/LibraryPanel'
import type { TeamPackagePreview, ReusableTeam } from '../src/lib/ipc'
import '../src/index.css'
const raw = import.meta.glob('../factories/software-factory/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const prefix = '../factories/software-factory/'
const team = JSON.parse(raw[prefix + 'team.json']) as ReusableTeam
const texts = Object.entries(raw).filter(([path]) => path.endsWith('/SKILL.md') || path.includes('/agents/')).map(([path, content]) => {
  const kind = path.endsWith('/SKILL.md') ? 'skill' : 'brief'
  const id = kind === 'skill' ? path.split('/').at(-2)! : path.split('/').at(-1)!.replace('.md', '')
  return { id, kind, path: path.replace(prefix, ''), content, name: content.match(/^name: (.+)$/m)?.[1] || id, description: content.match(/^description: (.+)$/m)?.[1] || '' }
})
const skills = Object.fromEntries(team.roles.map(role => [role.name, texts.find(t => t.id === role.worker && t.kind === 'brief')?.content.match(/^  - (.+)$/m)?.slice(1) || []]))
const preview: TeamPackagePreview = { folder: 'fixture/software-factory', fingerprint: 'fixture', team, texts, skills, context: raw[prefix + 'README.md'] }
let imported = false
const handlers = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
handlers.library_agents = () => []
handlers.team_package_templates = () => imported ? [preview] : []
handlers.team_package_inspect = () => preview
handlers.team_package_save_template = () => { imported = true; return preview }
createRoot(document.getElementById('root')!).render(<div className="workforce p-6"><p>Browser fixture: actual package text, simulated backend and persistence.</p><LibraryPanel items={[]} reload={() => {}} /></div>)
