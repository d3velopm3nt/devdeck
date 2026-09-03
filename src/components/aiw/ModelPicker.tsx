// Pick a model, without having to know its exact string.
//
// Typing `anthropic/claude-sonnet-4.5` from memory is a good way to configure
// an agent that fails on its first turn, so the list is fetched from the
// provider itself. The list is the default and the only thing on screen;
// typing one by hand is available, but you have to ask for it.
//
// Two rules keep it honest:
//
//   1. **Never an empty dropdown.** Every provider ships a small built-in list,
//      so a failed lookup still leaves something to choose from.
//   2. **Never a stale list shown as a fresh one.** The backend says whether
//      the answer really came from the provider, and this shows the difference.
//
// Whatever is currently set always appears in the list, even when the provider
// has never heard of it. A select with no matching option renders blank, which
// would make a configured model look like no model at all.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../lib/icons'
import { aiw, type ModelCatalog, type ModelInfo } from '../../lib/aiw'
import { knownPricing } from '../../lib/usage'

const TYPE_IT = '__type__'

/// What a model costs, in the fewest words that are still true.
///
/// Three answers, and the third is the point: a provider that publishes no
/// prices gets silence rather than a guess. NVIDIA's catalogue is eighty-odd
/// models with not a price among them, and "free" printed against one of those
/// would be a claim about somebody's bill that nothing supports.
export type Price = { kind: 'free' | 'paid'; label: string; why: string } | null

export function priceOf(m: ModelInfo | undefined, providerId: string): Price {
  if (!m) return null
  if (m.free) {
    return {
      kind: 'free',
      label: 'Free',
      why:
        m.input_per_mtok === 0
          ? 'The provider prices this one at zero.'
          : 'Runs on this machine — no account, no metering, nothing leaving it.',
    }
  }
  if (m.input_per_mtok != null && m.output_per_mtok != null) {
    return {
      kind: 'paid',
      label: `$${trim(m.input_per_mtok)}/$${trim(m.output_per_mtok)}`,
      why: `${trim(m.input_per_mtok)} in, ${trim(m.output_per_mtok)} out, per million tokens — the provider's own published rate.`,
    }
  }
  // Nothing published. We may still know it ourselves — and then it matters
  // whose figure it is.
  const ours = knownPricing(m.id, providerId)
  if (!ours) return null
  if (ours.inputPerMTok === 0 && ours.outputPerMTok === 0) {
    return { kind: 'free', label: 'Free', why: ours.label }
  }
  return {
    kind: 'paid',
    label: `$${trim(ours.inputPerMTok)}/$${trim(ours.outputPerMTok)}`,
    why: `${ours.label} list price per million tokens — from DevDeck's own table, not from the provider.`,
  }
}

/// Money without a wall of zeros: 3 → "3", 0.1 → "0.1", 0.00015 → "0.0002".
function trim(n: number): string {
  if (n === 0) return '0'
  if (n >= 1) return String(Math.round(n * 100) / 100)
  return String(Number(n.toFixed(4)))
}

export function ModelPicker({
  providerId,
  value,
  onChange,
  hint,
  compact,
}: {
  providerId: string
  value: string
  onChange: (model: string) => void
  hint?: string
  /** Table rows have no room for a note; the tooltip carries it instead. */
  compact?: boolean
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)

  const load = useCallback(async () => {
    if (!providerId) return
    setLoading(true)
    try {
      setCatalog(await aiw.models(providerId))
    } catch (e) {
      setCatalog({ models: [], live: false, note: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }, [providerId])

  useEffect(() => {
    void load()
  }, [load])

  const models = useMemo(() => catalog?.models ?? [], [catalog])
  const unlisted = value !== '' && !models.some((m) => m.id === value)

  // The current value first when the provider does not offer it, so it shows
  // rather than leaving the select blank.
  const options: ModelInfo[] = useMemo(
    () => (unlisted ? [{ id: value, name: value }, ...models] : models),
    [unlisted, value, models],
  )

  const price = useMemo(
    () => priceOf(options.find((m) => m.id === value), providerId),
    [options, value, providerId],
  )
  const status = describe(catalog, loading, unlisted, hint, providerId)

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {typing ? (
          <input
            autoFocus
            className="input min-w-0 flex-1 font-mono text-[11.5px]"
            value={value}
            placeholder="model id"
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <select
            className="input min-w-0 flex-1 text-[11.5px]"
            value={value}
            title={compact ? status?.text : undefined}
            onChange={(e) => {
              if (e.target.value === TYPE_IT) {
                setTyping(true)
                return
              }
              onChange(e.target.value)
            }}
          >
            {value === '' && <option value="">Choose a model…</option>}
            {/* A native select takes no markup, so the badge is text here and
                a real one sits beside the control for whatever is chosen. */}
            {options.map((m) => {
              const p = priceOf(m, providerId)
              return (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.context_window ? ` · ${Math.round(m.context_window / 1000)}k` : ''}
                  {p ? ` · ${p.label}` : ''}
                </option>
              )
            })}
            <option value={TYPE_IT}>Type one in…</option>
          </select>
        )}

        {!typing && price && (
          <span
            title={price.why}
            className={`shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold ${
              price.kind === 'free'
                ? 'bg-emerald-500/14 text-ok'
                : 'bg-slate-500/14 text-muted'
            }`}
          >
            {price.label}
          </span>
        )}

        {typing ? (
          <button
            className="btn-ghost shrink-0 whitespace-nowrap text-[10.5px]"
            title="Go back to the list of models"
            onClick={() => {
              setTyping(false)
              // An empty box would leave the select with nothing selected.
              if (!value && options.length > 0) onChange(options[0].id)
            }}
          >
            Back to list
          </button>
        ) : (
          <button
            className="btn-ghost shrink-0 px-1.5 text-[11px]"
            title={loading ? 'Loading…' : 'Check for new models'}
            disabled={loading || !providerId}
            onClick={() => void load()}
          >
            <Icon
              name={loading ? 'spinner' : 'update'}
              size={12}
              className={loading ? 'animate-spin' : ''}
            />
          </button>
        )}
      </div>

      {!compact && status && (
        <div className={`mt-1 text-[10.5px] leading-[1.5] ${status.tone}`}>{status.text}</div>
      )}
    </div>
  )
}

function describe(
  catalog: ModelCatalog | null,
  loading: boolean,
  unlisted: boolean,
  hint: string | undefined,
  providerId: string,
): { text: string; tone: string } | null {
  if (loading) return { text: 'Loading models…', tone: 'text-faint' }

  // A built-in list shown as though it came from the provider would be a
  // failed lookup reading as a successful one.
  if (catalog && !catalog.live) {
    const why = catalog.note ? ` (${catalog.note})` : ''
    return {
      text: `Couldn't load the list, so these are the ones we already knew about${why}.`,
      tone: 'text-warn',
    }
  }
  if (unlisted) {
    return {
      text: "This one isn't in the provider's list. That's fine if you know it's right.",
      tone: 'text-dim',
    }
  }
  if (catalog?.live) {
    return { text: `${catalog.models.length} models available. ${prices(catalog, providerId)}`, tone: 'text-faint' }
  }
  return hint ? { text: hint, tone: 'text-faint' } : null
}

/// How many of them cost nothing — or, more often, that nobody said.
///
/// The question this answers is "which of these 81 are free?", and for some
/// providers the true answer is "the catalogue does not say". A list that
/// silently showed no badges would look like a list of paid models; this says
/// which it is.
function prices(catalog: ModelCatalog, providerId: string): string {
  const known = catalog.models.filter((m) => priceOf(m, providerId) !== null)
  if (known.length === 0) {
    return 'This provider publishes no prices, so none are marked — the catalogue says what it serves, not what it charges.'
  }
  const free = catalog.models.filter((m) => priceOf(m, providerId)?.kind === 'free').length
  const priced = free === 0 ? 'none of them free' : `${free} of them free`
  return known.length === catalog.models.length
    ? `Priced per million tokens, ${priced}.`
    : `${known.length} carry a price, ${priced}; the rest are unpriced.`
}
