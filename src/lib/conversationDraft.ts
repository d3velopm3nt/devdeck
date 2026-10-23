import {create} from 'zustand'
import type {ContextInput} from './conversation'
export type ConversationSelection={context:ContextInput[];skills:string[]}
export const EMPTY_SELECTION:ConversationSelection={context:[],skills:[]}
// Deliberately memory-only: selecting a file never copies its body to browser storage.
export const useConversationSelection=create<{byId:Record<string,ConversationSelection>;put:(id:string,value:ConversationSelection)=>void}>(set=>({byId:{},put:(id,value)=>set(s=>({byId:{...s.byId,[id]:value}}))}))
