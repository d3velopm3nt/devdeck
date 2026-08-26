// Stash — the vault surface: search over everything you've copied, a list of
// clips, and a detail pane. Every clip remembers the project you were in when
// you copied it; anything secret-shaped is here as metadata only.

import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon, type IconName } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import { cleanPath, decodeJwt, logSearchTerm, minifyJson, prettifyJson, type DecodedJwt } from '../lib/stashActions'
import { openTerminal } from '../lib/runner'
import { resolveDir } from '../lib/tree'
import type { StashItem, StashType } from '../lib/types'

const TYPE_STYLE: Record<StashType | 'secret', { cls: string; icon: IconName }> = {
  json: { cls: 'bg-sky-500/15 text-sky-400', icon: 'code' },
  sql: { cls: 'bg-violet-500/15 text-violet-400', icon: 'code' },
  url: { cls: 'bg-indigo-500/15 text-indigo-300', icon: 'link' },
  stacktrace: { cls: 'bg-red-500/15 text-err', icon: 'alert' },
  jwt: { cls: 'bg-amber-500/15 text-warn', icon: 'secret' },
  path: { cls: 'bg-emerald-500/10 text-ok', icon: 'folder' },
  uuid: { cls: 'bg-white/5 text-dim', icon: 'clip' },
  hex: { cls: 'bg-white/5 text-dim', icon: 'clip' },
  text: { cls: 'bg-white/5 text-dim', icon: 'clip' },
  secret: { cls: 'bg-amber-500/15 text-warn', icon: 'secret' },
}

const styleFor = (item: StashItem) =>
  item.is_secret ? TYPE_STYLE.secret : (TYPE_STYLE[item.item_type] ?? TYPE_STYLE.text)

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

function TypeBadge({ item }: { item: StashItem }) {
  const s = styleFor(item)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-[2px] font-mono text-[9px] font-bold uppercase tracking-[0.05em] ${s.cls}`}
    >
      <Icon name={s.icon} size={10} />
      {item.is_secret ? 'secret · hidden' : item.item_type}
    </span>
  )
}

function Card({
  item,
  now,
  active,
  onClick,
}: {
  item: StashItem
  now: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`mb-1.5 block w-full rounded-lg border px-3 py-2.5 text-left ${
        active ? 'border-indigo-500/50 bg-raise' : 'border-line bg-panel hover:border-line3'
      }`}
      onClick={onClick}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <TypeBadge item={item} />
        {item.kind === 'note' && <Icon name="note" size={11} className="text-indigo-300" />}
        {item.pinned && <Icon name="star" size={11} className="text-warn" />}
        {item.note && (
          <Icon name="edit" size={10} className="text-muted" />
        )}
        <span className="ml-auto shrink-0 font-mono text-[9.5px] text-muted">
          {fmtAgo(item.created_at, now)}
        </span>
      </div>
      <div className="max-h-[36px] overflow-hidden whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.55] text-dim">
        {item.preview}
        {item.is_secret && <span className="ml-2 text-muted">(value not stored)</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {item.project_name && (
          <span className="rounded-full border border-indigo-500/30 px-1.5 py-[1px] font-mono text-[9.5px] text-indigo-300">
            {item.project_name}
          </span>
        )}
        <span className="rounded-full border border-line2 px-1.5 py-[1px] font-mono text-[9.5px] text-muted">
          {item.is_secret ? item.secret_reason : fmtBytes(item.bytes)}
        </span>
        {item.tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-indigo-500/10 px-1.5 py-[1px] font-mono text-[9.5px] text-indigo-300"
          >
            {t}
          </span>
        ))}
      </div>
    </button>
  )
}

/** Tag chips plus one box that adds them. Comma-separate to add several at
 *  once; existing tags autocomplete so you don't fork "bug" into "Bug". */
function TagRow({ item }: { item: StashItem }) {
  const { addStashTags, removeStashTag, stashCounts } = useApp()
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)

  // Takes the text explicitly rather than reading `draft`: on the keystroke
  // that types a comma, state hasn't caught up yet, and a pasted "a,b," would
  // otherwise commit the stale value.
  const commit = async (raw: string) => {
    const text = raw.trim().replace(/,+$/, '')
    setDraft('')
    if (!text) {
      setOpen(false)
      return
    }
    await addStashTags(item.id, text)
  }

  const suggestions = (stashCounts?.tags ?? [])
    .map((t) => t.name)
    .filter((n) => !item.tags.some((t) => t.toLowerCase() === n.toLowerCase()))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Icon name="tag" size={12} className="text-muted" />
      {item.tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 py-[2px] pl-2 pr-1 font-mono text-[10px] text-indigo-300"
        >
          {t}
          <button
            className="rounded-full px-0.5 text-indigo-300/60 hover:text-ink"
            title={`Remove "${t}"`}
            onClick={() => void removeStashTag(item.id, t)}
          >
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      {open ? (
        <>
          <input
            autoFocus
            list="stash-tag-suggestions"
            className="w-[170px] rounded-full border border-line2 bg-page px-2.5 py-[3px] font-mono text-[10px] text-ink outline-none placeholder:text-faint focus:border-indigo-500"
            placeholder="tag, another tag"
            value={draft}
            onChange={(e) => {
              const v = e.target.value
              setDraft(v)
              // Typing a comma commits that tag immediately, so adding
              // several in a row never needs the mouse.
              if (v.endsWith(',')) void commit(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit(draft)
              if (e.key === 'Escape') {
                setDraft('')
                setOpen(false)
              }
            }}
            onBlur={() => void commit(draft)}
          />
          <datalist id="stash-tag-suggestions">
            {suggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </>
      ) : (
        <button
          className="rounded-full border border-dashed border-line3 px-2 py-[2px] font-mono text-[10px] text-muted hover:border-indigo-500/50 hover:text-dim"
          onClick={() => setOpen(true)}
        >
          + tag
        </button>
      )}
    </div>
  )
}

/**
 * What this clip's type lets you do with it. Only ever shows actions that
 * apply — an empty row beats a row of greyed-out buttons.
 */
function SmartActions({ item, onError }: { item: StashItem; onError: (msg: string) => void }) {
  const { updateStashItem, searchLogs, setRailView, nodes } = useApp()
  const [jwt, setJwt] = useState<DecodedJwt | null>(null)

  useEffect(() => setJwt(null), [item.id])

  const content = item.content ?? ''
  // A flagged clip has no stored value, so there is nothing to act on.
  if (item.is_secret || !content.trim()) return null

  const run = (fn: () => void | Promise<void>) => () => {
    onError('')
    try {
      const r = fn()
      if (r instanceof Promise) void r.catch((e) => onError(String(e)))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const rewrite = (transform: (t: string) => string) => async () => {
    onError('')
    try {
      await updateStashItem({ id: item.id, content: transform(content) })
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const acts: Array<{ label: string; icon: string; title: string; onClick: () => void }> = []

  if (item.item_type === 'json') {
    acts.push({ label: 'Prettify', icon: 'code', title: 'Reformat this clip, indented', onClick: () => void rewrite(prettifyJson)() })
    acts.push({ label: 'Minify', icon: 'code', title: 'Reformat this clip onto one line', onClick: () => void rewrite(minifyJson)() })
  }
  if (item.item_type === 'jwt') {
    acts.push({
      label: jwt ? 'Hide decoded' : 'Decode',
      icon: 'secret',
      title: 'Read the header and claims (shown here only, never stored)',
      onClick: run(() => setJwt(jwt ? null : decodeJwt(content))),
    })
  }
  if (item.item_type === 'url') {
    acts.push({ label: 'Open', icon: 'external', title: 'Open in your default browser', onClick: run(() => ipc.openUrl(content.trim())) })
  }
  if (item.item_type === 'path') {
    acts.push({ label: 'Reveal', icon: 'reveal', title: 'Show this path in Explorer', onClick: run(() => ipc.revealInExplorer(cleanPath(content))) })
  }
  if (item.item_type === 'stacktrace') {
    acts.push({
      label: 'Search logs',
      icon: 'logs',
      title: 'Filter the Logs tab to this error',
      onClick: run(() => searchLogs(logSearchTerm(content))),
    })
  }
  if (item.item_type === 'text' && !content.includes('\n')) {
    acts.push({
      label: 'Send to terminal',
      icon: 'terminal',
      // Deliberately does not press Enter: a stash is full of text copied
      // from places you did not write, and one click should not run it.
      title: 'Open a terminal with this typed in, ready for you to run',
      onClick: run(async () => {
        const project =
          item.project_id != null ? nodes.find((n) => n.id === item.project_id) : null
        const cwd = project ? resolveDir(nodes, project) : undefined
        setRailView('projects')
        const ptyId = await openTerminal(undefined, cwd || undefined, item.title.slice(0, 30))
        // Give the shell a moment to print its prompt before typing.
        setTimeout(() => void ipc.ptyWrite(ptyId, ' ' + content.trim()), 700)
      }),
    })
  }

  if (acts.length === 0) return null

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {acts.map((a) => (
          <button
            key={a.label}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11.5px] text-indigo-300 hover:bg-indigo-500/20"
            title={a.title}
            onClick={a.onClick}
          >
            <Icon name={a.icon} size={12} /> {a.label}
          </button>
        ))}
      </div>
      {jwt && (
        <div className="mt-2 rounded-lg border border-line bg-panel px-3.5 py-3">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.07em] text-muted">Header</div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-body">{jwt.header}</pre>
          <div className="mb-1 mt-2.5 font-mono text-[9px] uppercase tracking-[0.07em] text-muted">Claims</div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-body">{jwt.payload}</pre>
          {jwt.expires && (
            <div className={`mt-2 font-mono text-[10.5px] ${jwt.expired ? 'text-err' : 'text-ok'}`}>
              {jwt.expired ? 'expired' : 'expires'} {jwt.expires}
            </div>
          )}
          <div className="mt-2 text-[11px] leading-snug text-muted">
            Decoded here only — nothing about this token is written to disk beyond the clip itself,
            and a JWT is a bearer credential, so treat it like one.
          </div>
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex-1 rounded-lg border border-line bg-panel px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.07em] text-muted">{label}</div>
      <div className={`mt-0.5 text-[12.5px] ${accent ? 'text-indigo-300' : 'text-ink'}`}>
        {value || '—'}
      </div>
    </div>
  )
}

function Detail({ item, now }: { item: StashItem; now: number }) {
  const { toggleStashPin, deleteStashItem, updateStashItem, stashEditing, setStashEditing } =
    useApp()
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState(item.content ?? '')
  const [note, setNote] = useState(item.note)

  // Selecting another clip resets every draft — a half-typed edit must never
  // leak onto the next item.
  useEffect(() => {
    setCopied('')
    setError('')
    setTitle(item.title)
    setContent(item.content ?? '')
    setNote(item.note)
  }, [item.id, item.title, item.content, item.note])

  const isNote = item.kind === 'note'

  const copy = async () => {
    if (!item.content) return
    try {
      // The backend owns the clipboard write: it arms the echo guard first, so
      // the capture this triggers isn't stashed as a brand new clip.
      await ipc.stashCopy(item.id)
      setCopied('Copied')
    } catch (e) {
      setCopied(`Copy failed: ${e}`)
    }
  }

  const save = async () => {
    setError('')
    try {
      await updateStashItem({ id: item.id, title, content })
      setStashEditing(false)
    } catch (e) {
      // The backend refuses secret-shaped content and says why — show that
      // verbatim instead of a generic failure, and keep the draft on screen.
      setError(String(e))
    }
  }

  const saveNote = async () => {
    if (note === item.note) return
    setError('')
    try {
      await updateStashItem({ id: item.id, note })
    } catch (e) {
      setError(String(e))
    }
  }

  const cancel = () => {
    setTitle(item.title)
    setContent(item.content ?? '')
    setError('')
    setStashEditing(false)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-page">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <TypeBadge item={item} />
        {isNote && (
          <span className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-[2px] font-mono text-[9px] font-bold uppercase tracking-[0.05em] text-indigo-300">
            <Icon name="note" size={10} /> note
          </span>
        )}
        <div className="min-w-0 flex-1">
          {stashEditing ? (
            <input
              className="w-full rounded border border-line2 bg-panel px-2 py-1 text-[13px] font-semibold text-ink outline-none placeholder:text-faint focus:border-indigo-500"
              placeholder="Give it a name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancel()
              }}
            />
          ) : (
            <>
              <div className="truncate text-[13px] font-semibold text-ink">{item.title}</div>
              <div className="font-mono text-[10px] text-muted">
                {isNote ? 'written' : 'captured'} {fmtAgo(item.created_at, now)}
                {item.project_name ? ` · ${item.project_name}` : ''} · {fmtBytes(item.bytes)}
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {copied && (
            <span
              className={`font-mono text-[10px] ${copied.startsWith('Copied') ? 'text-ok' : 'text-err'}`}
            >
              {copied}
            </span>
          )}
          {stashEditing ? (
            <>
              <button className="btn-ghost text-[11.5px]" onClick={cancel}>
                Cancel
              </button>
              <button
                className="btn-primary inline-flex items-center gap-1.5 text-[11.5px]"
                onClick={() => void save()}
              >
                <Icon name="check" size={12} /> Save
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]"
                title={item.pinned ? 'Unpin' : 'Pin — pinned clips sort first'}
                onClick={() => void toggleStashPin(item.id)}
              >
                <Icon name="star" size={12} className={item.pinned ? 'text-warn' : undefined} />
                {item.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]"
                title="Edit the name and text"
                onClick={() => setStashEditing(true)}
              >
                <Icon name="edit" size={12} /> Edit
              </button>
              <button
                className="btn-ghost inline-flex items-center gap-1.5 text-[11.5px]"
                title="Delete this item"
                onClick={() => void deleteStashItem(item.id)}
              >
                <Icon name="delete" size={12} />
              </button>
              {item.content != null && (
                <button
                  className="btn-primary inline-flex items-center gap-1.5 text-[11.5px]"
                  onClick={() => void copy()}
                >
                  <Icon name="copy" size={12} /> Copy
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3.5 py-2.5 text-[12px] leading-[1.6] text-err">
            {error}
          </div>
        )}

        {stashEditing ? (
          <>
            <textarea
              className="min-h-[220px] w-full resize-y whitespace-pre-wrap rounded-lg border border-line2 bg-panel px-3.5 py-3 font-mono text-[12px] leading-[1.7] text-body outline-none placeholder:text-faint focus:border-indigo-500"
              placeholder={item.is_secret ? 'Type a replacement value…' : 'The clip text'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {item.is_secret && (
              <div className="mt-1.5 font-mono text-[10px] text-muted">
                This clip was flagged, so there was no stored value to load. Saving something
                that isn't secret-shaped turns it into an ordinary clip.
              </div>
            )}
          </>
        ) : item.is_secret ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-[12px] leading-[1.6] text-body">
            <div className="mb-1 font-semibold text-warn">
              {item.secret_reason} — the value was never written to disk.
            </div>
            DevDeck kept the shape of this clip (when you copied it, which project you were in,
            roughly how long it was) so you can retrace your steps, and nothing else. There is
            nothing here to copy back out.
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-line bg-panel px-3.5 py-3 font-mono text-[12px] leading-[1.7] text-body">
            {item.content ?? ''}
          </pre>
        )}

        {!stashEditing && <SmartActions item={item} onError={setError} />}

        {/* Tags and the note stay editable outside edit mode — they're what
            you reach for most often, and both feed search. */}
        <div className="mt-3">
          <TagRow item={item} />
        </div>

        <div className="mt-3">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.07em] text-muted">
            Note
          </div>
          <textarea
            className="min-h-[64px] w-full resize-y rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[12px] leading-[1.6] text-body outline-none placeholder:text-faint focus:border-indigo-500"
            placeholder="Why you kept this, what it was for, where it came from… (searchable)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void saveNote()}
          />
        </div>

        <div className="mt-3 flex gap-2.5">
          <Cell
            label={isNote ? 'Written in' : 'Captured while in'}
            value={item.project_name || 'no project'}
            accent={!!item.project_name}
          />
          <Cell label="Source app" value={item.source_app} />
          <Cell label="Used" value={item.used_count === 1 ? 'once' : `${item.used_count} times`} />
        </div>

        <div className="mt-3 rounded-lg border border-line bg-panel px-3.5 py-3 text-[12px] leading-[1.6] text-body">
          <b className="text-ink">Local by default.</b> Clips live in your own SQLite file —
          nothing leaves this machine. Anything shaped like a key, token or password is flagged
          and its value is never stored — including something you type in yourself — and content
          your password manager marks sensitive is skipped entirely.
        </div>
      </div>
    </div>
  )
}

export function StashView() {
  const app = useApp()
  const { stashItems: items, stashDetail: detail, stashStatus: status, stashFilters } = app
  const [q, setQ] = useState(stashFilters.query)
  const [now, setNow] = useState(Date.now())
  const firstRun = useRef(true)

  useEffect(() => {
    void app.refreshStash()
    void app.refreshStashCounts()
    void app.refreshStashStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-render the "2m ago" labels without re-querying.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Debounced search — one query per pause, not per keystroke.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const id = setTimeout(() => app.setStashFilters({ query: q }), 200)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const capturing = status?.enabled ?? true

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line bg-panel px-3 py-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-line2 bg-page px-3 py-1.5">
          <Icon name="search" size={13} className="text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            placeholder="Search everything you've copied…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="text-muted hover:text-ink" title="Clear" onClick={() => setQ('')}>
              <Icon name="close" size={12} />
            </button>
          )}
          {/* Say which search this really is — an FTS5-less build must not
              look like full-text search that found nothing. */}
          <span className="shrink-0 font-mono text-[9.5px] text-muted">
            {status ? (status.fts ? 'full-text · FTS5' : 'substring search') : ''}
          </span>
        </div>
        <button
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[10.5px] ${
            capturing
              ? 'border-emerald-500/30 bg-emerald-500/10 text-ok'
              : 'border-line2 bg-soft text-muted hover:text-dim'
          }`}
          title={capturing ? 'Capturing every copy — click to pause' : 'Capture is paused — click to resume'}
          onClick={() => void app.setStashCapture(!capturing)}
        >
          <span
            className={`h-[7px] w-[7px] rounded-full ${capturing ? 'animate-pulse bg-emerald-400' : 'bg-muted'}`}
          />
          {capturing ? 'capturing' : 'paused'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[44%] min-w-[300px] shrink-0 overflow-auto border-r border-line p-2">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-muted">
              {stashFilters.query ||
              stashFilters.itemType ||
              stashFilters.tag ||
              stashFilters.filter !== 'all'
                ? 'Nothing matches those filters.'
                : capturing
                  ? 'Nothing stashed yet. Copy anything — or write a note — and it lands here.'
                  : 'Capture is paused — new copies are not being stashed.'}
            </div>
          ) : (
            items.map((it) => (
              <Card
                key={it.id}
                item={it}
                now={now}
                active={app.stashSelectedId === it.id}
                onClick={() => void app.selectStashItem(it.id)}
              />
            ))
          )}
        </div>

        {detail ? (
          <Detail item={detail} now={now} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
            {items.length === 0 ? '' : 'Select a clip'}
          </div>
        )}
      </div>
    </div>
  )
}
