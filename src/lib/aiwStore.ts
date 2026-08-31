// Assistant UI state.
//
// Kept in its own store rather than bolted onto the main one: nothing here is
// needed by the rest of the app, and the Assistant is the only part that
// re-renders on every event from the bus.
//
// The rule this store follows: it holds *what the backend said*, never a
// derived copy that could drift. A failed load is recorded as an error, not as
// an empty list — an empty conflict list and a broken conflict query must never
// look the same on screen.

import { create } from 'zustand'
import {
  CAPTURE_AUTORUN,
  CAPTURE_FEATURE,
  CAPTURE_PAGE,
  CAPTURE_PROJECT,
} from './devCapture'
import {
  aiw,
  type Grant,
  type AgentDef,
  type AssistantReply,
  type ChatEvent,
  type ChatMessage,
  type ConversationMeta,
  type ConversationSummary,
  type ApprovalDecision,
  type ApprovalRequest,
  type AiProject,
  type AssembledContext,
  type Conflict,
  type DecisionRow,
  type DomainEvent,
  type FeatureRow,
  type GitCommit,
  type PermissionRow,
  type Session,
  type TestRun,
  type ToolInfo,
  type WorkClaim,
  type WorkItem,
} from './aiw'

export type AiwPage =
  | 'chat'
  | 'overview' | 'features' | 'feature' | 'context' | 'agents'
  | 'conflicts' | 'activity' | 'decisions' | 'git'
  | 'knowledge' | 'tests' | 'skills' | 'settings'

interface AiwState {
  ready: boolean
  loading: boolean
  /** Non-null when the last load failed. Rendered explicitly, never as empty. */
  error: string | null

  page: AiwPage
  projectId: string | null
  featureId: string | null

  projects: AiProject[]
  features: FeatureRow[]
  workItems: WorkItem[]
  agents: AgentDef[]
  sessions: Session[]
  claims: WorkClaim[]
  conflicts: Conflict[]
  /// Tool calls blocked on a human right now. Global, not per-project:
  /// an agent stuck waiting is urgent whichever project it belongs to.
  approvals: ApprovalRequest[]
  /// The assistant. `conversation` is the open one; `null` until one is picked
  /// or created.
  conversations: ConversationSummary[]
  conversation: ConversationMeta | null
  sending: boolean
  /// The assistant's own failures.
  ///
  /// Separate from `error` on purpose: that one gates the whole module behind a
  /// "could not load the workspace" screen, which is right for a failed
  /// bootstrap and badly wrong for a failed `send` — one unreachable provider
  /// should not take down Features, Conflicts and Git, or claim the workspace
  /// could not be read when it was read fine.
  chatError: string | null
  /// The reply currently arriving, token by token. Rendered as the assistant's
  /// message until the turn ends, at which point the transcript re-read
  /// replaces it — so this is a preview, never the record.
  streaming: string
  /// Tool steps that have already run this turn, shown before the reply lands.
  streamingSteps: ChatMessage[]
  decisions: DecisionRow[]
  events: DomainEvent[]
  commits: GitCommit[]
  tools: ToolInfo[]
  permissions: PermissionRow[]
  /** Standing grants — what you have already said yes to in advance.
   *
   *  `null` until the first read comes back. "Nothing is pre-authorised" is a
   *  claim about your machine, and a list that has not loaded yet has not
   *  earned it — an empty array and an unread one must not look the same. */
  grants: Grant[] | null
  testRuns: TestRun[]
  context: AssembledContext | null

  demoRunning: boolean

  setPage: (p: AiwPage) => void
  selectProject: (id: string) => Promise<void>
  selectFeature: (id: string | null) => Promise<void>
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  reloadAgents: () => Promise<void>
  refreshApprovals: () => Promise<void>
  pushChat: (e: ChatEvent) => void
  loadConversations: () => Promise<void>
  openConversation: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  focusConversation: (projectId?: string) => Promise<void>
  send: (text: string) => Promise<void>
  resolveApproval: (id: string, decision: ApprovalDecision) => Promise<void>
  refreshContext: () => Promise<void>
  runDemo: () => Promise<void>
  startAgent: (agentId: string, opts?: { workItemId?: string; intent?: string; areas?: string[]; dependsOn?: string[] }) => Promise<void>
  resolveConflict: (id: string) => Promise<void>
  setPermission: (agentId: string, tool: string, permission: string) => Promise<void>
  refreshGrants: () => Promise<void>
  revokeGrant: (id: string) => Promise<void>
  revokeAllGrants: () => Promise<void>
  forgetGrant: (id: string) => Promise<void>
  pushEvent: (e: DomainEvent) => void
}

const say = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useAiw = create<AiwState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,

  // The assistant is the surface you use; the rest are surfaces you watch.
  page: (CAPTURE_PAGE || 'chat') as AiwPage,
  projectId: null,
  featureId: null,

  projects: [],
  features: [],
  workItems: [],
  agents: [],
  sessions: [],
  claims: [],
  conflicts: [],
  approvals: [],
  conversations: [],
  conversation: null,
  sending: false,
  chatError: null,
  streaming: '',
  streamingSteps: [],
  decisions: [],
  events: [],
  commits: [],
  tools: [],
  permissions: [],
  grants: null,
  testRuns: [],
  context: null,

  demoRunning: false,

  setPage: (page) => set({ page }),

  bootstrap: async () => {
    // React runs effects twice in dev (StrictMode). Without this guard the
    // demo runs twice, and the second run wipes the fixture directory out from
    // under the first run's state — which shows up as a project list with no
    // features in it.
    if (get().loading || get().ready) return
    set({ loading: true, error: null })
    try {
      const [projects, agents, tools, permissions] = await Promise.all([
        aiw.projects(),
        aiw.agents(),
        aiw.tools(),
        aiw.permissions(),
      ])
      set({ projects, agents, tools, permissions, ready: true, loading: false })
      // An app that starts up with an agent already blocked has to show it,
      // rather than waiting for an event that has already been emitted.
      void get().refreshApprovals()
      void get().loadConversations()
      // Screenshot harness: always rebuild, so each capture is self-contained.
      // Guarding on an empty project list stopped working once the registered
      // list became durable, which is exactly the behaviour we wanted.
      if (CAPTURE_AUTORUN) {
        await get().runDemo()
      }
      const all = get().projects.length ? get().projects : projects
      const wanted = CAPTURE_PROJECT || all[0]?.id || null
      if (wanted) await get().selectProject(wanted)
      if (CAPTURE_FEATURE) await get().selectFeature(CAPTURE_FEATURE)
    } catch (e) {
      // Honest failure: the screens render this instead of an empty state that
      // would read as "you have no projects".
      set({ error: say(e), loading: false, ready: true })
    }
  },

  selectProject: async (id) => {
    set({ projectId: id, featureId: null, context: null })
    await get().refresh()
  },

  selectFeature: async (id) => {
    set({ featureId: id })
    const { projectId } = get()
    if (!projectId || !id) {
      set({ context: null, workItems: [] })
      return
    }
    try {
      const [workItems, decisions] = await Promise.all([
        aiw.workItems(projectId, id),
        aiw.decisions(projectId, id),
      ])
      set({ workItems, decisions })
      await get().refreshContext()
    } catch (e) {
      set({ error: say(e) })
    }
  },

  // Agents and the permission matrix are workspace-wide, so `refresh` — which
  // is per-project and does nothing at all without one selected — never
  // reloaded them. Saving an agent's model then left the old value on screen
  // with the Apply button still lit, which is indistinguishable from a save
  // that failed.
  reloadAgents: async () => {
    try {
      const [agents, permissions] = await Promise.all([aiw.agents(), aiw.permissions()])
      set({ agents, permissions })
    } catch (e) {
      set({ error: say(e) })
    }
  },

  refresh: async () => {
    const { projectId } = get()
    if (!projectId) return
    set({ loading: true })
    try {
      const [features, sessions, claims, conflicts, events, commits, testRuns, decisions, projects] =
        await Promise.all([
          aiw.features(projectId),
          aiw.sessions(projectId),
          aiw.claims(projectId, true),
          aiw.conflicts(projectId, true),
          aiw.activity(projectId, 300),
          aiw.gitHistory(projectId, 25),
          aiw.testRuns(projectId),
          aiw.decisions(projectId),
          aiw.projects(),
        ])
      set({
        features, sessions, claims, conflicts, events, commits, testRuns,
        decisions, projects, loading: false, error: null,
      })
      void get().refreshApprovals()
    } catch (e) {
      set({ error: say(e), loading: false })
    }
  },

  refreshApprovals: async () => {
    try {
      set({ approvals: await aiw.pendingApprovals() })
    } catch {
      // A queue we cannot read is not an empty queue. Leaving the last known
      // list up is better than showing "nothing to approve" while an agent is
      // actually sitting there blocked.
    }
  },

  resolveApproval: async (id, decision) => {
    try {
      await aiw.resolveApproval(id, decision)
    } catch (e) {
      // Usually "no longer waiting" — it timed out while the prompt was open.
      set({ error: say(e) })
    }
    await get().refreshApprovals()
    // `always` moves a permission, so the matrix on screen is now stale.
    if (decision.endsWith('always')) {
      try {
        set({ permissions: await aiw.permissions(), grants: await aiw.grants() })
      } catch {
        /* the matrix reloads on the next refresh */
      }
    }
  },

  // -- the assistant ------------------------------------------------------

  pushChat: (e) => {
    // Progress for a conversation you have since navigated away from is not
    // wrong, it is just not yours — dropping it beats splicing another
    // conversation's tokens into the open one.
    if (e.conversation_id !== get().conversation?.id) return
    if (e.kind === 'delta') set({ streaming: get().streaming + e.text })
    else if (e.kind === 'step') set({ streamingSteps: [...get().streamingSteps, e.message] })
    else set({ streaming: '', streamingSteps: [] })
  },

  loadConversations: async () => {
    try {
      set({ conversations: await aiw.conversations(), chatError: null })
    } catch (e) {
      set({ chatError: say(e) })
    }
  },

  openConversation: async (id) => {
    try {
      set({
        conversation: await aiw.conversation(id),
        chatError: null,
        streaming: '',
        streamingSteps: [],
      })
    } catch (e) {
      set({ chatError: say(e) })
    }
  },

  newConversation: async () => {
    try {
      // Starts focused on the project you are already looking at. Being asked
      // "which project?" straight after clicking New is a question the app can
      // usually answer itself.
      const conv = await aiw.newConversation(get().projectId ?? undefined)
      set({ conversation: conv, chatError: null })
      await get().loadConversations()
    } catch (e) {
      set({ chatError: say(e) })
    }
  },

  deleteConversation: async (id) => {
    try {
      await aiw.deleteConversation(id)
      if (get().conversation?.id === id) set({ conversation: null })
      await get().loadConversations()
    } catch (e) {
      set({ chatError: say(e) })
    }
  },

  focusConversation: async (projectId) => {
    const conv = get().conversation
    if (!conv) return
    try {
      set({ conversation: await aiw.focusConversation(conv.id, projectId) })
    } catch (e) {
      set({ chatError: say(e) })
    }
  },

  send: async (text) => {
    const conv = get().conversation
    if (!conv || !text.trim() || get().sending) return

    // Show what was said before the round-trip. The reply can take a while —
    // several provider turns, possibly an approval prompt — and a message that
    // vanishes until then reads as a dropped one.
    const pending: ChatMessage = { at: new Date().toISOString(), from: 'user', text: text.trim() }
    set({
      sending: true,
      streaming: '',
      streamingSteps: [],
      conversation: { ...conv, messages: [...conv.messages, pending] },
    })

    try {
      const reply: AssistantReply = await aiw.sendMessage(conv.id, text.trim())
      // Re-read rather than splicing the optimistic message: the backend
      // decided the timestamps, the tool steps and the title, and a transcript
      // assembled from two sources drifts.
      const fresh = await aiw.conversation(conv.id)
      // The preview is dropped the moment the record arrives; keeping both
      // would show every reply twice.
      set({
        conversation: fresh,
        sending: false,
        chatError: null,
        streaming: '',
        streamingSteps: [],
      })
      await get().loadConversations()
      // Delegation started real sessions; the rest of the workspace is now stale.
      if (reply.delegated.length > 0) void get().refresh()
    } catch (e) {
      // Put the failure in the transcript rather than only in a banner — you
      // need to see which message did not get through.
      const failed: ChatMessage = {
        at: new Date().toISOString(),
        from: 'tool',
        text: say(e),
        tool: 'assistant',
        ok: false,
      }
      const current = get().conversation
      set({
        sending: false,
        streaming: '',
        streamingSteps: [],
        chatError: say(e),
        conversation: current ? { ...current, messages: [...current.messages, failed] } : current,
      })
    }
  },

  refreshContext: async () => {
    const { projectId, featureId } = get()
    if (!projectId || !featureId) return
    try {
      set({ context: await aiw.context(projectId, featureId) })
    } catch (e) {
      set({ error: say(e), context: null })
    }
  },

  runDemo: async () => {
    if (get().demoRunning) return
    set({ demoRunning: true, error: null })
    try {
      await aiw.runDemo()
      const projects = await aiw.projects()
      set({ projects, demoRunning: false })
      const tyrex = projects.find((p) => p.id === 'tyrex') ?? projects[0]
      if (tyrex) {
        await get().selectProject(tyrex.id)
        const f = get().features.find((x) => x.id === 'offline-synchronisation')
        if (f) await get().selectFeature(f.id)
      }
    } catch (e) {
      set({ error: say(e), demoRunning: false })
    }
  },

  startAgent: async (agentId, opts) => {
    const { projectId, featureId } = get()
    if (!projectId || !featureId) return
    try {
      await aiw.startAgent({
        projectId,
        featureId,
        agentId,
        workItemId: opts?.workItemId,
        intent: opts?.intent,
        areas: opts?.areas,
        dependsOn: opts?.dependsOn,
      })
      await get().refresh()
      await get().refreshContext()
      if (featureId) {
        set({ workItems: await aiw.workItems(projectId, featureId) })
      }
    } catch (e) {
      set({ error: say(e) })
    }
  },

  resolveConflict: async (id) => {
    try {
      await aiw.resolveConflict(id, 'you', 'resolved from the Conflict Center')
      await get().refresh()
    } catch (e) {
      set({ error: say(e) })
    }
  },

  setPermission: async (agentId, tool, permission) => {
    try {
      await aiw.setPermission(agentId, tool, permission)
      // Grants too: denying a tool withdraws the standing grants on it, and the
      // screen has to show that rather than a list that is quietly inert.
      set({
        permissions: await aiw.permissions(),
        agents: await aiw.agents(),
        grants: await aiw.grants(),
      })
    } catch (e) {
      set({ error: say(e) })
    }
  },

  refreshGrants: async () => {
    try {
      set({ grants: await aiw.grants() })
    } catch (e) {
      set({ error: say(e) })
    }
  },
  revokeGrant: async (id) => {
    try {
      await aiw.grantRevoke(id)
      set({ grants: await aiw.grants() })
    } catch (e) {
      set({ error: say(e) })
    }
  },
  revokeAllGrants: async () => {
    try {
      await aiw.grantRevokeAll()
      set({ grants: await aiw.grants() })
    } catch (e) {
      set({ error: say(e) })
    }
  },
  forgetGrant: async (id) => {
    try {
      await aiw.grantForget(id)
      set({ grants: await aiw.grants() })
    } catch (e) {
      set({ error: say(e) })
    }
  },

  // Live tail. Capped so a long-running demo can't grow the array without
  // bound; the full history is always a `refresh()` away.
  pushEvent: (e) => {
    // Approvals are read back from the backend rather than reconstructed from
    // the event, and before the project filter: the queue is global, and the
    // backend is the only thing that knows what is still waiting.
    if (e.type === 'tool.approval.requested' || e.type === 'tool.approval.resolved') {
      void get().refreshApprovals()
    }
    const { projectId, events } = get()
    if (projectId && e.project_id && e.project_id !== projectId) return
    // The same event can arrive twice: once live from the bus and once in the
    // history that refresh() fetches. Without this the feed renders duplicate
    // React keys and silently drops rows.
    if (events.some((x) => x.id === e.id)) return
    set({ events: [e, ...events].slice(0, 500) })
  },
}))
