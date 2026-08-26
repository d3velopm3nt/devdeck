// The connection editor: a slide-over, like the command/service/profile
// sheets. The password field is the interesting part — it writes straight to
// Windows Credential Manager and is never read back, so this form can tell
// you a password *exists* but can never show you one.

import { useEffect, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import type { ConnDef, ConnEngine } from '../lib/types'

const ENGINES: Array<{ id: ConnEngine; label: string; client: string; hint: string }> = [
  { id: 'postgres', label: 'Postgres', client: 'psql', hint: 'host, port, database, user' },
  { id: 'sqlite', label: 'SQLite', client: 'sqlite3', hint: 'just a file path' },
  { id: 'sqlserver', label: 'SQL Server', client: 'sqlcmd', hint: 'leave the user blank for a trusted connection' },
]

const BLANK: ConnDef = {
  id: 0,
  project_id: null,
  name: '',
  engine: 'postgres',
  host: 'localhost',
  port: 5432,
  database: '',
  username: '',
  sort: 0,
  created_at: 0,
  has_password: false,
}

export function ConnectionEditor() {
  const { connEditing, connections, closeConnEditor, refreshConnections, selectConnection } = useApp()
  const [def, setDef] = useState<ConnDef>(BLANK)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (connEditing == null) return
    const found = connections.find((c) => c.id === connEditing)
    setDef(found ? { ...found } : { ...BLANK })
    setPassword('')
    setError('')
  }, [connEditing, connections])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConnEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeConnEditor])

  if (connEditing == null) return null
  const isSqlite = def.engine === 'sqlite'
  const engine = ENGINES.find((e) => e.id === def.engine) ?? ENGINES[0]

  const save = async () => {
    setError('')
    if (!def.name.trim()) return setError('Give it a name.')
    if (isSqlite && !def.database.trim()) return setError('A SQLite connection needs a file path.')
    try {
      const id = await ipc.connSave({ ...def, name: def.name.trim() })
      // Only touch the credential when you typed something. An untouched
      // field must not wipe a stored password.
      if (password) await ipc.connSetPassword(id, password)
      await refreshConnections()
      await selectConnection(id)
      closeConnEditor()
    } catch (e) {
      setError(String(e))
    }
  }

  const remove = async () => {
    if (def.id <= 0) return closeConnEditor()
    await ipc.connDelete(def.id)
    await refreshConnections()
    closeConnEditor()
  }

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      {node}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/35" onClick={closeConnEditor} />
      <div className="fixed right-0 top-0 z-[310] flex h-full w-[460px] flex-col border-l border-line bg-page shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="database" size={15} className="text-indigo-400" />
          <span className="text-[13.5px] font-semibold text-ink">
            {def.id > 0 ? 'Edit connection' : 'New connection'}
          </span>
          <button className="ml-auto rounded p-1 text-muted hover:text-ink" onClick={closeConnEditor}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-err">
              {error}
            </div>
          )}

          {field(
            'Engine',
            <div className="flex gap-1.5">
              {ENGINES.map((e) => (
                <button
                  key={e.id}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] ${
                    def.engine === e.id
                      ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                      : 'border-line2 text-dim hover:border-line3 hover:text-ink'
                  }`}
                  onClick={() =>
                    setDef((d) => ({
                      ...d,
                      engine: e.id,
                      port: e.id === 'postgres' ? 5432 : e.id === 'sqlserver' ? 1433 : null,
                    }))
                  }
                >
                  {e.label}
                </button>
              ))}
            </div>,
            `Runs your ${engine.client} — ${engine.hint}.`,
          )}

          {field(
            'Name',
            <input
              className="input w-full"
              placeholder="staging"
              value={def.name}
              onChange={(e) => setDef((d) => ({ ...d, name: e.target.value }))}
            />,
          )}

          {isSqlite ? (
            field(
              'Database file',
              <input
                className="input w-full font-mono text-[12px]"
                placeholder="C:\\path\\to\\app.sqlite"
                value={def.database}
                onChange={(e) => setDef((d) => ({ ...d, database: e.target.value }))}
              />,
            )
          ) : (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  {field(
                    'Host',
                    <input
                      className="input w-full"
                      value={def.host}
                      onChange={(e) => setDef((d) => ({ ...d, host: e.target.value }))}
                    />,
                  )}
                </div>
                <div className="w-24">
                  {field(
                    'Port',
                    <input
                      className="input w-full"
                      value={def.port ?? ''}
                      onChange={(e) =>
                        setDef((d) => ({ ...d, port: e.target.value ? Number(e.target.value) : null }))
                      }
                    />,
                  )}
                </div>
              </div>
              {field(
                'Database',
                <input
                  className="input w-full"
                  value={def.database}
                  onChange={(e) => setDef((d) => ({ ...d, database: e.target.value }))}
                />,
              )}
              {field(
                'User',
                <input
                  className="input w-full"
                  value={def.username}
                  onChange={(e) => setDef((d) => ({ ...d, username: e.target.value }))}
                />,
                def.engine === 'sqlserver' ? 'Blank uses a trusted (Windows) connection.' : undefined,
              )}
              {field(
                'Password',
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="input w-full"
                    placeholder={def.has_password ? '•••••••• (stored)' : 'not set'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {def.has_password && (
                    <button
                      className="btn-ghost shrink-0 text-[11.5px]"
                      onClick={async () => {
                        await ipc.connClearPassword(def.id)
                        await refreshConnections()
                        setDef((d) => ({ ...d, has_password: false }))
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>,
                'Stored in Windows Credential Manager, not in DevDeck\u2019s database. There is no way to read it back out — including for DevDeck itself, beyond handing it to the client.',
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          {def.id > 0 && (
            <button className="btn-danger text-[12px]" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button className="btn-ghost ml-auto text-[12px]" onClick={closeConnEditor}>
            Cancel
          </button>
          <button className="btn-primary text-[12px]" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </>
  )
}
