import { invoke } from '@tauri-apps/api/core'
import * as ipc from '../ipc'
import { aiw } from '../aiw'
import type { RailView } from '../../store'

export type ConnectionState = 'configured' | 'authenticated' | 'verified' | 'degraded' | 'reconnect' | 'missing-dependency' | 'paused' | 'disconnected'
export type Capability = 'repository.read' | 'model.infer' | 'mail.read' | 'mail.send' | 'database.query' | 'mcp.tools' | 'feed.read'
export interface ServiceDefinition { id: string; name: string; category: string; capabilities: Capability[]; requirements: string; note: string; manage?: RailView }
export interface Connection {
  id: string; service: string; name: string; state: ConnectionState; credentialRef?: string
  mark?: string; lastCheck?: number; usedBy: string[]; note?: string
}
export interface FeedAccess { scope: 'agent' | 'space' | 'project'; id: string; capability: 'feed.read' }
export interface FeedConnection { id: number; name: string; url: string; state: ConnectionState; last_check: number | null; access: FeedAccess[]; entries: { title: string }[]; activity: string[] }
// Capabilities keep their own operations and result types; there is no generic execute().
export interface FeedReader { read(id: number): Promise<void>; list(): Promise<FeedConnection[]> }
export const feeds: FeedReader & {
  add(name: string, url: string): Promise<void>
  action(id: number, action: 'pause' | 'reconnect' | 'disconnect' | 'delete-cache'): Promise<void>
  access(id: number, scope: FeedAccess['scope'], resource: string, allow: boolean): Promise<void>
} = {
  list: () => invoke('connectors_feeds'),
  read: id => invoke('connectors_test_feed', { id }),
  add: (name, url) => invoke('connectors_add_feed', { name, url }),
  action: (id, action) => invoke('connectors_feed_action', { id, action }),
  access: (id, scope, resource, allow) => invoke('connectors_feed_access', { id, scope, resource, allow }),
}
export const services: ServiceDefinition[] = [
  { id: 'github', name: 'GitHub', category: 'Development', capabilities: ['repository.read'], requirements: 'Cloud API; local gh/git have separate readiness.', note: 'One existing global app credential. Repository choices remain on projects. Repository monitoring is opt-in while DevDeck is running.', manage: 'github' },
  { id: 'ai', name: 'AI providers & subscriptions', category: 'AI', capabilities: ['model.infer'], requirements: 'API endpoints or locally installed subscription CLIs.', note: 'Existing provider adapters and permission matrix remain authoritative. Agents keep model selection.', manage: 'settings' },
  { id: 'mail', name: 'IMAP / SMTP Mail', category: 'Communication', capabilities: ['mail.read', 'mail.send'], requirements: 'Local app with remote IMAP / SMTP; Google OAuth is mail-only.', note: 'Multiple accounts. Sending reaches external recipients; read/archive/delete flags are local-only. Folder destinations do not connect Drive, Dropbox or OneDrive.', manage: 'mail' },
  { id: 'database', name: 'Databases', category: 'Development', capabilities: ['database.query'], requirements: 'Local psql, sqlite3 or sqlcmd; local or remote database.', note: 'Existing saved project mappings and Credential Manager targets are preserved. Queries can write: existing permissions still apply.', manage: 'connections' },
  { id: 'mcp', name: 'MCP & local tools', category: 'Development', capabilities: ['mcp.tools'], requirements: 'Local server process and its declared dependencies.', note: 'Use the existing Community configuration for custom MCP entries. Viewing this catalogue never starts or installs a server. Tool grants remain in the existing permission matrix.', manage: 'community' },
  { id: 'feed', name: 'RSS / Atom', category: 'Information', capabilities: ['feed.read'], requirements: 'Local app; explicit public HTTPS URLs; no account credentials.', note: 'Manual read-only intake, up to 100 text titles. No background checks after exit. Agents can read cached titles with an explicit agent/project binding and Feed cache tool permission. Space bindings are reserved.' },
]

export interface Inventory { connections: Connection[]; feedConnections: FeedConnection[]; errors: string[]; unavailable: string[] }
/** Read-only projection. No imports, secret copies, live authentication calls or grant writes. */
export async function inventory(): Promise<Inventory> {
  const connections: Connection[] = [], errors: string[] = [], unavailable: string[] = []
  let feedConnections: FeedConnection[] = []
  const sources: [string, () => Promise<void>][] = [
    ['GitHub', async () => { if (await ipc.githubTokenStored()) connections.push({ id: 'github:global', service: 'github', name: 'GitHub app credential', state: 'configured', credentialRef: 'devdeck:github:oauth', usedBy: ['Project repository bindings (managed in Projects)'], note: 'Credential present; authentication and gh/git readiness have not been tested here.' }) }],
    ['Mail', async () => { for (const m of await ipc.mailAccountsList()) connections.push({ id: `mail:${m.id}`, service: 'mail', name: m.name || m.address, mark: m.kind === 'gmail' ? 'google' : 'mail', state: m.last_error ? 'degraded' : m.last_sync ? 'verified' : m.has_password || m.auth === 'oauth' ? 'configured' : 'reconnect', credentialRef: `mail account ${m.id} (existing credential owner)`, lastCheck: m.last_sync || undefined, usedBy: m.space ? [m.space] : [], note: m.last_error ? 'Last sync reported an error. Open Mail for details.' : 'Last sync is historical evidence, not a fresh authentication test.' }) }],
    ['Databases', async () => { for (const d of await ipc.connList()) connections.push({ id: `database:${d.id}`, service: 'database', name: d.name, state: 'configured', credentialRef: `devdeck:connection:${d.id}`, usedBy: d.project_id == null ? [] : [`Project ${d.project_id}`], note: `${d.engine}; client and connectivity not checked here.` }) }],
    ['AI', async () => { const [providers, agents] = await Promise.all([aiw.providerSetups(), aiw.agents()]); for (const p of providers) connections.push({ id: `ai:${p.id}`, service: 'ai', name: p.name, mark: p.kind === 'anthropic' ? 'anthropic' : 'openai', state: 'configured', credentialRef: `provider:${p.id} (existing credential owner)`, usedBy: agents.filter(a => a.provider === p.id).map(a => `Agent ${a.name}`), note: 'Configuration only. Open Settings to inspect agents, test provider health and manage subscription adapters.' }) }],
    ['MCP', async () => { for (const m of (await ipc.communityInstalled()).filter(m => m.kind === 'mcp')) connections.push({ id: `mcp:${m.id}`, service: 'mcp', name: m.name, state: m.blocked ? 'missing-dependency' : 'configured', usedBy: m.reach, note: m.blocked ? 'Installed entry reports a blocker; open MCP configuration for details.' : 'Installed; server has not been started or tested here.' }) }],
    ['RSS / Atom', async () => { feedConnections = await feeds.list(); for (const f of feedConnections) connections.push({ id: `feed:${f.id}`, service: 'feed', name: f.name, state: f.state, lastCheck: f.last_check ?? undefined, usedBy: f.access.map(a => `${a.scope}: ${a.id}`) }) }],
  ]
  const sourceIds: Record<string,string> = { GitHub:'github', Mail:'mail', Databases:'database', AI:'ai', MCP:'mcp', 'RSS / Atom':'feed' }
  await Promise.all(sources.map(async ([name, read]) => { try { await read() } catch { unavailable.push(sourceIds[name]); errors.push(`${name} inventory unavailable. Existing configuration was not changed.`) } }))
  return { connections: connections.sort((a,b) => a.name.localeCompare(b.name)), feedConnections, errors, unavailable }
}
