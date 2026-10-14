// Dev’s shared conversation, opened from Chat or any assistant shortcut.
// Text and voice use the same conversation record.

import { useEffect, useState } from 'react'
import { aiw } from '../../lib/aiw'
import { Mic, MessageSquare } from 'lucide-react'
import { DesktopDev } from '../orb/DesktopDev'
import { Thread } from './Thread'

export function AssistantThread() {
  const [id, setId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [voiceView, setVoiceView] = useState(false)
  const [revision, setRevision] = useState(0)
  const showChat = () => { setVoiceView(false); setRevision(value => value + 1) }

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
        <div className="flex items-center justify-between gap-3">
          <div><h1 className="text-[14px] font-semibold text-ink">Chat</h1><p className="text-[11px] text-muted">Dev · your assistant</p></div>
          <button className="btn-ghost flex items-center gap-2" aria-pressed={voiceView} aria-controls="dev-conversation-view" onClick={()=>voiceView?showChat():setVoiceView(true)}>
            {voiceView?<MessageSquare size={16} aria-hidden="true"/>:<Mic size={16} aria-hidden="true"/>}
            {voiceView?'Show chat':'Talk to Dev'}
          </button>
        </div>

      </div>
      <div id="dev-conversation-view" className="min-h-0 flex-1 px-5 py-3" hidden={voiceView}>
        <Thread
          reloadKey={`${id}:${revision}`}
          load={() => aiw.conversation(id)}
          send={(text) => aiw.sendMessage(id, text)}
          name="Dev"
          placeholder="Message Dev…"
          footnote="Conversations and anything it remembers are kept outside every repository."
        />
      </div>
      {voiceView&&<div className="min-h-0 flex-1 p-4"><DesktopDev conversationId={id} onChat={showChat}/></div>}
    </div>
  )
}
