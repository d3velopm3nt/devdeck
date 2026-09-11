// A node's files, as a tab on its own page.
//
// The same two directories the tree browses, in the place you land when you
// click the node rather than the chevron beside it. Both exist on purpose:
// the tree is for reaching past a folder to the one under it, and this is for
// looking at what is in the one you are already on.
//
// `work` and `vault` are a switch rather than two branches of one list. A
// node's repository and its vault folder are both "this node", and showing
// them as siblings would say one contains the other.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { openFile } from '../../lib/dock'

export function NodeFiles({ nodeId, hasRepo }: { nodeId: number; hasRepo: boolean }) {
  // A node with no repository has only one directory worth showing, so it
  // starts there rather than on an empty "work" that would read as broken.
  const [root, setRoot] = useState<'work' | 'vault'>(hasRepo ? 'work' : 'vault')
  const [rel, setRel] = useState('')
  const [rows, setRows] = useState<ipc.FileRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    setErr(null)
    try {
      setRows(await ipc.nodeFiles(nodeId, rel, root))
    } catch (e) {
      // "Could not read this folder" and "this folder is empty" must never
      // render the same way.
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [nodeId, rel, root])
  useEffect(() => {
    void load()
  }, [load])

  // Where you are, as something you can click back out of.
  const parts = rel ? rel.split(/[\\/]/).filter(Boolean) : []

  const tab = (want: 'work' | 'vault', label: string, title: string) => (
    <button
      className={`rounded px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
        root === want ? 'bg-indigo-500/15 text-indigo-400' : 'text-faint hover:text-dim'
      }`}
      title={title}
      onClick={() => {
        if (want === root) return
        setRoot(want)
        // The paths on the other side are not the same paths, so staying
        // where you were would open nothing and look broken.
        setRel('')
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 pb-2">
        {hasRepo && tab('work', 'Repo', 'The repository — where commands and terminals run')}
        {tab('vault', 'Vault', 'The vault folder — .devdeck, _bot.md and the features')}
        <span className="mx-1 h-3 w-px bg-line" />
        <button
          className={`text-[11.5px] ${rel ? 'text-dim hover:text-ink' : 'text-muted'}`}
          disabled={!rel}
          onClick={() => setRel('')}
        >
          {root === 'work' ? 'Repo' : 'Vault'}
        </button>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-faint">/</span>
            <button
              className="text-[11.5px] text-dim hover:text-ink"
              onClick={() => setRel(parts.slice(0, i + 1).join('/'))}
            >
              {p}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        <button
          className="rounded p-1 text-faint hover:bg-hover hover:text-dim"
          title="Read it again"
          aria-label="Refresh"
          onClick={() => void load()}
        >
          <Icon name="update" size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-panel">
        {err ? (
          <div className="flex items-start gap-2 px-3 py-3 text-[12px] text-err">
            <Icon name="alert" size={13} className="mt-px shrink-0" />
            <span className="min-w-0 flex-1">{err}</span>
          </div>
        ) : rows === null ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-[12px] text-muted">
            <Icon name="update" size={12} spin /> Reading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-muted">This folder is empty.</div>
        ) : (
          rows.map((r) => (
            <button
              key={r.rel}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left first:border-t-0 hover:bg-hover/40"
              onClick={() => (r.dir ? setRel(r.rel) : openFile(nodeId, r.rel, root))}
            >
              <Icon
                name={r.dir ? 'folder' : 'note'}
                size={13}
                className={`shrink-0 ${r.dir ? 'text-dim' : 'text-faint'}`}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-body">{r.name}</span>
              {/* The feature whose work items name this path. Derived, never a
                  label anybody maintains, so it is only ever right. */}
              {r.item && (
                <span className="shrink-0 rounded-full border border-line px-1.5 text-[10px] text-muted">
                  {r.item}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
