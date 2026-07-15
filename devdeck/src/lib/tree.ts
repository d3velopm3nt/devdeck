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

function joinPath(base: string, sub: string): string {
  const b = base.replace(/[\\/]+$/, '')
  const s = sub.replace(/^[\\/]+/, '').replace(/\//g, '\\')
  if (!b) return s
  if (!s) return b
  return `${b}\\${s}`
}

/// Resolved working directory for a node, or '' if none applies.
export function resolveDir(nodes: TreeNode[], node: TreeNode | null): string {
  if (!node) return ''
  if (node.kind === 'workspace') return ''
  if (node.kind === 'project') return node.path ?? ''
  // folder
  if (node.path && node.path.trim() !== '') return node.path // absolute override
  const proj = projectOf(nodes, node)
  const base = proj?.path ?? ''
  return joinPath(base, node.rel_path ?? '')
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
