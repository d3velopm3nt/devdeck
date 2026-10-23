import {openAgentSettings} from '../../lib/dock'
import {useEffect,useState,useRef} from 'react'
import {conversationApi,type ConversationSettings} from '../../lib/conversation'
import {useProviders,withCurrent} from '../../lib/providers'
import {ModelPicker} from '../aiw/ModelPicker'

export function ConversationModel({id,busy=false,readOnly=false}:{id:string;busy?:boolean;readOnly?:boolean}){
  const [value,setValue]=useState<ConversationSettings>(),[error,setError]=useState(''),[open,setOpen]=useState(false),[provider,setProvider]=useState(''),[model,setModel]=useState(''),[saving,setSaving]=useState(false)
  const trigger=useRef<HTMLButtonElement>(null)
  const providers=useProviders()
  useEffect(()=>{let live=true;setValue(undefined);setOpen(false);setError('');const load=()=>{if(id)void conversationApi.settings(id).then(v=>{if(live){if(!v?.provider)throw Error('Conversation settings are unavailable');setValue(v);setProvider(v.provider);setModel(v.model)}}).catch(e=>{if(live)setError(String(e))})};load();const updated=(event:Event)=>{if((event as CustomEvent).detail===id)load()};window.addEventListener('devdeck:conversation-model',updated);return()=>{live=false;window.removeEventListener('devdeck:conversation-model',updated)}},[id,busy])
  const save=async(defaults=false)=>{if(!value)return;setSaving(true);setError('');try{const v=await conversationApi.select(id,value.revision,defaults?null:provider,defaults?null:model);setValue(v);window.dispatchEvent(new CustomEvent('devdeck:conversation-model',{detail:id}));setOpen(false);requestAnimationFrame(()=>trigger.current?.focus())}catch(e){setError(String(e))}finally{setSaving(false)}}
  if(readOnly)return <div aria-label="Effective conversation model" className="text-xs text-dim">{value?`${value.provider} · ${value.model} · next message`:error||'Loading conversation model…'}</div>
  return <div className="conversation-model"><button ref={trigger} className="btn-ghost" disabled={!value||busy} onClick={()=>{setProvider(value!.provider);setModel(value!.model);setOpen(!open)}} aria-expanded={open} aria-label="Conversation provider and model">{value?`${value.provider} · ${value.model} · next message`:'Conversation model unavailable'}</button>
    {error&&<p role="alert" className="text-err text-xs">{error}</p>}
    {open&&<section className="rounded border border-line bg-panel p-3 space-y-2" aria-label="Conversation model settings" onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}}}><p className="text-xs text-dim">{value?.scope}. Changes apply to the next message in this conversation. History, active runs and agent defaults remain unchanged.</p><label className="block text-xs">Provider<select aria-label="Conversation provider" className="input w-full" value={provider} onChange={e=>{setProvider(e.target.value);setModel('')}}>{withCurrent(providers,provider).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><ModelPicker providerId={provider} value={model} onChange={setModel} compact/><div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={saving||busy||!provider||!model.trim()} onClick={()=>void save()}>Use for this chat</button><button className="btn-ghost" disabled={saving||busy} onClick={()=>void save(true)}>Use agent defaults for next message</button><button className="btn-ghost" onClick={()=>{setOpen(false);trigger.current?.focus()}}>Cancel</button><button className="btn-ghost" onClick={()=>value&&openAgentSettings(value.agent_id)}>Edit agent defaults…</button></div></section>}
  </div>
}
