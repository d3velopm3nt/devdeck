import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { FilterTabs, StateBadge, TabStrip } from '../src/components/ui/DesignSystem'
const states = ['open','running','planning','queued','review','needs-review','built','blocked','failed','crashed','done','resolved','draft','closed','merged','committed','paused','enabled','unclaimed','unknown']
const typography = [{label:'Page title',size:20,weight:600,text:'Your team, at a glance'},{label:'Card heading',size:16,weight:600,text:'Software Factory'},{label:'Conversation text',size:12.5,weight:400,text:'The plan is ready for review. Approve it when you are satisfied.'},{label:'Controls and tabs',size:12,weight:500,text:'Team     Context     Activity'},{label:'Status label',size:11,weight:550,text:'Needs review'},{label:'Small metadata',size:10,weight:400,text:'Updated just now · DevDeck'}]
const themes = [{id:'dark',label:'Dark'},{id:'light',label:'Light'},{id:'claude',label:'Claude'},{id:'vercel',label:'Vercel dark'},{id:'vercel-light',label:'Vercel light'},{id:'vscode',label:'VS Code'}]
const colors = [{token:'page',label:'Page'},{token:'panel',label:'Panel'},{token:'soft',label:'Soft surface'},{token:'line',label:'Border'},{token:'ink',label:'Heading text'},{token:'dim',label:'Secondary text'},{token:'accent',label:'Accent / selection'},{token:'ok',label:'Success / complete'},{token:'warn',label:'Needs review'},{token:'err',label:'Failed / blocked'},{token:'info',label:'Active / new'},{token:'viol',label:'Merged / committed'}]
function Preview() {
 const [filter,setFilter]=useState('all')
 const [tab,setTab]=useState('overview')
 const [editor,setEditor]=useState('team')
 const [theme,setTheme]=useState('dark')
 const [values,setValues]=useState<Record<string,string>>({})
 useEffect(()=>{document.documentElement.dataset.theme=theme;const style=getComputedStyle(document.documentElement);setValues(Object.fromEntries(colors.map(c=>[c.token,style.getPropertyValue(`--c-${c.token}`).trim()])))},[theme])
 return <main style={{padding:24,background:'var(--c-page)',height:'100vh',overflowY:'auto',color:'var(--c-ink)',fontSize:12}}>
  <h1 style={{fontSize:20,fontWeight:600}}>DevDeck design system</h1><p style={{color:'var(--c-dim)',margin:'8px 0 20px'}}>Existing theme tokens, semantic states and shared controls. This gallery uses the application’s real styles.</p>
  <FilterTabs label="Theme" value={theme} onChange={setTheme} options={themes.map(t=>({...t,icon:'layout' as const}))}/>
  <section aria-label="Color palette" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,margin:'24px 0'}}>{colors.map(c=><article key={c.token} style={{border:'1px solid var(--c-line)',borderRadius:8,overflow:'hidden',background:'var(--c-panel)'}}><div style={{height:48,background:`var(--c-${c.token})`,borderBottom:'1px solid var(--c-line)'}}/><div style={{padding:12}}><strong>{c.label}</strong><div style={{marginTop:4,color:'var(--c-dim)',fontSize:11}}>{values[c.token] || `--c-${c.token}`}</div></div></article>)}</section>
  <section aria-label="Typography" style={{margin:'24px 0',borderTop:'1px solid var(--c-line)',paddingTop:20}}>
    <h2 style={{fontSize:14,fontWeight:600}}>Typography</h2>
    <p style={{color:'var(--c-dim)',margin:'8px 0 16px'}}>Segoe UI · system-ui · sans-serif. Representative styles currently used by the application; sizes are still defined across component styles.</p>
    {typography.map(item=><div key={item.label} style={{display:'grid',gridTemplateColumns:'minmax(110px,180px) minmax(0,1fr)',gap:16,padding:'12px 0',borderBottom:'1px solid var(--c-line)',alignItems:'baseline'}}><div style={{color:'var(--c-dim)',fontSize:11}}>{item.label}<br/>{item.size}px · {item.weight}</div><div style={{fontSize:item.size,fontWeight:item.weight,lineHeight:item.label==='Conversation text'?1.65:1.4,overflowWrap:'anywhere',color:item.label==='Small metadata'?'var(--c-dim)':'var(--c-ink)'}}>{item.text}</div></div>)}
    <div style={{display:'grid',gridTemplateColumns:'minmax(110px,180px) minmax(0,1fr)',gap:16,padding:'12px 0',borderBottom:'1px solid var(--c-line)'}}><span style={{color:'var(--c-dim)',fontSize:11}}>Code and paths<br/>11.5px · monospace</span><code className="font-mono" style={{fontSize:11.5,overflowWrap:'anywhere'}}>docs/software-factory-pilot.md</code></div>
    <div style={{display:'flex',gap:24,padding:'16px 0',flexWrap:'wrap'}}><span style={{fontWeight:400}}>Regular 400</span><span style={{fontWeight:500}}>Medium 500</span><span style={{fontWeight:600}}>Semibold 600</span></div>
  </section>
  <h2 style={{fontSize:14,fontWeight:600}}>States</h2>
  <section aria-label="State vocabulary" style={{display:'flex',flexWrap:'wrap',gap:12,padding:'16px 0 24px'}}>{states.map(state=><StateBadge key={state} state={state}/>)}</section>
  <h2 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Shared controls</h2>
  <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:16}}><button className="btn-primary">Primary action</button><button className="btn-ghost">Secondary action</button><button className="btn-primary" disabled>Disabled</button><input className="input" aria-label="Example input" placeholder="Input field"/></div>
  <FilterTabs label="Gallery filters" value={filter} onChange={setFilter} options={[{id:'all',label:'All',icon:'layout'},{id:'attention',label:'Needs you',icon:'view',count:3}]}/>
  <h3 style={{fontSize:12,marginTop:16}}>Underlined view tabs</h3>
  <TabStrip label="Gallery tabs" panelId="gallery-panel" value={tab} onChange={setTab} options={[{id:'overview',label:'Overview',icon:'info'},{id:'activity',label:'Activity',icon:'history'},{id:'settings',label:'Settings',icon:'settings'}]}/>
  <section id="gallery-panel" role="tabpanel" aria-labelledby={'gallery-panel-tab-'+tab} style={{padding:'16px 0',color:'var(--c-dim)'}}>{tab} · Compact spacing: 4 / 8 / 12 / 16 / 24 px. Controls use 6 / 8 px corners and visible keyboard focus.</section>
  <h3 style={{fontSize:12,marginTop:16,marginBottom:8}}>Folder / editor tabs · side-panel artifacts</h3>
  <TabStrip label="Gallery editor tabs" appearance="editor" panelId="editor-gallery-panel" value={editor} onChange={setEditor} options={[{id:'team',label:'Team structure',icon:'context'},{id:'workflow',label:'Workflow',icon:'list'},{id:'notes',label:'Notes',icon:'info'}]}/>
  <section id="editor-gallery-panel" role="tabpanel" aria-labelledby={'editor-gallery-panel-tab-'+editor} style={{padding:'16px 12px',background:'var(--c-panel)',color:'var(--c-dim)'}}>{editor} · Open artifact view. Window, workspace and Dockview tab layouts use their existing components.</section>
 </main>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
