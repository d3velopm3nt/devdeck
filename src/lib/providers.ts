// Which endpoints an agent can actually be pointed at.
//
// This was a literal `['mock', 'anthropic', 'openai-compatible']`, copied into
// three dropdowns — which was accurate while a provider *was* its wire
// protocol and there could only be one of each. Endpoints are named things
// now: NVIDIA, OpenRouter and a local Ollama all speak the OpenAI shape and
// all exist at once, so the only honest list is the one the backend holds.
//
// One hook rather than three copies, because three copies is how two of them
// end up out of date.

import { useEffect, useState } from 'react'
import { aiw } from './aiw'

/** `[id, label]`, starting from the mock, which is always registered. */
export type ProviderOption = [string, string]

export function useProviders(): ProviderOption[] {
  const [list, setList] = useState<ProviderOption[]>([['mock', 'Mock (no AI)']])
  useEffect(() => {
    let alive = true
    void aiw
      .providers()
      .then((ps) => {
        if (alive && ps.length > 0) setList(ps.map(([id, name]) => [id, name]))
      })
      // The fallback above is never empty, so a failed lookup still leaves an
      // agent somewhere to be pointed at rather than an empty dropdown.
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return list
}

/// An agent can name an endpoint that has since been removed. Offering it
/// keeps the dropdown honest about what the agent actually says, instead of
/// silently showing the first option as though that were the truth.
export function withCurrent(list: ProviderOption[], current: string): ProviderOption[] {
  if (!current || list.some(([id]) => id === current)) return list
  return [...list, [current, `${current} — no longer configured`]]
}
