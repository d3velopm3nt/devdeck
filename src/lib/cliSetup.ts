import { invoke } from '@tauri-apps/api/core'

export type CliTool = 'claude-code' | 'codex'
export type CliAction = 'install' | 'sign-in'
export interface CliStatus {
  tool: CliTool
  installed: boolean
  version: string
  auth: 'signed-out' | 'subscription' | 'api' | 'unknown'
  detail: string
  setup_supported: boolean
}
export interface CliSetupPlan {
  title: string
  command: string
  shell: string
  cwd: string
}
export const cliSetupStatus = (tool: CliTool) => invoke<CliStatus>('cli_setup_status', { tool })
export const cliSetupPlan = (tool: CliTool, action: CliAction) =>
  invoke<CliSetupPlan>('cli_setup_plan', { tool, action })
