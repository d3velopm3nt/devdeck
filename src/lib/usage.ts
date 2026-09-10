// What a model call costs.
//
// Ported from x-platform's `ai-usage` package (`packages/ai-usage`) so the two
// agree on the arithmetic: four token categories, priced separately, because a
// cache read is a tenth of fresh input and an output token is five times it.
// A raw total would call a cache-heavy run and a fresh-input run of the same
// size equally expensive, which is wrong by an order of magnitude.
//
// Prices are per million tokens, in USD, and they are a *guess about your
// account*: they do not come from the provider, and no invoice is being read.
// Anything shown from them says "estimated" in the interface.

export interface TokenUsage {
  input: number
  output: number
  cache_read: number
  cache_write: number
}

export interface ModelPricing {
  /** What to call it next to a figure. */
  label: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
}

interface PricingRule extends ModelPricing {
  /** Case-insensitive substring matched against the provider's model id. */
  match: string
}

/// Anthropic pricing as of mid-2026 ($/MTok). Order matters: the first match
/// on the model id wins, so the more specific names come first.
const ANTHROPIC: PricingRule[] = [
  { match: 'fable', label: 'Claude Fable', inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1, cacheWritePerMTok: 12.5 },
  { match: 'mythos', label: 'Claude Mythos', inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1, cacheWritePerMTok: 12.5 },
  { match: 'opus', label: 'Claude Opus', inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  { match: 'sonnet', label: 'Claude Sonnet', inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  { match: 'haiku', label: 'Claude Haiku', inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
]

/** The mock provider bills nothing, and saying otherwise would be a lie. */
export const FREE: ModelPricing = {
  label: 'Mock (no AI)',
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheReadPerMTok: 0,
  cacheWritePerMTok: 0,
}

/** Priced at the Opus tier when the model is not one we know. */
export const DEFAULT_PRICING: ModelPricing = ANTHROPIC[2]

/// The same lookup, but it admits when it does not know.
///
/// `resolvePricing` falls back to the Opus tier so a cost estimate is never
/// blank — right for a total, wrong for a label: printing "$5 / $25 per M"
/// beside a model nobody has priced would be inventing a number and putting it
/// where someone will read it as fact.
export function knownPricing(modelId?: string | null, provider?: string | null): ModelPricing | null {
  if (provider === 'mock' || modelId === 'mock-1') return FREE
  if (!modelId) return null
  const id = modelId.toLowerCase()
  return ANTHROPIC.find((r) => id.includes(r.match)) ?? null
}

export function resolvePricing(modelId?: string | null, provider?: string | null): ModelPricing {
  if (provider === 'mock' || modelId === 'mock-1') return FREE
  if (!modelId) return DEFAULT_PRICING
  const id = modelId.toLowerCase()
  return ANTHROPIC.find((r) => id.includes(r.match)) ?? DEFAULT_PRICING
}

/** USD for one lot of tokens on one model. */
export function costOf(u: TokenUsage, pricing: ModelPricing): number {
  return (
    (u.input * pricing.inputPerMTok +
      u.output * pricing.outputPerMTok +
      u.cache_read * pricing.cacheReadPerMTok +
      u.cache_write * pricing.cacheWritePerMTok) /
    1_000_000
  )
}

/** Every category as input-token equivalents: what it costs, in one number. */
export function weightedTokens(u: TokenUsage): number {
  return u.input + u.output * 5 + u.cache_read * 0.1 + u.cache_write * 1.25
}

export const totalTokens = (u: TokenUsage): number =>
  u.input + u.output + u.cache_read + u.cache_write

/** 12,400 → "12.4k". Rounded, because nobody reads the last three digits. */
export function shortNumber(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Money, with enough decimals to be worth showing at these sizes. */
export function money(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 10) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(0)}`
}
