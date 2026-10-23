import {Check,ChevronDown,Cpu,ExternalLink,LoaderCircle,RotateCcw,SlidersHorizontal,X,Cable} from 'lucide-react'
import {openAgentSettings} from '../../lib/dock'
import {useEffect,useState,useRef} from 'react'
import {conversationApi,type ConversationSettings} from '../../lib/conversation'
import {useProviders,withCurrent} from '../../lib/providers'
import {ModelPicker} from '../aiw/ModelPicker'
import {Mark} from '../aiw/providerDefs'
import {BrandIcon} from '../BrandIcon'

function ProviderMark({id}:{id:string}){
  if(/openai|chatgpt|codex/.test(id))return <BrandIcon brand="openai" size={17}/>
  if(/claude|anthropic/.test(id))return <Mark id="anthropic" size={17}/>
  if(['openrouter','nvidia','ollama','lmstudio'].includes(id))return <Mark id={id} size={17}/>
  return <Cable size={17} aria-hidden="true"/>
}

export function ConversationModel({id,busy=false,readOnly=false}:{id:string;busy?:boolean;readOnly?:boolean}){
  const [value,setValue]=useState<ConversationSettings>(),[error,setError]=useState(''),[open,setOpen]=useState(false),[provider,setProvider]=useState(''),[model,setModel]=useState(''),[saving,setSaving]=useState(false)
  const trigger=useRef<HTMLButtonElement>(null),root=useRef<HTMLDivElement>(null),providerSelect=useRef<HTMLSelectElement>(null),currentId=useRef(id)
  currentId.current=id
  const providers=useProviders(),options=withCurrent(providers,provider),providerName=(key:string)=>providers.find(([p])=>p===key)?.[1]||key
  const close=(focus=true)=>{setOpen(false);if(focus)requestAnimationFrame(()=>trigger.current?.focus())}
  useEffect(()=>{let live=true;setValue(undefined);setOpen(false);setError('');const load=()=>{if(id)void conversationApi.settings(id).then(v=>{if(live){if(!v?.provider)throw Error('Conversation settings are unavailable');setValue(v);setProvider(v.provider);setModel(v.model)}}).catch(e=>{if(live)setError(String(e))})};load();const updated=(event:Event)=>{if((event as CustomEvent).detail===id)load()};window.addEventListener('devdeck:conversation-model',updated);return()=>{live=false;window.removeEventListener('devdeck:conversation-model',updated)}},[id,busy])
  useEffect(()=>{if(!open)return;providerSelect.current?.focus();const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target))setOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[open])
  const save=async(defaults=false)=>{if(!value)return;const target=id;setSaving(true);setError('');try{const v=await conversationApi.select(id,value.revision,defaults?null:provider,defaults?null:model);if(currentId.current!==target)return;setValue(v);window.dispatchEvent(new CustomEvent('devdeck:conversation-model',{detail:id}));close()}catch(e){if(currentId.current===target)setError(String(e))}finally{if(currentId.current===target)setSaving(false)}}
  if(readOnly)return <div aria-label="Effective conversation model" className="text-xs text-dim">{value?`${value.provider} · ${value.model} · next message`:error||'Loading conversation model.'}</div>
  return <div ref={root} className="conversation-model" onKeyDown={e=>{if(open&&e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}}}>
    <button ref={trigger} className="conversation-model-trigger" disabled={!value||busy} onClick={()=>{setProvider(value!.provider);setModel(value!.model);setOpen(!open)}} aria-expanded={open} aria-label="Conversation provider and model" title="Provider and model for the next message in this conversation"><SlidersHorizontal size={13} aria-hidden="true"/><span>{value?`${value.provider} · ${value.model} · next message`:'Conversation model unavailable'}</span><ChevronDown size={12} aria-hidden="true"/></button>
    {!open&&error&&<p role="alert" className="text-err text-xs">{error}</p>}
    {open&&<section className="conversation-model-panel" aria-label="Conversation model settings">
      <header className="conversation-model-title"><span className="conversation-model-title-icon"><SlidersHorizontal size={17} aria-hidden="true"/></span><div><h3>Conversation model</h3><p>Choose what answers the next message</p></div><button type="button" aria-label="Close model settings" title="Close model settings" onClick={()=>close()}><X size={16} aria-hidden="true"/></button></header>
      <div className="conversation-model-current"><Check size={13} aria-hidden="true"/><span><strong>Current</strong> {providerName(value?.provider||'')} · {value?.model}</span><span className="conversation-model-scope">{value?.scope==='conversation'?'This chat':'Inherited'}</span></div>
      <fieldset disabled={busy||saving} className="conversation-model-fields">
        <label className="conversation-provider-field"><span className="conversation-model-label"><ProviderMark id={provider}/><span>Provider</span></span><select ref={providerSelect} aria-label="Conversation provider" className="input w-full" value={provider} onChange={e=>{setProvider(e.target.value);setModel('');setError('')}}>{options.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
        <div className="conversation-model-field"><span className="conversation-model-label"><Cpu size={16} aria-hidden="true"/><span>Model</span></span><ModelPicker key={provider} label="Conversation model" providerId={provider} value={model} onChange={setModel}/></div>
      </fieldset>
      <p className="conversation-model-note">Applies to this chat's next message. History, active runs and agent defaults stay unchanged.</p>
      {error&&<p role="alert" className="conversation-model-error">{error}</p>}
      <div className="conversation-model-actions"><button className="btn-ghost" disabled={saving} onClick={()=>close()}>Cancel</button><button className="btn-primary" disabled={saving||busy||!provider||!model.trim()} onClick={()=>void save()}>{saving?<LoaderCircle size={14} aria-hidden="true"/>:<Check size={14} aria-hidden="true"/>}Use for this chat</button></div>
      <footer className="conversation-model-defaults"><button className="btn-ghost" disabled={saving||busy} onClick={()=>void save(true)}><RotateCcw size={13} aria-hidden="true"/>Use agent defaults for next message</button><button className="btn-ghost" disabled={saving||busy} onClick={()=>{close(false);if(value)openAgentSettings(value.agent_id)}}><ExternalLink size={13} aria-hidden="true"/>Edit agent defaults…</button></footer>
    </section>}
  </div>
}
