// Shared types mirroring the Rust backend structs (snake_case fields
// come straight from serde).

export type NodeKind = 'workspace' | 'project' | 'folder'

export interface TreeNode {
  id: number
  parent_id: number | null
  kind: NodeKind
  name: string
  /** project: base path (repo root); folder: optional absolute override. */
  path: string | null
  /** folder: subpath relative to the owning project's base path. */
  rel_path: string
  sort: number
  /** user-picked accent color (hex); null = derive from id. */
  color: string | null
}

export interface CommandDef {
  id: number
  project_id: number | null
  group_name: string
  name: string
  command: string
  cwd: string
  shell: string
  sort: number
}

export interface ServiceDef {
  id: number
  project_id: number | null
  name: string
  command: string
  cwd: string
  env: string
  auto_restart: boolean
  health_port: number | null
  /** shell/interpreter path to run under; '' = cmd.exe */
  shell: string
}

export type ProfileStep =
  | { type: 'service'; id: number }
  | { type: 'command'; id: number }
  | { type: 'terminal'; shell: string; cwd: string }
  | { type: 'layout'; id: number }

export interface ProfileDef {
  id: number
  project_id: number | null
  name: string
  steps: string // JSON-encoded ProfileStep[]
}

export interface LayoutDef {
  id: number
  name: string
  data: string
}

export interface PtyInfo {
  id: number
  title: string
  shell: string
  cwd: string
  pid: number | null
  alive: boolean
}

export type SvcStatus = 'running' | 'stopped' | 'crashed'

export interface SvcState {
  id: number
  name: string
  pid: number | null
  status: SvcStatus
  exit_code: number | null
  started_at: number | null
  ephemeral: boolean
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  seq: number
  ts: number
  service_id: number
  service: string
  stream: string
  level: LogLevel
  line: string
}

export interface ProcStat {
  kind: 'service' | 'terminal'
  id: number
  name: string
  pid: number
  cpu: number
  mem_mb: number
  uptime_secs: number
  ports: number[]
  procs: number
}

export interface ShellDef {
  name: string
  command: string
}

export interface Recent {
  kind: 'command' | 'service'
  ref_id: number
  ts: number
  count: number
}
