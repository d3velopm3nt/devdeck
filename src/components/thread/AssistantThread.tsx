// The Assistant's own conversation, as a document.
//
// Opened from the Bots page, where the Assistant is the first contact. It is
// the same `Thread` a bot's page uses, because it is the same loop: one
// conversation record, one composer, one voice — this one happens to be the
// orchestrator's.

import { useEffect, useState } from 'react'
import { aiw } from '../../lib/aiw'
import { Thread } from './Thread'

export function AssistantThread() {
  const [id, setId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    void aiw
      .conversations()
      .then(async (list) => {
        // Its own thread is the one that is nobody's room: no bot, no feature,
        // no node. Made on first visit rather than left as an empty surface.
        const mine = list.find((c) => !c.bot_node && !c.feature && !c.node)
        setId(mine ? mine.id : (await aiw.newConversation()).id)
      })
      .catch((e) => setErr(String(e)))
  }, [])

  if (err) {
    return <div className="p-5 text-[12px] text-err">{err}</div>
  }
  if (!id) {
    return <div className="py-8 text-center text-[12px] text-muted">Opening the thread…</div>
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="shrink-0 border-b border-line px-5 py-3">
        <div className="text-[14px] font-semibold text-ink">Assistant</div>
        <div className="text-[10.5px] text-muted">
          The orchestrator. It can put an agent on a feature and leave a bot behind, and it asks
          before anything that changes your machine.
        </div>
      </div>
      <div className="min-h-0 flex-1 px-5 py-3">
        <Thread
          reloadKey={id}
          load={() => aiw.conversation(id)}
          send={(text) => aiw.sendMessage(id, text)}
          name="Assistant"
          placeholder="Ask the assistant…"
          footnote="Conversations and anything it remembers are kept outside every repository."
        />
      </div>
    </div>
  )
}
