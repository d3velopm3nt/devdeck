// Connections' contextual sidebar: the connections themselves, each with its
// saved queries nested underneath. Fixed chrome, like the Explorer.

import { useApp } from '../store'
import { Icon } from '../lib/icons'
import type { ConnDef } from '../lib/types'

const ENGINE_LABEL: Record<string, string> = {
  postgres: 'Postgres',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
}

/** Reachability, shown the way a service's status is. */
function StatusDot({ state }: { state: 'ok' | 'bad' | 'unknown' | 'testing' }) {
  const cls =
    state === 'ok'
      ? 'bg-emerald-400'
      : state === 'bad'
        ? 'bg-red-400'
        : state === 'testing'
          ? 'bg-amber-400 animate-pulse'
          : 'bg-faint'
  return <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${cls}`} />
}

export function ConnectionsSidebar() {
  const {
    connections,
    connQueries,
    connSelectedId,
    connStatus,
    selectConnection,
    openConnEditor,
    setConnSql,
  } = useApp()

  return (
    <div className="flex h-full flex-col bg-app">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Icon name="database" size={14} className="text-indigo-400" />
        <span className="text-[12.5px] font-semibold text-ink">Connections</span>
        <button
          className="btn-ghost ml-auto inline-flex items-center gap-1 text-[11px]"
          title="Add a connection"
          onClick={() => openConnEditor(0)}
        >
          <Icon name="add" size={11} /> New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {connections.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] leading-5 text-muted">
            No connections yet.
            <br />
            DevDeck runs your existing database clients rather than talking to servers itself.
          </div>
        )}

        {connections.map((c: ConnDef) => {
          const active = connSelectedId === c.id
          const queries = connQueries.filter((q) => q.connection_id === c.id)
          return (
            <div key={c.id} className="mb-0.5">
              <button
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                  active ? 'bg-raise text-ink' : 'text-body hover:bg-hover/50'
                }`}
                onClick={() => void selectConnection(c.id)}
              >
                <StatusDot state={connStatus[c.id] ?? 'unknown'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]">{c.name}</span>
                  <span className="block truncate font-mono text-[10px] text-muted">
                    {ENGINE_LABEL[c.engine] ?? c.engine}
                    {c.database ? ` · ${c.database.split(/[\\/]/).pop()}` : ''}
                  </span>
                </span>
                {c.has_password && (
                  <Icon name="secret" size={11} className="shrink-0 text-muted" />
                )}
                <span
                  className="shrink-0 rounded p-0.5 text-muted hover:text-ink"
                  title="Edit this connection"
                  onClick={(e) => {
                    e.stopPropagation()
                    openConnEditor(c.id)
                  }}
                >
                  <Icon name="edit" size={11} />
                </span>
              </button>

              {active && queries.length > 0 && (
                <div className="ml-4 border-l border-line pl-2">
                  {queries.map((q) => (
                    <button
                      key={q.id}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11.5px] text-body hover:bg-hover/50"
                      title={q.sql}
                      onClick={() => setConnSql(q.sql)}
                    >
                      <Icon name="query" size={10} className="shrink-0 text-indigo-300" />
                      <span className="truncate">{q.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t border-line px-3 py-2 text-[10.5px] leading-4 text-muted">
        Passwords are kept in <b className="text-dim">Windows Credential Manager</b>, never in
        DevDeck's database.
      </div>
    </div>
  )
}
