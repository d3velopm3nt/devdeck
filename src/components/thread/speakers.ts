// Who said that.
//
// A message carries an id — `dev-a`, `bot:12` — because that is what the
// permission matrix and the vault deal in. A thread has to show a name, and
// the two lists that know the names are already loaded elsewhere, so this is
// a lookup rather than a third list to keep in step.
//
// An id nothing matches is shown as itself rather than as "unknown". A bot
// deleted last week still said what it said, and blanking its name would
// quietly rewrite the transcript.

import { useCallback } from 'react'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'

export function useSpeakers(): (id: string) => string {
  const bots = useApp((s) => s.bots)
  const agents = useAiw((s) => s.agents)

  return useCallback(
    (id: string) => {
      if (!id) return 'Assistant'
      if (id === 'assistant') return 'Assistant'
      if (id.startsWith('bot:')) {
        const node = Number(id.slice(4))
        const bot = bots.find((b) => b.node_id === node)
        return bot?.name ?? id
      }
      return agents.find((a) => a.id === id)?.name ?? id
    },
    [bots, agents],
  )
}
