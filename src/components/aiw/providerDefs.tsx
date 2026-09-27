// What DevDeck knows about each provider, in one place.
//
// Lifted out of the setup screen so the modal that asks you to set one up and
// the screen that manages them are working from the same list. Two copies of
// a list like this drift: one gains a provider, the other does not, and the
// place you notice is a dropdown that offers something the other half has
// never heard of.

/** Abstract marks in each provider's rough hue — recognisable in a grid
 *  without borrowing anyone's trademark. Swap for real logos with a licence. */
export const Mark = ({ id, size = 17 }: { id: string; size?: number }) => {
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

export interface Def {
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

export const DEFS: Def[] = [
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
  },
  {
    id: 'nvidia',
    kind: 'openai-compatible',
    name: 'NVIDIA NIM',
    note: 'Hosted open models on NVIDIA endpoints.',
    protocol: 'OpenAI-compatible',
    tint: '118,185,0',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    // The catalogue lists what NVIDIA publishes, not what a key may call:
    // most of the eighty-odd ids answer "not found for account", and a few
    // never answer at all. This one answers, and calls tools.
    modelHint: 'As listed in the catalogue — but not every listed model is on your account.',
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
