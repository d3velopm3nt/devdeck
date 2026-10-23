import {useApp} from '../../store'
import { DevAvatar } from '../DevAvatar'
// Dev’s shared conversation, opened from Chat or any assistant shortcut.
// Text and voice use the same conversation record.

import { useState } from 'react'
import { useAiw } from '../../lib/aiwStore'
import { Mic, MessageSquare } from 'lucide-react'
import { DesktopDev } from '../orb/DesktopDev'
import { Chat } from '../aiw/Chat'

export function AssistantThread() {
  const conversation = useAiw(s=>s.conversation)
  const id=conversation?.id
  const nodes=useApp(s=>s.nodes)
  const scope=conversation?.bot_handle ? 'Manager: '+conversation.bot_handle : conversation?.node!=null ? 'Scope: '+(nodes.find(n=>n.id===conversation.node)?.name||conversation.title) : 'Dev — your assistant'
  const [voiceView, setVoiceView] = useState(false)
  const showChat = () => { setVoiceView(false); if (id) void useAiw.getState().openConversation(id) }
  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="shrink-0 border-b border-line px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3"><DevAvatar size={38}/><div><h1 className="text-[14px] font-semibold text-ink">Chat</h1><p className="text-[11px] text-muted">{scope}</p></div></div>
          <button className="btn-ghost flex items-center gap-2" disabled={!id} aria-pressed={voiceView} aria-controls="dev-conversation-view" onClick={()=>voiceView?showChat():setVoiceView(true)}>
            {voiceView?<MessageSquare size={16} aria-hidden="true"/>:<Mic size={16} aria-hidden="true"/>}
            {voiceView?'Show chat':'Voice conversation'}
          </button>
        </div>

      </div>
      <div id="dev-conversation-view" className="min-h-0 flex-1" hidden={voiceView}>
        <Chat />
      </div>
      {voiceView&&id&&<div className="min-h-0 flex-1 p-4"><DesktopDev conversationId={id} onChat={showChat}/></div>}
    </div>
  )
}
