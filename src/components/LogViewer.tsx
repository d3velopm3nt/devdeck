// Centralized log viewer: stdout/stderr of every managed service and
// background run, with source + severity filters, text search, export,
// and follow mode.

import { useEffect, useMemo, useRef, useState } from 'react'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import type { LogLevel } from '../lib/types'
import { useApp } from '../store'

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: 'text-err',
  warn: 'text-warn',
  info: 'text-body',
  debug: 'text-muted',
}

const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

export function LogViewer() {
  const { logs, clearLogs, logFocus } = useApp()
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<string>('all')
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LEVELS))
  const [follow, setFollow] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  const sources = useMemo(() => {
    const s = new Set<string>()
    for (const l of logs) s.add(l.service)
    return [...s].sort()
  }, [logs])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return logs.filter(
      (l) =>
        levels.has(l.level) &&
        (source === 'all' || l.service === source) &&
        (q === '' || l.line.toLowerCase().includes(q) || l.service.toLowerCase().includes(q)),
    )
  }, [logs, search, source, levels])

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [filtered.length, follow])

  // "View logs" from the sidebar focuses this panel on one service.
  useEffect(() => {
    if (logFocus) setSource(logFocus.name)
  }, [logFocus])

  const toggleLevel = (lv: LogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lv)) next.delete(lv)
      else next.add(lv)
      return next
    })

  const exportLogs = async () => {
    const path = await saveDialog({
      title: 'Export logs',
      defaultPath: 'devdeck-logs.txt',
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    })
    if (typeof path === 'string') {
      const n = await ipc.logsExport(path)
      alert(`Exported ${n} lines`)
    }
  }

  return (
    <div className="flex h-full flex-col bg-page text-body">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5">
        <input
          className="input w-44 text-[11.5px]"
          placeholder="Search logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input text-[11.5px]" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {LEVELS.map((lv) => (
          <button
            key={lv}
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
              levels.has(lv)
                ? `border-line2 bg-soft ${LEVEL_COLOR[lv]}`
                : 'border-line text-faint'
            }`}
            onClick={() => toggleLevel(lv)}
          >
            {lv}
          </button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[11px] text-dim">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
        <button className="btn-ghost text-[11px]" onClick={() => void exportLogs()}>
          Export
        </button>
        <button
          className="btn-ghost text-[11px]"
          onClick={() => {
            void ipc.logsClear()
            clearLogs()
          }}
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1 font-mono text-[11.5px] leading-[1.5]">
        {filtered.length === 0 && (
          <div className="p-3 text-faint">No log output {logs.length > 0 ? 'matches the filters' : 'yet'}.</div>
        )}
        {filtered.map((l) => (
          <div key={l.seq} className="flex gap-2 whitespace-pre-wrap break-all px-1 hover:bg-hover">
            <span className="shrink-0 text-faint">
              {new Date(l.ts).toLocaleTimeString('en-GB', { hour12: false })}
            </span>
            <span className="shrink-0 text-indigo-400/80">{l.service}</span>
            <span className={`shrink-0 w-10 ${LEVEL_COLOR[l.level]}`}>{l.level}</span>
            <span className={l.level === 'error' ? 'text-err' : ''}>{l.line}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
