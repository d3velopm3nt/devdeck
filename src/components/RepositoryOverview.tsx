import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { openUrl } from '../lib/ipc'

export function RepositoryOverview({ repo, revision, files, onExplore, onImport }: {
  repo: string; revision: string; files: string[]; onExplore: () => void; onImport: () => void
}) {
  const [readme, setReadme] = useState('')
  const [status, setStatus] = useState('Loading project documentation...')
  const skills = files.filter(path => /(^|\/)SKILL\.md$/i.test(path)).length
  const agents = files.filter(path => /(^|\/)(agents\/[^/]+\.md|AGENTS\.md)$/i.test(path)).length
  const packages = files.filter(path => /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(path))
  useEffect(() => {
    const controller = new AbortController()
    setReadme(''); setStatus('Loading project documentation...')
    void (async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/readme?ref=${encodeURIComponent(revision)}`, { signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 404 ? 'No README is available for this revision.' : 'Documentation could not be loaded. Open the project on GitHub or try again later.')
        const data = await response.json()
        if (data.size > 250000 || data.encoding !== 'base64') throw new Error('This README is too large to preview. Read it on GitHub.')
        const text = new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\s/g, '')), c => c.charCodeAt(0)))
        if (!controller.signal.aborted) { setReadme(text); setStatus('') }
      } catch (e) { if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : String(e)) }
    })()
    return () => controller.abort()
  }, [repo, revision])
  const source = `https://github.com/${repo}`
  return <div className="repo-overview-layout">
    <main>
      <section className="repo-use-cases"><div><span className="repo-kicker">WAYS TO USE THIS PROJECT</span><h2>Explore its potential</h2><p>Choose a starting point. Compatibility and setup still need review.</p></div>
        <div className="repo-use-grid">
          <button onClick={onExplore}><strong>Understand the project</strong><span>Explore source, architecture, and implementation with AI.</span><em>Explore code →</em></button>
          {packages.length > 0 && <button onClick={onExplore}><strong>Evaluate as a tool</strong><span>Package definitions found. Review dependencies and documented setup before running.</span><em>Review implementation →</em></button>}
          {(skills > 0 || agents > 0) && <button onClick={onImport}><strong>Extend your team</strong><span>{skills} skill files and {agents} agent-related files detected. Review reusable definitions.</span><em>Review imports →</em></button>}
          <button onClick={() => void openUrl(`${source}/releases`)}><strong>Explore releases</strong><span>Check published versions, release notes, and available downloads on GitHub.</span><em>View releases ↗</em></button>
        </div>
      </section>
      <section className="repo-readme"><header><h2>Project guide</h2><span>README from this revision</span></header>{status && <p className="text-sm text-muted">{status}</p>}<ReactMarkdown skipHtml components={{ img: ({ alt }) => <span className="text-xs text-muted">{alt ? `[Image: ${alt}]` : ''}</span>, a: ({ href, children }) => { let url: URL; try { url = new URL(href || '', `${source}/blob/${revision}/`) } catch { return <span>{children}</span> } return ['https:', 'http:'].includes(url.protocol) ? <button className="repo-readme-link" onClick={() => void openUrl(url.href)}>{children}</button> : <span>{children}</span> } }}>{readme}</ReactMarkdown></section>
    </main>
    <aside className="repo-overview-aside"><section><h3>Before you adopt it</h3><p>Security scanning has not run. File detection does not verify that a project is safe or ready to install.</p><p>Team fit assessment is not connected yet. Use file-level AI review to investigate specific questions.</p></section><section><h3>Project links</h3><button onClick={() => void openUrl(source)}>Source repository ↗</button><button onClick={() => void openUrl(`${source}/issues`)}>Issues & discussions ↗</button><button onClick={onExplore}>Browse {files.length} files →</button></section><section><h3>Detected packaging</h3>{packages.length ? packages.slice(0, 8).map(path => <p key={path} className="break-all">{path}</p>) : <p>No recognized package definitions found. Check the project guide for usage instructions.</p>}</section></aside>
  </div>
}
