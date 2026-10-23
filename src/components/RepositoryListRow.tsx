import { useState, type ReactNode } from 'react'
import './repository-discovery.css'

export function RepositoryListRow({ name, owner, description, license, metrics, onOpen, busy, action }: {
  name: string; owner?: string; description?: string | null; license?: string; metrics?: ReactNode;
  onOpen: () => void; busy?: boolean; action?: ReactNode
}) {
  const [broken, setBroken] = useState(false)
  return <article className="repository-row">
    {owner && !broken ? <img src={`https://github.com/${encodeURIComponent(owner)}.png?size=80`} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className="repository-avatar">{name.slice(0, 1).toUpperCase()}</span>}
    <div className="repository-row-body"><button className="repository-name" onClick={onOpen} disabled={busy}>{name}</button><p>{description}</p><div className="repository-meta">{owner && <span>{owner}</span>}{metrics}<span>{!license || license === 'missing' ? 'License not reported' : license}</span></div></div>
    <div className="repository-row-actions">{action}<button aria-label="Inspect" className="repo-inspect" onClick={onOpen} disabled={busy}>Inspect <span aria-hidden="true">→</span></button></div>
  </article>
}
