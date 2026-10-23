import {useState} from 'react'
import * as ipc from '../../lib/ipc'
import {conversationApi} from '../../lib/conversation'
import {useAiw} from '../../lib/aiwStore'
import {useApp} from '../../store'

export function ScopedChat({node,manager,name}:{node?:number;manager?:string;name:string}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  return <div className="space-y-3 p-4"><h2 className="font-semibold">Chat about {name}</h2><p className="text-sm text-dim">Open the existing scoped history in Chat. Its manager context and permissions remain in effect; this does not create a manager.</p><button className="btn-primary" disabled={busy} onClick={()=>{setBusy(true);setError('');void (manager?conversationApi.manager(manager):node!=null?ipc.nodeThread(node):Promise.reject(Error('Conversation scope unavailable'))).then(async conv=>{await useAiw.getState().openConversation(conv.id);if(useAiw.getState().conversation?.id!==conv.id)throw Error('Conversation could not be opened');useApp.getState().setRailView('chat')}).catch(e=>setError(String(e))).finally(()=>setBusy(false))}}>{busy?'Opening…':'Open in Chat'}</button>{error&&<p role="alert" className="text-err">{error}</p>}</div>
}
