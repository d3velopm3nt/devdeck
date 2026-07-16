// Dock controller: holds the DockviewApi singleton so any part of the
// app (toolbar, profiles, commands) can open/focus panels and
// save/restore layouts.

import type { DockviewApi } from 'dockview-react'
import * as ipc from './ipc'

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
  if (api.getPanel('config')) return 'config'
  const editor = api.panels.find((p) => /-editor-(?:\d+|new)$/.test(p.id))
  if (editor) return editor.id
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
  const explorer = api.getPanel('explorer')
  if (explorer) {
    api.addPanel({ ...opts, position: { referencePanel: 'explorer', direction: 'right' } })
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

/// Open (or focus) a dedicated editor page for one item as a main-area
/// tab. id === 0 means create-new. Re-opening the same item focuses its
/// existing tab instead of stacking duplicates.
export function openEditor(kind: EditorKind, id: number, title: string, projectId?: number | null) {
  if (!api) return
  const panelId = `${kind}-editor-${id > 0 ? id : 'new'}`
  const existing = api.getPanel(panelId)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({
    id: panelId,
    component: `${kind}-editor`,
    title,
    params: { id, projectId: projectId ?? null },
  })
}

/// Open (or focus) the personalized detail page for a space (project) as
/// a main-area tab.
export function openSpace(projectId: number, title: string) {
  if (!api) return
  const id = `space-${projectId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'space-detail', title, params: { id: projectId } })
  api.getPanel(id)?.api.setActive()
}

/// Open (or focus) the setup page for a project or folder as a main tab.
export function openNodeSetup(nodeId: number, title: string) {
  if (!api) return
  const id = `node-setup-${nodeId}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  addToMain({ id, component: 'node-setup', title, params: { id: nodeId } })
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
