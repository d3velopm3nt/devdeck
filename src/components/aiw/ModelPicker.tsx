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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { aiw, type ModelCatalog, type ModelCheck, type ModelInfo } from '../../lib/aiw'
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

/// One space where a message has several.
///
/// Verdicts are stored as they were written, and a message built from a
/// wrapped Rust string can carry the wrap with it. Fixing the text at the
/// source is right; leaving old rows unreadable until someone re-runs them is
/// not, so it is tidied on the way to the screen too.
function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
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
  onVerdict,
}: {
  providerId: string
  value: string
  onChange: (model: string) => void
  hint?: string
  /** Table rows have no room for a note; the tooltip carries it instead. */
  compact?: boolean
  /** Hand the verdict to whoever owns the layout.
   *
   *  A refusal is about the *agent*, not about the dropdown, and in a table it
   *  belongs across the row rather than squeezed into a 220px column. When
   *  this is given the picker reports and renders nothing itself, and the
   *  parent decides where the message goes. `retry` runs the same check the
   *  button does. */
  onVerdict?: (verdict: ModelCheck | undefined, retry: () => void) => void
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)
  const [checks, setChecks] = useState<Record<string, ModelCheck>>({})
  const [checking, setChecking] = useState(false)

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

  // What has already been proven about this provider's models, from earlier
  // checks. Free to read — no calls are made here.
  useEffect(() => {
    if (!providerId) return
    let alive = true
    void aiw
      .modelChecks(providerId)
      .then((cs) => {
        if (alive) setChecks(Object.fromEntries(cs.map((c) => [c.model, c])))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [providerId])

  /// Call the chosen model once. The only way to answer "will this one work",
  /// because a catalogue lists what a provider serves and not what your key
  /// may call.
  const check = async () => {
    if (!value) return
    setChecking(true)
    try {
      const c = await aiw.modelCheck(providerId, value)
      setChecks((prev) => ({ ...prev, [value]: c }))
    } catch (e) {
      setChecks((prev) => ({
        ...prev,
        [value]: {
          provider: providerId,
          model: value,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
          at: Date.now(),
        },
      }))
    } finally {
      setChecking(false)
    }
  }

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
  const checked = checks[value]
  const status = describe(catalog, loading, unlisted, hint, providerId, checked)

  // Kept in a ref so a parent that re-renders on every verdict cannot make
  // this effect chase its own tail.
  const report = useRef(onVerdict)
  report.current = onVerdict
  useEffect(() => {
    report.current?.(checked, () => void check())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked])

  return (
    <div className="relative">
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
                  {checks[m.id] ? (checks[m.id].ok ? '✓ ' : '✗ ') : ''}
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

        {!typing && value && (
          <button
            className="btn-ghost shrink-0 px-1.5 text-[11px]"
            title={
              checked
                ? `${checked.ok ? 'Answered' : 'Did not answer'}: ${tidy(checked.detail)}`
                : 'Call this model once to see whether your key can actually use it'
            }
            disabled={checking}
            onClick={() => void check()}
          >
            <Icon
              name={checking ? 'spinner' : checked ? (checked.ok ? 'check' : 'alert') : 'run'}
              size={12}
              className={
                checking
                  ? 'animate-spin'
                  : checked
                    ? checked.ok
                      ? 'text-ok'
                      : 'text-err'
                    : ''
              }
            />
          </button>
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

      {/* A refusal gets its own block, in every layout including a table row.
          It was a native tooltip: cramped, unselectable, gone the moment the
          pointer moved, and the one message here that someone actually has to
          read and act on. */}
      {checked && !checked.ok && !onVerdict && (
        <div
          // In a table the Model column is a couple of hundred pixels wide,
          // and a refusal wrapped into it becomes a tall thin ribbon that
          // shoves every other row down the page. It hangs below the control
          // instead, at a width someone can actually read.
          className={`flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/[0.06] px-2 py-1.5 ${
            compact ? 'absolute right-0 top-full z-30 mt-1 w-[340px] shadow-xl' : 'mt-1'
          }`}
        >
          <Icon name="alert" size={11} className="mt-px shrink-0 text-err" />
          <div className="min-w-0 flex-1 text-[10.5px] leading-[1.5] text-err">
            {tidy(checked.detail)}
          </div>
          <button
            className="btn-ghost shrink-0 px-1 text-[10px] text-muted"
            title="Clear this and try again"
            onClick={() => void check()}
          >
            Retry
          </button>
        </div>
      )}

      {!compact && status && !(checked && !checked.ok) && (
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
  checked?: ModelCheck,
): { text: string; tone: string } | null {
  if (loading) return { text: 'Loading models…', tone: 'text-faint' }

  // A model that has actually been called outranks everything else this line
  // could say: a refusal here is the difference between an agent that works
  // and one that fails on its first turn.
  if (checked && !checked.ok) {
    return { text: tidy(checked.detail), tone: 'text-err' }
  }

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
    const proven = checked?.ok ? ' This one answered when it was checked.' : ''
    return {
      text: `${catalog.models.length} models available. ${prices(catalog, providerId)}${proven}`,
      tone: 'text-faint',
    }
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
