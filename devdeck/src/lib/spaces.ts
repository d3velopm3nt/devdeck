// Identity + usage helpers for "spaces" (Projects). Gives each space a
// stable color and avatar, and ranks spaces by run history so the
// Dashboard can surface the most-used ones.

import type { CommandDef, Recent, ServiceDef, TreeNode } from './types'
import { projectOf, findNode } from './tree'

export const SPACE_PALETTE = [
  '#7C8CF8', // indigo
  '#4ADE80', // green
  '#FBBF24', // amber
  '#F472B6', // pink
  '#38BDF8', // sky
  '#A78BFA', // violet
  '#FB7185', // rose
  '#34D399', // emerald
]

/// Stable accent color for a space, keyed by id so it never shifts.
export function spaceColor(id: number): string {
  return SPACE_PALETTE[Math.abs(id) % SPACE_PALETTE.length]
}

/// Effective color for a node: the user's picked color if set, else the
/// stable derived one.
export function nodeColor(node: { id: number; color: string | null }): string {
  return node.color && node.color.trim() !== '' ? node.color : spaceColor(node.id)
}

/// 1–2 letter avatar from a name ("TrackX" → "TR", "web app" → "WA").
export function avatarLabel(name: string): string {
  const words = name.trim().split(/[\s\-_]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const w = words[0] ?? name
  return w.slice(0, 2).toUpperCase()
}

export interface SpaceUsage {
  score: number // total run count across the space's commands + services
  lastTs: number // most recent run timestamp (ms)
}

/// Aggregate run history (recents) up to the owning project, so a folder's
/// runs still count toward its space.
export function projectUsage(
  nodes: TreeNode[],
  commands: CommandDef[],
  services: ServiceDef[],
  recents: Recent[],
): Record<number, SpaceUsage> {
  const out: Record<number, SpaceUsage> = {}
  const bump = (ownerId: number | null, count: number, ts: number) => {
    const proj = projectOf(nodes, findNode(nodes, ownerId))
    if (!proj) return
    const cur = out[proj.id] ?? { score: 0, lastTs: 0 }
    cur.score += count
    cur.lastTs = Math.max(cur.lastTs, ts)
    out[proj.id] = cur
  }
  for (const r of recents) {
    if (r.kind === 'command') {
      const c = commands.find((x) => x.id === r.ref_id)
      if (c) bump(c.project_id, r.count, r.ts)
    } else {
      const s = services.find((x) => x.id === r.ref_id)
      if (s) bump(s.project_id, r.count, r.ts)
    }
  }
  return out
}

/// Projects (spaces) under a workspace, ranked most-used first (then by
/// most-recent run, then name).
export function rankSpaces(
  projects: TreeNode[],
  usage: Record<number, SpaceUsage>,
): TreeNode[] {
  return [...projects].sort((a, b) => {
    const ua = usage[a.id] ?? { score: 0, lastTs: 0 }
    const ub = usage[b.id] ?? { score: 0, lastTs: 0 }
    if (ub.score !== ua.score) return ub.score - ua.score
    if (ub.lastTs !== ua.lastTs) return ub.lastTs - ua.lastTs
    return a.name.localeCompare(b.name)
  })
}
