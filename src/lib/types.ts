// Shared types mirroring the Rust backend structs (snake_case fields
// come straight from serde).

export type NodeKind = 'workspace' | 'project' | 'folder'

export interface TreeNode {
  id: number
  parent_id: number | null
  kind: NodeKind
  name: string
  /** project: base path (repo root); folder: optional absolute override. */
  path: string | null
  /** folder: subpath relative to the owning project's base path. */
  rel_path: string
  sort: number
  /** user-picked accent color (hex); null = derive from id. */
  color: string | null
}

export interface CommandDef {
  id: number
  project_id: number | null
  group_name: string
  name: string
  command: string
  cwd: string
  shell: string
  sort: number
}

export interface ServiceDef {
  id: number
  project_id: number | null
  name: string
  command: string
  cwd: string
  env: string
  auto_restart: boolean
  health_port: number | null
  /** shell/interpreter path to run under; '' = cmd.exe */
  shell: string
}

export type ProfileStep =
  | { type: 'service'; id: number }
  | { type: 'command'; id: number }
  | { type: 'terminal'; shell: string; cwd: string }
  | { type: 'layout'; id: number }

export interface ProfileDef {
  id: number
  project_id: number | null
  name: string
  steps: string // JSON-encoded ProfileStep[]
}

export interface LayoutDef {
  id: number
  name: string
  data: string
}

export interface PtyInfo {
  id: number
  title: string
  shell: string
  cwd: string
  pid: number | null
  alive: boolean
}

export type SvcStatus = 'running' | 'stopped' | 'crashed'

export interface SvcState {
  id: number
  name: string
  pid: number | null
  status: SvcStatus
  exit_code: number | null
  started_at: number | null
  ephemeral: boolean
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  seq: number
  ts: number
  service_id: number
  service: string
  stream: string
  level: LogLevel
  line: string
}

export interface DetectedCommand {
  name: string
  command: string
  group: string
  /** npm|pnpm|yarn|bun|cargo|go|dotnet|gradle|maven|python|php|ruby|docker|… */
  manager: string
  /** Subdirectory relative to the scanned root ('' = the root). Where the
   *  command has to run — without it a command found in `apps/web` would
   *  execute at the repo root. */
  dir: string
  /** The scanner thinks this is long-running (dev server, watcher). */
  service: boolean
}

export interface ProcStat {
  kind: 'service' | 'terminal' | 'detected'
  id: number
  name: string
  pid: number
  cpu: number
  mem_mb: number
  uptime_secs: number
  ports: number[]
  procs: number
  /** working directory (detected sessions only; used to attribute to a space) */
  cwd?: string
  /** inferred dev tool, e.g. "vite", "next", "uvicorn" (detected only) */
  tool?: string
}

export interface ShellDef {
  name: string
  command: string
}

export interface Recent {
  kind: 'command' | 'service'
  ref_id: number
  ts: number
  count: number
}

// ---- activity ----

/** One thing the app did. Every source writes here, so Home, the widget and
 *  usage ranking all read the same stream. */
export interface Activity {
  id: number
  /** service | query | git | clip | screenshot | setup | update */
  kind: string
  title: string
  detail: string
  /** False marks a failure — a crash, a failed query. */
  ok: boolean
  ref_id: number | null
  project_name: string
  ts: number
}

export interface ServiceRun {
  id: number
  service_id: number
  started_at: number
  ended_at: number | null
  exit_code: number | null
  /** running | stopped | crashed */
  outcome: string
}

// ---- connections ----

export type ConnEngine = 'postgres' | 'sqlite' | 'sqlserver'

export interface ConnDef {
  id: number
  project_id: number | null
  name: string
  engine: ConnEngine
  host: string
  port: number | null
  /** For sqlite this is the file path. */
  database: string
  username: string
  sort: number
  created_at: number
  /** Whether a password is stored. Never the password itself — there is no
   *  command that reads one back out. */
  has_password: boolean
}

export interface QueryResult {
  columns: string[]
  rows: string[][]
  row_count: number
  /** True when the grid was cut short. Never a silent truncation. */
  truncated: boolean
  ms: number
  /** Empty on success. */
  error: string
  /** The missing client binary, so the UI can offer to install it. */
  missing_tool: string
}

export interface SavedQuery {
  id: number
  connection_id: number
  name: string
  sql: string
  created_at: number
}

export interface QueryRun {
  id: number
  connection_id: number
  sql: string
  ok: boolean
  row_count: number
  ms: number
  error: string
  ran_at: number
}

// ---- stash ----

/** Smart type detection (backend classifier). */
export type StashType =
  | 'json'
  | 'sql'
  | 'url'
  | 'path'
  | 'jwt'
  | 'uuid'
  | 'hex'
  | 'stacktrace'
  | 'text'
  /** Screenshots. Their `content` is the OCR text, so they're searchable. */
  | 'image'

export interface StashItem {
  id: number
  /** clip = captured from the clipboard · note = you wrote it ·
   *  screenshot = a file Windows saved, linked here. */
  kind: string
  item_type: StashType
  title: string
  /** Only `stashGet` fills this. Always null for a flagged secret — the
   *  value was never written to disk. */
  content: string | null
  /** Your own text about this clip. Indexed for search. */
  note: string
  tags: string[]
  /** Screenshots only: where the image lives. Linked, never copied. */
  file_path: string
  /** Screenshots only: small data: URI for the card. */
  thumb: string
  preview: string
  bytes: number
  project_id: number | null
  /** Snapshot of the project name at capture time (survives node deletion). */
  project_name: string
  workspace_name: string
  source_app: string
  is_secret: boolean
  secret_reason: string
  pinned: boolean
  created_at: number
  used_count: number
}

/** Sidebar groups. `secrets` lists flagged clips (metadata only). */
export type StashFilter =
  | 'all'
  | 'pinned'
  | 'notes'
  | 'screenshots'
  | 'clips'
  | 'code'
  | 'links'
  | 'errors'
  | 'secrets'

export interface StashQuery {
  query: string
  filter: StashFilter
  item_type: string
  /** Exact user tag name ('' = any). */
  tag: string
  project_id: number | null
  no_project: boolean
  limit: number
}

export interface TagCount {
  id: number
  name: string
  n: number
}

export interface StashCounts {
  all: number
  pinned: number
  notes: number
  screenshots: number
  clips: number
  code: number
  links: number
  errors: number
  secrets: number
  types: Array<{ item_type: StashType; n: number }>
  projects: Array<{ project_id: number | null; name: string; n: number }>
  tags: TagCount[]
}

/** Patch for `stashUpdate` — omitted fields are left alone. */
export interface StashEdit {
  id: number
  title?: string
  content?: string
  note?: string
}

export interface StashStatus {
  enabled: boolean
  /** False = this SQLite has no FTS5 and search is a substring scan. */
  fts: boolean
  /** Show the capture toast when a clip lands. */
  toast: boolean
  /** Paste into the app you came from, rather than only copying. Opt-in. */
  auto_paste: boolean
  /** Days an untouched clip is kept; 0 = forever. */
  retention_days: number
}

// ---- mail ----

/** How an account talks to its server. `gmail` is IMAP + SMTP with Google's
 *  hosts prefilled; the transport is identical. */
export type MailKind = 'imap' | 'gmail'

export interface MailAccount {
  id: number
  name: string
  address: string
  kind: MailKind
  imap_host: string
  imap_port: number
  smtp_host: string
  smtp_port: number
  username: string
  signature: string
  is_default: boolean
  sort: number
  created_at: number
  last_sync: number
  /** Why the last sync failed, '' when it worked. A failed sync that looks
   *  like an empty inbox is how you miss mail for a week. */
  last_error: string
  /** Whether a password is stored. Never the password — nothing reads one back. */
  has_password: boolean
}

/** A message as the list needs it: no bodies, so 300 rows stay cheap. */
export interface MailMessage {
  id: number
  account_id: number
  uid: number
  message_id: string
  thread_key: string
  mailbox: MailMailbox
  from_name: string
  from_addr: string
  to_addrs: string
  cc_addrs: string
  subject: string
  preview: string
  ts: number
  unread: boolean
  flagged: boolean
  is_bot: boolean
  contact_id: number | null
  node_id: number | null
  account_address: string
  attachments: number
}

export type MailMailbox = 'INBOX' | 'Sent' | 'Drafts' | 'Archive'

export interface MailAttachment {
  id: number
  message_id: number
  filename: string
  mime: string
  bytes: number
  part_index: number
  /** Set only once you save it — sync never writes attachments to disk. */
  file_path: string
}

/** Fetched only when a message is opened. */
export interface MailBody {
  id: number
  body_text: string
  body_html: string
  raw_headers: string
  attachments: MailAttachment[]
}

export interface MailContact {
  id: number
  name: string
  email: string
  alt_email: string
  role: string
  company: string
  phone: string
  notes: string
  /** Comma-separated, like Stash tags. */
  tags: string
  /** The client: a node in the project tree. */
  node_id: number | null
  kind: 'person' | 'bot'
  created_at: number
  threads: number
  last_ts: number
}

export type MailGroup =
  | 'inbox' | 'unread' | 'flagged' | 'clients' | 'projects'
  | 'bots' | 'sent' | 'drafts' | 'archive'

export type MailChip = 'all' | 'unread' | 'flagged' | 'files'

export interface MailQuery {
  group: MailGroup
  chip: MailChip
  search: string
  account_id: number | null
  limit?: number
}

export interface MailCounts {
  inbox: number
  unread: number
  flagged: number
  clients: number
  projects: number
  bots: number
  sent: number
  drafts: number
  archive: number
}

export interface SendRequest {
  account_id: number
  to: string
  cc: string
  subject: string
  body: string
  in_reply_to: string
  attachments: string[]
}

/** Reachability for both halves of an account, reported separately: IMAP can
 *  work while SMTP does not, and one "failed" helps nobody. */
export interface MailTestResult {
  imap_ok: boolean
  imap_detail: string
  smtp_ok: boolean
  smtp_detail: string
}

/** What the assistant said or did about a thread, kept beside the mail so it
 *  is auditable after the fact. */
export interface AssistantNote {
  id: number
  thread_key: string
  account_id: number
  kind: 'summary' | 'draft' | 'action'
  body: string
  status: 'new' | 'accepted' | 'dismissed' | 'done'
  created_at: number
}

/** The compose sheet's working state. Wider than SendRequest because it also
 *  holds what the UI needs: whether Cc is showing, and why a send failed. */
export interface ComposeDraft {
  account_id: number
  to: string
  cc: string
  subject: string
  body: string
  in_reply_to: string
  attachments: string[]
  showCc: boolean
  sending: boolean
  error: string
}
