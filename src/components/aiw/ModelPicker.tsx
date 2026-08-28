// Pick a model, without having to know its exact string.
//
// Typing `anthropic/claude-sonnet-4.5` from memory is a good way to configure
// an agent that fails on its first turn, so the list is fetched from the
// provider itself. Two rules keep that honest:
//
//   1. **Never an empty dropdown.** Every provider ships a small built-in list,
//      so a failed lookup still leaves something to choose from.
//   2. **Never a stale list presented as fresh.** The backend says whether the
//      answer actually came from the provider, and this shows the difference.
//      A built-in list passed off as a lookup is the same lie as an update
//      checker reporting "up to date" when it could not reach the server.
//
// Free text stays available: gateways add models faster than directories list
// them, and a picker that cannot express an unlisted model is a downgrade.

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { aiw, type ModelCatalog } from '../../lib/aiw'

const CUSTOM = '__custom__'

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
  /** Table rows have no room for the note; the title attribute carries it. */
  compact?: boolean
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  // Sticky rather than derived: once you choose Custom, the field must not snap
  // back to the dropdown just because what you typed happens to match a listed
  // id halfway through typing it.
  const [custom, setCustom] = useState(false)

  const load = useCallback(async () => {
    if (!providerId) return
    setLoading(true)
    try {
      setCatalog(await aiw.models(providerId))
    } catch (e) {
      setCatalog({
        models: [],
        live: false,
        note: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }, [providerId])

  useEffect(() => {
    void load()
  }, [load])

  const models = catalog?.models ?? []
  // An unlisted value is a real state, not an error: a model the directory does
  // not know about still has to be selectable and visible.
  const unlisted = value !== '' && !models.some((m) => m.id === value)
  const asText = custom || unlisted

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {asText ? (
          <input
            className="input min-w-0 flex-1 font-mono text-[11.5px]"
            value={value}
            placeholder="model id"
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <select
            className="input min-w-0 flex-1 text-[11.5px]"
            value={value}
            onChange={(e) => {
              if (e.target.value === CUSTOM) {
                setCustom(true)
                return
              }
              onChange(e.target.value)
            }}
          >
            {value === '' && <option value="">Choose a model…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.context_window ? ` · ${Math.round(m.context_window / 1000)}k` : ''}
              </option>
            ))}
            <option value={CUSTOM}>Type it myself…</option>
          </select>
        )}

        <button
          className="btn-ghost shrink-0 px-1.5 text-[11px]"
          title={loading ? 'Looking up models…' : 'Look up the models this provider offers'}
          disabled={loading || !providerId}
          onClick={() => void load()}
        >
          <Icon name={loading ? 'spinner' : 'update'} size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        {asText && models.length > 0 && (
          <button
            className="btn-ghost shrink-0 text-[10.5px]"
            title="Go back to the list"
            onClick={() => {
              setCustom(false)
              // Leaving an unlisted value behind would put the select into a
              // state with no matching option, which renders as blank.
              if (unlisted) onChange(models[0].id)
            }}
          >
            List
          </button>
        )}
      </div>

      {!compact && <Note catalog={catalog} loading={loading} unlisted={unlisted} hint={hint} />}
    </div>
  )
}

function Note({
  catalog,
  loading,
  unlisted,
  hint,
}: {
  catalog: ModelCatalog | null
  loading: boolean
  unlisted: boolean
  hint?: string
}) {
  if (loading) {
    return <div className="mt-1 text-[10.5px] text-faint">Asking the provider…</div>
  }
  if (catalog && !catalog.live) {
    return (
      <div className="mt-1 text-[10.5px] leading-[1.5] text-warn">
        Showing the built-in list — the lookup failed
        {catalog.note ? `: ${catalog.note}` : '.'}
      </div>
    )
  }
  if (unlisted) {
    return (
      <div className="mt-1 text-[10.5px] text-dim">
        Not in the provider&rsquo;s list. That is fine if you know it exists — it will fail on the
        first turn if it doesn&rsquo;t.
      </div>
    )
  }
  if (catalog?.live) {
    return (
      <div className="mt-1 text-[10.5px] text-faint">
        {catalog.models.length} models, live from the provider.
      </div>
    )
  }
  return hint ? <div className="mt-1 text-[10.5px] text-faint">{hint}</div> : null
}
