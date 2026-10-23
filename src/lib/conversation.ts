import {invoke} from '@tauri-apps/api/core'
import type {AssistantReply,ConversationMeta} from './aiw'
export interface ContextInput {kind:'file'|'folder-file'|'image'|'link';name:string;text:string}
export interface ConversationInput {text:string;context:ContextInput[];skills:string[]}
export interface ConversationSettings {conversation:string;agent_id:string;provider:string;model:string;revision:number;scope:string;capabilities:string[]}
export const conversationApi={
  settings:(conversation:string)=>invoke<ConversationSettings>('chat_settings',{conversation}),
  select:(conversation:string,expected:number,provider:string|null,model:string|null)=>invoke<ConversationSettings>('chat_select_model',{conversation,expected,provider,model}),
  send:(conversation:string,input:ConversationInput)=>invoke<AssistantReply>('chat_send_input',{conversation,input}),
  manager:(handle:string)=>invoke<ConversationMeta>('chat_open_manager',{handle}),
}

export function privateContextName(name:string){return name.split(/[\\/]/).some(p=>p==='..'||/^(\.git|\.ssh|\.aws|\.azure|\.config|\.npmrc|\.pypirc|\.netrc|node_modules|\.env.*|id_rsa|id_ed25519)$/i.test(p)||/credential|secret|\.(pem|key)$/i.test(p))}
export async function textContext(files:File[],folder=false):Promise<{parts:ContextInput[];excluded:string[]}>{
  const excluded:string[]=[],parts:ContextInput[]=[];let size=0
  for(const file of files){const name=file.webkitRelativePath||file.name
    if(privateContextName(name)){excluded.push(name);continue}
    if(name.split('/').length>5)throw Error('Folder context is limited to four nested levels. Choose a smaller folder.')
    if(file.type.startsWith('image/')){parts.push({kind:'image',name,text:''});continue}
    if(file.size>65536)throw Error(`${name}: text files are limited to 64 KiB`)
    const text=await file.text();size+=new TextEncoder().encode(text).length
    if(text.includes('\0')||text.includes('-----BEGIN ')||/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})/.test(text))throw Error(`${name}: binary/private-key content cannot be attached`)
    if(size>131072)throw Error('Context is limited to 128 KiB; choose fewer files')
    parts.push({kind:folder?'folder-file':'file',name,text})
    if(parts.length>16)throw Error('Select at most 16 context files')
  }
  return{parts,excluded}
}
