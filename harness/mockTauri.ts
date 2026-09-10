// A stand-in for the Tauri IPC boundary, so the real React components and the
// real zustand store can run in a plain browser for screenshots and checks.
//
// Only the boundary is faked. Everything above it — components, store slice,
// lib/ipc wrappers — is the code that ships.

import { SEED } from './seed'

const store: Record<string, unknown> = {}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const handler = (SEED as Record<string, (a?: Record<string, unknown>) => unknown>)[cmd]
  if (handler) return handler(args) as T
  // Unknown commands answer the way the real ones shape their results, so a
  // missing mock degrades into an empty list rather than a crash.
  // Anything unmocked answers with an empty list. Commands that hand back a
  // collection are the common case, and `null` here becomes an unhelpful
  // "x is not iterable" three frames away from the real gap.
  if (!cmd.startsWith('setting_')) return [] as unknown as T
  if (cmd.startsWith('setting_get')) return (store[String(args?.key)] ?? null) as T
  return null as unknown as T
}

export const listen = async () => () => {}
export const emit = async () => {}
export const once = async () => () => {}
export type UnlistenFn = () => void

export const getCurrentWindow = () => ({
  label: 'main',
  listen: async () => () => {},
  onCloseRequested: async () => () => {},
  setSize: async () => {},
  setPosition: async () => {},
  show: async () => {},
  hide: async () => {},
  isVisible: async () => true,
  setAlwaysOnTop: async () => {},
  outerPosition: async () => ({ x: 0, y: 0 }),
  outerSize: async () => ({ width: 1440, height: 900 }),
  scaleFactor: async () => 1,
})
export const LogicalSize = class { constructor(public width: number, public height: number) {} }
export const LogicalPosition = class { constructor(public x: number, public y: number) {} }
export const PhysicalSize = LogicalSize
export const PhysicalPosition = LogicalPosition

export const open = async () => null
export const save = async () => null
export const message = async () => {}
export const ask = async () => false
export const confirm = async () => false

export const relaunch = async () => {}
export const exit = async () => {}
export const check = async () => null
