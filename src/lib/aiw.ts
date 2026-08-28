// AI Workspace — types and IPC.
//
// These mirror the Rust structs in `src-tauri/src/aiw/`. Keeping them in one
// file next to the calls means a backend rename shows up as a type error here
// rather than as an empty screen at runtime.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventCategory =
  | 'Agent' | 'Session' | 'Task' | 'Tool' | 'Process'
  | 'File' | 'Git' | 'Context' | 'Decision' | 'Conflict' | 'Test' | 'Workspace'

export interface DomainEvent {
  id: string
  seq: number
  type: string
  category: EventCategory
  timestamp: string
  workspace_id?: string
  project_id?: string
  feature_id?: string
  work_item_id?: string
  session_id?: string
  agent_id?: string
  correlation_id?: string
  causation_id?: string
  depth: number
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Projects / features
// ---------------------------------------------------------------------------

export interface AiProject {
  id: string
  name: string
  root: string
  features: number
  active_agents: number
  open_conflicts: number
  branch?: string
  commit?: string
}

export type FeatureStatus = 'planned' | 'in-progress' | 'review' | 'blocked' | 'completed'
export type ContextHealth = 'fresh' | 'changed' | 'stale' | 'conflict'

export interface FeatureRow {
  id: string
  name: string
  status: string
  goal?: string
  areas: string[]
  agents: string[]
  context_health: ContextHealth
  conflicts: number
  last_activity?: string
  work_items: number
}

export interface WorkItem {
  id: string
  title: string
  status: string
  assignee?: string
  areas: string[]
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type Inclusion = 'manual' | 'inherited' | 'generated' | 'excluded'

export interface ContextSection {
  key: string
  title: string
  inclusion: Inclusion
  tokens: number
  source: string
  body: string
  reason?: string
}

export interface AssembledContext {
  project_id: string
  feature_id: string
  work_item_id?: string
  commit?: string
  assembled_at: string
  sections: ContextSection[]
  total_tokens: number
  excluded_tokens: number
}

export interface RawContext {
  path: string
  frontmatter: string
  body: string
}

export type ChangeKind = 'added' | 'changed' | 'removed' | 'superseded' | 'conflicting'

export interface ContextChange {
  kind: ChangeKind
  subject: string
  detail: string
  source?: string
}

export interface ContextComparison {
  from: string
  to: string
  from_body?: string
  to_body: string
  changes: ContextChange[]
  changed_files: string[]
}

export interface Checkpoint {
  session_id: string
  agent_id: string
  project_id: string
  feature_id: string
  commit?: string
  taken_at: string
  context_tokens: number
}

// ---------------------------------------------------------------------------
// Agents / sessions
// ---------------------------------------------------------------------------

export interface AgentDef {
  id: string
  name: string
  role: string
  provider: string
  model: string
  system: string
  permissions: Record<string, string>
}

export type SessionStatus =
  | 'planning' | 'working' | 'waiting' | 'reviewing'
  | 'blocked' | 'completed' | 'failed' | 'idle'

export interface TranscriptEntry {
  at: string
  kind: string
  text: string
}

export interface Session {
  id: string
  agent_id: string
  agent_name: string
  role: string
  project_id: string
  feature_id: string
  work_item_id?: string
  status: SessionStatus
  started_at: string
  ended_at?: string
  checkpoint?: Checkpoint
  stale: boolean
  turns: number
  context_tokens: number
  files_touched: string[]
  transcript: TranscriptEntry[]
  summary?: string
}

export interface WorkClaim {
  id: string
  agent_id: string
  session_id: string
  project_id: string
  feature_id: string
  work_item_id?: string
  intent: string
  areas: string[]
  depends_on: string[]
  status: string
  started_at: string
}

export interface StartAgentCommand {
  projectId: string
  featureId: string
  agentId: string
  workItemId?: string
  intent?: string
  areas?: string[]
  dependsOn?: string[]
}

export interface SessionOutcome {
  session_id: string
  status: string
  turns: number
  summary: string
  files_touched: string[]
  context_tokens: number
  conflicts_detected: number
}

// ---------------------------------------------------------------------------
// Conflicts / decisions / tests
// ---------------------------------------------------------------------------

export type Severity = 'info' | 'warning' | 'high' | 'blocking'
export type ConflictKind = 'file' | 'component' | 'decision' | 'requirement' | 'stale-context'

export interface ConflictSide {
  agent_id: string
  detail: string
  source?: string
}

export interface Conflict {
  id: string
  kind: ConflictKind
  severity: Severity
  title: string
  project_id: string
  feature_id?: string
  left: ConflictSide
  right: ConflictSide
  detected_at: string
  resolved: boolean
  resolved_by?: string
  resolution?: string
}

export interface DecisionRow {
  id: string
  title: string
  status: string
  feature?: string
  author?: string
  created?: string
  impacts: string[]
  body: string
}

export interface TestRun {
  id: string
  project_id: string
  feature_id?: string
  agent_id: string
  command: string
  started_at: string
  ended_at?: string
  passed: boolean
  output: string
}

export interface GitCommit {
  sha: string
  short: string
  subject: string
  author: string
  when: string
  files: string[]
  context_updated: boolean
}

export interface ToolInfo {
  id: string
  name: string
  description: string
}

export interface PermissionRow {
  tool: string
  grants: [string, string][]
}

export interface ProviderHealth {
  ok: boolean
  detail: string
  configured: boolean
}

/// Saved provider configuration. Never carries a key — the UI is told only
/// *that* one is stored, never what it is.
export interface ProviderSetup {
  kind: string
  name: string
  base_url: string
  model: string
  headers: [string, string][]
  timeout_secs?: number
  has_key: boolean
}

export interface ProviderConfigInput {
  kind: string
  name: string
  baseUrl: string
  /** Sent once, stored in Windows Credential Manager. Empty = keep the saved one. */
  apiKey?: string
  model: string
  headers: [string, string][]
  timeoutSecs?: number
}

export interface DemoResult {
  tyrex_root: string
  assetx_root: string
  outcomes: SessionOutcome[]
  conflicts: Conflict[]
  events: number
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

/** Who said a thing in a conversation. `tool` is a step, not a speaker. */
export type Speaker = 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  at: string
  from: Speaker
  text: string
  /** `tool.action`, on tool steps only. */
  tool?: string
  ok?: boolean
}

export interface ConversationMeta {
  id: string
  title: string
  started_at: string
  updated_at: string
  /** The project in focus. A focus, not a boundary — the assistant works across projects. */
  project_id?: string
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  started_at: string
  updated_at: string
  project_id?: string
  messages: number
  preview: string
}

export interface AssistantReply {
  conversation_id: string
  reply: string
  /** What this exchange appended, so the transcript can grow without a refetch. */
  appended: ChatMessage[]
  /** Sessions it started, if any. */
  delegated: string[]
  turns: number
}

export interface ModelInfo {
  id: string
  name: string
  context_window?: number
}

/** Models a provider offers, and whether the answer is actually from it.
 *
 * `live` is the load-bearing field: every provider ships a built-in list so the
 * dropdown is never empty, and showing that as though it had been fetched would
 * be a failed lookup reading as a successful one.
 */
export interface ModelCatalog {
  models: ModelInfo[]
  live: boolean
  note?: string
}

/** What the assistant knows about you. Personal store, never a repo. */
/** Progress while a reply is still being produced.
 *
 * A side channel, not the event bus: token deltas are not facts about the
 * project, and a few hundred of them would bury the audit log. Lossy by
 * design — the conversation on disk is the record.
 */
export type ChatEvent =
  | { kind: 'delta'; conversation_id: string; text: string }
  | { kind: 'step'; conversation_id: string; message: ChatMessage }
  | { kind: 'done'; conversation_id: string }

export interface ProfileView {
  preferences: string[]
  body: string
  updated_at: string
}

export interface MemoryView {
  id: string
  title: string
  body: string
  created_at: string
  project_id?: string
  tags: string[]
}

/** A tool call an agent is blocked on, waiting for a person to answer. */
export interface ApprovalRequest {
  id: string
  agent_id: string
  tool: string
  action: string
  /** One line you can decide on without reading JSON. */
  summary: string
  /** The full arguments, for when the summary isn't enough. */
  detail: string
  project_id?: string
  feature_id?: string
  session_id?: string
  requested_at: string
  /** Seconds the agent will wait before giving up and being refused. */
  expires_in: number
}

/** `always` variants also move the permission, so the question stops recurring. */
export type ApprovalDecision = 'allow' | 'allow-always' | 'deny' | 'deny-always'

export const aiw = {
  projects: () => invoke<AiProject[]>('aiw_projects'),
  registerProject: (id: string, name: string, root: string) =>
    invoke<AiProject>('aiw_register_project', { id, name, root }),

  features: (projectId: string) => invoke<FeatureRow[]>('aiw_features', { projectId }),
  createFeature: (projectId: string, name: string, goal: string, areas: string[]) =>
    invoke<string>('aiw_create_feature', { projectId, name, goal, areas }),
  workItems: (projectId: string, featureId: string) =>
    invoke<WorkItem[]>('aiw_work_items', { projectId, featureId }),

  context: (projectId: string, featureId: string, workItemId?: string) =>
    invoke<AssembledContext>('aiw_context', { projectId, featureId, workItemId }),
  contextRaw: (projectId: string, featureId: string) =>
    invoke<RawContext>('aiw_context_raw', { projectId, featureId }),
  contextCompare: (projectId: string, featureId: string, from: string) =>
    invoke<ContextComparison>('aiw_context_compare', { projectId, featureId, from }),

  agents: () => invoke<AgentDef[]>('aiw_agents'),
  sessions: (projectId?: string) => invoke<Session[]>('aiw_sessions', { projectId }),
  session: (sessionId: string) => invoke<Session | null>('aiw_session', { sessionId }),
  claims: (projectId?: string, activeOnly = true) =>
    invoke<WorkClaim[]>('aiw_claims', { projectId, activeOnly }),
  startAgent: (cmd: StartAgentCommand) =>
    invoke<SessionOutcome>('aiw_start_agent', {
      cmd: {
        project_id: cmd.projectId,
        feature_id: cmd.featureId,
        agent_id: cmd.agentId,
        work_item_id: cmd.workItemId ?? null,
        intent: cmd.intent ?? null,
        areas: cmd.areas ?? [],
        depends_on: cmd.dependsOn ?? [],
      },
    }),

  conflicts: (projectId?: string, includeResolved = false) =>
    invoke<Conflict[]>('aiw_conflicts', { projectId, includeResolved }),
  resolveConflict: (conflictId: string, by: string, resolution: string) =>
    invoke<Conflict>('aiw_resolve_conflict', { conflictId, by, resolution }),

  decisions: (projectId: string, featureId?: string) =>
    invoke<DecisionRow[]>('aiw_decisions', { projectId, featureId }),
  activity: (projectId?: string, limit?: number) =>
    invoke<DomainEvent[]>('aiw_activity', { projectId, limit }),
  eventChain: (correlationId: string) =>
    invoke<DomainEvent[]>('aiw_event_chain', { correlationId }),

  gitHistory: (projectId: string, limit?: number) =>
    invoke<GitCommit[]>('aiw_git_history', { projectId, limit }),
  tools: () => invoke<ToolInfo[]>('aiw_tools'),
  permissions: () => invoke<PermissionRow[]>('aiw_permissions'),
  setPermission: (agentId: string, tool: string, permission: string) =>
    invoke<void>('aiw_set_permission', { agentId, tool, permission }),
  providers: () => invoke<[string, string, ProviderHealth][]>('aiw_providers'),
  providerSetups: () => invoke<ProviderSetup[]>('aiw_provider_setups'),
  configureProvider: (c: ProviderConfigInput) =>
    invoke<void>('aiw_configure_provider', {
      config: {
        kind: c.kind,
        name: c.name,
        base_url: c.baseUrl,
        api_key: c.apiKey ?? null,
        model: c.model,
        headers: c.headers,
        timeout_secs: c.timeoutSecs ?? null,
      },
    }),
  testProvider: (providerId: string) => invoke<string>('aiw_provider_test', { providerId }),
  setAgentProvider: (agentId: string, provider: string, model: string) =>
    invoke<AgentDef>('aiw_set_agent_provider', { agentId, provider, model }),
  forgetProviderKey: (providerId: string) =>
    invoke<boolean>('aiw_provider_forget_key', { providerId }),
  models: (providerId: string) => invoke<ModelCatalog>('aiw_models', { providerId }),
  testRuns: (projectId?: string) => invoke<TestRun[]>('aiw_test_runs', { projectId }),

  exportContext: (projectId: string, featureId: string, filename: string) =>
    invoke<string>('aiw_export_context', { projectId, featureId, filename }),
  agentFiles: () => invoke<string[]>('aiw_agent_files'),
  knowledgeTree: (projectId: string) => invoke<string[]>('aiw_knowledge_tree', { projectId }),
  readFile: (projectId: string, path: string) =>
    invoke<string>('aiw_read_file', { projectId, path }),
  writeFile: (projectId: string, path: string, content: string) =>
    invoke<void>('aiw_write_file', { projectId, path, content }),

  conversations: () => invoke<ConversationSummary[]>('aiw_conversations'),
  conversation: (id: string) => invoke<ConversationMeta>('aiw_conversation', { id }),
  newConversation: (projectId?: string) =>
    invoke<ConversationMeta>('aiw_new_conversation', { projectId }),
  deleteConversation: (id: string) => invoke<boolean>('aiw_delete_conversation', { id }),
  focusConversation: (id: string, projectId?: string) =>
    invoke<ConversationMeta>('aiw_focus_conversation', { id, projectId }),
  sendMessage: (conversationId: string, text: string) =>
    invoke<AssistantReply>('aiw_send_message', { conversationId, text }),

  /** Live progress for the assistant. Separate from `onEvent`, deliberately. */
  onChat: (cb: (e: ChatEvent) => void): Promise<UnlistenFn> =>
    listen<ChatEvent>('aiw:chat', (e) => cb(e.payload)),

  personalRoot: () => invoke<string>('aiw_personal_root'),
  profile: () => invoke<ProfileView>('aiw_profile'),
  saveProfile: (preferences: string[], body: string) =>
    invoke<ProfileView>('aiw_save_profile', { preferences, body }),
  memories: () => invoke<MemoryView[]>('aiw_memories'),
  forgetMemory: (id: string) => invoke<boolean>('aiw_forget_memory', { id }),

  pendingApprovals: () => invoke<ApprovalRequest[]>('aiw_pending_approvals'),
  resolveApproval: (id: string, decision: ApprovalDecision) =>
    invoke<void>('aiw_resolve_approval', { id, decision }),

  runDemo: (baseDir?: string) => invoke<DemoResult>('aiw_run_demo', { baseDir }),
  reset: () => invoke<void>('aiw_reset'),

  /// Live events from the bus. The Activity screen and the status dots use
  /// this so they update while agents run rather than only on refresh.
  onEvent: (cb: (e: DomainEvent) => void): Promise<UnlistenFn> =>
    listen<DomainEvent>('aiw:event', (e) => cb(e.payload)),
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Colour for a status, using theme tokens only. */
export const severityStyle = (s: Severity): { chip: string; border: string } => {
  switch (s) {
    case 'blocking':
      return { chip: 'bg-red-500/16 text-err', border: 'border-red-500/35' }
    case 'high':
      return { chip: 'bg-amber-500/16 text-warn', border: 'border-amber-500/30' }
    case 'warning':
      return { chip: 'bg-amber-500/12 text-warn', border: 'border-amber-500/20' }
    default:
      return { chip: 'bg-slate-500/14 text-dim', border: 'border-line' }
  }
}

export const sessionStatusStyle = (s: SessionStatus): string => {
  switch (s) {
    case 'working':
      return 'bg-emerald-500/10 text-ok'
    case 'reviewing':
      return 'bg-violet-500/16 text-viol'
    case 'blocked':
    case 'failed':
      return 'bg-red-500/12 text-err'
    case 'completed':
      return 'bg-emerald-500/12 text-ok'
    case 'planning':
      return 'bg-sky-500/14 text-info'
    default:
      return 'bg-slate-500/14 text-dim'
  }
}

export const contextHealthStyle = (h: ContextHealth): string => {
  switch (h) {
    case 'fresh':
      return 'bg-emerald-500/12 text-ok'
    case 'changed':
      return 'bg-sky-500/12 text-info'
    case 'stale':
      return 'bg-amber-500/14 text-warn'
    default:
      return 'bg-red-500/12 text-err'
  }
}

export const inclusionStyle = (i: Inclusion): string => {
  switch (i) {
    case 'inherited':
      return 'bg-indigo-500/16 text-indigo-300'
    case 'manual':
      return 'bg-sky-500/14 text-info'
    case 'generated':
      return 'bg-slate-500/14 text-dim'
    default:
      return 'bg-slate-500/10 text-faint'
  }
}

/** Two-letter badge for an agent, e.g. "dev-a" → "DA". */
export const initials = (id: string): string => {
  const parts = id.split(/[-_\s]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return id.slice(0, 2).toUpperCase()
}

/** "4 min ago" from an ISO timestamp. */
export const ago = (iso?: string): string => {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** Compact one-line description of an event for the activity feed. */
export const describeEvent = (e: DomainEvent): string => {
  const p = e.payload as Record<string, string | number | boolean | undefined>
  const agent = e.agent_id ?? 'someone'
  switch (e.type) {
    case 'agent.started':
      return `${p.name ?? agent} started work`
    case 'agent.completed':
      return `${agent} completed — ${p.summary ?? ''}`
    case 'agent.failed':
      return `${agent} failed — ${p.error ?? ''}`
    case 'work.claimed':
      return `${agent} claimed “${p.intent ?? ''}”`
    case 'work.completed':
      return `${agent} released its claim`
    case 'tool.executed':
      return `${agent} ran ${p.tool}.${p.action}`
    case 'tool.failed':
      return `${agent} was refused ${p.tool}.${p.action}${p.denied ? ' (denied)' : ''}`
    case 'tool.approval.requested':
      return `${agent} is waiting on you — ${p.summary ?? `${p.tool}.${p.action}`}`
    case 'tool.approval.resolved':
      return `${p.allowed ? 'Approved' : 'Refused'} for ${agent} — ${p.summary ?? p.tool}`
    case 'file.changed':
      return `${p.by ?? agent} changed ${p.path}`
    case 'context.changed':
      return p.symbol ? `${p.by ?? agent} changed ${p.symbol}` : 'Feature context updated'
    case 'context.reconciled':
      return `Context reconciled — ${p.summary ?? ''}`
    case 'context.delta.detected':
      return 'Context delta detected'
    case 'context.stale':
      return `${p.agent ?? agent}'s context went stale`
    case 'conflict.detected':
      return `${p.severity ?? ''} conflict — ${p.title ?? ''}`.trim()
    case 'conflict.resolved':
      return `Conflict resolved by ${p.by ?? 'someone'}`
    case 'decision.created':
      return `Decision recorded — ${p.title ?? ''}`
    case 'test.completed':
      return `Tests passed (${p.command ?? ''})`
    case 'test.failed':
      return `Tests failed (${p.command ?? ''})`
    case 'session.started':
      return `Session started for ${p.agent ?? agent}`
    case 'session.checkpointed':
      return `Checkpoint at ${String(p.commit ?? '').slice(0, 7)}`
    case 'session.completed':
      return `Session completed — ${p.summary ?? ''}`
    case 'feature.created':
      return `Feature created — ${p.name ?? ''}`
    default:
      return e.type
  }
}
