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
}) =>
  invoke<number>('schedule_save', {
    ...s,
    id: s.id ?? null,
    atMs: s.atMs ?? null,
    durationMin: s.durationMin ?? null,
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
}

export const botsList = () => invoke<Bot[]>('bots_list')

/** Where one bot's plan stands. Counts only — what a number means (amber, red,
 *  quiet) is the interface's decision, not the backend's. */
export interface BotStanding {
  node_id: number
  done: number
  total: number
  blocked: number
  unclaimed: number
  feature: string
}

export const botsStanding = () => invoke<BotStanding[]>('bots_standing')
export const botGet = (nodeId: number) => invoke<Bot | null>('bot_get', { nodeId })
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
export const botDelete = (nodeId: number) => invoke<void>('bot_delete', { nodeId })

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

export const botThread = (nodeId: number) =>
  invoke<import('./aiw').ConversationMeta>('bot_thread', { nodeId })
export const botThreadSend = (nodeId: number, text: string) =>
  invoke<import('./aiw').AssistantReply>('bot_thread_send', { nodeId, text })

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

export const botWork = (nodeId: number) => invoke<BotWork[]>('bot_work', { nodeId })
export const botPlan = (nodeId: number, steps: string[]) =>
  invoke<string>('bot_plan', { nodeId, steps })
export const botWorkSave = (w: {
  nodeId: number
  id: string
  title: string
  status: string
  assignee: string | null
}) => invoke<void>('bot_work_save', w)
export const botWorkDelete = (nodeId: number, id: string) =>
  invoke<void>('bot_work_delete', { nodeId, id })

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
