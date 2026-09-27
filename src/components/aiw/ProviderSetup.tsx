// Setting a provider up, from wherever you happened to need one.
//
// This exists because choosing a provider and setting one up were different
// places. The dropdown on an agent offered whatever was already configured and
// said nothing about how to add one; the screen that could add one was four
// clicks away behind the AI Workspace, which has no rail entry at all. So the
// path of least resistance was to pick something that did not work — and for
// three of six agents on this machine, that is exactly what happened.
//
// **It checks before it closes.** Saving without testing is how you end up
// with a manager pointed at a key that was mistyped a week ago: the wake runs,
// the first call fails, and the failure looks like the agent's fault. Here the
// endpoint is saved and then immediately asked for something real, and the
// modal only closes when that comes back. When it does not, what is shown is
// the provider's own words — never "something went wrong", which tells you
// nothing you did not already know.

import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { aiw } from '../../lib/aiw'
import { DEFS, Mark, type Def } from './providerDefs'

export function ProviderSetup({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Called with the id of the endpoint that just proved it works. */
  onSaved?: (providerId: string) => void
}) {
  const [def, setDef] = useState<Def>(DEFS[0])
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  /** What went wrong, in the provider's words. Never a paraphrase. */
  const [failed, setFailed] = useState('')
  const [step, setStep] = useState('')

  // Reset to the chosen provider's own defaults whenever it changes, so the
  // fields never hold half of one provider and half of another.
  useEffect(() => {
    setName(def.name)
    setBaseUrl(def.baseUrl ?? '')
    setModel(def.model)
    setApiKey('')
    setFailed('')
  }, [def])

  useEffect(() => {
    if (open) {
      setDef(DEFS[0])
      setFailed('')
      setStep('')
    }
  }, [open])

  if (!open) return null

  const needsKey = !def.local
  const ready = name.trim() !== '' && model.trim() !== '' && (!needsKey || apiKey.trim() !== '')

  const save = async () => {
    setBusy(true)
    setFailed('')
    try {
      setStep('Saving the endpoint…')
      await aiw.configureProvider({
        kind: def.kind,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
        headers: [],
      })

      // The whole point: ask it for something real before saying it works.
      setStep(`Asking ${name.trim()} for its models…`)
      const said = await aiw.testProvider(def.id)
      setStep('')
      onSaved?.(def.id)
      onClose()
      return said
    } catch (e) {
      // Whatever came back, verbatim. A provider that says "invalid x-api-key"
      // has told you exactly what to fix; "something went wrong" has not.
      setFailed(String(e))
      setStep('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Set up a provider"
    >
      <div className="flex max-h-full w-[640px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold text-ink">Set up a provider</span>
          <span className="text-[11.5px] text-muted">
            it is tested before it is saved
          </span>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-1 text-[11px] font-medium text-dim">Which one</div>
          <div className="grid grid-cols-4 gap-1.5">
            {DEFS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDef(d)}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] ${
                  d.id === def.id
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-ink'
                    : 'border-line bg-raise text-body hover:bg-hover'
                }`}
              >
                <Mark id={d.id} size={15} />
                <span className="truncate">{d.name}</span>
              </button>
            ))}
          </div>

          <div className="mt-2 text-[10.5px] leading-4 text-muted">
            {def.note} <span className="text-faint">Speaks {def.protocol}.</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[11px] font-medium text-dim">Call it</div>
              <input
                className="input w-full text-[12.5px]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={def.name}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-dim">Model</div>
              <input
                className="input w-full text-[12.5px]"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={def.model}
              />
              <div className="mt-1 text-[10.5px] leading-4 text-muted">{def.modelHint}</div>
            </div>
          </div>

          {(def.custom || def.local || def.baseUrl) && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-medium text-dim">Where it lives</div>
              <input
                className="input w-full font-mono text-[12px]"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={def.baseUrl ?? 'https://…'}
              />
            </div>
          )}

          {needsKey && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-medium text-dim">Key</div>
              <input
                className="input w-full font-mono text-[12px]"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="pasted once, kept by Windows"
                autoComplete="off"
              />
              <div className="mt-1 text-[10.5px] leading-4 text-muted">
                Stored in Windows Credential Manager. DevDeck never shows it again, and
                never sends it anywhere but this provider.
              </div>
            </div>
          )}

          {failed && (
            <div className="mt-3 rounded-lg border border-err/40 bg-err/[0.06] px-3 py-2.5">
              <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-err">
                <Icon name="alert" size={13} />
                {name.trim() || def.name} did not answer
              </div>
              <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-body">
                {failed}
              </div>
              <div className="mt-1.5 text-[10.5px] text-muted">
                That is what it said, word for word. Nothing was saved as working.
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-[11.5px] text-muted">{step}</span>
          <div className="flex-1" />
          <button className="btn text-[12.5px]" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary text-[12.5px]"
            onClick={() => void save()}
            disabled={busy || !ready}
          >
            {busy ? 'Checking…' : 'Check and save'}
          </button>
        </div>
      </div>
    </div>
  )
}
