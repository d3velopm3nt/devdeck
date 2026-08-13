// Package-manager / toolchain badges, shown next to commands so you can tell
// npm from pnpm from cargo at a glance. `fromCommand` infers the manager from a
// command string (for commands that weren't created via a repo scan).

export interface PmBadge {
  label: string
  color: string
  bg: string
}

const BADGES: Record<string, PmBadge> = {
  npm: { label: 'npm', color: '#F87171', bg: 'rgba(248,113,113,0.14)' },
  pnpm: { label: 'pnpm', color: '#FBBF24', bg: 'rgba(251,191,36,0.14)' },
  yarn: { label: 'yarn', color: '#38BDF8', bg: 'rgba(56,189,248,0.14)' },
  bun: { label: 'bun', color: '#F472B6', bg: 'rgba(244,114,182,0.14)' },
  cargo: { label: 'cargo', color: '#FB923C', bg: 'rgba(251,146,60,0.14)' },
  go: { label: 'go', color: '#22D3EE', bg: 'rgba(34,211,238,0.14)' },
  dotnet: { label: '.NET', color: '#A78BFA', bg: 'rgba(167,139,250,0.14)' },
  make: { label: 'make', color: '#9BA3B2', bg: 'rgba(255,255,255,0.06)' },
  composer: { label: 'composer', color: '#C084FC', bg: 'rgba(192,132,252,0.14)' },
  python: { label: 'py', color: '#4ADE80', bg: 'rgba(74,222,128,0.14)' },
}

export function pmBadge(manager: string): PmBadge | null {
  return BADGES[manager] ?? null
}

/// Best-effort manager from a raw command string.
export function pmFromCommand(command: string): string | null {
  const c = command.trim().toLowerCase()
  const first = c.split(/\s+/)[0]
  if (['pnpm', 'yarn', 'bun', 'cargo', 'go', 'dotnet', 'make', 'composer'].includes(first)) return first
  if (first === 'npm' || first === 'npx') return 'npm'
  if (first === 'python' || first === 'python3' || first === 'py') return 'python'
  return null
}
