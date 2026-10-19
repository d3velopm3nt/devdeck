import { FilterTabs } from './ui/DesignSystem'
import { RepositoryOverview } from './RepositoryOverview'
import { RepositoryListRow } from './RepositoryListRow'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Search, ArrowLeft } from 'lucide-react'
import { RepositoryFiles } from './RepositoryFiles'
import './repository-discovery.css'
import { AddFromGitHub } from './workers/LibraryPanel'

type Repository = { full_name: string; description: string | null; stargazers_count: number; default_branch: string; license: { spdx_id: string } | null }
type Finding = { label: string; paths: string[] }

export function classifyRepository(paths: string[]): Finding[] {
  const groups: [string, RegExp][] = [
    ['Skills', /(^|\/)SKILL\.md$/i],
    ['Agent definitions', /(^|\/)(agents\/[^/]+\.md|AGENTS\.md)$/i],
    ['Packages and applications', /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|pom\.xml|[^/]+\.csproj)$/i],
    ['Commands and scripts', /(^|\/)(Makefile|justfile|[^/]+\.(sh|ps1|bat|cmd))$|(^|\/)bin\//i],
    ['Tool and deployment configuration', /(^|\/)(mcp[^/]*\.json|server\.json|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i],
    ['Documentation', /(^|\/)(readme[^/]*|docs\/.*\.md)$/i],
  ]
  return groups.map(([label, pattern]) => ({ label, paths: paths.filter(path => pattern.test(path)) })).filter(group => group.paths.length)
}

async function github<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`https://api.github.com/${path}`, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) {
    const details = await response.json().catch(() => ({}))
    const limited = response.status === 429 || (response.status === 403 && (
      response.headers.get('x-ratelimit-remaining') === '0' ||
      /rate limit|secondary rate|abuse detection/i.test(String(details.message || ''))
    ))
    if (limited) {
      const reset = Number(response.headers.get('x-ratelimit-reset'))
      const retry = Number(response.headers.get('retry-after'))
      const when = retry > 0 ? Date.now() + retry * 1000 : reset > 0 ? reset * 1000 : 0
      throw new Error(`GitHub's request limit was reached.${when > Date.now() ? ` Try again after ${new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ' Please wait before trying again.'}`)
    }
    throw new Error(response.status === 403 ? 'GitHub denied this request. This may be an access restriction.' : response.status === 404 ? 'Repository not found. Check that it is public and the address is correct.' : `GitHub could not complete the request (${response.status}).`)
  }
  return response.json()
}

export function RepositoryDiscovery({ onOpenChange, requestedRepo, showSearch = true }: { onOpenChange?: (open: boolean) => void; requestedRepo?: { url: string; request: number }; showSearch?: boolean }) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('devdeck.repository-searches') || '[]')
      return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string').slice(0, 8) : []
    } catch { return [] }
  })
  const saveRecent = (values: string[]) => {
    setRecent(values)
    try { localStorage.setItem('devdeck.repository-searches', JSON.stringify(values)) } catch { /* Search remains usable without storage. */ }
  }
  const [pageTab, setPageTab] = useState<'overview' | 'files'>('overview')
  const [results, setResults] = useState<Repository[] | null>(null)
  const [selected, setSelected] = useState<Repository | null>(null)
  useEffect(() => { onOpenChange?.(!!selected) }, [selected, onOpenChange])
  const [files, setFiles] = useState<string[]>([])
  const [revision, setRevision] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [added, setAdded] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const run = async (repo?: string, search = query.trim()) => {
    if (!repo && !search) return
    if (!repo) {
      setQuery(search)
      saveRecent([search, ...recent.filter(value => value.toLowerCase() !== search.toLowerCase())].slice(0, 8))
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setSelected(null); setAdded(false)
    try {
      const direct = repo || search.match(/^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)\/?$/)?.[1]?.replace(/\.git$/, '')
      if (direct) {
        const metadata = await github<Repository>(`repos/${direct}`, controller.signal)
        const head = await github<{ sha: string }>(`repos/${direct}/commits/${encodeURIComponent(metadata.default_branch)}`, controller.signal)
        const tree = await github<{ sha: string; tree: { path: string; type: string }[]; truncated: boolean }>(`repos/${direct}/git/trees/${encodeURIComponent(head.sha)}?recursive=1`, controller.signal)
        setFiles(tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path)); setRevision(head.sha); setPageTab('overview'); setSelected(metadata); setTruncated(tree.truncated)
      } else {
        const data = await github<{ items: Repository[] }>(`search/repositories?q=${encodeURIComponent(search)}&sort=stars&per_page=20`, controller.signal)
        setResults(data.items)
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (requestedRepo) void run(requestedRepo.url.replace(/^https:\/\/github.com\//, '').replace(/\/$/, '').replace(/\.git$/, ''))
    // The request identity deliberately allows reopening the same repository.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedRepo])
  return <section className={`repo-discovery ${!showSearch ? "repo-discovery-hidden" : ""}`} aria-label="Search GitHub repositories">
    <div hidden={!!selected || !showSearch} className="repository-search-heading"><span className="repo-kicker">GITHUB DISCOVERY</span><h2>What will you build next?</h2><p>Find tools, explore skills, and discover what your team could do next.</p></div>
    <form hidden={!!selected || !showSearch} className="repo-search" onSubmit={event => { event.preventDefault(); void run() }}>
      <input className="input min-w-0 flex-1" aria-label="GitHub search or repository URL" placeholder="Search repositories or paste a GitHub URLâ€¦" value={query} onChange={event => setQuery(event.target.value)} />
      <button className="repo-search-submit" aria-label="Search / inspect" title="Search GitHub" disabled={busy || !query.trim()}>{busy ? <span aria-hidden="true">...</span> : <Search size={16} />}</button>
    </form>
    {!selected && showSearch && <div className="repo-search-extras">
      <div className="repo-topics"><span>Explore</span>{['Agent skills', 'MCP servers', 'Developer tools', 'Automation'].map(topic => <button key={topic} disabled={busy} onClick={() => void run(undefined, topic)}>{topic}</button>)}</div>
      {!!recent.length && <div className="repo-recents"><div className="repo-recents-title"><span>Recent searches</span><button onClick={() => saveRecent([])}>Clear history</button></div><div className="repo-recent-items">{recent.map(value => <button key={value} disabled={busy} onClick={() => void run(undefined, value)}><Search size={12} /><span>{value}</span></button>)}</div></div>}
      {results && <div className="repo-results-heading"><strong>{results.length} results</strong><span>Top matches by stars</span></div>}
    </div>}
    {busy && !showSearch && <p role="status" className="text-sm text-muted">Opening repository…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-err">{error}</p>}
    {selected && createPortal(<div className="repo-inspection-page" aria-label="Repository inspection">
      <button className="repo-back" onClick={() => setSelected(null)}><ArrowLeft size={16} />Back to Discover</button>
      <header className="repo-page-header"><div className="repo-project-identity"><img src={`https://github.com/${encodeURIComponent(selected.full_name.split('/')[0])}.png?size=160`} alt={`${selected.full_name.split('/')[0]} avatar`} onError={event => { event.currentTarget.style.display = 'none' }} /><div><span className="repo-kicker">REPOSITORY</span><h1>{selected.full_name}</h1></div></div><button className="wf-secondary" onClick={() => setImporting(true)}>Review imports</button></header>
      <p className="mt-1 text-sm text-muted">{selected.description}</p>
      <div className="repo-metadata"><span>{selected.stargazers_count.toLocaleString()} stars</span><span>{selected.license?.spdx_id || 'License not declared'}</span><span>{files.length} files</span><span>Security scan: not run</span></div>
      <div className="ds-view-switch"><FilterTabs label="Repository views" value={pageTab} onChange={setPageTab} options={[{id:"overview",label:"Overview",icon:"info"},{id:"files",label:"Files & AI",icon:"folder"}]}/></div>
      {truncated && <p className="mt-2 text-xs text-warn">GitHub returned a partial file list. Some contents may be missing.</p>}
      <div hidden={pageTab !== 'overview'}><RepositoryOverview key={selected.full_name} repo={selected.full_name} revision={revision} files={files} onExplore={() => setPageTab('files')} onImport={() => setImporting(true)} /></div>
      <div hidden={pageTab !== 'files'}><RepositoryFiles key={selected.full_name} repo={selected.full_name} revision={revision} files={files} /></div>
      {added && <p role="status" className="mt-2 text-xs text-ok">Added to Library</p>}
      {importing && <AddFromGitHub initialRepo={selected.full_name} onClose={() => setImporting(false)} onAdded={() => { setImporting(false); setAdded(true) }} />}
    </div>, document.getElementById('repository-page-host') || document.body)}
    {!selected && showSearch && results && <div className="repository-results">{!results.length && <p className="text-sm text-muted">No repositories found. Try another search.</p>}{results.map(repo => <RepositoryListRow key={repo.full_name} name={repo.full_name} owner={repo.full_name.split('/')[0]} description={repo.description} license={repo.license?.spdx_id} metrics={<span>{repo.stargazers_count.toLocaleString()} stars</span>} busy={busy} onOpen={() => void run(repo.full_name)} />)}</div>}
  </section>
}
