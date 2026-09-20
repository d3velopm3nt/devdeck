// The library: the skills and briefs you installed, and the way to add more.
//
// Words only. A skill is instructions a worker is given; a brief is who it
// should be for a job. Nothing here runs, which is the only reason importing
// from a stranger's repository is a reasonable thing to do at all — and why
// hooks, MCP configs and install scripts are not importable.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'

export function LibraryPanel({
  items,
  reload,
}: {
  items: ipc.LibraryItem[]
  reload: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [reading, setReading] = useState<{ item: ipc.LibraryItem; text: string } | null>(null)
  const [err, setErr] = useState('')

  const skills = items.filter((i) => i.kind === 'skill')
  const briefs = items.filter((i) => i.kind === 'brief')

  const read = async (it: ipc.LibraryItem) => {
    setErr('')
    try {
      setReading({ item: it, text: await ipc.libraryRead(it.id, it.kind) })
    } catch (e) {
      setErr(String(e))
    }
  }

  const row = (it: ipc.LibraryItem) => (
    <div key={`${it.kind}-${it.id}`} className="group flex items-start gap-2 border-t border-line px-3 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[11.5px] text-ink">{it.id}</span>
          <span className="shrink-0 text-[10px] text-faint">{it.repo}</span>
        </div>
        {it.what && <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{it.what}</div>}
      </div>
      <button className="btn-ghost shrink-0 text-[11px] opacity-0 group-hover:opacity-100" onClick={() => void read(it)}>
        Read
      </button>
      <button
        className="shrink-0 text-[11px] text-muted opacity-0 hover:text-err group-hover:opacity-100"
        title="Remove from the library"
        onClick={() => void ipc.libraryRemove(it.id, it.kind).then(reload)}
      >
        <Icon name="delete" size={12} />
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">The library</span>
        <span className="text-[10.5px] text-faint">
          {skills.length} skill{skills.length === 1 ? '' : 's'} · {briefs.length} brief{briefs.length === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <button className="btn-ghost text-[11px]" onClick={() => setAdding(true)}>
          <Icon name="add" size={12} /> Add from GitHub
        </button>
      </div>

      {err && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11.5px] text-err">{err}</div>}

      {items.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line2 px-4 py-6 text-center">
          <div className="text-[12.5px] text-ink">Nothing in the library yet</div>
          <p className="mx-auto mt-1 max-w-[380px] text-[11.5px] leading-relaxed text-muted">
            A worker with no skills is Claude Code with a job description. Add a few, and every worker you lend them to
            gets better at once.
          </p>
          <button className="btn-primary mt-3 text-[11.5px]" onClick={() => setAdding(true)}>
            <Icon name="add" size={12} /> Add from GitHub
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          {skills.length > 0 && (
            <div className="overflow-hidden rounded-[10px] border border-line bg-panel">
              <div className="border-b border-line bg-raise px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Skills
              </div>
              {skills.map(row)}
            </div>
          )}
          {briefs.length > 0 && (
            <div className="overflow-hidden rounded-[10px] border border-line bg-panel">
              <div className="border-b border-line bg-raise px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Briefs
              </div>
              {briefs.map(row)}
            </div>
          )}
        </div>
      )}

      {adding && (
        <AddFromGitHub
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
      {reading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8" onClick={() => setReading(null)}>
          <div
            className="flex max-h-full w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="font-mono text-[12.5px] text-ink">{reading.item.id}</span>
              <span className="text-[10.5px] text-faint">
                {reading.item.repo} · {reading.item.commit.slice(0, 7)} · {reading.item.licence}
              </span>
              <span className="flex-1" />
              <button className="btn-ghost text-[11.5px]" onClick={() => setReading(null)}>
                Close
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11.5px] leading-relaxed text-body">
              {reading.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function AddFromGitHub({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [repo, setRepo] = useState('')
  const [src, setSrc] = useState<ipc.LibrarySource | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'' | 'look' | 'install'>('')
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('')

  const look = async () => {
    setErr('')
    setBusy('look')
    try {
      const s = await ipc.libraryLook(repo)
      setSrc(s)
      setPicked(new Set())
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy('')
    }
  }

  const install = async () => {
    if (!src) return
    setErr('')
    setBusy('install')
    try {
      await ipc.libraryInstall(src, [...picked])
      onAdded()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy('')
    }
  }

  const shown = (src?.items ?? []).filter(
    (i) =>
      !filter.trim() ||
      i.id.toLowerCase().includes(filter.toLowerCase()) ||
      i.what.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8" onClick={onClose}>
      <div
        className="flex max-h-full w-[860px] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-4">
          <div className="text-[15px] font-semibold text-ink">Add from GitHub</div>
          <p className="mt-1 max-w-[640px] text-[12px] leading-relaxed text-muted">
            Any repository that keeps skills in <code className="font-mono text-dim">skills/name/SKILL.md</code> or briefs
            in <code className="font-mono text-dim">agents/name.md</code>. Read one before you add it: it becomes part of
            what a worker is told.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              className="input flex-1 font-mono text-[12px]"
              placeholder="github.com/owner/name"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void look()}
            />
            <button className="btn-primary text-[12px]" disabled={!repo.trim() || busy !== ''} onClick={() => void look()}>
              {busy === 'look' ? 'Reading…' : 'Read it'}
            </button>
            <button className="btn-ghost text-[12px]" onClick={onClose}>
              Cancel
            </button>
          </div>
          {err && <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11.5px] text-err">{err}</div>}
        </div>

        {src && (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-raise px-5 py-2 text-[11.5px]">
              <span className="font-semibold text-ink">{src.repo}</span>
              <span className="rounded-full bg-emerald-500/15 px-2 text-[9px] font-semibold uppercase tracking-wider text-ok">
                {src.licence}
              </span>
              <span className="font-mono text-[10.5px] text-faint">{src.commit.slice(0, 7)}</span>
              <span className="text-muted">
                {src.items.length} item{src.items.length === 1 ? '' : 's'}
              </span>
              <span className="flex-1" />
              <input
                className="input w-48 py-0.5 text-[11px]"
                placeholder="Filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            {src.note && (
              <div className="flex items-start gap-2 border-b border-line bg-amber-500/5 px-5 py-2 text-[11px] leading-relaxed text-warn">
                <Icon name="info" size={12} className="mt-0.5 shrink-0" />
                {src.note}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {shown.map((i) => {
                const on = picked.has(i.id)
                return (
                  <label
                    key={`${i.kind}-${i.id}`}
                    className={`flex cursor-pointer items-start gap-2.5 border-b border-line px-5 py-2 last:border-b-0 ${
                      on ? 'bg-indigo-500/[0.06]' : 'hover:bg-hover/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-[3px]"
                      checked={on}
                      disabled={i.have}
                      onChange={(e) =>
                        setPicked((cur) => {
                          const next = new Set(cur)
                          if (e.target.checked) next.add(i.id)
                          else next.delete(i.id)
                          return next
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11.5px] text-ink">{i.id}</span>
                        <span className="rounded bg-raise px-1.5 text-[9.5px] uppercase tracking-wider text-muted">{i.kind}</span>
                        {i.have && <span className="text-[10.5px] text-ok">already yours</span>}
                      </div>
                      {i.what && <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{i.what}</div>}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-faint">{i.path}</span>
                  </label>
                )
              })}
              {shown.length === 0 && <div className="px-5 py-6 text-center text-[12px] text-muted">Nothing matches.</div>}
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-raise px-5 py-3">
              <button className="btn-primary text-[12px]" disabled={picked.size === 0 || busy !== ''} onClick={() => void install()}>
                {busy === 'install' ? 'Adding…' : `Add ${picked.size || ''}`.trim()}
              </button>
              <span className="text-[11px] text-muted">Pinned to this commit. Updates are offered, never applied on their own.</span>
              <span className="flex-1" />
              <span className="flex items-center gap-1.5 text-[11px] text-faint">
                <Icon name="secret" size={11} /> Hooks, MCP configs and install scripts are never imported
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The library, loaded once for whoever needs the names. */
export function useLibrary() {
  const [items, setItems] = useState<ipc.LibraryItem[]>([])
  const [err, setErr] = useState('')
  const reload = () => {
    void ipc
      .libraryList()
      .then(setItems)
      .catch((e) => setErr(String(e)))
  }
  useEffect(reload, [])
  return { items, reload, err }
}
