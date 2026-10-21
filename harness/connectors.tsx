import { createRoot } from 'react-dom/client'
import { ConnectorsPage } from '../src/components/connectors/ConnectorsPage'
import { SEED } from './seed'
import type { FeedConnection, FeedAccess } from '../src/lib/connectors'
import '../src/index.css'
const handlers = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
const read = (): FeedConnection[] => JSON.parse(localStorage.getItem('connector-fixture') ?? '[]')
const save = (rows: FeedConnection[]) => localStorage.setItem('connector-fixture', JSON.stringify(rows))
handlers.github_token_stored = () => true
handlers.mail_accounts_list = () => [{ id: 7, name: 'Fixture mailbox', auth: 'oauth', space: 'Personal', last_sync: 0, last_error: '', has_password: false }]
handlers.conn_list = () => [{ id: 9, name: 'Fixture database', engine: 'postgres', project_id: 42 }]
handlers.aiw_provider_setups = () => [{ id: 'fixture-ai', name: 'Fixture provider' }]
handlers.aiw_agents = () => [{ id: 'fixture-agent', name: 'Fixture agent', provider: 'fixture-ai' }]
handlers.community_installed = () => [{ id: 'fixture-mcp', kind: 'mcp', name: 'Fixture MCP', blocked: 'Missing local dependency', reach: [] }]
handlers.connectors_feeds = () => { if(localStorage.getItem('inventory-failure')) throw new Error('Fixture inventory failure'); return read() }
handlers.connectors_add_feed = a => {
  const url = new URL(String(a?.url));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use public HTTPS without credentials, query or fragment')
  const rows = read(); if (rows.some(f=>f.url===url.href)) throw new Error('This feed is already configured')
  rows.push({ id: rows.length+1, name: String(a?.name), url: url.href, state: 'configured', last_check: null, access: [], entries: [], activity: ['configured'] }); save(rows)
}
function update(a: Record<string,unknown> | undefined, action: (f: FeedConnection)=>void) { const rows=read(); const f=rows.find(f=>f.id===a?.id); if(!f) throw new Error('Missing fixture'); action(f); save(rows) }
handlers.connectors_test_feed = a => update(a,f=>{ f.last_check=1770000000; if(localStorage.getItem('feed-failure')) { f.state='degraded'; f.activity.push('feed check failed'); return } f.state='verified';f.entries=[{title:'Fixture title <script>never executed</script>'}];f.activity.push('feed read verified') })
handlers.connectors_feed_action = a => update(a,f=>{ switch(a?.action) { case 'pause': f.state='paused';break;case 'reconnect':f.state='configured';break;case 'disconnect':f.state='disconnected';f.access=[];break;case 'delete-cache':f.entries=[];break;default:throw new Error('Unknown action') } f.activity.push(String(a?.action)) })
handlers.connectors_feed_access = a => update(a,f=>{ f.access=f.access.filter(x=>!(x.scope===a?.scope&&x.id===a?.resource));if(a?.allow) f.access.push({scope:a.scope as FeedAccess['scope'],id:String(a.resource),capability:'feed.read'});f.activity.push('access changed') })
createRoot(document.getElementById('root')!).render(<ConnectorsPage />)
