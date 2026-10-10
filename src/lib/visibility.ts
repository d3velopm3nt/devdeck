import { invoke } from '@tauri-apps/api/core'
export interface ProductLink { id: string; name: string; space: string; folder: string; repository: string; project_url: string }
export interface SessionRecord {
  id: string; assistant: string; product_id: string; space: string; folder: string; title: string;
  status: string; started_at: string; updated_at: string; ticket_url: string; conversation_url: string;
  step: string; blocker: string; next_action: string;
  checkpoints: { at: string; summary: string; evidence: string[] }[];
}
export interface VisibilitySnapshot { products: ProductLink[]; config_raw: string; sessions: SessionRecord[]; warnings: string[] }
export interface GithubIssue { number: number; title: string; state: string; url: string; updated_at: string; assignees: string[]; pull_request: boolean }
export interface IssueSnapshot { items: GithubIssue[]; fetched_at: string; truncated: boolean }
export const visibility = {
  snapshot: () => invoke<VisibilitySnapshot>('visibility_snapshot'),
  saveProducts: (expected: string, products: ProductLink[]) => invoke<void>('visibility_products_save', { expected, products }),
  issues: (repository: string) => invoke<IssueSnapshot>('visibility_github_issues', { repository }),
}
export const isStale = (updated: string, now = Date.now()) => !Number.isFinite(Date.parse(updated)) || now - Date.parse(updated) > 15 * 60_000
export const stage = (status: string): string => {
  if (['done', 'completed', 'closed'].includes(status)) return 'Done'
  if (['blocked', 'failed'].includes(status)) return 'Blocked'
  if (['review', 'reviewing'].includes(status)) return 'Review'
  if (['working', 'in-progress', 'claimed', 'planning'].includes(status)) return 'Working'
  return 'Queued'
}
