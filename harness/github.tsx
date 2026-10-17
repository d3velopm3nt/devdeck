import { createRoot } from 'react-dom/client'
import { GitHubBriefing, GitHubPage } from '../src/components/GitHubPage'
import { useApp } from '../src/store'
import { SEED } from './seed'
import '../src/index.css'
import type { IssueMonitorView } from '../src/lib/ipc'
const f = SEED as Record<string, () => unknown>
const fixture: IssueMonitorView = { raw: '', enabled: false, briefings: true, dispatch_enabled: false, bindings: [], warnings: [], dispatches: [{ repository: 'example/product', number: 33, node: 1, status: 'review', workflow: 'smoke-test', message: 'Documentation ready for human review.' }], sources: [{ repository: 'example/product', items: [{ number: 33, title: 'Documentation smoke test', state: 'open', pull_request: false, url: '', assignees: [], updated_at: '2026-10-16T12:00:00Z' }], fetched_at: '2026-10-16T12:00:00Z', last_attempt: '2026-10-16T12:00:00Z', error: '', warnings: [], truncated: false, activity: { commits: [{ sha: 'abcdef1234567', title: 'Document setup steps', author: 'Example', updated_at: '2026-10-16T12:00:00Z' }], pulls: [{ number: 48, title: 'Fix session renewal', state: 'open', head: 'abc1234567', checks: 'failed', check_error: '', reviewers: ['reviewer'], draft: false, updated_at: '2026-10-16T12:00:00Z' }], fetched_at: '2026-10-16T12:00:00Z', last_attempt: '', error: '', warnings: ['Recent activity window, not complete history.'] }, briefing: { fingerprint: 'sample', attempted: 'sample', attempted_at: '', generated_at: '2026-10-16T12:00:00Z', text: 'PR #48 has a failing check. Review its logs before merging. The new commit updates documentation.', error: '', unread: true } }] }
f.issue_monitor_get = () => structuredClone(fixture)
f.repository_briefing_read = () => { fixture.sources[0].briefing!.unread = false; return structuredClone(fixture) }
function Preview() { const view = useApp(s => s.railView); return view !== 'today' && view !== 'github' ? <div><h1>{view}</h1><button onClick={() => useApp.setState({ railView: 'today' })}>Back to Today</button></div> : view === 'github' ? <GitHubPage /> : <div className="p-5"><GitHubBriefing unreadMail={4} taskAttention={2} working={1} /></div> }
useApp.setState({ railView: 'today' })
createRoot(document.getElementById('root')!).render(<Preview />)
