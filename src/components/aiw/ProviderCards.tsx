// Provider setup — pick a provider, then set it up.
//
// The gallery is keyed on the *provider people recognise*, not the wire
// protocol. OpenAI-compatible vs Anthropic is DevDeck's concern, so it sits as
// a line of small print rather than as a tab you have to understand before you
// can start.
//
// The rule this screen follows: it never displays, requests back, or receives
// a stored API key. The backend keeps keys in Windows Credential Manager and
// tells the UI only *that* one is saved. The key field is therefore blank on
// load, and leaving it blank means "keep what's saved", not "clear it".

import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { aiw, type ProviderHealth, type ProviderSetup } from '../../lib/aiw'

/** Abstract marks in each provider's rough hue — recognisable in a grid
 *  without borrowing anyone's trademark. Swap for real logos with a licence. */
const Mark = ({ id, size = 17 }: { id: string; size?: number }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (id) {
    case 'openrouter':
      return (
        <svg {...common} stroke="#818cf8">
          <circle cx="12" cy="12" r="2.6" />
          <path d="M12 4.2v4.8M12 15v4.8M4.2 12h4.8M15 12h4.8" />
        </svg>
      )
    case 'anthropic':
      return (
        <svg {...common} stroke="#d97757">
          <path d="M7.5 19 12 5l4.5 14" />
          <path d="M9.4 14.4h5.2" />
        </svg>
      )
    case 'nvidia':
      return (
        <svg {...common} stroke="#76b900">
          <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
          <path d="M9 15V9l6 6V9" />
        </svg>
      )
    case 'openai':
      return (
        <svg {...common} stroke="#38bdf8">
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 4.5v15M4.5 12h15" />
        </svg>
      )
    case 'ollama':
      return (
        <svg {...common} stroke="#4ade80">
          <rect x="3.5" y="5" width="17" height="11" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )
    case 'lmstudio':
      return (
        <svg {...common} stroke="#a78bfa">
          <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
          <path d="M7.5 20.5h9" />
          <path d="M9.5 9.5 12 12l-2.5 2.5" />
        </svg>
      )
    default:
      return (
        <svg {...common} stroke="#94a3b8">
          <path d="M14.7 6.3a4 4 0 0 1 5 5l-9.3 9.3-5-5z" />
          <path d="m9 11 4 4" />
        </svg>
      )
  }
}

interface Def {
  id: string
  /** The wire protocol DevDeck talks. Not user-facing as a choice. */
  kind: 'openai-compatible' | 'anthropic'
  name: string
  note: string
  protocol: string
  tint: string
  baseUrl?: string
  model: string
  modelHint: string
  local?: boolean
  custom?: boolean
  unavailable?: boolean
}

const DEFS: Def[] = [
  {
    id: 'openrouter',
    kind: 'openai-compatible',
    name: 'OpenRouter',
    note: 'One key, most models. Good first choice.',
    protocol: 'OpenAI-compatible',
    tint: '129,140,248',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    modelHint: 'Provider-prefixed, e.g. anthropic/… or meta-llama/….',
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    name: 'Anthropic',
    note: 'Claude models, direct from the source.',
    protocol: 'Anthropic Messages API',
    tint: '217,119,87',
    model: 'claude-sonnet-4-5',
    modelHint: 'Exactly as Anthropic names it.',
    unavailable: true,
  },
  {
    id: 'nvidia',
    kind: 'openai-compatible',
    name: 'NVIDIA NIM',
    note: 'Hosted open models on NVIDIA endpoints.',
    protocol: 'OpenAI-compatible',
    tint: '118,185,0',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.1-70b-instruct',
    modelHint: 'As listed in the NIM catalogue.',
  },
  {
    id: 'openai',
    kind: 'openai-compatible',
    name: 'OpenAI',
    note: 'GPT models, direct.',
    protocol: 'OpenAI-compatible',
    tint: '56,189,248',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    modelHint: 'Exactly as OpenAI names it.',
  },
  {
    id: 'ollama',
    kind: 'openai-compatible',
    name: 'Ollama',
    note: 'Local models. Nothing leaves the machine.',
    protocol: 'OpenAI-compatible · local',
    tint: '74,222,128',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:14b',
    modelHint: 'Whatever `ollama list` shows.',
    local: true,
  },
  {
    id: 'lmstudio',
    kind: 'openai-compatible',
    name: 'LM Studio',
    note: 'Local server, no key.',
    protocol: 'OpenAI-compatible · local',
    tint: '167,139,250',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    modelHint: 'The identifier LM Studio serves it under.',
    local: true,
  },
  {
    id: 'custom',
    kind: 'openai-compatible',
    name: 'Custom endpoint',
    note: 'Any OpenAI-compatible gateway or proxy.',
    protocol: 'OpenAI-compatible',
    tint: '148,163,184',
    model: 'your-model',
    modelHint: 'Whatever your gateway expects.',
    custom: true,
  },
]

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[11px] font-medium text-dim">{children}</div>
)
const Hint = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-1 text-[10.5px] leading-4 text-muted">{children}</div>
)

export function ProviderCards({ onChanged }: { onChanged?: () => void }) {
  const [setups, setSetups] = useState<ProviderSetup[]>([])
  const [live, setLive] = useState<[string, string, ProviderHealth][]>([])
  const [selected, setSelected] = useState('openrouter')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [headers, setHeaders] = useState<[string, string][]>([])
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const def = DEFS.find((d) => d.id === selected) ?? DEFS[0]

  // A saved config matches by *kind* — DevDeck registers one provider per wire
  // protocol, so its name records which card it was set up from.
  const saved = setups.find((s) => s.kind === def.kind && (s.name === def.name || def.custom))
  const connected = !!saved?.has_key || (!!saved && !!def.local)

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

  // Load whatever is saved for this card. The key stays blank — the backend
  // will not hand it back, by design.
  //
  // Note what this does NOT do: clear `result`. It also runs when `setups`
  // refreshes, which happens right after saving — so clearing here wiped the
  // message that had just been set, including a failed load's error. The
  // message is cleared when you pick a different card instead.
  useEffect(() => {
    setName(saved?.name ?? def.name)
    setBaseUrl(saved?.base_url ?? def.baseUrl ?? '')
    setModel(saved?.model ?? def.model)
    setHeaders(saved?.headers ?? [])
    setApiKey('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, setups])

  useEffect(() => {
    setResult(null)
  }, [selected])

  const save = async () => {
    setBusy(true)
    setResult(null)
    try {
      await aiw.configureProvider({
        kind: def.kind,
        name: def.custom ? name.trim() || 'Custom endpoint' : def.name,
        baseUrl: (def.custom ? baseUrl : def.baseUrl ?? '').trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        headers: headers.filter(([k]) => k.trim() !== ''),
      })
      setApiKey('')
      await load()
      onChanged?.()
      setResult({
        ok: true,
        text: def.local
          ? 'Connected. Make sure the local server is running, then test.'
          : 'Connected. The key is in Windows Credential Manager, not the database.',
      })
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
      setResult({ ok: true, text: await aiw.testProvider(def.kind) })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const forget = async () => {
    await aiw.forgetProviderKey(def.kind)
    await load()
    onChanged?.()
    setResult({ ok: true, text: 'Key deleted from Credential Manager.' })
  }

  const statusOf = (d: Def) => {
    const s = setups.find((x) => x.kind === d.kind && (x.name === d.name || d.custom))
    if (d.unavailable) return { text: 'Not available yet', cls: 'text-warn' }
    if (s?.has_key || (s && d.local)) return { text: 'Connected', cls: 'text-ok' }
    if (d.local) return { text: 'No key needed', cls: 'text-faint' }
    return { text: 'Not connected', cls: 'text-faint' }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_424px] items-start gap-5">
      {/* gallery */}
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            Choose a provider
          </span>
          <div className="flex-1" />
          <span className="text-[10.5px] text-faint">{DEFS.length} available</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {DEFS.map((d) => {
            const on = d.id === selected
            const st = statusOf(d)
            return (
              <button
                key={d.id}
                className="flex items-start gap-2.5 rounded-[7px] border p-3 text-left hover:brightness-110"
                style={
                  on
                    ? { borderColor: `rgb(${d.tint})`, background: `rgba(${d.tint},0.07)` }
                    : { borderColor: '#1e293b', background: '#151923' }
                }
                onClick={() => setSelected(d.id)}
              >
                <span
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `rgba(${d.tint},0.14)` }}
                >
                  <Mark id={d.id} />
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold text-ink">{d.name}</span>
                    {st.text === 'Connected' && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-[1.45] text-muted">
                    {d.note}
                  </span>
                  <span className={`mt-1.5 block text-[10px] ${st.cls}`}>{st.text}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-3.5 flex items-start gap-2.5 border-t border-line pt-3">
          <Icon name="info" size={13} className="mt-px shrink-0 text-muted" />
          <div className="text-[11px] leading-[1.55] text-muted">
            Connecting a provider does not switch anything by itself — assign it to an agent under{' '}
            <span className="text-dim">Agents</span> below.
          </div>
        </div>

        <div className="mt-3.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Registered
          </div>
          <div className="overflow-hidden rounded-md border border-line bg-raise">
            {live.length === 0 && (
              <div className="px-3 py-3 text-[11.5px] leading-5 text-muted">
                Nothing registered — which shouldn&rsquo;t happen, since Mock is always available.
                That points at a failed read rather than an empty list.
              </div>
            )}
            {live.map(([id, label, health]) => (
              <div key={id} className="border-b border-line px-3 py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-[7px] w-[7px] rounded-full ${
                      health.ok ? 'bg-emerald-400' : health.configured ? 'bg-amber-400' : 'bg-faint'
                    }`}
                  />
                  <span className="text-[12px] text-ink">{label}</span>
                  <span className="ml-auto font-mono text-[10px] text-faint">{id}</span>
                </div>
                <div className="pl-[15px] text-[10.5px] leading-4 text-muted">{health.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* setup panel — always in the same place */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-raise">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]"
            style={{ background: `rgba(${def.tint},0.14)` }}
          >
            <Mark id={def.id} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink">{def.name}</div>
            <div className="mt-px text-[10.5px] text-muted">{def.protocol}</div>
          </div>
          <span
            className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${
              def.unavailable
                ? 'bg-amber-500/14 text-warn'
                : connected
                  ? 'bg-emerald-500/12 text-ok'
                  : 'bg-slate-500/14 text-dim'
            }`}
          >
            {def.unavailable ? 'Not available yet' : connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="p-3.5">
          {def.unavailable && (
            <div className="mb-3 rounded border border-amber-500/28 bg-amber-500/5 px-3 py-2.5 text-[11.5px] leading-[1.55] text-warn">
              The direct transport isn&rsquo;t built yet — the key is stored and the adapter is
              wired, but a call returns an explicit error rather than pretending to work. OpenRouter
              serves the same models today.
            </div>
          )}

          {def.baseUrl && !def.custom && (
            <div className="mb-3">
              <Label>Endpoint</Label>
              <div className="rounded border border-line bg-page px-2.5 py-1.5 font-mono text-[11px] text-dim">
                {def.baseUrl}
              </div>
              <Hint>Fixed for this provider. DevDeck appends /chat/completions.</Hint>
            </div>
          )}

          {def.custom && (
            <>
              <div className="mb-3">
                <Label>Name</Label>
                <input
                  className="input w-full text-[12px]"
                  value={name}
                  placeholder="Team gateway"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="mb-3">
                <Label>Base URL</Label>
                <input
                  className="input w-full font-mono text-[11.5px]"
                  value={baseUrl}
                  placeholder="https://your-gateway.internal/v1"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <Hint>The v1 root. DevDeck appends /chat/completions.</Hint>
              </div>
            </>
          )}

          <div className="mb-3">
            <Label>Model</Label>
            <input
              className="input w-full font-mono text-[11.5px]"
              value={model}
              placeholder={def.model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Hint>{def.modelHint}</Hint>
          </div>

          {!def.local && (
            <div className="mb-3">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-dim">API key</span>
                {saved?.has_key && (
                  <span className="rounded bg-emerald-500/12 px-1.5 py-px text-[10.5px] font-semibold text-ok">
                    saved
                  </span>
                )}
              </div>
              <input
                className="input w-full font-mono text-[11.5px]"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={saved?.has_key ? '•••••••••••• saved' : 'sk-…'}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Hint>
                {saved?.has_key
                  ? 'A key is saved. Leave blank to keep it, or type a new one to replace it.'
                  : 'Stored in Windows Credential Manager, never in the database.'}
              </Hint>
            </div>
          )}

          {def.local && (
            <div className="mb-3 rounded border border-line bg-page px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Icon name="machine" size={12} className="text-ok" />
                <span className="text-[11.5px] font-semibold text-ok">Runs on this machine</span>
              </div>
              <div className="text-[10.5px] leading-[1.55] text-muted">
                No key, no account, nothing leaves the machine. Start the server before testing.
              </div>
            </div>
          )}

          {def.custom && (
            <div className="mb-3">
              <Label>Custom headers</Label>
              <div className="flex flex-col gap-1.5">
                {headers.map(([k, v], i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      className="input flex-1 font-mono text-[11px]"
                      value={k}
                      placeholder="X-Team"
                      onChange={(e) => {
                        const next = [...headers]
                        next[i] = [e.target.value, v]
                        setHeaders(next)
                      }}
                    />
                    <input
                      className="input flex-1 font-mono text-[11px]"
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
              <Hint>For gateways that authenticate by header rather than bearer token.</Hint>
            </div>
          )}

          <div className="flex items-center gap-1.5 border-t border-line pt-3">
            <button
              className="btn-primary text-[12px]"
              disabled={busy || !model.trim() || (def.custom && !baseUrl.trim())}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : connected ? 'Update' : 'Connect'}
            </button>
            <button
              className="btn-ghost text-[11.5px]"
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
              <button className="btn-ghost text-[11px] text-muted" onClick={() => void forget()}>
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

          <div className="mt-3 flex items-start gap-2.5 border-t border-line pt-3">
            <Icon name="secret" size={13} className="mt-px shrink-0 text-indigo-400" />
            <div className="text-[10.5px] leading-[1.6] text-muted">
              Keys go to Windows Credential Manager under{' '}
              <span className="font-mono text-dim">devdeck:aiw:&lt;provider&gt;</span> — never the
              database, never a log. DevDeck can tell you a key is saved; it cannot show you what it
              is.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
