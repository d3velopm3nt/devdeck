import { useEffect, useRef, useState } from 'react'
import { Mic, MessageSquare, VolumeX, Settings2 } from 'lucide-react'
import '../../lib/voice-input.js'
import '../../../mobile/voice-client.js'
import { aiw } from '../../lib/aiw'
import { useOrbPreferences } from '../../lib/orb/preferences'
import type { OrbMode } from '../../lib/orb-engine.js'
import { useApp } from '../../store'
import { DevOrb } from './DevOrb'
const labels: Record<OrbMode,string>={idle:'Ready when you are',connecting:'Starting microphone…',listening:'Listening…',thinking:'Thinking…',preparing:'Preparing voice…',speaking:'Speaking…',offline:'Disconnected'}
export function DesktopDev({ conversationId, onChat }: { conversationId: string; onChat: () => void }) {
  const { value: preferences, error: preferencesError } = useOrbPreferences()
  const [mode,setMode]=useState<OrbMode>('idle')
  const [caption,setCaption]=useState('')
  const [reply,setReply]=useState('')
  const [error,setError]=useState('')
  const [muted,setMuted]=useState(false)
  const [supported,setSupported]=useState(false)
  const [ready,setReady]=useState(false)
  const download=useRef<HTMLButtonElement>(null),status=useRef<HTMLSpanElement>(null)
  const input=useRef<ReturnType<typeof DevVoiceInput.create> | null>(null)
  const voice=useRef<ReturnType<typeof createOfflineVoice> | null>(null)
  const mutedRef=useRef(false)
  useEffect(()=>{
    if(!download.current||!status.current)return
    let alive=true, pending=0, tail=Promise.resolve()
    const idle=()=>{if(alive)setMode(pending?'thinking':'idle')}
    const player=createOfflineVoice({button:download.current,status:status.current,onPreparing:()=>{if(alive)setMode('preparing')},onSpeaking:()=>{if(alive)setMode('speaking')},onIdle:idle,onChange:()=>queueMicrotask(()=>{if(alive)setReady(player.isReady())})})
    voice.current=player
    const capture=DevVoiceInput.create({onState:state=>{if(alive)setMode(state==='starting'?'connecting':state==='listening'?'listening':pending?'thinking':'idle')},onCaption:text=>{if(alive)setCaption(text)},onError:message=>{if(alive)setError(message)},onText:text=>{
      pending++;setMode('thinking');setError('')
      tail=tail.then(async()=>{
        if(!alive)return
        try {
          // The same conversation command used by the existing typed Thread.
          await aiw.sendMessage(conversationId,text)
          if(!alive)return
          const conversation=await aiw.conversation(conversationId)
          const last=[...conversation.messages].reverse().find(m=>m.from==='assistant'&&!m.tool)
          if(last){setReply(last.text);if(!mutedRef.current&&player.isReady())await player.speak(last.text);else if(!player.isReady())setError('Download voice to hear Dev’s replies. Your text reply is below.')}
        }catch(e){if(alive)setError(String(e))}finally{pending--;if(alive&&player.canSpeak())idle()}
      })
      return tail
    }})
    input.current=capture;setSupported(capture.supported)
    return ()=>{alive=false;capture.dispose();player.dispose();input.current=null;voice.current=null}
  },[conversationId])
  const start=()=>{
    const capture=input.current;if(!capture)return
    if(capture.state()==='starting'){capture.cancel();return}
    if(capture.state()==='listening'){capture.finish();return}
    voice.current?.stop();void voice.current?.unlock().catch(e=>setError(String(e)));setError('');capture.start()
  }
  const mute=()=>{const next=!mutedRef.current;mutedRef.current=next;setMuted(next);if(next)voice.current?.stop()}
  return <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto rounded-2xl bg-[#0c0e15] px-6 py-8 text-[#eee9fa]">
    <div className="flex w-full max-w-2xl items-center justify-between"><span className="text-[11px] uppercase tracking-[.18em] text-[#a49cb8]">DEV · VOICE</span><button className="rounded-lg p-2 text-[#cbb7ed]" aria-label="Orb settings" onClick={()=>{useApp.getState().setSettingsTab('deck');useApp.getState().setRailView('settings')}}><Settings2 size={18}/></button></div>
    <h2 className="mt-8 text-3xl font-semibold">Dev</h2>
    <button onClick={start} disabled={!supported} aria-label={mode==='listening'?'Finish listening':'Talk to Dev'} className="mt-2 rounded-full focus-visible:outline-2 focus-visible:outline-violet-400"><DevOrb mode={mode} preferences={preferences} level={()=>voice.current?.level()||0}/></button>
    <p role="status" className="mb-4 text-[15px] text-[#d7c5ee]">{labels[mode]}</p>
    <p aria-live="polite" className="min-h-7 max-w-xl text-center text-[13px] text-[#9de2d9]">{caption}</p>
    <div className="my-5 flex items-center gap-5"><button aria-label="Show chat" onClick={onChat} className="rounded-full border border-[#524760] p-3"><MessageSquare size={20}/></button><button onClick={start} disabled={!supported} aria-label={mode==='listening'?'Finish listening':'Start voice input'} aria-pressed={mode==='listening'} className={`rounded-full border-2 p-5 ${mode==='listening'?'border-emerald-300 bg-emerald-500/20':'border-violet-400 bg-violet-500/20'}`}><Mic size={28}/></button><button aria-label={muted?'Enable spoken replies':'Mute spoken replies'} aria-pressed={muted} onClick={mute} className={`rounded-full border p-3 ${muted?'border-rose-400 bg-rose-500/15':'border-[#524760]'}`}><VolumeX size={20}/></button></div>
    <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-[#afa3c4]"><button ref={download} className="rounded-full border border-[#635376] px-3 py-2">Download voice</button><span ref={status}>Download once for local speech.</span></div>
    <p className="mt-3 text-[11px] text-[#afa3c4]">{ready?'Local voice ready · automatic replies':supported?'Browser voice input uses your browser’s speech service.':'Speech recognition is unavailable in this WebView. Use the chat view.'}</p>
    {(error||preferencesError)&&<p role="alert" className="mt-4 max-w-xl text-center text-[12px] text-[#edbdcb]">{error||preferencesError}</p>}
    {reply&&<p className="mt-5 max-w-2xl whitespace-pre-wrap text-[13px] leading-relaxed text-[#ccc1dc]">{reply}</p>}
  </div>
}
