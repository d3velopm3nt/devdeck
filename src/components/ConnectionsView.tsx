// Connections — the SQL surface: an editor, a run button, and a results grid.
//
// Deliberately a *runner*, not an IDE. No schema tree, no autocomplete, no
// transaction management. You write SQL, you get a grid; everything your
// database can do stays reachable because DevDeck isn't standing in front of
// it. The moment this grows a query planner it starts losing to a real client.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import type { ConnDef, QueryRun } from '../lib/types'

const ENGINE_LABEL: Record<string, string> = {
  postgres: 'Postgres',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
}

/**
 * The install id for each client, so a missing one is one click from fixed.
 * These are exact winget ids and were checked against `winget show --exact`;
 * an id that doesn't resolve turns the fix-it button into a dead end, which
 * is worse than not offering one.
 */
const CLIENT_PKG: Record<string, { id: string; source: string; label: string }> = {
  // PostgreSQL is versioned in winget — there is no unversioned id.
  psql: { id: 'PostgreSQL.PostgreSQL.17', source: 'winget', label: 'PostgreSQL 17' },
  sqlite3: { id: 'SQLite.SQLite', source: 'winget', label: 'SQLite' },
  sqlcmd: { id: 'Microsoft.Sqlcmd', source: 'winget', label: 'Sqlcmd Tools' },
}

function ResultGrid({
  columns,
  rows,
  sort,
  onSort,
}: {
  columns: string[]
  rows: string[][]
  sort: { col: number; dir: 1 | -1 } | null
  onSort: (col: number) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-left font-mono text-[11.5px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className="cursor-pointer select-none border-b border-line2 bg-panel px-2.5 py-1.5 font-semibold text-dim hover:text-ink"
                onClick={() => onSort(i)}
              >
                <span className="inline-flex items-center gap-1">
                  {c || <span className="text-faint">(no name)</span>}
                  {sort?.col === i && (
                    <Icon name={sort.dir === 1 ? 'arrow-up' : 'arrow-down'} size={10} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="even:bg-panel/40 hover:bg-hover/40">
              {columns.map((_, ci) => (
                <td key={ci} className="max-w-[420px] truncate border-b border-line px-2.5 py-1 text-body">
                  {r[ci] === '' ? <span className="text-faint">∅</span> : r[ci]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ConnectionsView() {
  const app = useApp()
  const {
    connections,
    connSelectedId,
    connSql,
    setConnSql,
    connResult,
    connRunning,
    runConnQuery,
    testConnection,
    connStatus,
    refreshConnQueries,
  } = app
  const conn: ConnDef | undefined = connections.find((c) => c.id === connSelectedId)
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [history, setHistory] = useState<QueryRun[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setSort(null)
    setNotice('')
  }, [connResult])

  useEffect(() => {
    if (!conn) return setHistory([])
    void ipc.connRunsList(conn.id, 30).then(setHistory).catch(() => setHistory([]))
  }, [conn, connResult])

  const rows = useMemo(() => {
    if (!connResult) return []
    if (!sort) return connResult.rows
    const { col, dir } = sort
    // Sort numerically when the whole column looks numeric, else as text —
    // string-sorting a column of ids puts 10 before 2, which reads as a bug.
    const numeric = connResult.rows.every((r) => r[col] === '' || !Number.isNaN(Number(r[col])))
    return [...connResult.rows].sort((a, b) => {
      const x = a[col] ?? ''
      const y = b[col] ?? ''
      if (numeric) return (Number(x) - Number(y)) * dir
      return x.localeCompare(y) * dir
    })
  }, [connResult, sort])

  const exportCsv = async () => {
    if (!connResult) return
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const csv = [connResult.columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
    try {
      await navigator.clipboard.writeText(csv)
      setNotice(`Copied ${rows.length} row${rows.length === 1 ? '' : 's'} as CSV.`)
    } catch (e) {
      setNotice(String(e))
    }
  }

  const saveQuery = async () => {
    if (!conn || !connSql.trim()) return
    const name = saveName.trim() || connSql.trim().split('\n')[0].slice(0, 40)
    await ipc.connQuerySave({
      id: 0,
      connection_id: conn.id,
      name,
      sql: connSql,
      created_at: 0,
    })
    setSaveName('')
    await refreshConnQueries()
    setNotice(`Saved as "${name}".`)
  }

  if (!conn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Icon name="database" size={26} className="text-muted" />
        <div className="text-[13px] font-medium text-ink">No connection selected</div>
        <div className="max-w-md text-[12px] leading-5 text-muted">
          DevDeck is a <b className="text-dim">runner</b>, not a SQL IDE: it drives the{' '}
          <code>psql</code>, <code>sqlite3</code> and <code>sqlcmd</code> clients you already have
          and shows you the grid. Add a connection on the left to start.
        </div>
      </div>
    )
  }

  const status = connStatus[conn.id] ?? 'unknown'

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-line bg-panel px-3 py-2">
        <Icon name="database" size={14} className="text-indigo-400" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{conn.name}</div>
          <div className="truncate font-mono text-[10px] text-muted">
            {ENGINE_LABEL[conn.engine] ?? conn.engine}
            {conn.host ? ` · ${conn.host}${conn.port ? ':' + conn.port : ''}` : ''}
            {conn.database ? ` · ${conn.database}` : ''}
            {conn.username ? ` · ${conn.username}` : ''}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]"
            title="Run `select 1` and see whether this is reachable"
            onClick={() => void testConnection(conn.id)}
          >
            <Icon name="ok" size={12} className={status === 'ok' ? 'text-ok' : undefined} />
            {status === 'testing' ? 'Testing…' : 'Test'}
          </button>
          <button
            className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]"
            onClick={() => setShowHistory((v) => !v)}
          >
            <Icon name="history" size={12} /> History
          </button>
          <button
            className="btn-primary inline-flex items-center gap-1.5 text-[11.5px]"
            disabled={connRunning || !connSql.trim()}
            onClick={() => void runConnQuery()}
          >
            <Icon name={connRunning ? 'spinner' : 'run'} size={12} spin={connRunning} />
            {connRunning ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {/* editor */}
      <div className="border-b border-line px-3 py-2">
        <textarea
          className="min-h-[104px] w-full resize-y rounded-lg border border-line2 bg-panel px-3 py-2 font-mono text-[12px] leading-[1.6] text-body outline-none placeholder:text-faint focus:border-indigo-500"
          placeholder="select * from …    (Ctrl+Enter to run)"
          value={connSql}
          onChange={(e) => setConnSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void runConnQuery()
            }
          }}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <input
            className="input w-56 text-[11.5px]"
            placeholder="Save this query as…"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveQuery()
            }}
          />
          <button className="btn-ghost text-[11.5px]" onClick={() => void saveQuery()}>
            Save query
          </button>
          {connResult && !connResult.error && (
            <button className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]" onClick={() => void exportCsv()}>
              <Icon name="copy" size={12} /> Copy as CSV
            </button>
          )}
          {notice && <span className="text-[11px] text-ok">{notice}</span>}
        </div>
      </div>

      {/* history */}
      {showHistory && (
        <div className="max-h-[180px] overflow-auto border-b border-line bg-page px-3 py-2">
          {history.length === 0 && <div className="text-[11.5px] text-muted">No runs yet.</div>}
          {history.map((h) => (
            <button
              key={h.id}
              className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-hover/50"
              onClick={() => setConnSql(h.sql)}
            >
              <Icon
                name={h.ok ? 'ok' : 'alert'}
                size={11}
                className={`mt-0.5 shrink-0 ${h.ok ? 'text-ok' : 'text-err'}`}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">{h.sql}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted">
                {h.ok ? `${h.row_count} rows` : 'failed'} · {h.ms}ms · {fmtAgo(h.ran_at, Date.now())}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* results */}
      {!connResult ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
          Write some SQL and hit Run.
        </div>
      ) : connResult.error ? (
        <div className="flex-1 overflow-auto p-3.5">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3.5 py-3">
            <div className="mb-1 text-[12px] font-semibold text-err">Query failed</div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-body">
              {connResult.error}
            </pre>
            {connResult.missing_tool && CLIENT_PKG[connResult.missing_tool] && (
              <button
                className="btn-primary mt-2.5 inline-flex items-center gap-1.5 text-[11.5px]"
                onClick={() => {
                  const pkg = CLIENT_PKG[connResult.missing_tool]
                  app.showBottom('logs')
                  void ipc.machineInstall([pkg]).then(() => ipc.onMachineDone(() => void ipc.refreshPath()))
                }}
              >
                <Icon name="download" size={12} /> Install{' '}
                {CLIENT_PKG[connResult.missing_tool].label}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 border-b border-line px-3 py-1.5 font-mono text-[10.5px] text-muted">
            <span>
              <span className="text-dim">{connResult.row_count}</span> row
              {connResult.row_count === 1 ? '' : 's'}
            </span>
            <span>{connResult.ms} ms</span>
            {connResult.truncated && (
              <span className="text-warn">
                showing the first {connResult.rows.length} — the rest were not loaded
              </span>
            )}
          </div>
          <ResultGrid
            columns={connResult.columns}
            rows={rows}
            sort={sort}
            onSort={(col) =>
              setSort((s) => (s?.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }))
            }
          />
        </>
      )}
    </div>
  )
}
