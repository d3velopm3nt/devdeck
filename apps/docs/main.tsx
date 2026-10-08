import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import pages from './navigation.json'
import './style.css'
import workflowGuide from '../../docs/FOLDER-WORKFLOWS.md?raw'
const content = import.meta.glob('./content/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (slug: string) => slug === 'workflows' ? workflowGuide : content[`./content/${slug}.md`] ?? ''
const current = () => decodeURIComponent(location.hash.slice(1)) || 'welcome'
function App() {
  const [slug, setSlug] = useState(current)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('devdeck-docs-theme') === 'dark')
  useEffect(() => { const change = () => { setSlug(current()); setOpen(false); window.scrollTo(0, 0) }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('devdeck-docs-theme', dark ? 'dark' : 'light') }, [dark])
  const page = pages.find(p => p.slug === slug)
  useEffect(() => { document.title = `${page?.title ?? 'Page not found'} · DevDeck Docs` }, [page])
  const filtered = pages.filter(p => `${p.title} ${read(p.slug)}`.toLowerCase().includes(query.toLowerCase()))
  const headings = read(slug).split('\n').filter(line => line.startsWith('## ')).map(line => line.slice(3))
  const index = pages.findIndex(p => p.slug === slug)
  return <><header><a className="brand" href="#welcome"><span className="logo">❯_</span> DevDeck <span className="docs">/ Docs</span></a><div className="header-actions"><span className="edition">FIRST EDITION</span><a href="https://github.com/d3velopm3nt/devdeck">GitHub ↗</a><button aria-label="Toggle colour theme" onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</button><button className="mobile" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button></div></header><div className="layout"><aside className={`sidebar ${open ? 'open' : ''}`}><label className="search"><span>⌕</span><input aria-label="Search documentation" placeholder="Search documentation…" value={query} onChange={e => setQuery(e.target.value)} /></label><nav aria-label="Documentation">{['Start here','Tools','Agents & workflows','Reference'].map(group => <section key={group}><h2>{group}</h2>{filtered.filter(p => p.group === group).map(p => <a key={p.slug} href={`#${p.slug}`} aria-current={slug === p.slug ? 'page' : undefined}>{p.title}</a>)}</section>)}{filtered.length === 0 && <p className="empty">No guides found. Try “worker” or “mail”.</p>}</nav><div className="sidebar-note">Your work. Your files.<br/><strong>One place to keep moving.</strong></div></aside><main id="main"><div className="crumb">Documentation <span>/</span> {page?.group ?? 'Not found'}</div>{slug === 'welcome' && <div className="eyebrow">THE DEVDECK HANDBOOK</div>}<article><Markdown remarkPlugins={[remarkGfm]}>{page ? read(slug) : '# Page not found\n\n[Return to the documentation](#welcome).'}</Markdown></article>{slug === 'welcome' && <div className="cards">{[['workflows','Build a workflow','Turn a folder into clear, reviewable steps.'],['tools','Explore your tools','Find the right capability for the job.']].map(([id,title,desc]) => <a href={`#${id}`} key={id}><span>↗</span><strong>{title}</strong><p>{desc}</p></a>)}</div>}<footer><span>DevDeck documentation · First edition</span><a href="https://github.com/d3velopm3nt/devdeck/issues">Suggest a correction ↗</a></footer>{page && <div className="pagination">{index > 0 ? <a href={`#${pages[index-1].slug}`}>← {pages[index-1].title}</a> : <span/>}{index < pages.length-1 && <a href={`#${pages[index+1].slug}`}>{pages[index+1].title} →</a>}</div>}</main><aside className="outline"><h2>ON THIS PAGE</h2>{headings.map((h,i) => <button key={i} onClick={() => document.querySelectorAll('article h2')[i]?.scrollIntoView({behavior:'smooth',block:'start'})}>{h}</button>)}<div className="outline-note">Built around readable files.<br/>Refined as DevDeck grows.</div></aside></div></>
}
createRoot(document.getElementById('root')!).render(<App />)
