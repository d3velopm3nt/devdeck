// Provider setup — connect a real model.
//
// The rule this screen follows: it never displays, requests back, or receives a
// stored API key. The backend keeps keys in Windows Credential Manager and
// tells the UI only *that* one is saved. So the key field is always blank on
// load, and leaving it blank means "keep what's saved" rather than "clear it".

import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { aiw, type ProviderHealth, type ProviderSetup } from '../../lib/aiw'

type Kind = 'openai-compatible' | 'anthropic'

/** Endpoints people actually use, so nobody has to remember a base URL. */
const PRESETS: Array<{ label: string; baseUrl: string; model: string; note: string }> = [
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    note: 'One key, most models. Good first choice.',
  },
  {
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.1-70b-instruct',
    note: 'Hosted open models.',
  },
  {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:14b',
    note: 'No key needed. Nothing leaves the machine.',
  },
  {
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    note: 'No key needed.',
  },
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    note: '',
  },
]

const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) => (
  <label className="mb-3 block">
    <div className="mb-1 text-[11px] font-medium text-dim">{label}</div>
    {children}
    {hint && <div className="mt-1 text-[10.5px] leading-4 text-muted">{hint}</div>}
  </label>
)

export function Providers() {
  const [setups, setSetups] = useState<ProviderSetup[]>([])
  const [live, setLive] = useState<[string, string, ProviderHealth][]>([])
  const [kind, setKind] = useState<Kind>('openai-compatible')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [headers, setHeaders] = useState<[string, string][]>([])
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const saved = setups.find((s) => s.kind === kind)

  const load = async () => {
    try {
      const [s, l] = await Promise.all([aiw.providerSetups(), aiw.providers()])
      setSetups(s)
      setLive(l)
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Load the saved config into the form when switching kind. The key stays
  // blank — the backend will not hand it back, by design.
  useEffect(() => {
    const s = setups.find((x) => x.kind === kind)
    setName(s?.name ?? (kind === 'anthropic' ? 'Anthropic' : ''))
    setBaseUrl(s?.base_url ?? '')
    setModel(s?.model ?? '')
    setHeaders(s?.headers ?? [])
    setApiKey('')
    setResult(null)
  }, [kind, setups])

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setName(p.label)
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setResult(null)
  }

  const save = async () => {
    setBusy(true)
    setResult(null)
    try {
      await aiw.configureProvider({
        kind,
        name: name.trim() || kind,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        headers: headers.filter(([k]) => k.trim() !== ''),
      })
      setApiKey('')
      await load()
      setResult({ ok: true, text: 'Saved. The key is in Windows Credential Manager, not the database.' })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult({ ok: true, text: await aiw.testProvider(kind) })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const forget = async () => {
    await aiw.forgetProviderKey(kind)
    await load()
    setResult({ ok: true, text: 'Key deleted from Credential Manager.' })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-3 border-b border-line px-5 py-3.5">
        <div>
          <div className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Providers</div>
          <div className="mt-0.5 text-[12px] text-dim">
            Connect a model. Nothing else in the workspace changes — same runtime, same tools,
            same context.
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5">
          <div className="min-w-0">
            <div className="mb-3 flex gap-px rounded-md border border-line bg-soft p-0.5">
              {(
                [
                  ['openai-compatible', 'OpenAI-compatible'],
                  ['anthropic', 'Anthropic'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`flex-1 rounded px-3 py-1.5 text-[12px] ${
                    kind === k ? 'bg-raise font-semibold text-ink' : 'text-muted hover:text-ink'
                  }`}
                  onClick={() => setKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>

            {kind === 'openai-compatible' && (
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  Start from
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className="btn-ghost text-[11.5px]"
                      onClick={() => applyPreset(p)}
                      title={`${p.baseUrl}${p.note ? ` — ${p.note}` : ''}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-md border border-line bg-raise p-4">
              {kind === 'openai-compatible' && (
                <>
                  <Field label="Name" hint="What this connection is called in DevDeck.">
                    <input
                      className="input w-full text-[12px]"
                      value={name}
                      placeholder="OpenRouter"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Base URL"
                    hint="The v1 root. DevDeck appends /chat/completions."
                  >
                    <input
                      className="input w-full font-mono text-[12px]"
                      value={baseUrl}
                      placeholder="https://openrouter.ai/api/v1"
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </Field>
                </>
              )}

              <Field
                label="Model"
                hint={
                  kind === 'anthropic'
                    ? 'e.g. claude-sonnet-4-5'
                    : 'Exactly as the provider names it.'
                }
              >
                <input
                  className="input w-full font-mono text-[12px]"
                  value={model}
                  placeholder={kind === 'anthropic' ? 'claude-sonnet-4-5' : 'anthropic/claude-sonnet-4.5'}
                  onChange={(e) => setModel(e.target.value)}
                />
              </Field>

              <Field
                label="API key"
                hint={
                  saved?.has_key
                    ? 'A key is saved. Leave blank to keep it, or type a new one to replace it.'
                    : 'Stored in Windows Credential Manager, never in the database. Local servers usually need none.'
                }
              >
                <input
                  className="input w-full font-mono text-[12px]"
                  type="password"
                  value={apiKey}
                  placeholder={saved?.has_key ? '•••••••• saved' : 'sk-…'}
                  autoComplete="off"
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>

              {kind === 'openai-compatible' && (
                <Field
                  label="Custom headers"
                  hint="For gateways that authenticate by header rather than bearer token."
                >
                  <div className="flex flex-col gap-1.5">
                    {headers.map(([k, v], i) => (
                      <div key={i} className="flex gap-1.5">
                        <input
                          className="input flex-1 font-mono text-[11.5px]"
                          value={k}
                          placeholder="X-Team"
                          onChange={(e) => {
                            const next = [...headers]
                            next[i] = [e.target.value, v]
                            setHeaders(next)
                          }}
                        />
                        <input
                          className="input flex-1 font-mono text-[11.5px]"
                          value={v}
                          placeholder="platform"
                          onChange={(e) => {
                            const next = [...headers]
                            next[i] = [k, e.target.value]
                            setHeaders(next)
                          }}
                        />
                        <button
                          className="btn-ghost px-2 text-[11px]"
                          onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                          title="Remove"
                        >
                          <Icon name="delete" size={11} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn-ghost self-start text-[11px]"
                      onClick={() => setHeaders([...headers, ['', '']])}
                    >
                      <Icon name="add" size={11} /> Add header
                    </button>
                  </div>
                </Field>
              )}

              <div className="mt-1 flex items-center gap-2">
                <button
                  className="btn-primary text-[12px]"
                  disabled={busy || !model.trim() || (kind === 'openai-compatible' && !baseUrl.trim())}
                  onClick={() => void save()}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="btn-ghost text-[12px]"
                  disabled={testing || !saved}
                  onClick={() => void test()}
                  title="Make a real call — the only way to know it works"
                >
                  {testing ? (
                    <>
                      <Icon name="spinner" size={11} className="animate-spin" /> Testing…
                    </>
                  ) : (
                    'Test connection'
                  )}
                </button>
                <div className="flex-1" />
                {saved?.has_key && (
                  <button className="btn-ghost text-[11.5px] text-muted" onClick={() => void forget()}>
                    Forget key
                  </button>
                )}
              </div>

              {result && (
                <div
                  className={`mt-3 rounded border px-3 py-2 text-[11.5px] leading-5 ${
                    result.ok
                      ? 'border-emerald-500/28 bg-emerald-500/6 text-ok'
                      : 'border-red-500/30 bg-red-500/5 text-err'
                  }`}
                >
                  {result.text}
                </div>
              )}

              {kind === 'anthropic' && (
                <div className="mt-3 rounded border border-amber-500/28 bg-amber-500/5 px-3 py-2 text-[11.5px] leading-5 text-warn">
                  The Anthropic transport is not implemented yet — the key is stored and the
                  adapter is wired, but a call returns an explicit error rather than pretending to
                  work. Use OpenAI-compatible for now; OpenRouter serves Claude models through it.
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Registered
            </div>
            <div className="mb-4 overflow-hidden rounded-md border border-line bg-raise">
              {live.map(([id, label, health]) => (
                <div key={id} className="border-b border-line px-3 py-2.5 last:border-0">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      className={`h-[7px] w-[7px] rounded-full ${
                        health.ok ? 'bg-emerald-400' : health.configured ? 'bg-amber-400' : 'bg-faint'
                      }`}
                    />
                    <span className="text-[12.5px] text-ink">{label}</span>
                    {id === 'mock' && (
                      <span className="ml-auto text-[10px] text-faint">no key needed</span>
                    )}
                  </div>
                  <div className="pl-[15px] text-[10.5px] leading-4 text-muted">{health.detail}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-line bg-raise p-3.5 text-[11.5px] leading-5 text-dim">
              <div className="mb-1.5 flex items-center gap-1.5 text-ink">
                <Icon name="secret" size={12} className="text-indigo-400" />
                <span className="font-semibold">Where the key goes</span>
              </div>
              Windows Credential Manager, under{' '}
              <span className="font-mono text-[11px]">devdeck:aiw:&lt;provider&gt;</span> — never
              SQLite, never a log, never back over IPC. DevDeck can tell you a key is saved; it
              cannot show you what it is.
              <div className="mt-2.5 border-t border-line pt-2.5 text-muted">
                Agents keep running on <span className="text-dim">Mock</span> until you change
                their provider — configuring one here does not switch anything by itself.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
