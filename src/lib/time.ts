// Small time formatters shared by Home, the service page, and anywhere else
// that shows uptime or "how long ago".

export const fmtUptime = (startedAt: number | null | undefined, now: number): string => {
  if (!startedAt) return ''
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const fmtAgo = (ts: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
