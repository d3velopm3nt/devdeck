import {createRoot} from 'react-dom/client'
import {ThemeSwitch} from '../src/shell/ThemeSwitch'
import {useApp} from '../src/store'
import {themeById} from '../src/lib/themes'
import {SEED} from './seed'
import '../src/index.css'
declare global { interface Window { __appearanceFail: boolean } }
window.__appearanceFail=false
;(SEED as Record<string,(args?:Record<string,unknown>)=>unknown>).setting_set=args=>{if(window.__appearanceFail)throw Error('Fixture save failure');localStorage.setItem(String(args?.key),String(args?.value))}
const theme=themeById(localStorage.getItem('app_theme')).id
useApp.setState({theme});document.documentElement.dataset.theme=theme
createRoot(document.getElementById('root')!).render(<main style={{height:'100vh',background:'var(--c-page)',color:'var(--c-ink)'}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 16px',borderBottom:'1px solid var(--c-line)'}}><strong>DevDeck</strong><ThemeSwitch/></header><p style={{padding:20,fontSize:12,color:'var(--c-dim)'}}>Appearance preview · fixture data</p><button style={{margin:20}} id="outside-action">Outside action</button></main>)
