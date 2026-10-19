import { StateBadge } from './ui/DesignSystem'
import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import * as ipc from '../lib/ipc'
import type { TreeNode } from '../lib/types'

export function IssueMonitorPanel() {
  const [data, setData] = useState<ipc.IssueMonitorView | null>(null)
  const [error, setError] = useState('')
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [scope, setScope] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setData(await ipc.issueMonitorGet()); setError('') } catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => {
    void load()
    void ipc.treeList().then(setNodes).catch(e => setError(String(e)))
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
  const assign = async (repository: string, node?: number) => {
    if (!data) return
    setBusy(true); setError('')
    const bindings = (data.bindings || []).filter(b => b.repository !== repository)
    if (node) {
      const input = scope[repository] ?? (data.bindings.find(b => b.repository === repository)?.issues || []).join(', ')
      const issues = input.trim() ? input.split(/[ ,]+/).map(Number) : []
      if (issues.some(n => !Number.isSafeInteger(n) || n <= 0) || issues.length > 100) {
        setError('Enter up to 100 positive issue numbers, separated by commas.'); setBusy(false); return
      }
      bindings.push({ repository, node, issues: [...new Set(issues)] })
    }
    try { setData(await ipc.issueMonitorSave(data.raw, data.enabled, bindings, undefined, node ? true : undefined)) }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const retry = async (repository: string, number: number) => {
    setBusy(true); setError('')
    try { setData(await ipc.issueMonitorRetry(repository, number)) }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const options = async (briefings: boolean, dispatch: boolean) => {
    if (!data) return
    setBusy(true); setError('')
    try { setData(await ipc.issueMonitorSave(data.raw, data.enabled, undefined, briefings, dispatch)) }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section className="border-b border-line bg-panel px-5 py-3" aria-label="Automatic issue monitor">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-[13px] font-semibold text-ink">Repository monitor</h2>
      <span className="text-[12px] text-muted">{data ? data.enabled ? 'Monitoring on · issues every minute, PRs and commits every 5 minutes' : 'Monitoring paused' : 'Reading monitor…'}</span>
      <button className="btn-ghost text-[12px]" disabled={!data || busy} onClick={() => void change(false)}>{data?.enabled ? 'Pause monitoring' : 'Enable monitoring'}</button>
      <button className="btn-ghost text-[12px]" disabled={!data || busy || !data.sources.length} onClick={() => void change(true)}>{busy ? 'Updating…' : 'Refresh activity now'}</button>
    </div>
    <p className="mt-1 text-[12px] text-muted">Reads connected projects while DevDeck is open. Dev can summarize observed changes using the main agent’s existing model connection, with no tools or execution. Unchanged snapshots do not repeat model calls. Failed briefings need an explicit retry.</p>
    <div className="mt-2 flex flex-wrap gap-4 text-[12px]"><label className="flex items-center gap-2"><input type="checkbox" checked={!!data?.briefings} disabled={!data || busy} onChange={e => void options(e.target.checked, !!data?.dispatch_enabled)} /> Dev’s AI briefings</label><label className="flex items-center gap-2"><input type="checkbox" checked={!!data?.dispatch_enabled} disabled={!data || busy} onChange={e => void options(!!data?.briefings, e.target.checked)} /> Automatic issue execution</label></div>
    <p className="mt-1 text-[12px] text-muted">Execution additionally requires an assigned workflow folder, issue scope and Dev’s Full workflow permission. Existing assignments are retained; execution defaults to off until explicitly enabled.</p>
    {error && <p role="alert" className="mt-2 text-[12px] text-err">{error}</p>}
    {data?.warnings.map(w => <p key={w} className="text-[12px] text-warn">{w}</p>)}
    {data?.sources.length === 0 && <p className="mt-2 text-[12px] text-muted">Connect a GitHub project in Activity first.</p>}
    <div className="mt-2 space-y-2">{data?.sources.map(source => <details key={source.repository} className="rounded border border-line p-2 text-[12px]">
      <summary className="cursor-pointer text-ink">{source.repository} · {source.items.filter(i => i.state === 'open').length} open issues · {source.fetched_at ? `Last successful refresh ${new Date(source.fetched_at).toLocaleString()}` : 'Not fetched yet'}</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>{data.bindings?.find(b => b.repository === source.repository) ? `Dispatch assigned to ${nodes.find(n => n.id === data.bindings.find(b => b.repository === source.repository)?.node)?.name || 'folder'} · ${data.enabled && data.dispatch_enabled ? 'enabled' : 'paused'}` : 'Automatic dispatch off'}</span>
        <select aria-label={`Workflow folder for ${source.repository}`} value={targets[source.repository] || ''} onChange={e => setTargets({ ...targets, [source.repository]: e.target.value })} className="rounded border border-line bg-panel p-1">
          <option value="">Choose workflow folder</option>{nodes.filter(n => n.dir).map(n => <option key={n.id} value={n.id}>{n.name} · {n.dir}</option>)}
        </select>
        <input aria-label={`Issue numbers for ${source.repository}`} placeholder="Issue numbers, e.g. 33 (blank: all)" value={scope[source.repository] ?? (data.bindings.find(b => b.repository === source.repository)?.issues || []).join(', ')} onChange={e => setScope({ ...scope, [source.repository]: e.target.value })} className="rounded border border-line bg-panel p-1 text-ink" />
        <button className="btn-ghost" disabled={busy || !targets[source.repository]} onClick={() => void assign(source.repository, Number(targets[source.repository]))}>Enable dispatch here</button>
        {data.bindings?.some(b => b.repository === source.repository) && <button className="btn-ghost" disabled={busy} onClick={() => void assign(source.repository)}>Disable dispatch</button>}
      </div>
      <p className="mt-1 text-muted">Dispatch covers selected issue numbers, or all open issues when blank. Dev selects a template; configured workers run independent steps. Human review still gates dependencies.</p>
      {(data.dispatches || []).filter(d => d.repository === source.repository).map(d => <p key={d.number} className="mt-1">#{d.number} · <StateBadge state={d.status}/>{d.workflow && ` · ${d.workflow}`} {d.message && `— ${d.message}`}{d.status === 'blocked' && !d.workflow && <button className="btn-ghost ml-2" disabled={busy} onClick={() => void retry(d.repository, d.number)}>Retry selection</button>}</p>)}
      {source.error && <p role="alert" className="mt-2 text-err">Refresh failed: {source.error}. Previous issues are retained.</p>}
      {source.warnings.map(w => <p key={w} className="text-warn">{w}</p>)}
      {source.truncated && <p className="text-warn">Partial issue history</p>}
      <ul className="mt-2 space-y-1">{source.items.filter(i => i.state === 'open').map(issue => <li key={issue.number}>#{issue.number} · {issue.title} · {issue.assignees.length ? issue.assignees.join(', ') : 'Unassigned'}</li>)}</ul>
    </details>)}</div>
  </section>
}
