// Pure helpers over the workspace tree: resolve a node's directory,
// find its owning project, and collect descendants. Directory rules:
//   project → path (base path)
//   folder  → path (absolute override) if set, else join(projectBase, rel_path)

import type { TreeNode } from './types'

export function findNode(nodes: TreeNode[], id: number | null): TreeNode | null {
  if (id == null) return null
  return nodes.find((n) => n.id === id) ?? null
}

/// Nearest ancestor project of `node` (or itself if it is a project).
export function projectOf(nodes: TreeNode[], node: TreeNode | null): TreeNode | null {
  let cur = node
  while (cur) {
    if (cur.kind === 'project') return cur
    cur = findNode(nodes, cur.parent_id)
  }
  return null
}

/// Nearest ancestor workspace of `node` (or itself if it is a workspace).
///
/// Walks rather than assuming a depth: a service can hang off a folder, and a
/// folder's parent is a project, so "the workspace" is however many hops up it
/// takes to find one.
export function workspaceOf(nodes: TreeNode[], node: TreeNode | null): TreeNode | null {
  let cur = node
  while (cur) {
    if (cur.kind === 'workspace') return cur
    cur = findNode(nodes, cur.parent_id)
  }
  return null
}

/// Nearest ancestor solution of `node`, or null when it sits directly under a
/// workspace. Null is the normal case, not an error: solutions are optional and
/// every tree that existed before them has none.
export function solutionOf(nodes: TreeNode[], node: TreeNode | null): TreeNode | null {
  let cur = node
  while (cur) {
    if (cur.kind === 'solution') return cur
    if (cur.kind === 'workspace') return null
    cur = findNode(nodes, cur.parent_id)
  }
  return null
}


/// Resolved working directory for a node, or '' if none applies.
export function resolveDir(_nodes: TreeNode[], node: TreeNode | null): string {
  if (!node) return ''
  if (node.kind === 'workspace') return ''
  if (node.kind === 'project') return node.path ?? ''
  // A folder runs in the repository it names, and nowhere otherwise. `rel_path`
  // is the node's place in the vault now, not a subpath of some parent repo —
  // joining it onto one produced a directory that never existed.
  return node.path?.trim() ? node.path : ''
}

/// A service's working directory: its explicit `cwd`, else the resolved
/// directory of the node it belongs to. '' when nothing applies (global, no cwd).
export function serviceDir(nodes: TreeNode[], svc: { project_id: number | null; cwd: string }): string {
  return svc.cwd.trim() !== '' ? svc.cwd : resolveDir(nodes, findNode(nodes, svc.project_id))
}

/// All descendant node ids of `id` (not including `id` itself).
export function descendantIds(nodes: TreeNode[], id: number): number[] {
  const out: number[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of nodes) {
      if (n.parent_id === cur) {
        out.push(n.id)
        stack.push(n.id)
      }
    }
  }
  return out
}

/// Ids of `id` plus all its descendants — the scope for showing a node's
/// (and its children's) commands/services.
export function subtreeIds(nodes: TreeNode[], id: number): number[] {
  return [id, ...descendantIds(nodes, id)]
}

/// Breadcrumb label for a node, e.g. "TrackX › web-app".
export function nodeLabel(nodes: TreeNode[], node: TreeNode): string {
  const parts: string[] = []
  let cur: TreeNode | null = node
  while (cur && cur.kind !== 'workspace') {
    parts.unshift(cur.name)
    cur = findNode(nodes, cur.parent_id)
  }
  return parts.join(' › ')
}

/// Projects and folders (things a command/service can belong to),
/// ordered as they appear in the tree.
export function ownerNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.kind === 'project' || n.kind === 'folder')
}
