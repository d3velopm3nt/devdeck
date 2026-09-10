// Naming a project inside the Assistant.
//
// The Assistant is deliberately global: it lists every project on the machine,
// flat, regardless of which workspace tab is active. That is the right scope
// for it — you ask it about work, not about a folder grouping — but a flat list
// with no provenance reads as an accident rather than a decision. So every
// project it names says which workspace it came from.
//
// The join is possible because both sides key on the same record: a project's
// AI id is its tree node id as a string (see `sync_projects_from_tree`). This
// is a read of the tree, never a write — the Assistant still owns no workspace
// state of its own.

import { useMemo } from 'react'
import { useApp } from '../store'
import { useAiw } from './aiwStore'
import { findNode, workspaceOf } from './tree'
import type { AiProject } from './aiw'
import type { TreeNode } from './types'

/** What a project is called, and where it lives. */
export interface ProjectLabel {
  name: string
  /** Null when the project has no workspace ancestor, or the tree has not loaded. */
  workspace: string | null
}

/** The tree node behind an AI project id, if the tree knows it. */
function nodeFor(nodes: TreeNode[], projectId: string): TreeNode | null {
  const id = Number(projectId)
  return Number.isFinite(id) ? findNode(nodes, id) : null
}

/**
 * Project id → name + workspace, for every registered project.
 *
 * Falls back to the id itself for a project the tree cannot resolve. Showing
 * the raw id is ugly, but it is true — inventing a name for a project that is
 * no longer in the tree would hide that it went missing.
 */
export function useProjectLabels(): (projectId: string | null | undefined) => ProjectLabel | null {
  const nodes = useApp((s) => s.nodes)
  const projects = useAiw((s) => s.projects)

  return useMemo(() => {
    const map = new Map<string, ProjectLabel>()
    for (const p of projects) {
      map.set(p.id, { name: p.name, workspace: workspaceOf(nodes, nodeFor(nodes, p.id))?.name ?? null })
    }
    return (projectId) => {
      if (!projectId) return null
      const hit = map.get(projectId)
      if (hit) return hit
      const node = nodeFor(nodes, projectId)
      return { name: node?.name ?? projectId, workspace: workspaceOf(nodes, node)?.name ?? null }
    }
  }, [nodes, projects])
}

/**
 * Projects bucketed by workspace, for a grouped picker.
 *
 * Workspaces keep tree order rather than being sorted alphabetically — the tab
 * strip has an order the user arranged, and a picker that disagrees with it
 * makes them hunt.
 */
export function useProjectsByWorkspace(): Array<{ workspace: string; projects: AiProject[] }> {
  const nodes = useApp((s) => s.nodes)
  const projects = useAiw((s) => s.projects)

  return useMemo(() => {
    const order = nodes.filter((n) => n.kind === 'workspace').map((w) => w.name)
    const groups = new Map<string, AiProject[]>()
    for (const p of projects) {
      const ws = workspaceOf(nodes, nodeFor(nodes, p.id))?.name ?? 'Not in a workspace'
      const list = groups.get(ws)
      if (list) list.push(p)
      else groups.set(ws, [p])
    }
    const out: Array<{ workspace: string; projects: AiProject[] }> = []
    for (const name of order) {
      const list = groups.get(name)
      if (list) {
        out.push({ workspace: name, projects: list })
        groups.delete(name)
      }
    }
    // Anything the tree order did not account for still has to appear — a
    // project dropped here would be one you could never pick.
    for (const [workspace, list] of groups) out.push({ workspace, projects: list })
    return out
  }, [nodes, projects])
}
