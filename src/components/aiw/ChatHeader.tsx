// The chat's header: which project, which model, and what the assistant can
// actually see.
//
// The last one is the point. "What I can see" shows the *same string* the
// model is handed, not a summary composed for the UI — a paraphrase would be
// worse than nothing, because you would trust it and it could drift from the
// truth without ever being obviously wrong.

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw } from '../../lib/aiw'
import { ModelPicker } from './ModelPicker'
import { useProviders, withCurrent } from '../../lib/providers'

export function ProviderChip() {
  const a = useAiw()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  const agent = a.agents.find((x) => x.id === 'assistant')
  const providers = useProviders()
  const [draft, setDraft] = useState({ provider: '', model: '' })

  const provider = agent?.provider ?? ''
  const model = agent?.model ?? ''
  // Depend on the two values rather than the object: reloading the agent list
  // makes a new object every time and would reset a draft mid-edit.
  useEffect(() => {
    setDraft({ provider, model })
  }, [provider, model])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  if (!agent) return null
  const mock = agent.provider === 'mock'
  const dirty = draft.provider !== agent.provider || draft.model !== agent.model

  const apply = async () => {
    setSaving(true)
    try {
      await aiw.setAgentProvider('assistant', draft.provider, draft.model)
      await a.reloadAgents()
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
          mock
            ? 'border-amber-500/35 bg-amber-500/[0.08] text-warn'
            : 'border-line2 bg-page text-dim hover:text-ink'
        }`}
        title={mock ? 'Running a fixed script, not a model' : `${agent.provider} · ${agent.model}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`h-[6px] w-[6px] rounded-full ${mock ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        <span className="max-w-[190px] truncate">{mock ? 'Mock (no AI)' : agent.model || agent.provider}</span>
        <Icon name="chevron-down" size={11} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[320px] rounded-md border border-line2 bg-menu p-3 shadow-2xl">
          <div className="text-[11.5px] font-medium text-dim">Provider</div>
          <select
            className="input mt-1 w-full text-[12px]"
            value={draft.provider}
            onChange={(e) => setDraft({ provider: e.target.value, model: '' })}
          >
            {withCurrent(providers, draft.provider).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <div className="mt-2.5 text-[11.5px] font-medium text-dim">Model</div>
          <div className="mt-1">
            <ModelPicker
              key={draft.provider}
              providerId={draft.provider}
              value={draft.model}
              onChange={(model) => setDraft({ ...draft, model })}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              className="btn-primary text-[11.5px]"
              disabled={!dirty || saving}
              onClick={() => void apply()}
            >
              {saving ? 'Applying…' : 'Apply'}
            </button>
            <span className="text-[10px] leading-[1.45] text-faint">
              Changes this assistant only. Other agents keep what they have.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function ContextPeek({ conversationId }: { conversationId: string | null }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !conversationId) return
    setError(null)
    setText(null)
    aiw
      .assistantContext(conversationId)
      .then(setText)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [open, conversationId])

  if (!conversationId) return null

  return (
    <>
      <button
        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
          open ? 'border-line3 bg-hover text-ink' : 'border-line2 bg-page text-dim hover:text-ink'
        }`}
        title="Exactly what this conversation can see"
        onClick={() => setOpen(!open)}
      >
        <Icon name="context" size={12} />
        Context
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-b border-line bg-page px-5 py-3 shadow-xl">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              What I can see
            </span>
            <span className="text-[10px] text-faint">
              {text ? `${Math.round(text.length / 4)} tokens, roughly` : ''}
            </span>
            <button className="ml-auto text-faint hover:text-dim" onClick={() => setOpen(false)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          {error ? (
            <div className="text-[11.5px] text-err">{error}</div>
          ) : text === null ? (
            <div className="text-[11.5px] text-muted">Reading…</div>
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-line bg-app px-3 py-2.5 font-mono text-[10.5px] leading-[1.6] text-dim">
              {text}
            </pre>
          )}
          <div className="mt-1.5 text-[10px] text-faint">
            The same text the model is handed &mdash; not a summary of it.
          </div>
        </div>
      )}
    </>
  )
}
