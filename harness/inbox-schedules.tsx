// Browser fixtures exercise the production UI, not native persistence or live GitHub.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InboxPage } from '../src/components/InboxPage'
import { BottomBar, type BottomTab } from '../src/components/BottomBar'
import { Today } from '../src/components/Today'
import { AssistantThread } from '../src/components/thread/AssistantThread'
import { useApp } from '../src/store'
import { useAiw } from '../src/lib/aiwStore'
import { SEED } from './seed'
import '../src/index.css'

const fixture = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const now = Date.now()
const schedules = [
  { id: 1, name: 'Repository health check', kind: 'command', manager: '', node_id: null, every: 'hourly', at_min: 0, days: '', payload: '', enabled: true, catch_up: false, last_run: now - 3600000, last_ok: true, last_note: 'Documentation check passed', next_run: now + 600000, running: false },
  { id: 2, name: 'Release review reminder', kind: 'reminder', manager: '', node_id: null, every: 'daily', at_min: 540, days: '', payload: '', enabled: false, catch_up: false, last_run: null, last_ok: false, last_note: '', next_run: null, running: false },
  { id: 3, name: 'Dev repository assessment', kind: 'agent', manager: '', node_id: null, every: 'hourly', at_min: 0, days: '', payload: '', enabled: true, catch_up: false, last_run: now - 2000, last_ok: true, last_note: 'Previous assessment completed', next_run: now + 3600000, running: true },
]
let scheduleMode = 'normal'
let requestError = false
const requestKey = 'verification.requests'
const initialRequests = [
  { id: 'github:example/product:33:blocker', version: 'event-1', source: 'example/product', title: 'Choose a workflow for documentation', evidence: 'Issue #33 asks for a documentation change. No workflow is assigned.', recommendation: 'Review the scope and select a documentation workflow before work starts.', kind: 'blocker', target: 'space:1', status: 'needs-you', at: new Date(now).toISOString(), resolution: '' },
  { id: 'github:example/product:34:review', version: 'event-2', source: 'example/product', title: 'Review documentation changes', evidence: 'The proposed documentation update is ready. Checks passed; no merge or deployment occurred.', recommendation: 'Inspect the proposed changes and record the review outcome.', kind: 'review', target: 'space:1', status: 'needs-you', at: new Date(now).toISOString(), resolution: '' },
]
const readRequests = () => JSON.parse(localStorage.getItem(requestKey) || JSON.stringify(initialRequests)) as typeof initialRequests
fixture.inbox_requests = () => {
  if (requestError) throw new Error('Fixture Inbox unavailable')
  return readRequests()
}
fixture.inbox_request_resolve = args => {
  const rows = readRequests(), row = rows.find(row => row.id === args?.id)
  if (!row || row.version !== args?.version || row.status !== 'needs-you') throw new Error('This request changed. Refresh before recording a decision.')
  if (!String(args?.resolution || '').trim()) throw new Error('A resolution is required')
  row.status = 'resolved'; row.resolution = String(args?.resolution)
  localStorage.setItem(requestKey, JSON.stringify(rows))
}
fixture.schedules_list = () => {
  if (scheduleMode === 'error') throw new Error('Fixture schedule service unavailable')
  return scheduleMode === 'empty' ? [] : schedules
}
fixture.activity_list = () => []
fixture.inbox_marks = () => JSON.parse(localStorage.getItem('verification.marks') || '[]')
fixture.inbox_floor_seed = () => 0
fixture.inbox_mark = args => {
  const rows = fixture.inbox_marks() as {item: string; read: boolean; at: number}[]
  for (const item of args?.items as string[]) {
    const existing = rows.find(row => row.item === item)
    if (existing) existing.read = Boolean(args?.read)
    else rows.push({item, read: Boolean(args?.read), at: now})
  }
  localStorage.setItem('verification.marks', JSON.stringify(rows))
}
fixture.learn_facts = () => []
fixture.runs_list = () => []
fixture.calendar_range = () => []
fixture.aiw_conversations = () => [{ id: 'fixture-dev', title: 'Dev conversation', started_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }]
fixture.aiw_conversation = () => ({ id: 'fixture-dev', title: 'Dev conversation', started_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), participants: [], messages: [] })
fixture.thread_context = () => ({parts: [], tools: [], system_tokens: 0, context_tokens: 0, tool_tokens: 0, history_turns: 0, history_tokens: 0, total_tokens: 0})
fixture.issue_monitor_get = () => ({ enabled: true, briefings: true, dispatch_enabled: false, dispatches: [], sources: [{ repository: 'example/product', items: Array.from({length: 12}, (_, i) => ({number: i + 1, title: `Documentation task ${i + 1}`, state: 'open', updated_at: new Date(now - i * 10000).toISOString()})), fetched_at: new Date(now).toISOString(), last_attempt: '', error: '', warnings: [], truncated: false, activity: { commits: [], pulls: [], warnings: [], error: '' }, briefing: { text: 'Documentation tasks are awaiting assessment. No execution has started. Review the repository activity and choose which work to discuss with Dev.', generated_at: new Date(now).toISOString(), unread: true } }], warnings: [], bindings: [], raw: '' })
fixture.open_url = args => { (window as any).fixtureOpenedUrl = args }
fixture.setting_get = args => localStorage.getItem(String(args?.key))
fixture.setting_set = args => localStorage.setItem(String(args?.key), String(args?.value))
useAiw.setState({ ready: true, approvals: [], conflicts: [], sessions: [] })
useApp.setState({ activity: [], nodes: [], railView: 'inbox', inboxLoaded: true, inboxRead: {}, svcStates: {} })
Object.assign(window, {
  fixtureSchedules: (mode: string) => { scheduleMode = mode },
  fixtureScheduleComplete: () => { schedules[2].running = false },
  fixtureAppState: () => useApp.getState(),
  fixtureRequests: () => readRequests(),
  fixtureRequestError: (value: boolean) => { requestError = value },
  fixtureRequestVersion: () => { const rows = readRequests(); rows[0].version = 'event-new'; localStorage.setItem(requestKey, JSON.stringify(rows)) },
})

function Preview() {
  const [tab, setTab] = useState<BottomTab>('schedules')
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(320)
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ padding: '10px 18px', fontSize: 11, borderBottom: '1px solid var(--c-line)', color: 'var(--c-muted)' }}>INBOX + SCHEDULES · VERIFICATION FIXTURES · NO LIVE GITHUB OR AGENT EXECUTION</header>
    <main style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{location.search.includes('today') ? <Today /> : location.search.includes('chat') ? <AssistantThread /> : <InboxPage />}</main>
    {!location.search && <BottomBar tab={tab} onTab={setTab} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(v => !v)} height={height} onHeight={setHeight} />}
  </div>
}
createRoot(document.getElementById('root')!).render(<Preview />)
