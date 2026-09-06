// What this thread runs on, under the box you type in.
//
// The same switch lives inside an agent's pill card, which is fine once you
// know to click a name to find it. This is the other case: you are about to
// ask something expensive, or something a cheap model will fumble, and the
// decision belongs next to the send button.
//
// It never guesses. The bar renders only for an agent we can actually find in
// the matrix — a thread whose answerer we cannot identify gets nothing, rather
// than a model name that belongs to someone else. Being silent about which
// model is answering is a small failure; naming the wrong one is not.

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw } from '../../lib/aiw'
import { useProviders, withCurrent } from '../../lib/providers'
import { ModelPicker } from '../aiw/ModelPicker'

export function ModelBar({ agentId }: { agentId: string }) {
  const a = useAiw()
  const agent = a.agents.find((x) => x.id === agentId)
  const providers = useProviders()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ provider: '', model: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (agent) setDraft({ provider: agent.provider, model: agent.model })
  }, [agent?.provider, agent?.model]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click anywhere else to dismiss. A popover that only closes by re-clicking
  // the thing that opened it sits over the transcript you were reading.
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])

  if (!agent) return null

  const dirty = draft.provider !== agent.provider || draft.model !== agent.model
  const providerLabel =
    withCurrent(providers, agent.provider).find(([id]) => id === agent.provider)?.[1] ??
    agent.provider
  const apply = async () => {
    setSaving(true)
    setError(null)
    try {
      await aiw.setAgentProvider(agent.id, draft.provider, draft.model)
      await a.reloadAgents()
      setOpen(false)
    } catch (e) {
      // A refused switch must not look like a switch: the bar keeps saying
      // what the agent actually runs on, and this says why it did not change.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        className="flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-[10.5px] text-faint hover:bg-hover hover:text-dim"
        title="Which provider and model answers in this thread"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="ai" size={11} className="shrink-0" />
        <span className="truncate">
          {providerLabel} · {agent.model || 'no model set'}
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10} className="shrink-0" />
      </button>

      {/* Anchored to its right edge, not its left. The button sits at the right
          of the composer, so a panel growing rightwards from it ran off the
          side of the pane and clipped the model name — the one thing the
          popover exists to show. */}
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1.5 w-[320px] rounded-lg border border-line2 bg-menu p-3 shadow-lg">
          <div className="mb-1 flex items-baseline gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
              {agent.name || agent.id} runs on
            </span>
          </div>
          <select
            className="input w-full text-[11.5px]"
            value={draft.provider}
            onChange={(e) => setDraft({ provider: e.target.value, model: '' })}
          >
            {withCurrent(providers, draft.provider).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <div className="mt-1.5">
            <ModelPicker
              key={draft.provider}
              providerId={draft.provider}
              value={draft.model}
              onChange={(model) => setDraft({ ...draft, model })}
              compact
            />
          </div>
          {error && <div className="mt-1.5 text-[10.5px] text-err">{error}</div>}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              className="btn-primary text-[11px]"
              disabled={!dirty || saving || !draft.model}
              onClick={() => void apply()}
            >
              {saving ? 'Applying…' : 'Apply'}
            </button>
            <span className="text-[10px] text-muted">
              {dirty ? 'Takes effect on the next message.' : 'This is what answers here.'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
