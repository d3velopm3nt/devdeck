import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import * as ipc from '../lib/ipc'

export function IssueMonitorPanel() {
  const [data, setData] = useState<ipc.IssueMonitorView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setData(await ipc.issueMonitorGet()); setError('') } catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => {
    void load()
    let alive = true
    const stop = listen<{ payload?: { source?: string } }>('aiw:event', e => { if (e.payload.payload?.source === 'issue_monitor') void load() })
    void stop.then(off => { if (!alive) off() }).catch(e => setError(String(e)))
    return () => { alive = false; void stop.then(off => off()).catch(() => {}) }
  }, [load])
  const change = async (refresh: boolean) => {
    if (!data) return
    setBusy(true); setError('')
    try { setData(await (refresh ? ipc.issueMonitorRefresh() : ipc.issueMonitorSave(data.raw, !data.enabled))) }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section className="border-b border-line bg-panel px-5 py-3" aria-label="Automatic issue monitor">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-[13px] font-semibold text-ink">Issue monitor</h2>
      <span className="text-[12px] text-muted">{data ? data.enabled ? 'Automatic intake enabled · every minute' : 'Automatic intake disabled' : 'Reading monitor…'}</span>
      <button className="btn-ghost text-[12px]" disabled={!data || busy} onClick={() => void change(false)}>{data?.enabled ? 'Pause monitoring' : 'Enable monitoring'}</button>
      <button className="btn-ghost text-[12px]" disabled={!data || busy || !data.sources.length} onClick={() => void change(true)}>{busy ? 'Updating…' : 'Refresh issues now'}</button>
    </div>
    <p className="mt-1 text-[12px] text-muted">Reads projects connected in Activity while DevDeck is open. Detecting an issue does not start an agent.</p>
    {error && <p role="alert" className="mt-2 text-[12px] text-err">{error}</p>}
    {data?.warnings.map(w => <p key={w} className="text-[12px] text-warn">{w}</p>)}
    {data?.sources.length === 0 && <p className="mt-2 text-[12px] text-muted">Connect a GitHub project in Activity first.</p>}
    <div className="mt-2 space-y-2">{data?.sources.map(source => <details key={source.repository} className="rounded border border-line p-2 text-[12px]">
      <summary className="cursor-pointer text-ink">{source.repository} · {source.items.filter(i => i.state === 'open').length} open issues · {source.fetched_at ? `Last successful refresh ${new Date(source.fetched_at).toLocaleString()}` : 'Not fetched yet'}</summary>
      {source.error && <p role="alert" className="mt-2 text-err">Refresh failed: {source.error}. Previous issues are retained.</p>}
      {source.warnings.map(w => <p key={w} className="text-warn">{w}</p>)}
      {source.truncated && <p className="text-warn">Partial issue history</p>}
      <ul className="mt-2 space-y-1">{source.items.filter(i => i.state === 'open').map(issue => <li key={issue.number}>#{issue.number} · {issue.title} · {issue.assignees.length ? issue.assignees.join(', ') : 'Unassigned'}</li>)}</ul>
    </details>)}</div>
  </section>
}
