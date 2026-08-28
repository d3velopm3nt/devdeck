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

const TYPE_IT = '__type__'

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

  const status = describe(catalog, loading, unlisted, hint)

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
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.context_window ? ` · ${Math.round(m.context_window / 1000)}k` : ''}
              </option>
            ))}
            <option value={TYPE_IT}>Type one in…</option>
          </select>
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
  hint?: string,
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
    return { text: `${catalog.models.length} models available.`, tone: 'text-faint' }
  }
  return hint ? { text: hint, tone: 'text-faint' } : null
}
