import { useEffect, useRef, useState } from 'react'
import { Mic, MessageSquare, VolumeX, Settings2 } from 'lucide-react'
import { createLocalSpeechInput } from '../../lib/local-speech-input'
import { savedVoiceModels } from '../../lib/voice-cache'
import '../../../mobile/voice-client.js'
import { aiw } from '../../lib/aiw'
import { useOrbPreferences } from '../../lib/orb/preferences'
import type { OrbMode } from '../../lib/orb-engine.js'
import { useApp } from '../../store'
import { OrbStage } from './OrbStage'
export function DesktopDev({ conversationId, onChat }: { conversationId: string; onChat: () => void }) {
  const { value: preferences, error: preferencesError } = useOrbPreferences()
  const [mode,setMode]=useState<OrbMode>('idle')
  const [caption,setCaption]=useState('')
  const [reply,setReply]=useState('')
  const [error,setError]=useState('')
  const [muted,setMuted]=useState(false)
  const [supported,setSupported]=useState(false)
  const [ready,setReady]=useState(false)
  const [setupBusy,setSetupBusy]=useState(true)
  const [setupStatus,setSetupStatus]=useState('Checking saved voice…')
  const setup=useRef<(restoring?:boolean)=>Promise<void>>(async()=>{})
  const [draft,setDraft]=useState('')
  const [sending,setSending]=useState(false)
  const [inputStatus,setInputStatus]=useState('Microphone · local English transcription')
  const [inputBusy,setInputBusy]=useState(false)
  const download=useRef<HTMLButtonElement>(null),status=useRef<HTMLSpanElement>(null)
  const input=useRef<ReturnType<typeof createLocalSpeechInput> | null>(null)
  const voice=useRef<ReturnType<typeof createOfflineVoice> | null>(null)
  const mutedRef=useRef(false)
  const submit=useRef<(text:string)=>Promise<void>>(async()=>{})
  useEffect(()=>{
    if(!download.current||!status.current)return
    let alive=true, pending=0, tail=Promise.resolve(), setupStage=''
    setReady(false);setSetupBusy(true);setSetupStatus('Checking saved voice…')
    const idle=()=>{if(alive)setMode(pending?'thinking':'idle')}
    const player=createOfflineVoice({button:download.current,status:status.current,onPreparing:()=>{if(alive)setMode('preparing')},onSpeaking:()=>{if(alive)setMode('speaking')},onIdle:idle,onChange:()=>queueMicrotask(()=>{if(alive && setupStage==='speaker')setSetupStatus('Speaker · '+(status.current?.textContent || 'Preparing…'))})})
    voice.current=player
    const sendText=(text:string)=>{
      pending++;setMode('thinking');setError('')
      tail=tail.then(async()=>{
        if(!alive)return
        try {
          // The same conversation command used by the existing typed Thread.
          await aiw.sendMessage(conversationId,text)
          if(!alive)return
          const conversation=await aiw.conversation(conversationId)
          const last=[...conversation.messages].reverse().find(m=>m.from==='assistant'&&!m.tool)
          if(last){setReply(last.text);if(!mutedRef.current&&player.isReady())await player.speak(last.text);else if(!player.isReady())setError('Set up voice to hear Dev’s replies. Your text reply is below.')}
        }catch(e){if(alive)setError(String(e))}finally{pending--;if(alive&&player.canSpeak())idle()}
      })
      return tail
    }
    submit.current=sendText
    const capture=createLocalSpeechInput({
      onState:state=>{if(alive){setInputBusy(state==='starting'||state==='transcribing');setMode(state==='starting'?'connecting':state==='listening'?'listening':state==='transcribing'?'thinking':pending?'thinking':'idle')}},
      onCaption:text=>{if(alive)setCaption(text)},
      onStatus:text=>{if(alive){setInputStatus(text);if(setupStage==='microphone')setSetupStatus(text)}},
      onError:message=>{if(alive)setError(message)},
      onText:sendText,
    })
    input.current=capture;setSupported(capture.supported)
    const prepareVoice=async(restoring=false)=>{
      if(setupStage)return
      setSetupBusy(true);setMode('preparing');setError('');setupStage='microphone'
      setSetupStatus(restoring?'Loading saved microphone model…':'Setting up microphone · 1 of 2…')
      try {
        await capture.prepare();if(!alive)return
        setupStage='speaker';setSetupStatus(restoring?'Loading saved speaker model…':'Setting up speaker · 2 of 2…')
        await player.prepare();if(!alive)return
        setReady(true);setSetupStatus('Voice ready · microphone and speaker');setInputStatus('Tap the orb to speak · local English transcription')
      }catch(e){if(alive){setReady(false);setError(e instanceof Error?e.message:String(e));setSetupStatus('Setup incomplete · retry to continue')}}
      finally{setupStage='';if(alive){setSetupBusy(false);setMode('idle')}}
    }
    setup.current=prepareVoice
    void savedVoiceModels().then(saved=>{
      if(!alive)return
      if(saved.microphone&&saved.speaker)void prepareVoice(true)
      else {setSetupBusy(false);setSetupStatus(saved.microphone||saved.speaker?'Finish voice setup · saved files will be reused':'One setup for listening and speaking · internet needed once')}
    }).catch(()=>{if(alive){setSetupBusy(false);setSetupStatus('Set up voice to enable listening and speaking')}})
    return ()=>{alive=false;setup.current=async()=>{};capture.dispose();player.dispose();input.current=null;voice.current=null;submit.current=async()=>{}}
  },[conversationId])
  const start=()=>{
    const capture=input.current;if(!capture||setupBusy)return
    if(!ready){void setup.current();return}
    if(capture.state()==='starting'||capture.state()==='transcribing'){capture.cancel();setInputStatus('Microphone stopped · tap to try again');return}
    if(capture.state()==='listening'){capture.finish();return}
    voice.current?.stop();void voice.current?.unlock().catch(e=>setError(String(e)));setError('');capture.start()
  }
  const mute=()=>{const next=!mutedRef.current;mutedRef.current=next;setMuted(next);if(next)voice.current?.stop()}
  const sendDraft=async()=>{const text=draft.trim();if(!text||sending)return;setSending(true);setDraft('');input.current?.cancel();voice.current?.stop();try{await voice.current?.unlock().catch(e=>setError(String(e)));await submit.current(text)}finally{setSending(false)}}
  return <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto rounded-2xl bg-[#0c0e15] px-6 py-8 text-[#eee9fa]">
    <div className="flex w-full max-w-2xl items-center justify-between"><span className="text-[11px] uppercase tracking-[.18em] text-[#a49cb8]">DEV · VOICE</span><button className="rounded-lg p-2 text-[#cbb7ed]" aria-label="Orb settings" onClick={()=>{useApp.getState().setSettingsTab('deck');useApp.getState().setRailView('settings')}}><Settings2 size={18}/></button></div>
    <h2 className="mt-8 text-3xl font-semibold">Dev</h2>
    <OrbStage mode={mode} preferences={preferences} level={()=>mode==='listening'?input.current?.level()||0:voice.current?.level()||0} onActivate={start} disabled={!supported||setupBusy}/>
    <p aria-live="polite" className="min-h-7 max-w-xl text-center text-[13px] text-[#9de2d9]">{caption}</p>
    <div className="my-5 flex items-center gap-5"><button aria-label="Show chat" onClick={onChat} className="rounded-full border border-[#524760] p-3"><MessageSquare size={20}/></button><button onClick={start} disabled={!supported||setupBusy} aria-label={mode==='listening'?'Finish listening':inputBusy?'Cancel voice input':'Start voice input'} aria-pressed={mode==='listening'} className={`rounded-full border-2 p-5 ${mode==='listening'?'border-emerald-300 bg-emerald-500/20':'border-violet-400 bg-violet-500/20'}`}><Mic size={28}/></button><button aria-label={muted?'Enable spoken replies':'Mute spoken replies'} aria-pressed={muted} onClick={mute} className={`rounded-full border p-3 ${muted?'border-rose-400 bg-rose-500/15':'border-[#524760]'}`}><VolumeX size={20}/></button></div>
    <div hidden aria-hidden="true"><button ref={download} tabIndex={-1}>Speaker setup</button><span ref={status}/></div>
    <div className="flex flex-col items-center gap-2 text-[11px] text-[#afa3c4]"><button disabled={setupBusy||ready} onClick={()=>void setup.current()} className="rounded-full border border-[#635376] px-4 py-2 disabled:opacity-60">{setupBusy?'Preparing voice…':ready?'Voice ready':'Set up voice'}</button><span role="status" aria-live="polite">{setupStatus}</span></div>
    {!setupBusy && <p role="status" aria-live="polite" className="mt-3 text-center text-[11px] text-[#afa3c4]">{supported ? ready ? inputStatus : 'Set up voice once to enable the microphone and speaker.' : 'Microphone recording is unavailable. You can type below.'}</p>}

    {(error||preferencesError)&&<p role="alert" className="mt-4 max-w-xl text-center text-[12px] text-[#edbdcb]">{error||preferencesError}</p>}
    <form className="mt-4 flex w-full max-w-xl items-center gap-2" onSubmit={e=>{e.preventDefault();void sendDraft()}}>
      <input aria-label="Message Dev in voice view" className="min-w-0 flex-1 rounded-xl border border-[#635376] bg-[#191522] px-3 py-3 text-[13px] text-[#eee9fa]" placeholder="Type a message…" value={draft} onChange={e=>setDraft(e.target.value)}/>
      <button type="submit" disabled={sending||!draft.trim()} className="rounded-xl border border-violet-400 px-4 py-3 text-[13px] disabled:opacity-40">{sending?'Sending…':'Send'}</button>
    </form>
    {reply&&<p className="mt-5 max-w-2xl whitespace-pre-wrap text-[13px] leading-relaxed text-[#ccc1dc]">{reply}</p>}
  </div>
}
