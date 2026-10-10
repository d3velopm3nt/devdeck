import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import * as ipc from '../../lib/ipc'
import { visibility } from '../../lib/visibility'
import { useApp } from '../../store'
interface Project { id: string; title: string; url: string }
export function ProductGitHub({ business, product, name, repos, login, onChanged }: { business: number; product: number; name: string; repos: ipc.Repo[]; login: string; onChanged: () => void }) {
  const [repository, setRepository] = useState('')
  const [owner, setOwner] = useState(login)
  const [repoName, setRepoName] = useState(name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-'))
  const [projects, setProjects] = useState<Project[]>([])
  const [projectUrl, setProjectUrl] = useState('')
  const [projectTitle, setProjectTitle] = useState(name)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [projectError, setProjectError] = useState('')
  const [createdRepos, setCreatedRepos] = useState<ipc.Repo[]>([])
  const nodes = useApp(s => s.nodes)
  const folder = nodes.find(n => n.id === product)?.rel_path
  const allRepos = [...repos, ...createdRepos.filter(r => !repos.some(p => p.full_name === r.full_name))]
  useEffect(() => { let live = true; void visibility.snapshot().then(s => { if (!live) return; const p = s.products.find(p => p.folder === folder); if (p) { setRepository(p.repository); setProjectUrl(p.project_url) } }).catch(e => setMessage(String(e))); return () => { live = false } }, [folder])
  const projectOwner = repository.split('/')[0] || owner
  useEffect(() => {
    let live = true; setProjects([]); setProjectError('')
    if (projectOwner) void invoke<Project[]>('product_github_projects', { owner: projectOwner }).then(p => { if (live) setProjects(p) }).catch(e => { if (live) setProjectError(String(e)) })
    return () => { live = false }
  }, [projectOwner])
  const act = async (work: () => Promise<void>) => { setBusy(true); setMessage(''); try { await work() } catch (e) { setMessage(String(e)) } finally { setBusy(false) } }
  return <section className="rounded-xl border border-line bg-panel p-4">
    <h2 className="font-semibold text-ink">{name}</h2>
    <label className="mt-3 block text-sm text-muted">GitHub repository<select aria-label={`${name} repository`} className="input mt-1 w-full" disabled={busy} value={repository} onChange={e => { setRepository(e.target.value); setProjectUrl('') }}><option value="">Choose a repository</option>{allRepos.map(r => <option key={r.full_name} value={r.full_name}>{r.full_name}</option>)}</select></label>
    <details className="mt-3"><summary className="cursor-pointer text-sm text-info">Create a repository</summary><p className="my-2 text-xs text-muted">Creates a private repository on GitHub. You can select it afterwards if a later step fails.</p><label className="block text-sm">Owner<select aria-label={`${name} repository owner`} className="input my-1 w-full" value={owner} onChange={e => setOwner(e.target.value)}>{[...new Set([login, ...allRepos.map(r => r.owner)])].filter(Boolean).map(o => <option key={o}>{o}</option>)}</select></label><label className="block text-sm">Repository name<input aria-label={`${name} new repository name`} className="input my-1 w-full" value={repoName} onChange={e => setRepoName(e.target.value)} /></label><button className="btn-ghost mt-2" disabled={busy || !owner || !repoName} onClick={() => void act(async () => { const r = await invoke<ipc.Repo>('product_github_create_repo', { owner, name: repoName }); setCreatedRepos(rs => [...rs,r]); setRepository(r.full_name); setMessage(`Created ${r.full_name}. Choose its Project, then connect.`) })}>Create private repository</button></details>
    <label className="mt-4 block text-sm text-muted">GitHub Project<select aria-label={`${name} project`} className="input mt-1 w-full" disabled={busy} value={projectUrl} onChange={e => setProjectUrl(e.target.value)}><option value="">Connect repository only for now</option>{projectUrl && !projects.some(p => p.url === projectUrl) && <option value={projectUrl}>Current Project</option>}{projects.map(p => <option key={p.id} value={p.url}>{p.title}</option>)}</select></label>
    {projectError && <p role="alert" className="mt-2 text-xs text-warn">{projectError} Repository linking remains available.</p>}
    <details className="mt-3"><summary className="cursor-pointer text-sm text-info">Create a Project</summary><p className="my-2 text-xs text-muted">Creates the product backlog under {projectOwner || 'the repository owner'}. Requires GitHub Projects write permission.</p><input aria-label={`${name} new project title`} className="input w-full" value={projectTitle} onChange={e => setProjectTitle(e.target.value)} /><button className="btn-ghost mt-2" disabled={busy || !repository || !projectTitle} onClick={() => void act(async () => { const p = await invoke<Project>('product_github_create_project', { owner: projectOwner, title: projectTitle }); setProjects(ps => [...ps,p]); setProjectUrl(p.url); setProjectError(''); setMessage(`Created ${p.title}. Connect to save the product link.`) })}>Create GitHub Project</button></details>
    <button className="btn-primary mt-4" disabled={busy || !repository} onClick={() => void act(async () => { await invoke('product_github_connect', { business, product, repository, projectUrl }); await useApp.getState().refreshTree(); onChanged(); setMessage('Connected. Product issues and session updates are now available on Activity and Sessions.') })}>{busy ? 'Working…' : 'Connect product'}</button>
    {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
  </section>
}
