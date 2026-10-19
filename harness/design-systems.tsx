import React from 'react'
import { createRoot } from 'react-dom/client'
import { SEED } from './seed'
import { LibraryPanel } from '../src/components/workers/LibraryPanel'
import design from '../design-systems/supabase.json'
import '../src/index.css'
import type { DesignAssignment } from '../src/lib/ipc'
document.documentElement.style.height = 'auto'
document.body.style.height = 'auto'
document.body.style.overflow = 'visible'
const handlers = SEED as Record<string, (args?: Record<string, unknown>) => unknown>
handlers.library_agents = () => []
handlers.design_systems_list = () => [design]
handlers.tree_list = () => [1,2].map(id => ({id,parent_id:null,kind:'project',name:id===1?'Starter project':'Other project',path:`C:/projects/${id}`,rel_path:`Work/Project-${id}`,dir:`C:/vault/Work/Project-${id}`,sort:id,color:null,label:null}))
const key = (id: unknown) => `design-fixture-${id}`
handlers.design_system_assignment = a => JSON.parse(localStorage.getItem(key(a?.nodeId)) ?? 'null')
handlers.design_system_assign = a => {
  if (localStorage.getItem('design-fixture-fail')) throw new Error('Simulated disk write failure')
  const current = handlers.design_system_assignment(a) as DesignAssignment | null
  if (JSON.stringify(current) !== JSON.stringify(a?.expected)) throw new Error('Design selection changed. Reload before saving.')
  const value = {design_id:a?.designId,version:a?.designId?1:0,revision:(current?.revision??0)+1}
  localStorage.setItem(key(a?.nodeId),JSON.stringify(value)); return value
}
createRoot(document.getElementById('root')!).render(<div className="workforce" style={{minHeight:'100vh',height:'auto'}}><main className="wf-content" style={{overflow:'visible',flex:'none'}}><LibraryPanel items={[]} reload={() => {}} /></main></div>)
