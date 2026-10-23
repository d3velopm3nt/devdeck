import {useEffect} from 'react'
import type {TeamTab} from '../../store'

const views=['work','goals','messages','runs','history']
/** Browser back/forward within Work; other application destinations keep their existing navigation. */
export function useWorkViewHistory(view:TeamTab,navigate:(view:TeamTab)=>void) {
  useEffect(()=>{
    const saved=window.history.state?.devdeckWorkView
    if(saved===view)return
    const state={...window.history.state,devdeckWorkView:view}
    if(views.includes(saved))window.history.pushState(state,'')
    else window.history.replaceState(state,'')
  },[view])
  useEffect(()=>{const pop=(event:PopStateEvent)=>{const view=event.state?.devdeckWorkView;if(views.includes(view))navigate(view)};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[navigate])
}
