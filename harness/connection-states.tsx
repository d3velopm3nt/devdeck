import {createRoot} from 'react-dom/client'
import {ConnectionStatus} from '../src/components/connectors/ConnectionStatus'
import {connectionStates} from '../src/components/connectors/connectionStates'
import type {Connection} from '../src/lib/connectors'
import '../src/index.css'
import '../src/components/connectors/connectors.css'
document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'chatgpt'
createRoot(document.getElementById('root')!).render(<main style={{minHeight:'100vh',padding:24,background:'var(--c-page)'}}><h1 style={{fontSize:24,color:'var(--c-ink)'}}>Connection states</h1><p style={{margin:'8px 0 24px',color:'var(--c-dim)'}}>Fixture data · status previews, no accounts connected</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:16}}>{Object.entries(connectionStates).map(([state,info])=><article className="ds-card" key={state} style={{padding:20,background:'var(--c-panel)'}}><h2 style={{marginBottom:12,color:'var(--c-ink)'}}>Demo connection</h2><ConnectionStatus state={state as Connection['state']}/><p style={{marginTop:12,fontSize:12,color:'var(--c-dim)'}}>{info.detail}</p></article>)}</div></main>)
