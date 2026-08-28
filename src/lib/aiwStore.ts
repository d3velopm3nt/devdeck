// AI Workspace UI state.
//
// Kept in its own store rather than bolted onto the main one: nothing here is
// needed by the rest of the app, and the AI Workspace is the only part that
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
  type AgentDef,
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
  | 'overview' | 'features' | 'feature' | 'context' | 'agents'
  | 'conflicts' | 'activity' | 'decisions' | 'git' | 'tools'
  | 'knowledge' | 'tests' | 'providers'

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
  decisions: DecisionRow[]
  events: DomainEvent[]
  commits: GitCommit[]
  tools: ToolInfo[]
  permissions: PermissionRow[]
  testRuns: TestRun[]
  context: AssembledContext | null

  demoRunning: boolean

  setPage: (p: AiwPage) => void
  selectProject: (id: string) => Promise<void>
  selectFeature: (id: string | null) => Promise<void>
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  refreshContext: () => Promise<void>
  runDemo: () => Promise<void>
  startAgent: (agentId: string, opts?: { workItemId?: string; intent?: string; areas?: string[]; dependsOn?: string[] }) => Promise<void>
  resolveConflict: (id: string) => Promise<void>
  setPermission: (agentId: string, tool: string, permission: string) => Promise<void>
  pushEvent: (e: DomainEvent) => void
}

const say = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useAiw = create<AiwState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,

  page: (CAPTURE_PAGE || 'overview') as AiwPage,
  projectId: null,
  featureId: null,

  projects: [],
  features: [],
  workItems: [],
  agents: [],
  sessions: [],
  claims: [],
  conflicts: [],
  decisions: [],
  events: [],
  commits: [],
  tools: [],
  permissions: [],
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
    } catch (e) {
      set({ error: say(e), loading: false })
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
      set({ permissions: await aiw.permissions(), agents: await aiw.agents() })
    } catch (e) {
      set({ error: say(e) })
    }
  },

  // Live tail. Capped so a long-running demo can't grow the array without
  // bound; the full history is always a `refresh()` away.
  pushEvent: (e) => {
    const { projectId, events } = get()
    if (projectId && e.project_id && e.project_id !== projectId) return
    // The same event can arrive twice: once live from the bus and once in the
    // history that refresh() fetches. Without this the feed renders duplicate
    // React keys and silently drops rows.
    if (events.some((x) => x.id === e.id)) return
    set({ events: [e, ...events].slice(0, 500) })
  },
}))
