export interface CatalogueEntry {
  id: string
  name: string
  description: string
  category: string
  mark: string
  planned?: boolean
  detail?: string
}

export const availableEntries: CatalogueEntry[] = [
  { id: 'github', name: 'GitHub', description: 'Repositories, issues & pull requests', category: 'Development', mark: 'github' },
  { id: 'ai', name: 'AI providers & subscriptions', description: 'Models, API endpoints & local CLIs', category: 'AI', mark: 'openai' },
  { id: 'mail', name: 'IMAP / SMTP Mail', description: 'Mailboxes, messages & sending', category: 'Communication', mark: 'mail' },
  { id: 'database', name: 'Databases', description: 'Postgres, SQLite & SQL Server', category: 'Development', mark: 'database' },
  { id: 'mcp', name: 'MCP & local tools', description: 'Your servers, tools & permissions', category: 'Development', mark: 'mcp' },
  { id: 'feed', name: 'RSS / Atom', description: 'Public feeds & read-only knowledge', category: 'Information', mark: 'feed' },
]

// Catalogue information only. These entries register no adapter, account or action.
export const plannedEntries: CatalogueEntry[] = [
  { id: 'vercel', name: 'Vercel', description: 'Deployments & project status', category: 'Development', mark: 'vercel', planned: true },
  { id: 'supabase', name: 'Supabase', description: 'Database & backend', category: 'Development', mark: 'supabase', planned: true },
  { id: 'slack', name: 'Slack', description: 'Team conversations', category: 'Communication', mark: 'slack', planned: true },
  { id: 'microsoft', name: 'Microsoft 365', description: 'Outlook, Calendar & OneDrive', category: 'Productivity', mark: 'microsoft', planned: true },
  { id: 'notion', name: 'Notion', description: 'Pages & knowledge', category: 'Productivity', mark: 'notion', planned: true },
  { id: 'linear', name: 'Linear', description: 'Issues & roadmaps', category: 'Development', mark: 'linear', planned: true },
  { id: 'facebook', name: 'Facebook', description: 'Pages & supported messages', category: 'Social', mark: 'facebook', planned: true, detail: 'A possible Pages integration, not access to personal profiles or private conversations. No Facebook adapter is available in this build.' },
  { id: 'instagram', name: 'Instagram', description: 'Professional accounts & shared links', category: 'Social', mark: 'instagram', planned: true, detail: 'A possible professional-account integration. Personal accounts and messages are not supported. No Instagram adapter is available in this build.' },
  { id: 'youtube', name: 'YouTube', description: 'Playlists, videos & shared links', category: 'Social', mark: 'youtube', planned: true },
]

export const categories = ['All', 'Development', 'AI', 'Communication', 'Productivity', 'Storage', 'Social', 'Information']
