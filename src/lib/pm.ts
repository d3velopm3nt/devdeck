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

// Script names that are almost always long-running dev servers, so a repo
// scan defaults them to a Service rather than a one-shot Command.
const SERVICE_NAMES = new Set(['dev', 'start', 'serve', 'preview', 'watch', 'storybook', 'develop'])
// Command fragments that signal a process that stays up (watchers / servers).
const SERVICE_HINTS =
  /(^|\s)(nodemon|vite|webpack(-dev-server)?\s+serve|next\s+dev|nuxt\s+dev|remix\s+dev|astro\s+dev|uvicorn|gunicorn|flask\s+run|rails\s+s(erver)?|php\s+artisan\s+serve|cargo\s+run|cargo\s+watch|go\s+run|dotnet\s+watch|dotnet\s+run|http-server|serve\b)|--watch\b|--reload\b|--hot\b/i

/// Guess whether a detected script is a long-running service or a one-shot
/// command. Heuristic only — the UI lets the user flip it before adding.
export function guessKind(name: string, command: string): 'command' | 'service' {
  if (SERVICE_NAMES.has(name.trim().toLowerCase())) return 'service'
  if (SERVICE_HINTS.test(command)) return 'service'
  return 'command'
}

/// Best-effort dev-server port from a command string, so an imported service
/// can pre-fill its port instead of you typing it every time. Reads an explicit
/// --port / -p / PORT= first, else falls back to the tool's conventional port.
export function guessPort(command: string): number | null {
  const c = command.toLowerCase()
  const m = c.match(/(?:--port[=\s]|(?:^|\s)-p[=\s]|\bport[:=])\s*(\d{2,5})/)
  if (m) return Number(m[1])
  if (/\bvite\b/.test(c)) return 5173
  if (/\bnext\b/.test(c)) return 3000
  if (/\bnuxt\b/.test(c)) return 3000
  if (/\bastro\b/.test(c)) return 4321
  if (/react-scripts|craco/.test(c)) return 3000
  if (/\bstorybook\b/.test(c)) return 6006
  if (/\bng\s+serve\b|angular/.test(c)) return 4200
  if (/vue-cli-service|\bquasar\b/.test(c)) return 8080
  if (/uvicorn|fastapi/.test(c)) return 8000
  if (/manage\.py\s+runserver|django/.test(c)) return 8000
  if (/rails\s+s(erver)?\b|\bpuma\b/.test(c)) return 3000
  if (/php\s+artisan\s+serve/.test(c)) return 8000
  if (/http-server|\bserve\b/.test(c)) return 8080
  return null
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
