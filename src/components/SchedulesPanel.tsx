import { StateBadge } from './ui/DesignSystem'
import { useCallback, useEffect, useRef, useState } from 'react'
import { schedulesList, type Schedule } from '../lib/ipc'
import { Icon } from '../lib/icons'
import { openBot } from '../lib/dock'
import { useApp } from '../store'

function dateLabel(value: number | null) {
  return value == null ? '—' : new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SchedulesPanel() {
  const [rows, setRows] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const inFlight = useRef(false)
  const load = useCallback(async () => {
    inFlight.current = true
    const request = ++generation.current
    setLoading(true)
    try {
      const result = await schedulesList()
      if (request !== generation.current) return
      setRows(result)
      setError('')
    } catch (e) {
      if (request === generation.current) setError(String(e))
    } finally {
      inFlight.current = false
      if (request === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    // Only the visible panel polls; hidden panels never run this timer.
    const timer = window.setInterval(() => { if (!document.hidden && !inFlight.current) void load() }, 5000)
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => { generation.current++; clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [load])
  const manage = () => {
    useApp.getState().setSettingsTab('routines')
    useApp.getState().setRailView('settings')
  }
  return <section className="flex h-full min-h-0 flex-col text-[11.5px]" aria-label="Schedules">
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <Icon name="schedule" size={14} className="text-dim" />
      <span className="text-dim">{rows.length} schedules · {rows.filter(s => s.enabled).length} enabled</span>
      <span className="ml-auto" />
      <button className="btn-ghost text-[11px]" onClick={manage}>Manage schedules</button>
      <button className="rounded p-1 text-muted hover:bg-hover hover:text-ink" title="Refresh schedules" aria-label="Refresh schedules" disabled={loading} onClick={() => void load()}><Icon name="update" size={13} /></button>
    </header>
    {error && <div role="alert" className="border-b border-line px-3 py-2 text-err">Could not refresh schedules. {rows.length > 0 ? 'Showing the last loaded snapshot. ' : ''}{error}</div>}
    <div className="min-h-0 flex-1 overflow-auto">
      {loading && !rows.length ? <p role="status" className="p-4 text-muted">Loading schedules…</p> : !rows.length && !error ? <div className="flex items-center gap-3 p-4 text-muted"><Icon name="schedule" size={20} /><div><p className="text-body">No schedules yet</p><p>Manage schedules to add reminders, commands or agent routines.</p></div></div> : rows.length > 0 ? <table className="w-full min-w-[600px] border-collapse text-left">
        <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wide text-muted"><tr>{['Schedule', 'State', 'Next run', 'Last run / result', ''].map((label, i) => <th key={i} className="px-3 py-1.5 font-medium">{label}</th>)}</tr></thead>
        <tbody>{rows.map(s => <tr key={s.id} className="border-t border-line hover:bg-hover/30">
          <td className="max-w-[260px] px-3 py-2"><div className="truncate font-medium text-ink" title={s.name}>{s.name}</div><div className="text-[10px] text-muted">{s.kind === 'bot' ? 'Agent routine' : s.kind}{s.feature ? ` · ${s.feature}` : ''}{s.work_item ? ` · ${s.work_item}` : ''}</div></td>
          <td className="whitespace-nowrap px-3 py-2 text-dim"><StateBadge state={s.running && !error ? 'running' : s.enabled ? 'enabled' : s.every === 'once' && s.last_run ? 'finished' : 'paused'} label={s.running && !error ? 'Running' : s.enabled ? 'Enabled' : s.every === 'once' && s.last_run ? 'Finished' : 'Paused'}/></td>
          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-dim">{s.enabled ? dateLabel(s.next_run) : '—'}</td>
          <td className="max-w-[320px] px-3 py-2"><div className="text-muted">{s.last_run ? dateLabel(s.last_run) : 'Not run yet'}</div>{s.last_run && <div className={s.last_ok ? 'text-ok' : 'text-err'} title={s.last_note}>{s.last_note || (s.last_ok ? 'Completed' : 'Failed')}</div>}</td>
          <td className="px-3 py-2">{s.manager && s.node_id != null && <button className="btn-ghost text-[11px]" onClick={() => openBot(s.node_id!, s.manager, false, s.manager)}>Open agent</button>}</td>
        </tr>)}</tbody>
      </table> : null}
    </div>
  </section>
}
