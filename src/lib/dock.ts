// Dock controller: holds the DockviewApi singleton so any part of the
// app (toolbar, profiles, commands) can open/focus panels and
// save/restore layouts.

import type { DockviewApi } from 'dockview-react'
import * as ipc from './ipc'
import { useApp } from '../store'

let api: DockviewApi | null = null

export function setDockApi(a: DockviewApi) {
  api = a
}

export function dockApi(): DockviewApi | null {
  return api
}

export function openSingleton(id: string, component: string, title: string) {
  if (!api) return
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  api.addPanel({ id, component, title })
}

// The anchor that identifies the main center group. Prefer the stable
// panels that only ever live in the center (welcome, settings, editors)
// over terminals — a terminal from a stale layout could itself be
// misplaced, and anchoring to it would perpetuate the problem.
function mainAnchorId(): string | undefined {
  if (!api) return undefined
  if (api.getPanel('welcome')) return 'welcome'
  const space = api.panels.find((p) => p.id.startsWith('space-') || p.id.startsWith('node-setup-'))
  if (space) return space.id
  const terminal = api.panels.find((p) => p.id.startsWith('terminal-'))
  return terminal?.id
}

/// Add a panel into the main center group, wherever that group currently
/// is. Anchors to an existing main-area panel; if none exist (the whole
/// center area was closed), rebuilds the center group to the right of the
/// Explorer so it never lands inside a side dock.
function addToMain(opts: {
  id: string
  component: string
  title: string
  params?: Record<string, unknown>
  tabComponent?: string
}) {
  if (!api) return
  const anchorId = mainAnchorId()
  if (anchorId) {
    api.addPanel({ ...opts, position: { referencePanel: anchorId, direction: 'within' } })
    return
  }
  api.addPanel(opts)
}

/// Open (or focus) a panel as a tab in the main center area, next to the
/// Welcome/terminal panels rather than in a side dock.
export function openInMain(id: string, component: string, title: string) {
  if (!api) return
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component, title })
}

export type EditorKind = 'command' | 'service' | 'profile'

/// Open the editor for one item in the slide-over sheet (id === 0 means
/// create-new). Editors no longer occupy main-area tabs — the sheet keeps
/// the current view visible behind it. `_title` is unused but kept so the
/// many call sites stay unchanged.
export function openEditor(kind: EditorKind, id: number, _title?: string, projectId?: number | null) {
  useApp.getState().openSheet({ kind, id, projectId: projectId ?? null })
}

/// Open (or focus) the Assistant's own conversation as a document.
export function openAssistant() {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = 'assistant-thread'
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'assistant-thread', title: 'Assistant' })
  api.getPanel(id)?.api.setActive()
}

/// Open (or focus) a node's thread — the first thing a click on the tree
/// does now. Every level has one, which is the whole model: you talk to a
/// workspace, a folder or a project, and what differs is what it can say.
export function openNodeThread(nodeId: number, title: string) {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = `node-thread-${nodeId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'node-thread', title, params: { id: nodeId } })
  api.getPanel(id)?.api.setActive()
}

/// Open (or focus) the personalized detail page for a space (project) as
/// a main-area tab.
export function openSpace(projectId: number, title: string) {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = `space-${projectId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'space-detail', title, params: { id: projectId } })
  api.getPanel(id)?.api.setActive()
}

/// Open (or focus) the service page — live status, config, run history and
/// log tail for one service — as a document tab.
/// Open (or focus) a bot as a document tab. A bot is a file in a folder, and
/// everything a folder offers opens as a document here — the Bots page is the
/// index, this is the thing.
export function openBot(nodeId: number, title: string, ask = false) {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = `bot-${nodeId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  // `ask` opens the interview straight away, and only ever on a bot that was
  // just made — a page that re-asks every time you visit is a page you close.
  addToMain({ id, component: 'bot-detail', title, params: { id: nodeId, ask } })
  api.getPanel(id)?.api.setActive()
}

export function openService(serviceId: number, title: string) {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = `service-${serviceId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'service-detail', title, params: { id: serviceId } })
  api.getPanel(id)?.api.setActive()
}

/// Open (or focus) the setup page for a project or folder as a main tab.
/// The page for a node the app has no dedicated page for — a Topic, an Area,
/// a Client. Projects have the dashboard; this is everything else.
export function openNodeConfig(nodeId: number, title: string) {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = `node-config-${nodeId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'node-config', title, params: { id: nodeId } })
}

export function openNodeSetup(nodeId: number, title: string) {
  if (!api) return
  useApp.getState().setRailView('projects')
  const id = `node-setup-${nodeId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  // "· settings" keeps this tab distinguishable from the project's dashboard
  // tab, which carries the bare project name.
  addToMain({ id, component: 'node-setup', title: `${title} · settings`, params: { id: nodeId } })
}

/// One of a project's AI views, as a document.
///
/// Keyed by project as well as kind, so `tyrex`'s Git and `assetx`'s Assistant
/// are two tabs rather than one that keeps changing what it points at — which
/// is the thing the old section row could not do.
export type AiwDoc = 'assistant' | 'context' | 'git' | 'features'

const AIW_TITLES: Record<AiwDoc, string> = {
  assistant: 'Assistant',
  context: 'Context',
  git: 'Git',
  features: 'Features',
}

export function openAiwDoc(kind: AiwDoc, projectId: string, projectName: string) {
  const api = dockApi()
  if (!api) return
  const id = `aiw-${kind}-${projectId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  api.addPanel({
    id,
    component: `aiw-${kind}`,
    // The project is in the title because a tab row spanning projects is
    // unreadable without it.
    title: `${AIW_TITLES[kind]} · ${projectName}`,
    params: { projectId },
  })
}

export function openTerminalPanel(ptyId: number, title: string) {
  if (!api) return
  const id = `terminal-${ptyId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'terminal', title, params: { ptyId }, tabComponent: 'terminalTab' })
  api.getPanel(id)?.api.setActive()
}

export function closeTerminalPanel(ptyId: number) {
  if (!api) return
  const panel = api.getPanel(`terminal-${ptyId}`)
  if (panel) api.removePanel(panel)
}

export async function saveLayout(name: string) {
  if (!api) return
  await ipc.layoutSave(name, JSON.stringify(api.toJSON()))
}

export function restoreLayout(data: string): boolean {
  if (!api) return false
  try {
    api.fromJSON(JSON.parse(data))
    return true
  } catch {
    return false
  }
}
