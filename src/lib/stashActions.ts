// Pure transforms behind Stash's type-driven actions. Kept out of the view so
// the tricky parts — base64url that isn't quite base64, picking the useful
// line out of a stack trace — are readable on their own.

/** JSON.parse that reports *why* it failed, for showing inline. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`Not valid JSON — ${e instanceof Error ? e.message : String(e)}`)
  }
}

export const prettifyJson = (text: string): string => JSON.stringify(parseJson(text), null, 2)
export const minifyJson = (text: string): string => JSON.stringify(parseJson(text))

/** base64url → text. Not the same as base64: different alphabet, no padding. */
function b64urlDecode(part: string): string {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  // A JWT payload is UTF-8, so go through bytes rather than trusting atob's
  // latin1 output — otherwise any non-ASCII claim comes back mangled.
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export interface DecodedJwt {
  header: string
  payload: string
  /** Human-readable expiry, when the token carries one. */
  expires: string
  /** True when `exp` is in the past — worth saying out loud. */
  expired: boolean
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().split('.')
  if (parts.length !== 3) throw new Error('Not a JWT — expected three dot-separated parts.')
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(b64urlDecode(parts[0]))
    payload = JSON.parse(b64urlDecode(parts[1]))
  } catch {
    throw new Error("Couldn't decode this token — its header or payload isn't valid base64url JSON.")
  }
  const exp = (payload as { exp?: unknown })?.exp
  const hasExp = typeof exp === 'number' && Number.isFinite(exp)
  const expMs = hasExp ? exp * 1000 : 0
  return {
    header: JSON.stringify(header, null, 2),
    payload: JSON.stringify(payload, null, 2),
    expires: hasExp ? new Date(expMs).toLocaleString() : '',
    expired: hasExp && expMs < Date.now(),
  }
}

/**
 * The line from a stack trace worth searching the logs for. Python puts the
 * exception last and a banner first, so the first line ("Traceback (most
 * recent call last):") is the one line guaranteed to be useless.
 */
export function logSearchTerm(content: string): string {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''
  const first = lines[0]
  const pick = /^traceback \(most recent call last\)/i.test(first) ? lines[lines.length - 1] : first
  return pick.length > 90 ? pick.slice(0, 90) : pick
}

/** Strip the quotes a copied path usually arrives wrapped in. */
export const cleanPath = (text: string): string => text.trim().replace(/^"(.*)"$/s, '$1')
