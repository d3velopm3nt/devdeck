// Typed wrappers around the Tauri IPC surface. One place to see the
// whole backend API.

import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CommandDef,
  DetectedCommand,
  LayoutDef,
  LogEntry,
  ProcStat,
  ProfileDef,
  PtyInfo,
  Recent,
  ServiceDef,
  ShellDef,
  Activity,
  ConnDef,
  MailAccount,
  MailLabel,
  MailBody,
  MailContact,
  MailCounts,
  MailMessage,
  MailQuery,
  MailTestResult,
  AssistantNote,
  SendRequest,
  ServiceRun,
  QueryResult,
  QueryRun,
  SavedQuery,
  StashCounts,
  StashEdit,
  StashItem,
  StashQuery,
  StashStatus,
  TagCount,
  SvcState,
  TreeNode,
} from './types'

// ---- tree ----
export const treeList = () => invoke<TreeNode[]>('tree_list')
export const nodeCreate = (
  parentId: number | null,
  kind: string,
  name: string,
  path?: string | null,
  relPath?: string | null,
) => invoke<TreeNode>('node_create', { parentId, kind, name, path: path ?? null, relPath: relPath ?? null })
// ---- schedules ----

/** One thing that happens on a clock. */
export interface Schedule {
  id: number
  name: string
  /** reminder | command | agent */
  kind: string
  node_id: number | null
  /** daily | weekdays | weekly | hourly | once */
  every: string
  /** Minutes past midnight, local. Ignored by 'once' and 'hourly'. */
  at_min: number
  /** For 'once': the moment, unix ms. */
  at_ms?: number
  /** Minutes it lasts. 0 is an instant; more is a block on the calendar. */
  duration_min?: number
  /** For 'weekly': comma-separated 0-6, Sunday first. */
  days: string
  payload: string
  enabled: boolean
  /** Whether a missed run should happen late. A reminder never should. */
  catch_up: boolean
  last_run: number | null
  last_ok: boolean
  last_note: string
  /** Minutes of warning before it starts. 0 says nothing early. */
  remind_min?: number
  /** The occurrence already warned about, unix ms. */
  last_remind?: number | null
  /** The feature in the space's deck this serves, and one item on it. The
   *  link lives in the database, not the vault: a reminder to look at
   *  something is not part of the project's record of that thing. */
  feature?: string
  work_item?: string
  next_run: number | null
}

export const schedulesList = () => invoke<Schedule[]>('schedules_list')
export const scheduleSave = (s: {
  id?: number | null
  name: string
  kind: string
  nodeId: number | null
  /** daily | weekdays | weekly | hourly | once */
  every: string
  atMin: number
  /** For `once`: the moment, unix ms. Ignored by every rhythm. */
  atMs?: number | null
  /** Minutes it lasts. 0 is an instant; more is a block on the calendar. */
  durationMin?: number | null
  days: string
  payload: string
  catchUp: boolean
  /** Minutes of warning before it starts. */
  remindMin?: number | null
  feature?: string | null
  workItem?: string | null
}) =>
  invoke<number>('schedule_save', {
    ...s,
    id: s.id ?? null,
    atMs: s.atMs ?? null,
    durationMin: s.durationMin ?? null,
    remindMin: s.remindMin ?? null,
    feature: s.feature ?? null,
    workItem: s.workItem ?? null,
  })
export const scheduleEnable = (id: number, on: boolean) =>
  invoke<void>('schedule_enable', { id, on })
export const scheduleDelete = (id: number) => invoke<void>('schedule_delete', { id })
export interface RunOutcome {
  ok: boolean
  /** Empty when a reminder simply told you — which is the whole job. */
  note: string
  ran_at: number
}
export const scheduleRunNow = (id: number) =>
  invoke<RunOutcome>('schedule_run_now', { id })

// ---- focus: a goal, a clock, and permission to ignore everything else ----

export interface Focus {
  id: number
  goal: string
  /** The space the goal is about. Null means it spans everything, and then
   *  nothing is held. */
  node_id: number | null
  started_at: number
  ended_at: number | null
  /** What never reached you, counted by the inbox when the session ended. */
  held: number
}

export const focusCurrent = () => invoke<Focus | null>('focus_current')
export const focusStart = (goal: string, nodeId: number | null) =>
  invoke<Focus>('focus_start', { goal, nodeId })
/** `held` is the inbox's count — the backend cannot work it out, because
 *  holding is a rendering rule over three live streams. */
export const focusEnd = (held: number) => invoke<void>('focus_end', { held })
export const focusRecent = (limit = 8) => invoke<Focus[]>('focus_recent', { limit })


// ---- inbox: what has been read, and what has not ----

/** One decision about one row. Absent means nobody has said, which is unread. */
export interface InboxMark {
  item: string
  read: boolean
  at: number
}

export const inboxMarks = () => invoke<InboxMark[]>('inbox_marks')
/** Mark rows read, or unread again. */
export const inboxMark = (items: string[], read: boolean) =>
  invoke<void>('inbox_mark', { items, read })
/** The moment before which history counts as read. */
export const inboxFloor = () => invoke<number>('inbox_floor')
/** Seed that moment from the old localStorage timestamp, once. */
export const inboxFloorSeed = (at: number) => invoke<number>('inbox_floor_seed', { at })


// ---- spaces: making a workspace with a first cut already drafted ----

export interface FolderDraft {
  name: string
  why: string
}

export interface RoutineDraft {
  name: string
  /** daily | weekdays | weekly | hourly */
  every: string
  at_min: number
  /** For 'weekly': comma-separated 0-6, Sunday first. */
  days: string
}

export interface Starter {
  id: string
  name: string
  what: string
  /** One line naming what it actually brings. */
  brings: string
  /** The tag it suggests — only a suggestion. */
  label: string
  folders: FolderDraft[]
  routines: RoutineDraft[]
  bot: boolean
}

export interface SpaceCreated {
  node_id: number
  name: string
  folders: string[]
  routines: string[]
  bot: boolean
  /** Empty on a clean run. Anything here happened after the space existed. */
  problems: string[]
}

export const spaceStarters = () => invoke<Starter[]>('space_starters')
export const spaceCreate = (s: {
  name: string
  label: string
  folders: FolderDraft[]
  routines: RoutineDraft[]
  botName: string
  botGoal: string
}) => invoke<SpaceCreated>('space_create', s)

// ---- bots: a file in a folder, not a new entity ----

export interface Bot {
  /** What people type after the `@`, and the identity: a manager is a file at
   *  the vault root, so this — not a node — is what names it. */
  handle: string
  /** Where its memory is filed. Not what it owns: ownership is on the
   *  feature. 0 for a manager with no home. */
  node_id: number
  node_name: string
  dir: string
  name: string
  goal: string
  /** daily | weekdays | weekly | hourly, or empty for no heartbeat. */
  every: string
  at_min: number
  days: string
  body: string
  /** Skills appended to its instructions. Words, no permissions. */
  skills: string[]
  /** Which starter it came from, empty when made by hand. */
  template: string
  /** The `.devdeck` feature holding its work items. Empty until it has a plan. */
  feature: string
  /** The agent its heartbeat wakes. Empty means it only reads and reports. */
  agent: string
  team: string[]
  /** What to ask that agent on waking. Empty means the goal. */
  wake_intent: string
  /** Review points in words — "before any push". Not a permission: the runtime
   *  stops such a call and says which rule stopped it. Edited in the file. */
  stop_at: string[]
  schedule_id: number | null
  last_woke: number | null
  /** Whether its last wake went well, and what it said. */
  last_ok?: boolean | null
  last_note?: string
  /** The businesses it works for, by space id. */
  businesses?: number[]
  /** The worker it hands a job to, by handle. */
  worker?: string
}

export const botsList = () => invoke<Bot[]>('bots_list')

/** Where one bot's plan stands. Counts only — what a number means (amber, red,
 *  quiet) is the interface's decision, not the backend's. */
export interface BotStanding {
  handle: string
  node_id: number
  done: number
  total: number
  blocked: number
  unclaimed: number
  feature: string
}

export const botsStanding = () => invoke<BotStanding[]>('bots_standing')
export const botGet = (handle: string) => invoke<Bot | null>('bot_get', { handle })
/** The manager whose memory lives on a node — how a bot page opened from a
 *  space still finds it. */
export const botForNode = (nodeId: number) => invoke<Bot | null>('bot_for_node', { nodeId })
export const botSave = (b: {
  nodeId: number
  name: string
  goal: string
  every: string
  atMin: number
  days: string
  body: string
  skills: string[]
  agent: string
  /** Every agent it may put work on, its lead included. */
  team: string[]
  wakeIntent: string
}) => invoke<Bot>('bot_save', b)
export const botDelete = (nodeId: number, handle?: string) => invoke<void>('bot_delete', { nodeId, handle })

// The bot's own thread. Same record and same loop as a conversation with the
// assistant, run in the bot's voice with the bot's permissions — so the shapes
// are the assistant's, not a second set.
/** One entry under a node, on disk. `item` is the feature whose work items
 *  name this path — derived, never a label anyone maintains. */
export interface FileRow {
  name: string
  rel: string
  dir: boolean
  item?: string
}

/** What is in one folder of a node. `rel` empty means the node's own root. */
/** One directory of a node. `root` picks which of its two directories: `work`
 *  is where things run (the repository, when the node names one), `vault` is
 *  where what we know lives — `.devdeck`, `_bot.md`, the features. */
export const nodeFiles = (nodeId: number, rel = '', root: 'work' | 'vault' = 'work') =>
  invoke<FileRow[]>('node_files', { nodeId, rel, root })

/** One file's text, plus what to say when it is not text at all. */
export interface FileText {
  rel: string
  path: string
  text: string
  bytes: number
  readable: boolean
  why: string
  truncated: boolean
}

/** The vault from the top: the workspaces as folders, and `.devdeck/team`,
 *  which belongs to no node and so cannot be reached through `nodeFiles`. */
export const vaultFiles = (rel: string) => invoke<FileRow[]>('vault_files', { rel })
/** One file anywhere in the vault, by path from its root. */
export const vaultFileText = (rel: string) => invoke<FileText>('vault_file_text', { rel })

export const fileText = (nodeId: number, rel: string, root: 'work' | 'vault' = 'work') =>
  invoke<FileText>('file_text', { nodeId, rel, root })

/** One model call: what went in, what came back, whose it was, what it cost.
 *  Token fields are null when the provider did not report — never zero. */
export interface LlmCall {
  id: number
  at: number
  speaker: string
  speaker_name: string
  kind: 'agent' | 'bot' | 'assistant'
  runs_as: string
  provider: string
  model: string
  project_id: string
  project_name: string
  feature: string
  conversation: string
  session: string
  turn: number
  ms: number
  ok: boolean
  error: string
  prompt: string
  prompt_len: number
  reply: string
  reply_len: number
  tools: number
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
}

export interface UsageRow {
  key: string
  label: string
  calls: number
  /** Calls whose provider reported nothing. Shown rather than hidden. */
  unreported: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  provider: string
}

export interface UsageReport {
  since: number
  calls: number
  unreported: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  by_space: UsageRow[]
  by_speaker: UsageRow[]
  by_model: UsageRow[]
  by_day: UsageRow[]
}

export const callsList = (limit = 200) => invoke<LlmCall[]>('calls_list', { limit })
export const callsUsage = (days = 30) => invoke<UsageReport>('calls_usage', { days })
export const callsClear = () => invoke<void>('calls_clear')

/** The Team board: every goal in every space, with everyone on it. */
export const teamBoard = () => invoke<import('./aiw').GoalRow[]>('team_board')

// A feature's thread — the room bots and agents collaborate in. The feature
// already exists in the deck; this is the same conversation record marked with
// its slug, so nothing new is created on disk.
export const featureThread = (nodeId: number, featureId: string) =>
  invoke<import('./aiw').ConversationMeta>('feature_thread', { nodeId, featureId })
export const featureThreadSend = (nodeId: number, featureId: string, text: string) =>
  invoke<import('./aiw').AssistantReply>('feature_thread_send', { nodeId, featureId, text })

// A node's thread, at any level of the tree. A parent has no repository, and
// says so rather than answering as though it had read code up there.
export const nodeThread = (nodeId: number) =>
  invoke<import('./aiw').ConversationMeta>('node_thread', { nodeId })
/** One piece of what a turn will be told, named and measured. */
export interface ContextPart {
  key: string
  title: string
  source: string
  /** personal | deck | yours — which side of the store split it came from. */
  origin: string
  tokens: number
  on: boolean
  edited: boolean
  body: string
}

/** One tool as a turn sees it: what it may do, and what offering it costs. */
export interface ToolLine {
  id: string
  title: string
  description: string
  permission: string
  actions: number
  tokens: number
  on: boolean
}

/** Everything a turn will carry, itemised. Assembled by the same code the
 *  turn uses, so the panel and the request cannot describe different things. */
export interface ContextView {
  parts: ContextPart[]
  tools: ToolLine[]
  system_tokens: number
  context_tokens: number
  tool_tokens: number
  history_turns: number
  history_tokens: number
  total_tokens: number
}

export const threadContext = (conversationId: string) =>
  invoke<ContextView>('thread_context', { conversationId })

export const threadContextSet = (
  conversationId: string,
  kind: 'context' | 'tool',
  key: string,
  on: boolean,
) => invoke<ContextView>('thread_context_set', { conversationId, kind, key, on })

export const threadContextEdit = (conversationId: string, key: string, body: string) =>
  invoke<ContextView>('thread_context_edit', { conversationId, key, body })

/** One thing at one time, from whichever source had a time in it. */
export interface CalendarItem {
  id: string
  /** schedule | deadline */
  kind: string
  /** reminder | command | bot | agent | work */
  sort: string
  /** once | daily | weekdays | weekly | hourly — empty when it is not a
   *  schedule. A one-off and a daily routine look different on a day. */
  every: string
  title: string
  at: number
  end: number
  node_id?: number | null
  space: string
  feature: string
  work_item: string
  status: string
  past: boolean
  schedule_id?: number | null
}

/** What came of one occurrence. Lives as a file per date in the personal
 *  store — `done` is three-valued, because a day you never answered is not a
 *  day you skipped. */
export interface EventEntry {
  schedule_id: number
  day: string
  done?: boolean | null
  notes: string
  updated_at: string
}

export const eventEntry = (scheduleId: number, at: number) =>
  invoke<EventEntry>('event_entry', { scheduleId, at })

export const eventEntrySave = (
  scheduleId: number,
  at: number,
  done: boolean | null,
  notes: string,
) => invoke<EventEntry>('event_entry_save', { scheduleId, at, done, notes })

export const eventHistory = (scheduleId: number, limit?: number) =>
  invoke<EventEntry[]>('event_history', { scheduleId, limit: limit ?? null })

/** Everything between two moments, across every space. One query for every
 *  view, so a day and the month containing it cannot disagree. */
export const calendarRange = (from: number, to: number) =>
  invoke<CalendarItem[]>('calendar_range', { from, to })

export const nodeThreadSend = (nodeId: number, text: string) =>
  invoke<import('./aiw').AssistantReply>('node_thread_send', { nodeId, text })

/** Wake an agent from a thread: a session in a feature's room, an answer
 *  anywhere else. Returns one line saying which happened. */
export const threadWake = (convId: string, agentId: string) =>
  invoke<string>('thread_wake', { convId, agentId })

/** A manager's own chat. `handle` picks the manager on a space that has several. */
export const botThread = (nodeId: number, handle?: string) =>
  invoke<import('./aiw').ConversationMeta>('bot_thread', { nodeId, handle })
export const botThreadSend = (nodeId: number, text: string, handle?: string) =>
  invoke<import('./aiw').AssistantReply>('bot_thread_send', { nodeId, text, handle })

export interface BotWork {
  id: string
  title: string
  /** unclaimed | claimed | in-progress | blocked | done */
  status: string
  assignee: string | null
  feature: string
}

export const WORK_STATUSES = ['unclaimed', 'claimed', 'in-progress', 'blocked', 'done'] as const

export interface ToolOffer {
  id: string
  name: string
  /** skill | agent | software | self-hosted */
  kind: string
  what: string
  /** What saying yes costs. Empty for a skill, which costs nothing. */
  wants: string
  because: string
  /** added | declined | '' when you have not said. */
  decided: string
}

export interface BotTemplate {
  id: string
  name: string
  what: string
  goal_hint: string
  every: string
  at_min: number
  steps: string[]
  standards: string[]
  skills: string[]
  tools: Omit<ToolOffer, 'decided'>[]
}

export interface BotAnswer {
  step: number
  question: string
  answer: string
  at: string
  skipped: boolean
}

export interface Interview {
  script: string[]
  answers: BotAnswer[]
  step: number
  done: boolean
}

export interface Belief {
  id: string
  text: string
  /** you | watched | corrected */
  source: string
  was: string
  created_at: string
  last_used: string
  uses: number
  pinned: boolean
  /** Whether ageing would offer to drop it. */
  stale: boolean
}

export interface BotSuggestion {
  id: string
  title: string
  /** Why this is on screen. Never empty. */
  evidence: string
  /** interview | heartbeat | work | tool | goal */
  kind: string
  tool_id: string
}

export const botCatalog = () => invoke<BotTemplate[]>('bot_catalog')
export const botCreate = (b: {
  nodeId: number
  templateId: string
  name: string
  goal: string
  every: string
  atMin: number
  days: string
  withPlan: boolean
}) => invoke<Bot>('bot_create', b)

export const botWork = (nodeId: number, handle?: string) => invoke<BotWork[]>('bot_work', { nodeId, handle })
export const botPlan = (nodeId: number, steps: string[], handle?: string) =>
  invoke<string>('bot_plan', { nodeId, steps, handle })
/** What a manager with nothing on its plan would start with. */
export const botPlanProposal = (nodeId: number, handle?: string) =>
  invoke<string[]>('bot_plan_proposal', { nodeId, handle })
export const botWorkSave = (w: {
  nodeId: number
  handle?: string
  id: string
  title: string
  status: string
  assignee: string | null
}) => invoke<void>('bot_work_save', w)
export const botWorkDelete = (nodeId: number, id: string, handle?: string) =>
  invoke<void>('bot_work_delete', { nodeId, id, handle })

export const botInterview = (nodeId: number) => invoke<Interview>('bot_interview', { nodeId })
export const botAnswer = (nodeId: number, step: number, answer: string, skipped: boolean) =>
  invoke<Interview>('bot_answer', { nodeId, step, answer, skipped })
export const botInterviewReset = (nodeId: number) =>
  invoke<Interview>('bot_interview_reset', { nodeId })

export const botBeliefs = (nodeId: number) => invoke<Belief[]>('bot_beliefs', { nodeId })
export const botBeliefAdd = (nodeId: number, text: string) =>
  invoke<void>('bot_belief_add', { nodeId, text })
export const botBeliefCorrect = (nodeId: number, id: string, text: string) =>
  invoke<void>('bot_belief_correct', { nodeId, id, text })
export const botBeliefPin = (nodeId: number, id: string, pinned: boolean) =>
  invoke<void>('bot_belief_pin', { nodeId, id, pinned })
export const botBeliefDrop = (nodeId: number, id: string) =>
  invoke<void>('bot_belief_drop', { nodeId, id })
export const botBeliefDropStale = (nodeId: number) =>
  invoke<number>('bot_belief_drop_stale', { nodeId })

export const botTools = (nodeId: number) => invoke<ToolOffer[]>('bot_tools', { nodeId })
/** Returns a sentence when saying yes needs a step DevDeck will not take for
 *  you — an install, a service, a permission. Empty when it is done. */
export const botToolDecide = (nodeId: number, toolId: string, response: string) =>
  invoke<string>('bot_tool_decide', { nodeId, toolId, response })

export const botSuggestions = (nodeId: number) => invoke<BotSuggestion[]>('bot_suggestions', { nodeId })
export const botSuggestionAnswer = (nodeId: number, id: string, response: string, why = '') =>
  invoke<void>('bot_suggestion_answer', { nodeId, id, response, why })


// ---- the vault: the folder tree that is the Explorer ----

/** What a node's `_devdeck.md` says about it. */
export interface VaultMeta {
  label: string
  /** Absolute path to the code this node is about. Its presence is what makes
   *  the node a project; the vault folder and the repo are unrelated dirs. */
  repo: string
  color: string
  body: string
}

/** Where the vault lives, or null until the user has chosen. */
export const vaultRoot = () => invoke<string | null>('vault_root')

/** What the pre-vault tree still holds, so setup can say what clearing costs. */
export interface VaultLegacy {
  nodes: number
  commands: number
  services: number
}
export const vaultLegacy = () => invoke<VaultLegacy>('vault_legacy')
/** The folder setup suggests, so the screen opens with an answer in it. */
export const vaultDefaultRoot = () => invoke<string>('vault_default_root')
export const vaultSetRoot = (path: string, gitInit: boolean, adoptExistingTree: boolean) =>
  invoke<string>('vault_set_root', { path, gitInit, adoptExistingTree })
/** Re-read the folders and hand back the tree they describe. */
export const vaultScan = () => invoke<TreeNode[]>('vault_scan')
export const vaultCreate = (parentId: number | null, name: string) =>
  invoke<TreeNode>('vault_create', { parentId, name })
export const vaultRename = (id: number, name: string) =>
  invoke<void>('vault_rename', { id, name })
export const vaultMeta = (id: number) => invoke<VaultMeta>('vault_meta', { id })
export const vaultSetMeta = (
  id: number,
  fields: { label?: string; repo?: string; color?: string; body?: string },
) =>
  invoke<void>('vault_set_meta', {
    id,
    label: fields.label ?? null,
    repo: fields.repo ?? null,
    color: fields.color ?? null,
    body: fields.body ?? null,
  })
export const vaultDelete = (id: number) => invoke<void>('vault_delete', { id })
/** What switching to another vault folder would cost, before anything moves. */
export interface VaultSwitchCost {
  keeps: number
  drops: number
  losing_commands: number
  losing_services: number
}
/** Move the vault and everything in it. Ids survive, so nothing loses its
 *  commands or services. */
export const vaultMove = (newPath: string) => invoke<string>('vault_move', { newPath })
/** Adopt a folder that already holds a vault — a clone on another machine. */
export const vaultSwitch = (path: string) => invoke<string>('vault_switch', { path })
export const vaultSwitchCost = (path: string) => invoke<VaultSwitchCost>('vault_switch_cost', { path })

/** A node's own folder on disk — for revealing it, or writing context into it. */
export const vaultDir = (id: number) => invoke<string>('vault_dir', { id })

export const nodeSetLabel = (id: number, label: string) =>
  invoke<void>('node_set_label', { id, label })
export const nodeRename = (id: number, name: string) => invoke<void>('node_rename', { id, name })
export const nodeUpdate = (
  id: number,
  fields: { name?: string; path?: string; relPath?: string; color?: string; kind?: string },
) =>
  invoke<void>('node_update', {
    id,
    name: fields.name ?? null,
    path: fields.path ?? null,
    relPath: fields.relPath ?? null,
    color: fields.color ?? null,
    kind: fields.kind ?? null,
  })
export const nodeDelete = (id: number) => invoke<void>('node_delete', { id })

// ---- commands ----
export const commandsList = () => invoke<CommandDef[]>('commands_list')
export const commandSave = (cmd: CommandDef) => invoke<number>('command_save', { cmd })
export const scanProject = (dir: string) => invoke<DetectedCommand[]>('scan_project', { dir })
export const commandDelete = (id: number) => invoke<void>('command_delete', { id })

// ---- services ----
export const servicesList = () => invoke<ServiceDef[]>('services_list')
export const serviceSave = (svc: ServiceDef) => invoke<number>('service_save', { svc })
export const serviceDelete = (id: number) => invoke<void>('service_delete', { id })
export const svcStart = (id: number) => invoke<SvcState>('svc_start', { id })
export const svcStop = (id: number) => invoke<void>('svc_stop', { id })
export const svcRestart = (id: number) => invoke<void>('svc_restart', { id })
export const svcStates = () => invoke<SvcState[]>('svc_states')
export const runBackground = (name: string, command: string, cwd: string, shell?: string) =>
  invoke<SvcState>('run_background', { name, command, cwd, shell: shell ?? null })

// ---- profiles ----
export const profilesList = () => invoke<ProfileDef[]>('profiles_list')
export const profileSave = (profile: ProfileDef) => invoke<number>('profile_save', { profile })
export const profileDelete = (id: number) => invoke<void>('profile_delete', { id })

// ---- machine setup ----
export interface MachineStatus {
  winget: string[]
  scoop: string[]
  scoop_available: boolean
  winget_available: boolean
}
export interface InstallItem {
  id: string
  source: string
}
export interface ManifestPackage {
  id: string
  source: string
  elevate?: boolean
}
export interface Manifest {
  name: string
  version: number
  packages: ManifestPackage[]
  steps: unknown[]
  repos: unknown[]
}
export const machineStatus = () => invoke<MachineStatus>('machine_status')
export const machineInstall = (items: InstallItem[]) => invoke<void>('machine_install', { items })
export const machineInstallScoop = () => invoke<void>('machine_install_scoop')
export const machineSnapshot = (name: string, known: InstallItem[]) =>
  invoke<Manifest>('machine_snapshot', { name, known })
export const machineExport = (path: string, manifest: Manifest) =>
  invoke<void>('machine_export', { path, manifest })
export const machineImport = (path: string) => invoke<Manifest>('machine_import', { path })
export const machineShow = (id: string, source: string) => invoke<string>('machine_show', { id, source })
export const machineInstallPreview = (id: string, source: string) =>
  invoke<string>('machine_install_preview', { id, source })

// The editable, DB-backed catalog (curated packages seeded on first run).
export interface MachinePackage {
  id: string
  name: string
  source: string
  category: string
  blurb: string
  elevate: boolean
  custom: boolean
  hidden: boolean
  sort: number
}
export const machinePackagesList = () => invoke<MachinePackage[]>('machine_packages_list')
export const machinePackagesSeed = (packages: MachinePackage[]) =>
  invoke<number>('machine_packages_seed', { packages })
export const machinePackageSave = (pkg: MachinePackage) => invoke<void>('machine_package_save', { pkg })
export const machinePackageDelete = (id: string) => invoke<void>('machine_package_delete', { id })

export interface MachineItemEvent {
  id: string
  status: 'installing' | 'ok' | 'failed'
}
export function onMachineItem(cb: (e: MachineItemEvent) => void): Promise<UnlistenFn> {
  return listen<MachineItemEvent>('machine:item', (e) => cb(e.payload))
}
export function onMachineDone(cb: () => void): Promise<UnlistenFn> {
  return listen('machine:done', () => cb())
}

// ---- project setup ----
export interface RequiredTool {
  binary: string
  name: string
  pkg_id: string
  source: string
  installed: boolean
}
export interface SetupStep {
  label: string
  run: string
  done: boolean
}
export interface ProjectSetup {
  tools: RequiredTool[]
  steps: SetupStep[]
  ready: boolean
}
export const detectProjectSetup = (dir: string) => invoke<ProjectSetup>('detect_project_setup', { dir })
export const refreshPath = () => invoke<void>('refresh_path')
export const suggestInstall = (line: string) => invoke<RequiredTool | null>('suggest_install', { line })
export const runProjectSetup = (
  tools: { pkg_id: string; source: string }[],
  steps: string[],
  cwd: string,
) => invoke<void>('run_project_setup', { tools, steps, cwd })
export function onSetupDone(cb: (ok: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>('setup:done', (e) => cb(e.payload))
}
export const cloneRepo = (url: string, parent: string) => invoke<string>('clone_repo', { url, parent })

/** Who is signed in to GitHub — `gh` first, our own OAuth token second. */
export interface GithubUser {
  /** Empty when nobody is signed in, or gh is not installed. */
  login: string
  name: string
  avatar_url: string
  /** Why there is no login, in words worth showing. */
  reason: string
}

export const githubUser = () => invoke<GithubUser>('github_user')

// ---- GitHub sign-in (OAuth device flow) ----

/** The codes GitHub hands back when a sign-in starts. */
export interface DeviceStart {
  /** The short code the user types into GitHub, e.g. `WDJB-MJHT`. */
  user_code: string
  /** Ours, not theirs — the handle we poll with. Never shown. */
  device_code: string
  verification_uri: string
  /** Seconds GitHub asks us to wait between polls. */
  interval: number
  /** Seconds until the code dies. */
  expires_in: number
}

/** One poll's answer. `pending` is the normal case, not a failure. */
export type DevicePoll =
  | { kind: 'pending'; interval: number }
  /** Signed in. `gh` says whether the CLI took the token too. */
  | { kind: 'done'; login: string; gh: boolean }
  | { kind: 'failed'; message: string; retryable: boolean }

/** Whether this build has an OAuth app to sign in against at all. */
export const githubOauthConfigured = () => invoke<boolean>('github_oauth_configured')
export const githubDeviceStart = () => invoke<DeviceStart>('github_device_start')
export const githubDevicePoll = (deviceCode: string, interval: number) =>
  invoke<DevicePoll>('github_device_poll', { deviceCode, interval })
/** Do we hold a token? Never *what* it is. */
export const githubTokenStored = () => invoke<boolean>('github_token_stored')
export const githubSignOut = (alsoGh = true) => invoke<void>('github_sign_out', { alsoGh })

/** What a hand-pasted token turned out to be. Never the token itself. */
export interface TokenPasted {
  login: string
  /** Whether the `gh` CLI took the same token — false means git push is still logged out. */
  gh: boolean
  scopes: string[]
  /** Scopes we want that this token lacks. Empty when GitHub did not say. */
  missing: string[]
  /** A fine-grained token reports no scopes at all; that is not the same as none. */
  scopes_known: boolean
}
/** Store a personal access token, after proving GitHub accepts it. */
export const githubTokenPaste = (token: string) =>
  invoke<TokenPasted>('github_token_paste', { token })

// ---- community ----

/** One thing you could install for your bots. */
export interface CommunityItem {
  id: string
  /** skill | agent | tool */
  kind: string
  name: string
  summary: string
  author: string
  source: string
  /** permissive | copyleft | restricted | missing */
  licence: string
  version: string
  body: string
  role: string
  tool_id: string
  command: string
  /** Total stars, when the source reports one. `null` is not zero — a registry
   *  entry has no star count at all, and ranking it as zero would bury it for
   *  a reason that is nothing to do with the entry. */
  stars: number | null
  /** Stars gained over this list's window. Never mixed with `stars`: a gain
   *  over a week and a lifetime total are not the same number. */
  gained: number | null
}

/** An install, and the thing the Installed page exists to say. */
export interface CommunityStanding {
  id: string
  kind: string
  name: string
  version: string
  source: string
  licence: string
  at: number
  files: string[]
  /** Agents that can actually use it. Empty straight after an install. */
  reach: string[]
  days: number
  /** Unreachable long enough to be worth pointing at. */
  idle: boolean
  /** Why it cannot be called even when granted, or empty when it can. */
  blocked: string
}

export interface CommunityListing extends CommunityItem {
  installed: boolean
  standing: CommunityStanding | null
}

export const communityCatalog = () => invoke<CommunityListing[]>('community_catalog')
export const communityInstalled = () => invoke<CommunityStanding[]>('community_installed')
/** Writes files. Grants nothing — every agent stays on `none`. */
export const communityInstall = (id: string) =>
  invoke<CommunityStanding>('community_install', { id })
export const communityUninstall = (id: string) =>
  invoke<void>('community_uninstall', { id })
/** The separate, deliberate act: who may use it, and how. */
/** A grant a bundle suggests. Never applied by installing. */
export interface CommunitySuggestion {
  item: string
  agent: string
  /** none | read | approval | full. A skill ignores it; its grant is binary. */
  level: string
}
export interface CommunityBundle {
  id: string
  name: string
  summary: string
  items: string[]
  grants: CommunitySuggestion[]
}
/** What installing a bundle would do, worked out before anything happens. */
export interface CommunityPlan {
  bundle: string
  to_install: string[]
  already: string[]
  /** Named in the bundle and not in the index — a broken bundle, said so. */
  missing: string[]
  /** Offered after installing, never applied by it. */
  grants: CommunitySuggestion[]
  /** Grants naming an agent this machine does not have. */
  unknown_agents: string[]
}
export const communityBundles = () => invoke<[CommunityBundle, CommunityPlan][]>('community_bundles')
/** Installs the items and grants nothing; returns the grants it proposes. */
export const communityInstallBundle = (id: string) =>
  invoke<CommunityPlan>('community_install_bundle', { id })

/** A thing that can serve an open model on this machine. */
export interface CommunityRunner {
  id: string
  name: string
  install_hint: string
  installed: boolean
  /** Installed and not answering is a different problem with a different fix. */
  responding: boolean
  version: string
  models: { name: string; size: string }[]
  note: string
}
export const communityRunners = () => invoke<CommunityRunner[]>('community_runners')

/** One index source's answer, and how much to trust it. */
export interface CommunityFeed {
  /** 'registry' | 'github' */
  source: string
  items: CommunityItem[]
  /** False means `items` is the last good answer, or empty because there has
   *  never been one. Never confuse it with "nothing is published". */
  ok: boolean
  /** Millis of the last *successful* read. 0 when there has never been one. */
  fetched_at: number
  /** How the list is ordered, or what went wrong. */
  note: string
  /** The orders this feed can honestly be put in, worked out from the rows it
   *  holds. A feed with no star counts does not offer to sort by stars. */
  sorts: CommunitySort[]
}

/** One order a feed can honestly be put in. */
export interface CommunitySort {
  /** 'source' | 'stars' | 'growth' | 'name' */
  id: string
  label: string
  /** What the order actually means. The labels are short enough to mislead. */
  note: string
}
/** Cache only — opening the page never spends a rate limit. */
export const communityIndex = () => invoke<CommunityFeed[]>('community_index')
/** Go and look. A button, not something that happens on its own. */
export const communityRefreshIndex = (source?: string) =>
  invoke<CommunityFeed[]>('community_refresh_index', { source: source ?? null })

/** Search, filter and order one list. Cache only, so it costs nothing and can
 *  run on every keystroke. `source` is a feed name, or 'catalog' for what
 *  ships with DevDeck. */
export const communityArrange = (
  source: string,
  q: string,
  kinds: string[],
  permissive: boolean,
  sort: string,
) => invoke<CommunityItem[]>('community_arrange', { source, q, kinds, permissive, sort })

/** A tool an MCP server declares, read from the running server. */
export interface McpToolDef {
  name: string
  description: string
  input_schema: unknown
  /** The server's own hint that the tool changes nothing. A hint: an unhinted
   *  tool counts as a write, so a lying server can only narrow itself. */
  read_only: boolean
}

/** Something the command needs, checked against this machine. */
export interface CommunityNeed {
  what: string
  present: boolean
  hint: string
}

/** One entry, with everything this machine can honestly say about it. */
export interface CommunityRepo {
  item: CommunityItem
  /** 'catalog', or the index source it was found in. */
  found_in: string
  installed: CommunityStanding | null
  tools: McpToolDef[]
  /** Why `tools` is empty. Empty string when it is not — "no tools" and "we
   *  could not ask" are different facts. */
  tools_note: string
  /** [agentId, level] for every agent, including the ones on none. */
  grants: [string, string][]
  needs: CommunityNeed[]
}

/** Everything known about one entry. Starts an installed server to read its
 *  real tool list, so it is a page you opened, not a row in a list. */
export const communityRepo = (id: string) => invoke<CommunityRepo>('community_repo', { id })

/** An MCP server running right now. */
export interface McpServerStatus {
  id: string
  name: string
  pid: number
  started_at: string
  protocol: string
  tools: number
}
/** Which servers are up. An MCP server is a process; a process nobody can see
 *  is a process nobody can stop. */
export const communityServers = () => invoke<McpServerStatus[]>('community_servers')
/** Stop one. It restarts on the next call that needs it. */
export const communityStopServer = (id: string) =>
  invoke<boolean>('community_stop_server', { id })

export const communityGrant = (
  id: string,
  agentId: string,
  on: boolean,
  level?: string,
) => invoke<void>('community_grant', { id, agentId, on, level: level ?? null })

// ---- git ----
export interface GitInfo {
  is_repo: boolean
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}
/** Branch + ahead/behind from local refs — no network. */
export const gitInfo = (dir: string) => invoke<GitInfo>('git_info', { dir })
/** Quiet non-interactive fetch, then fresh status (learns what's to pull). */
export const gitFetch = (dir: string) => invoke<GitInfo>('git_fetch', { dir })
/** Fast-forward pull, streaming to Logs; emits git:done when finished. */
export const gitPull = (dir: string) => invoke<void>('git_pull', { dir })
/** One path git has something to say about. */
export interface GitChange {
  path: string
  /** Status letter for the staged column, ' ' when clean. */
  index: string
  /** Status letter for the working-tree column, ' ' when clean. */
  work: string
  from: string | null
  untracked: boolean
  conflict: boolean
  /** One word for the status letters — decided in Rust, so there is one copy. */
  label: string
}
/** Everything the working tree has to say, untracked files included. */
export const gitChanges = (dir: string) => invoke<GitChange[]>('git_changes', { dir })
/** Stage exactly these paths, commit them, and optionally push. Streams to Logs. */
export const gitCommit = (dir: string, message: string, paths: string[], push: boolean) =>
  invoke<void>('git_commit', { dir, message, paths, push })
/** Push the current branch, setting an upstream if it has none. */
export const gitPush = (dir: string) => invoke<void>('git_push', { dir })

export function onGitDone(cb: (ok: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>('git:done', (e) => cb(e.payload))
}

// ---- layouts ----
export const layoutsList = () => invoke<LayoutDef[]>('layouts_list')
export const layoutSave = (name: string, data: string) => invoke<void>('layout_save', { name, data })
export const layoutDelete = (id: number) => invoke<void>('layout_delete', { id })

// ---- settings ----
export const settingGet = (key: string) => invoke<string | null>('setting_get', { key })
export const settingSet = (key: string, value: string) => invoke<void>('setting_set', { key, value })
export const hotkeyApply = (spec: string) => invoke<void>('hotkey_apply', { spec })
export const shellsDetect = () => invoke<ShellDef[]>('shells_detect')
export const revealInExplorer = (path: string) => invoke<void>('reveal_in_explorer', { path })
export const openUrl = (url: string) => invoke<void>('open_url', { url })

// ---- example workspace ----
/** Writes the demo project to disk and seeds it; returns the new project id. */
export const seedExample = () => invoke<number>('seed_example')
export const exampleExists = () => invoke<boolean>('example_exists')

// ---- widget window ----
export const widgetToggle = () => invoke<void>('widget_toggle')
export const widgetShow = () => invoke<void>('widget_show')
export const widgetHide = () => invoke<void>('widget_hide')
export const widgetResize = (width: number, height: number) =>
  invoke<void>('widget_resize', { width, height })

export const focusMain = () => invoke<void>('focus_main')

/// Tell the shell the UI has painted, so it can show the window.
///
/// The window starts hidden so nobody watches it assemble itself. If this
/// never arrives the backend shows it anyway after a few seconds — a slow
/// reveal beats an app with no window at all.
export const appReady = () => invoke<void>('app_ready')
/** Bring the widget into view without taking the keyboard. `sticky` keeps it
 *  up (a crash); otherwise it collapses itself after a few seconds. */
export const widgetPeek = (sticky = false) => invoke<void>('widget_peek_cmd', { sticky })

// ---- self-update ----
export interface UpdateInfo {
  /** False when the check couldn't reach the manifest — do NOT read that as
   *  "up to date". */
  ok: boolean
  current: string
  latest: string
  available: boolean
  via_scoop: boolean
  scoop_available: boolean
}
export const appUpdateInfo = () => invoke<UpdateInfo>('app_update_info')
export const appUpdate = () => invoke<void>('app_update')

// ---- recents ----
export const recentBump = (kind: 'command' | 'service', refId: number) =>
  invoke<void>('recent_bump', { kind, refId })
export const recentsList = () => invoke<Recent[]>('recents_list')

// ---- activity ----
export const activityList = (limit = 60) => invoke<Activity[]>('activity_list', { limit })
/** What one schedule, bot or service has done, newest first. A rolling
 *  history: the feed is trimmed, so this means "as far back as is kept". */
export const activityFor = (refId: number, kinds: string[], limit = 8) =>
  invoke<Activity[]>('activity_for', { refId, kinds, limit })
export const activityClear = () => invoke<void>('activity_clear')
/** Durable run history for one service: start, stop, duration, exit code. */
export const serviceRuns = (serviceId: number, limit = 25) =>
  invoke<ServiceRun[]>('service_runs', { serviceId, limit })
export function onActivity(cb: (a: Activity) => void): Promise<UnlistenFn> {
  return listen<Activity>('activity:new', (e) => cb(e.payload))
}

// ---- connections ----
export const connList = () => invoke<ConnDef[]>('conn_list')
export const connSave = (def: ConnDef) => invoke<number>('conn_save', { def })
export const connDelete = (id: number) => invoke<void>('conn_delete', { id })
/** Store a password in Windows Credential Manager. '' removes it. */
export const connSetPassword = (id: number, password: string) =>
  invoke<void>('conn_set_password', { id, password })
export const connClearPassword = (id: number) => invoke<void>('conn_clear_password', { id })
/** `select 1` against the connection — reachable or not, and why. */
export const connTest = (id: number) => invoke<QueryResult>('conn_test', { id })
export const connRun = (id: number, sql: string) => invoke<QueryResult>('conn_run', { id, sql })
export const connQueriesList = () => invoke<SavedQuery[]>('conn_queries_list')
export const connQuerySave = (query: SavedQuery) => invoke<number>('conn_query_save', { query })
export const connQueryDelete = (id: number) => invoke<void>('conn_query_delete', { id })
export const connRunsList = (connectionId: number, limit = 50) =>
  invoke<QueryRun[]>('conn_runs_list', { connectionId, limit })

// ---- stash ----
export const stashList = (q: Partial<StashQuery>) =>
  invoke<StashItem[]>('stash_list', {
    q: {
      query: q.query ?? '',
      filter: q.filter ?? 'all',
      item_type: q.item_type ?? '',
      tag: q.tag ?? '',
      project_id: q.project_id ?? null,
      no_project: q.no_project ?? false,
      limit: q.limit ?? 300,
    },
  })
/** Full row including `content` — the list omits it to stay small. */
export const stashGet = (id: number) => invoke<StashItem>('stash_get', { id })
/** Edit title / content / note. Rejects secret-shaped content with a reason. */
export const stashUpdate = (edit: StashEdit) => invoke<StashItem>('stash_update', { edit })
/** Write a note from scratch — an item that never touched the clipboard. */
export const stashCreateNote = (title: string, content: string) =>
  invoke<StashItem>('stash_create_note', { title, content })

// ---- stash tags ----
export const stashTagsList = () => invoke<TagCount[]>('stash_tags_list')
/** Each entry may itself be comma-separated, so one box can add several. */
export const stashTagAdd = (id: number, names: string[]) =>
  invoke<string[]>('stash_tag_add', { id, names })
export const stashTagRemove = (id: number, name: string) =>
  invoke<string[]>('stash_tag_remove', { id, name })
/** Remove a tag from every item at once. */
export const stashTagDelete = (tagId: number) => invoke<void>('stash_tag_delete', { tagId })
export const stashCounts = () => invoke<StashCounts>('stash_counts')
export const stashPin = (id: number, pinned: boolean) => invoke<void>('stash_pin', { id, pinned })
export const stashDelete = (id: number) => invoke<void>('stash_delete', { id })
/** Bump usage + arm the echo guard so copying doesn't re-capture the clip. */
export const stashMarkUsed = (id: number) => invoke<void>('stash_mark_used', { id })
/** Tell the capture thread which project it should stamp new clips with. */
export const stashSetContext = (
  projectId: number | null,
  projectName: string,
  workspaceName: string,
) => invoke<void>('stash_set_context', { projectId, projectName, workspaceName })
export const stashStatus = () => invoke<StashStatus>('stash_status')
export const stashSetEnabled = (enabled: boolean) => invoke<void>('stash_set_enabled', { enabled })
/** `toast` = show the capture toast · `auto_paste` = paste, don't just copy. */
export const stashSetOption = (key: 'toast' | 'auto_paste', value: boolean) =>
  invoke<void>('stash_set_option', { key, value })
/** Prune now using the saved window. Resolves with the number removed. */
export const stashPrune = () => invoke<number>('stash_prune')
/** Open a linked screenshot in the default image viewer. */
export const stashOpenFile = (id: number) => invoke<void>('stash_open_file', { id })

/** A screenshot decoded for the detail pane. `width`/`height` are what the
 *  data URI really contains, so the pane can refuse to stretch past them. */
export interface StashImage {
  uri: string
  width: number
  height: number
  natural_width: number
  natural_height: number
}
/** Full-quality image for the detail pane, rendered to fit a box given in
 *  **device** pixels — multiply your CSS box by `devicePixelRatio` first, or
 *  you get a preview that is soft on every scaled display. Reads the linked
 *  file, not the card thumbnail. */
export const stashImage = (id: number, maxWidth: number, maxHeight: number) =>
  invoke<StashImage>('stash_image', { id, maxWidth, maxHeight })
/** Save a retention window (days; 0 = forever) and apply it immediately. */
export const stashSetRetention = (days: number) => invoke<number>('stash_set_retention', { days })
export function onStashItem(cb: (item: StashItem) => void): Promise<UnlistenFn> {
  return listen<StashItem>('stash:item', (e) => cb(e.payload))
}
/** A screenshot landed in the watched folder and was stashed. */
export function onStashShot(cb: () => void): Promise<UnlistenFn> {
  return listen('stash:shot', () => cb())
}

// ---- stash copy / paste ----
export interface PasteResult {
  copied: boolean
  /** True only when the keystroke really reached another window — a false
   *  here is "it's on your clipboard", never a pretend paste. */
  pasted: boolean
}
/** Write a clip to the clipboard from the backend. Works from an unfocused
 *  window, unlike the webview's clipboard API. */
export const stashCopy = (id: number) => invoke<void>('stash_copy', { id })
/** Copy, and paste into the app you came from when auto-paste is on (or when
 *  `force` — that's ⇧⏎, an explicit ask). */
export const stashPaste = (id: number, force = false) =>
  invoke<PasteResult>('stash_paste', { id, force })
/** Snapshot the foreground window before DevDeck takes focus. */
export const stashRememberTarget = () => invoke<void>('stash_remember_target')

// ---- capture toast window ----
export const toastShow = (width: number, height: number) =>
  invoke<void>('toast_show', { width, height })
export const toastHide = () => invoke<void>('toast_hide')
export const toastFocus = () => invoke<void>('toast_focus')

/** Another window changed a stash item — tell whoever is displaying them. */
export const emitStashChanged = () => emit('devdeck:stash-changed', {})
export function onStashChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('devdeck:stash-changed', () => cb())
}

// ---- cross-window: app tour (widget drives the main window) ----
export type TourAction = 'workspace' | 'project' | 'command' | 'service' | 'profile' | 'open-main'
export const emitTourAction = (action: TourAction) =>
  emit('devdeck:tour-action', { action })
export function onTourAction(cb: (action: TourAction) => void): Promise<UnlistenFn> {
  return listen<{ action: TourAction }>('devdeck:tour-action', (e) => cb(e.payload.action))
}

// ---- cross-window: data changed (so the other window can refresh) ----
export const emitDataChanged = () => emit('devdeck:data-changed', {})
export function onDataChanged(cb: () => void): Promise<UnlistenFn> {
  return listen('devdeck:data-changed', () => cb())
}

// ---- cross-window: widget asks the main IDE to open a terminal panel ----
export interface OpenTerminalReq {
  ptyId: number
  title: string
}
export const emitOpenTerminal = (ptyId: number, title: string) =>
  emit('devdeck:open-terminal', { ptyId, title } satisfies OpenTerminalReq)
export function onOpenTerminal(cb: (e: OpenTerminalReq) => void): Promise<UnlistenFn> {
  return listen<OpenTerminalReq>('devdeck:open-terminal', (e) => cb(e.payload))
}

// ---- pty ----
export const ptyCreate = (shell: string, cwd?: string | null, title?: string | null) =>
  invoke<PtyInfo>('pty_create', { shell, cwd: cwd ?? null, title: title ?? null })
export const ptyWrite = (id: number, data: string) => invoke<void>('pty_write', { id, data })
export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>('pty_resize', { id, cols, rows })
export const ptyKill = (id: number) => invoke<void>('pty_kill', { id })
export const ptyScrollback = (id: number) => invoke<string>('pty_scrollback', { id })
export const ptyList = () => invoke<PtyInfo[]>('pty_list')

// ---- logs ----
export const logsRecent = (limit?: number) => invoke<LogEntry[]>('logs_recent', { limit: limit ?? null })
export const logsClear = () => invoke<void>('logs_clear')
export const logsExport = (path: string) => invoke<number>('logs_export', { path })

// ---- events ----
export interface PtyOutputEvent {
  id: number
  data: string
}

export function onPtyOutput(cb: (e: PtyOutputEvent) => void): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>('pty:output', (e) => cb(e.payload))
}
export function onPtyExit(cb: (e: { id: number }) => void): Promise<UnlistenFn> {
  return listen<{ id: number }>('pty:exit', (e) => cb(e.payload))
}
export function onSvcLog(cb: (e: LogEntry) => void): Promise<UnlistenFn> {
  return listen<LogEntry>('svc:log', (e) => cb(e.payload))
}
export function onSvcStatus(cb: (e: SvcState) => void): Promise<UnlistenFn> {
  return listen<SvcState>('svc:status', (e) => cb(e.payload))
}
export function onStats(cb: (e: ProcStat[]) => void): Promise<UnlistenFn> {
  return listen<ProcStat[]>('stats:update', (e) => cb(e.payload))
}

// ---- mail ----
export const mailAccountsList = () => invoke<MailAccount[]>('mail_accounts_list')
export const mailAccountSave = (def: MailAccount) => invoke<number>('mail_account_save', { def })
export const mailAccountDelete = (id: number) => invoke<void>('mail_account_delete', { id })
/** Store an IMAP/SMTP password in Windows Credential Manager. Nothing reads it back. */
export const mailAccountSetPassword = (id: number, username: string, password: string) =>
  invoke<void>('mail_account_set_password', { id, username, password })
export const mailAccountClearPassword = (id: number) =>
  invoke<boolean>('mail_account_clear_password', { id })
/** Whether this build carries a Google client, so the button is worth drawing. */
export const mailGoogleAvailable = () => invoke<boolean>('mail_google_available')
/** Opens the browser and blocks until you consent or close the tab. */
export const mailGoogleSignIn = (id: number, address: string) =>
  invoke<void>('mail_google_sign_in', { id, address })
export const mailGoogleSignOut = (id: number) => invoke<void>('mail_google_sign_out', { id })
/** Sign in and build the account from whichever address consented. */
/** Somebody worth learning about, and the evidence for saying so. */
export interface Correspondent {
  contact_id: number
  name: string
  email: string
  /** The company part of the address, which is most of "who is this". */
  domain: string
  received: number
  /** How many times *you* wrote to them. The whole signal. */
  sent: number
  threads: number
  last_ts: number
  account_id: number
  /** Which space a fact about them would be filed under by default. */
  space: string
}

/** Who you actually correspond with, most-reciprocal first. Local query. */
export const mailCorrespondents = (limit = 200) =>
  invoke<Correspondent[]>('mail_correspondents', { limit })

/** Where attachments go when nothing is configured. */
export const mailAttachmentsDefault = () => invoke<string>('mail_attachments_default')
export const mailGoogleConnect = () => invoke<MailAccount>('mail_google_connect')
/** Every label on an account. `0` for all accounts. */
export const mailLabels = (accountId = 0) =>
  invoke<MailLabel[]>('mail_labels', { accountId })
/** Fetch one label's mail. Labels cost nothing until you open one. */
export const mailSyncLabel = (labelId: number) =>
  invoke<number>('mail_sync_label', { labelId })

// ---------------------------------------------------------------------------
// The learn run
// ---------------------------------------------------------------------------

/** Somebody a run proposes to read about. */
export interface LearnPerson {
  contact_id: number
  name: string
  email: string
  domain: string
  /** The space of the mailbox they write to — a suggestion, never a rule. */
  space: string
  threads: number
  messages: number
  attachments: number
  chars: number
  received: number
  sent: number
  /** Who wrote to them: you, or for a business anyone on its team. */
  written_by?: string[]
}

/** Something deliberately left out, with the reason attached. */
export interface LearnExclusion {
  kind: string
  count: number
  why: string
}

/**
 * What one decision buys. Every number here is computed from the batch that
 * would actually be sent, so the figure you approve is the figure that leaves.
 */
export interface LearnEstimate {
  people: LearnPerson[]
  threads: number
  messages: number
  attachments: number
  chars: number
  tokens: number
  /** Zero when the model has no published price — see `price_note`, not free. */
  cost_usd: number
  price_note: string
  excluded: LearnExclusion[]
  depth: string
  provider: string
  provider_name: string
  model: string
  /** False when the run could not read anything: no provider, or the mock. */
  ready: boolean
  /** Why it cannot run. Empty when it can. */
  note: string
  /** Why the model differs from the assistant's. Never a reason it is blocked. */
  model_note: string
}

/** A receipt. Written when the batch is posted, not when it succeeds. */
export interface LearnRun {
  id: number
  started_at: number
  finished_at: number
  provider: string
  model: string
  status: string
  depth: string
  people: number
  threads: number
  messages: number
  attachments: number
  chars: number
  tokens: number
  held_back: number
  thread_keys: string[]
  held: LearnExclusion[]
  error: string
  facts: number
  kept: number
}

/** A proposed fact, waiting for a yes. */
export interface LearnFact {
  id: number
  run_id: number
  /** thing = about a client or project · you = about you. Decides the store. */
  kind: string
  text: string
  source: string
  thread_keys: string[]
  contact_id: number
  space: string
  node_id: number
  status: string
  written_to: string
  created_at: number
  /** Where a yes would put it. Computed fresh, never stored. */
  destination: string
}

/** What a run would cost and what it would leave out. Nothing is sent. */
export const learnEstimate = (people = 12, only: number[] = [], depth = 'full', fresh = false, business = 0) =>
  invoke<LearnEstimate>('learn_estimate', { people, only, depth, fresh, business })
/** Everybody a run could read about, for the Choose who list. */
export const learnPeople = (limit = 50) =>
  invoke<Correspondent[]>('learn_people', { limit })
/** Send it. The one call in DevDeck that puts your mail on the wire. */
export const learnRun = (people = 12, only: number[] = [], depth = 'full') =>
  invoke<LearnRun>('learn_run', { people, only, depth })
/** Past runs, newest first. Each row is its own receipt. */
export const learnRuns = (limit = 20) => invoke<LearnRun[]>('learn_runs', { limit })
/** Proposals. `runId` 0 for every run, `status` '' for every state. */
export const learnFacts = (runId = 0, status = 'proposed') =>
  invoke<LearnFact[]>('learn_facts', { runId, status })
/** Say yes to one, with whatever edit you made. Returns where it was written. */
export const learnKeep = (id: number, text: string, nodeId = 0) =>
  invoke<string>('learn_keep', { id, text, nodeId })
/** Say no. Writes a row, not a note — so it is not offered twice. */
export const learnDecline = (id: number) => invoke<void>('learn_decline', { id })

/** One fact as kept from a card: the id and the words, edited or not. */
export interface KeptLine {
  id: number
  text: string
  node_id?: number
}
/**
 * A person's card, decided in one go: keep these lines (with any edits),
 * decline those, and put the summary on the person's record.
 */
export interface PersonDecision {
  run_id: number
  contact_id: number
  name: string
  email: string
  summary: string
  keep: KeptLine[]
  decline: number[]
  /** Lines you wrote on the card yourself. Filed and kept with the rest. */
  add: string[]
  /** For a business's card: the business, what the organisation is, and what it relates to. */
  business?: number
  role?: string
  relates?: string[]
  title?: string
  contacts?: ContactSummary[]
}
export interface PersonOutcome {
  kept: number
  declined: number
  person_file: string
}
export const learnDecidePerson = (decision: PersonDecision) =>
  invoke<PersonOutcome>('learn_decide_person', { decision })

/** One person at an organisation, as the mail shows them. */
export interface ContactSummary {
  contact_id: number
  email: string
  name: string
  title: string
  text: string
}
/** A person's card as a run left it: summary, facts, and the decision. */
export interface LearnCard {
  run_id: number
  person: LivePerson
  /** client | supplier | adviser | partner firm, for an organisation. */
  role: string
  /** The business's products and services it has to do with. */
  relates: string[]
  /** The business space, or 0 for a card about you. */
  business: number
  summary: string
  /** proposed | kept | declined */
  status: string
  facts: LearnFact[]
  /** organisation | person | team, for a business's card. */
  kind?: string
  /** For someone on the business's team: what they do there. */
  title?: string
  /** The people at an organisation, each with what the mail says of them. */
  contacts?: ContactSummary[]
}
/** The cards of a run, to decide or look at again. `runId` 0 is the latest. */
export const learnReview = (runId = 0) => invoke<LearnCard[]>('learn_review', { runId })
/** Somebody the kept facts say is family, a friend or a pet. */
export interface LifeProposal {
  name: string
  /** wife, stepson, father, friend, dog: as the facts put it. */
  relation: string
  kind: 'person' | 'pet' | string
  home: boolean
  /** The fact that says so. */
  why: string
}
/**
 * Who the kept facts say is in your life. One small request from what was
 * already read and kept; cached until more is kept.
 */
export const learnLifeProposals = () => invoke<LifeProposal[]>('learn_life_proposals')
/** The summary written again from the lines kept. One small request to the model. */
export const learnSummarise = (name: string, facts: string[]) =>
  invoke<string>('learn_summarise', { name, facts })

/** Somebody in a live run's plan. */
export interface LivePerson {
  contact_id: number
  name: string
  email: string
  threads: number
  messages: number
}
export interface LearnPlanEvent {
  run_id: number
  people: LivePerson[]
  /** organisation | person | team, one per entry in `people`. */
  kinds?: string[]
  threads: number
  messages: number
  tokens: number
  cost_usd: number
  model: string
}
export interface LearnFactEvent {
  run_id: number
  index: number
  total: number
  person: LivePerson
  fact: LearnFact
}
export interface LearnPersonEvent {
  run_id: number
  index: number
  total: number
  person: LivePerson
  facts: number
  /** What they are to you, in two or three sentences. Empty if the model gave none. */
  summary: string
  tokens_so_far: number
  cost_so_far: number
}
/** The first line the model writes about a person: who they are to you. */
export interface LearnSummaryEvent {
  run_id: number
  index: number
  total: number
  person: LivePerson
  text: string
  /** For an organisation: what it is to the business, and what it relates to. */
  role?: string
  relates?: string[]
}
export interface LearnDoneEvent {
  run: LearnRun
  stopped: boolean
}
export interface LearnFailedEvent {
  run_id: number
  index: number
  person: LivePerson
  error: string
}

/**
 * The same run, told live: one request per person, one fact per line. The
 * promise resolves with the receipt when the last person is done, or when
 * Stop was pressed; the events arrive along the way.
 */
export const learnRunLive = (people = 12, only: number[] = [], depth = 'full', fresh = false, business = 0) =>
  invoke<LearnRun>('learn_run_live', { people, only, depth, fresh, business })
/** Stop after the person being read. Everything that came back stays. */
export const learnStop = () => invoke<void>('learn_stop')
/** Everything a live run says, as it says it. Returns the unsubscribe. */
export async function onLearn(h: {
  plan?: (e: LearnPlanEvent) => void
  summary?: (e: LearnSummaryEvent) => void
  fact?: (e: LearnFactEvent) => void
  person?: (e: LearnPersonEvent) => void
  done?: (e: LearnDoneEvent) => void
  failed?: (e: LearnFailedEvent) => void
}): Promise<() => void> {
  const offs = await Promise.all([
    listen<LearnPlanEvent>('learn:plan', (e) => h.plan?.(e.payload)),
    listen<LearnSummaryEvent>('learn:summary', (e) => h.summary?.(e.payload)),
    listen<LearnFactEvent>('learn:fact', (e) => h.fact?.(e.payload)),
    listen<LearnPersonEvent>('learn:person', (e) => h.person?.(e.payload)),
    listen<LearnDoneEvent>('learn:done', (e) => h.done?.(e.payload)),
    listen<LearnFailedEvent>('learn:failed', (e) => h.failed?.(e.payload)),
  ])
  return () => offs.forEach((off) => off())
}
/** One note in a space's knowledge folder. */
export interface KnownNote {
  name: string
  body: string
}
/** Everything known about a space: kept facts and setup answers, as its manager sees them. */
export const learnNotes = (nodeId: number) => invoke<KnownNote[]>('learn_notes', { nodeId })
/** Write a note into a space's knowledge folder. What Home's setup answers become. */
export const learnNoteSave = (nodeId: number, title: string, body: string) =>
  invoke<string>('learn_note_save', { nodeId, title, body })
/** Log in over IMAP and SMTP and report each separately. */
export const mailAccountTest = (id: number) => invoke<MailTestResult>('mail_account_test', { id })
/** Fetch new mail. `id` 0 syncs every account. Returns messages stored. */
export const mailSync = (id = 0) => invoke<number>('mail_sync', { id })
export const mailList = (query: MailQuery) => invoke<MailMessage[]>('mail_list', { query })
export const mailCounts = () => invoke<MailCounts>('mail_counts')
/** What has been fetched from one account, folder by folder. */
export interface MailBoxCount {
  mailbox: string
  count: number
  last_ts: number
}
export const mailAccountBoxes = (id: number) => invoke<MailBoxCount[]>('mail_account_boxes', { id })
/** Bodies and attachment metadata, only for the message you opened. */
export const mailBody = (id: number) => invoke<MailBody>('mail_body', { id })
export const mailMarkRead = (id: number, read: boolean) =>
  invoke<void>('mail_mark_read', { id, read })
export const mailSetFlag = (id: number, flagged: boolean) =>
  invoke<void>('mail_set_flag', { id, flagged })
export const mailArchive = (id: number) => invoke<void>('mail_archive', { id })
export const mailDelete = (id: number) => invoke<void>('mail_delete', { id })
/** Link a whole thread to a project node. */
export const mailLinkNode = (id: number, nodeId: number | null) =>
  invoke<void>('mail_link_node', { id, nodeId })
export const mailSend = (req: SendRequest) => invoke<number>('mail_send', { req })

/** Contacts. With an account, only the people who appear in that mailbox. */
export const mailContactsList = (accountId: number | null = null) =>
  invoke<MailContact[]>('mail_contacts_list', { accountId })
/** Every message to or from one contact, newest first, across every account. */
export const mailContactMessages = (id: number, limit = 200) =>
  invoke<MailMessage[]>('mail_contact_messages', { id, limit })
export const mailContactSave = (def: MailContact) => invoke<number>('mail_contact_save', { def })
export const mailContactDelete = (id: number) => invoke<void>('mail_contact_delete', { id })
/** Link (or unlink) a contact to the client node they belong to. */
export const mailContactLink = (id: number, nodeId: number | null) =>
  invoke<void>('mail_contact_link', { id, nodeId })

export const mailAssistantList = (threadKey: string) =>
  invoke<AssistantNote[]>('mail_assistant_list', { threadKey })
export const mailAssistantAdd = (note: AssistantNote) =>
  invoke<number>('mail_assistant_add', { note })
export const mailAssistantStatus = (id: number, status: AssistantNote['status']) =>
  invoke<void>('mail_assistant_status', { id, status })

// ---------------------------------------------------------------------------
// A business
// ---------------------------------------------------------------------------

/** Someone who runs the business. Kept with the business, never in Your life. */
export interface Director {
  name: string
  email: string
  you: boolean
}

/** One thing the business might be, sell or be about, and where it came from. */
export interface Suggestion {
  id: string
  /** what | serves | industry | where | product | service */
  field: string
  text: string
  /** quote | suggestion | guess | you */
  kind: string
  source: string
  /** open | agreed | declined */
  state: string
  /** An agreed product or service's own folder, once made. */
  node_id: number
}

/** Somebody on the business's own team, as Learn found them and you kept them. */
export interface TeamMember {
  name: string
  email: string
  title: string
  summary: string
}
export interface BusinessMeta {
  team?: TeamMember[]
  name: string
  website: string
  directors: Director[]
  items: Suggestion[]
  /** plain | browser, empty until read */
  site_how: string
  site_read_at: string
  site_chars: number
  site_pages: string[]
  /** business | sells | code | mail | learn | team | done */
  step: string
  made: boolean
}

export interface FolderRef {
  node_id: number
  name: string
}

export interface SiteSummary {
  how: string
  chars: number
  pages: string[]
  title: string
  excerpt: string
  /** Almost nothing came back from a plain read: a site drawn by script. */
  thin: boolean
}

export interface BusinessView {
  node_id: number
  meta: BusinessMeta
  folders: FolderRef[]
  site: SiteSummary
}

export interface BusinessSummary {
  node_id: number
  name: string
  website: string
  /** Went through the business steps. An old workspace tagged Business is listed too. */
  set_up: boolean
  step: string
  made: boolean
  products: number
  services: number
  mailboxes: number
  directors: number
}

export const businessList = () => invoke<BusinessSummary[]>('business_list')
export const businessGet = (nodeId: number) => invoke<BusinessView>('business_get', { nodeId })
/** Make the space, its folders and its record. Clean: nothing copied from anywhere. */
export const businessCreate = (name: string, website: string) =>
  invoke<BusinessView>('business_create', { name, website })
export const businessSave = (nodeId: number, meta: BusinessMeta) =>
  invoke<BusinessView>('business_save', { nodeId, meta })
/** Read the website and suggest what the business is. `browser` reads the pages as drawn. */
export const businessReadSite = (nodeId: number, browser = false) =>
  invoke<BusinessView>('business_read_site', { nodeId, browser })
/** Give every agreed product and service its own folder. */
export const businessCommitItems = (nodeId: number) =>
  invoke<BusinessView>('business_commit_items', { nodeId })

// ---- a business's code ------------------------------------------------------

export interface Repo {
  full_name: string
  name: string
  owner: string
  description: string
  private: boolean
  updated_at: string
  language: string
  clone_url: string
  html_url: string
}
export interface RepoList {
  /** github | example */
  source: string
  login: string
  signed_in: boolean
  repos: Repo[]
  note: string
}
export interface Linked {
  node_id: number
  name: string
  path: string
  /** Already on this machine: used where it was, not cloned. */
  reused: boolean
  commands: number
  services: number
}
export const businessRepos = () => invoke<RepoList>('business_repos')
export const businessCloneFolder = (nodeId: number) => invoke<string>('business_clone_folder', { nodeId })
/** Link a repository to a product (or Marketing) as a project, cloning it if it is not here. */
export const businessLinkRepo = (req: { business: number; parent: number; repo: Repo; clone_into: string }) =>
  invoke<Linked>('business_link_repo', { req })

// ---- clearing old workspaces --------------------------------------------------

export interface ClearProject {
  node_id: number
  name: string
  repo: string
}
export interface ClearSpace {
  node_id: number
  name: string
  label: string
  suggested: boolean
  folders: number
  projects: ClearProject[]
  managers: string[]
  services: number
  commands: number
  reminders: number
  vault_dir: string
  blocked: string
}
export interface ClearPreview {
  spaces: ClearSpace[]
}
export const businessClearPreview = () => invoke<ClearPreview>('business_clear_preview')
/** Clears the spaces named. Only ever called from the red button. */
export const businessClear = (nodeIds: number[]) =>
  invoke<string[]>('business_clear', { nodeIds, confirm: 'clear' })

// ---- a business's team ----------------------------------------------------------

export interface RoleOffer {
  id: string
  name: string
  job: string
  every: string
  at_min: number
  days: string
  team: string[]
  stop_at: string[]
  rhythm: string
  covers: string[]
  on: boolean
  why: string
  /** Already made for this business: its handle. */
  made: string
}
export interface ManagerOffer {
  handle: string
  name: string
  role: string
  works_for: string[]
  rhythm: string
}
export interface TeamOffer {
  roles: RoleOffer[]
  others: ManagerOffer[]
  members: string[]
  directors: string[]
}
export interface TeamMade {
  made: string[]
  joined: string[]
  problems: string[]
}
export const businessTeam = (nodeId: number) => invoke<TeamOffer>('business_team', { nodeId })
export const businessMakeTeam = (nodeId: number, roles: string[], reuse: string[]) =>
  invoke<TeamMade>('business_make_team', { nodeId, roles, reuse })

/** One manager on a business's team, for the space's Team tab. */
export interface MemberView {
  handle: string
  name: string
  role: string
  goal: string
  rhythm: string
  last_woke: number | null
  open_items: number
  also_for: string[]
}
export interface KindCount {
  folder: string
  count: number
}
export interface SpaceView {
  members: MemberView[]
  /** Roles nobody is on: the directors keep doing them. */
  keeps: string[]
  organisations: KindCount[]
}
export const businessSpace = (nodeId: number) => invoke<SpaceView>('business_space', { nodeId })

// ---------------------------------------------------------------------------
// The library, the workers, and their runs
// ---------------------------------------------------------------------------

/** One skill or brief you installed, and where it came from. */
export interface LibraryItem {
  id: string
  /** skill | brief */
  kind: string
  name: string
  what: string
  repo: string
  commit: string
  licence: string
  path: string
  added_at: string
  chars: number
}
/** Something a repository holds that the library could hold. */
export interface LibraryCandidate {
  id: string
  kind: string
  name: string
  what: string
  path: string
  have: boolean
}
/** What one look at a repository found. */
export interface LibrarySource {
  repo: string
  commit: string
  licence: string
  branch: string
  items: LibraryCandidate[]
  /** The folders it keeps them in. Taking one is one decision. */
  kits: LibraryKit[]
  /** Said out loud when the list is not the whole truth. */
  note: string
}
/** A folder of a repository, offered whole. */
export interface LibraryKit {
  folder: string
  kind: string
  picks: LibraryCandidate[]
  /** How many of those are already yours, at this commit. */
  have: number
}
/** A kit as it sits in your library. */
export interface LibraryKitRef {
  /** `owner/name:folder` — what a worker stores. */
  id: string
  repo: string
  folder: string
  kind: string
  count: number
}
/** What one install did, including what it could not do. */
export interface LibraryAdded {
  items: LibraryItem[]
  /** The ones that did not come in, each with its reason. */
  missed: string[]
}
export const libraryList = () => invoke<LibraryItem[]>('library_list')
export const libraryRead = (id: string, kind: string) => invoke<string>('library_read', { id, kind })
/** Read a public GitHub repository: its licence, its commit, and what it holds. */
export const libraryLook = (repo: string) => invoke<LibrarySource>('library_look', { repo })
export const libraryInstall = (source: LibrarySource, ids: string[]) =>
  invoke<LibraryAdded>('library_install', { source, ids })
/** Take one folder of a repository whole. */
export const libraryInstallKit = (source: LibrarySource, folder: string) =>
  invoke<LibraryAdded>('library_install_kit', { source, folder })
/** The kits already in your library, biggest first. */
export const libraryKits = () => invoke<LibraryKitRef[]>('library_kits')
export const libraryRemove = (id: string, kind: string) => invoke<void>('library_remove', { id, kind })

/** A worker: yours, lent to any space, with the skills you gave it. */
export interface Worker {
  handle: string
  name: string
  what: string
  /** A library brief id, or empty. */
  brief: string
  skills: string[]
  /** A kit it carries, as `owner/name:folder`, or empty. */
  kit: string
  runner: string
  model: string
  /** folder | branch */
  writes: string
  minutes: number
  usd: number
  /** Spaces it may work in. Empty means any. */
  spaces: number[]
  unattended: boolean
  created_at: string
  /** Anything you want said to it every time. */
  body: string
}
/** What starting a worker would mean, before it means it. */
export interface RunPlan {
  worker: Omit<Worker, 'body'>
  node_id: number
  space: string
  title: string
  intent: string
  folder: string
  branch: string
  is_repo: boolean
  skills: LibraryItem[]
  brief: LibraryItem | null
  /** The bench it carries, if it carries one. */
  kit: LibraryItem[]
  kit_id: string
  reads: string[]
  never: string[]
  minutes: number
  usd: number
  model: string
  ready: boolean
  note: string
}
export interface RunStep {
  at: string
  /** message | tool | stderr | note */
  kind: string
  text: string
}
export interface RunFile {
  path: string
  bytes: number
}
/** The receipt for one job. */
export interface Run {
  id: string
  worker: string
  worker_name: string
  node_id: number
  space: string
  title: string
  intent: string
  /** running | done | stopped | failed | kept | discarded */
  status: string
  started_at: string
  ended_at: string
  folder: string
  branch: string
  skills: string[]
  minutes_limit: number
  usd_limit: number
  usd: number
  seconds: number
  files: RunFile[]
  steps: RunStep[]
  verdict: string
  ok: boolean
  decision: string
}
export const workersList = () => invoke<Worker[]>('workers_list')
export const workerSave = (worker: Worker) => invoke<Worker>('worker_save', { worker })
export const workerDelete = (handle: string) => invoke<void>('worker_delete', { handle })
/** Workers worth having, minus the ones you already made. */
export const workerStarters = () => invoke<Worker[]>('worker_starters')
/** What it would do, where, and under what limits. Nothing starts. */
export const workerPlan = (handle: string, nodeId: number, title: string, intent: string) =>
  invoke<RunPlan>('worker_plan', { handle, nodeId, title, intent })
/** The one yes. Starts a session and returns its receipt straight away. */
export const workerStart = (handle: string, nodeId: number, title: string, intent: string) =>
  invoke<Run>('worker_start', { handle, nodeId, title, intent })
export const workerStop = (id: string) => invoke<void>('worker_stop', { id })
export const runsList = (nodeId = 0) => invoke<Run[]>('runs_list', { nodeId })
export const runGet = (id: string) => invoke<Run | null>('run_get', { id })
/** keep | discard, with whatever you want said about it. */
export const runDecide = (id: string, decision: string, note = '') =>
  invoke<Run>('run_decide', { id, decision, note })

/** A run as it happens: every step, then its receipt. */
export async function onWorker(h: {
  step?: (e: { run: string; step: RunStep }) => void
  done?: (e: { run: Run }) => void
}): Promise<() => void> {
  const offs = await Promise.all([
    listen<{ run: string; step: RunStep }>('worker:step', (e) => h.step?.(e.payload)),
    listen<{ run: Run }>('worker:done', (e) => h.done?.(e.payload)),
  ])
  return () => offs.forEach((off) => off())
}

/** What a worker did lately that names a product. */
export interface RunBrief {
  id: string
  title: string
  worker: string
  status: string
  when: string
}
/** One row of the idea-to-product board: the claim, and the evidence for it. */
export interface PipeItem {
  product: string
  /** idea | validating | building | launched */
  stage: string
  /** What has to be true to move on. */
  next: string
  updated: string
  projects: string[]
  work_open: number
  work_done: number
  runs: RunBrief[]
  notes: string[]
}
export const businessPipeline = (nodeId: number) => invoke<PipeItem[]>('business_pipeline', { nodeId })
/** Move a product, and say what has to be true to move it again. Yours to say. */
export const businessStageSet = (nodeId: number, product: string, stage: string, next: string) =>
  invoke<PipeItem[]>('business_stage_set', { nodeId, product, stage, next })

/** Say which worker a manager hands its jobs to. Empty takes it back. */
export const botSetWorker = (handle: string, worker: string) =>
  invoke<void>('bot_set_worker', { handle, worker })
