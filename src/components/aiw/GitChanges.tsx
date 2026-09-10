// The working tree: what has changed, and committing it.
//
// The Git page next to this one is history — commits that already happened,
// read as the version layer agents are measured against. It could not answer
// the question you actually have while working, which is "what have I changed
// and can I commit it", so committing meant leaving the app for a terminal.
//
// Choices worth keeping:
//
//  * Nothing is staged behind your back. The checkboxes are the selection and
//    the selected paths are what gets `git add`ed — there is no `git add -A`
//    anywhere in this path, because that is how a stray `.env` or a build
//    directory ends up in someone's history.
//  * Conflicts start unticked and say so. Committing a half-resolved merge is
//    one of the few things here that reaches other people.
//  * Push is a separate tick, not a separate screen — "commit and forget to
//    push" is the most common way work goes missing.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store'
import { findNode, resolveDir } from '../../lib/tree'

const TONE: Record<string, string> = {
  new: 'text-ok',
  added: 'text-ok',
  modified: 'text-warn',
  deleted: 'text-err',
  conflict: 'text-err',
  renamed: 'text-info',
  copied: 'text-info',
}

export function GitChanges({ nodeId }: { nodeId: number | null }) {
  const nodes = useApp((s) => s.nodes)
  const node = nodeId != null ? findNode(nodes, nodeId) : null
  const dir = resolveDir(nodes, node)

  const [changes, setChanges] = useState<ipc.GitChange[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!dir) {
      setChanges(null)
      setErr(null)
      return
    }
    try {
      const rows = await ipc.gitChanges(dir)
      setChanges(rows)
      setErr(null)
      // Everything that is not a conflict starts ticked: the common case is
      // "commit what I did". A conflict is never assumed.
      setPicked(new Set(rows.filter((r) => !r.conflict).map((r) => r.path)))
    } catch (e) {
      // Never an empty list on failure — "nothing has changed" and "we could
      // not find out" must not look the same.
      setChanges(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [dir])

  useEffect(() => {
    void load()
  }, [load])

  // A commit or a pull finishing elsewhere changes this list, so it follows
  // the same event the tree does rather than going stale until a click.
  useEffect(() => {
    const un = ipc.onGitDone(() => void load())
    return () => {
      void un.then((f) => f())
    }
  }, [load])

  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const commit = async () => {
    if (!dir) return
    setBusy(true)
    setErr(null)
    try {
      await ipc.gitCommit(dir, message, [...picked], push)
      setMessage('')
      // The commit runs on a thread and reports through `git:done`, which
      // reloads this list. Clearing the message now is safe; clearing the
      // list would claim a result we have not been told yet.
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!node) return null

  if (!dir) {
    return (
      <Frame>
        <p className="text-[11.5px] text-muted">
          This space has no folder on disk, so there is nothing to commit.
        </p>
      </Frame>
    )
  }

  if (err) {
    return (
      <Frame>
        <div className="flex items-start gap-1.5 text-[11.5px] leading-5 text-err">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{err}</span>
          <button className="btn-ghost shrink-0 text-[11px]" onClick={() => void load()}>
            <Icon name="update" size={11} /> Retry
          </button>
        </div>
      </Frame>
    )
  }

  if (changes === null) {
    return (
      <Frame>
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <Icon name="update" size={12} spin /> Reading the working tree…
        </div>
      </Frame>
    )
  }

  if (changes.length === 0) {
    return (
      <Frame>
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          <Icon name="check" size={13} className="text-ok" />
          Nothing to commit — the working tree is clean.
        </div>
      </Frame>
    )
  }

  const conflicts = changes.filter((c) => c.conflict).length

  return (
    <Frame>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11.5px] font-medium text-ink">
          {changes.length} change{changes.length === 1 ? '' : 's'}
        </span>
        {conflicts > 0 && (
          <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-semibold text-err">
            {conflicts} conflict{conflicts === 1 ? '' : 's'}
          </span>
        )}
        <span className="flex-1" />
        <button
          className="btn-ghost text-[11px]"
          onClick={() => setPicked(new Set(changes.filter((c) => !c.conflict).map((c) => c.path)))}
        >
          All
        </button>
        <button className="btn-ghost text-[11px]" onClick={() => setPicked(new Set())}>
          None
        </button>
        <button className="btn-ghost text-[11px]" title="Re-read" onClick={() => void load()}>
          <Icon name="update" size={11} />
        </button>
      </div>

      <div className="max-h-[260px] overflow-y-auto rounded-md border border-line bg-raise">
        {changes.map((c) => {
          const word = c.label
          return (
            <label
              key={c.path}
              className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 last:border-0 hover:bg-hover"
              title={c.from ? `${c.from} → ${c.path}` : c.path}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 shrink-0 accent-indigo-500"
                checked={picked.has(c.path)}
                onChange={() => toggle(c.path)}
              />
              <span
                className={`w-[68px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.03em] ${
                  TONE[word] ?? 'text-dim'
                }`}
              >
                {word}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-body">
                {c.path}
              </span>
            </label>
          )
        })}
      </div>

      <textarea
        className="input mt-2 h-[58px] w-full resize-none text-[12px]"
        placeholder="What did you change, and why?"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          className="btn-primary text-[12px]"
          disabled={busy || picked.size === 0 || message.trim() === ''}
          onClick={() => void commit()}
        >
          <Icon name="commit" size={12} />
          {push ? 'Commit and push' : 'Commit'} {picked.size > 0 ? `(${picked.size})` : ''}
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-body">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-indigo-500"
            checked={push}
            onChange={(e) => setPush(e.target.checked)}
          />
          Push afterwards
        </label>
        <span className="flex-1" />
        {conflicts > 0 && (
          <span className="text-[11px] text-warn">
            Conflicts start unticked — resolve them first.
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-4 text-muted">
        Only the ticked paths are staged. Progress goes to Logs; a failed push leaves the commit
        safe on this machine.
      </p>
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-md border border-line bg-panel p-3.5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Working tree
      </h3>
      {children}
    </div>
  )
}
