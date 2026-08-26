// The capture toast: proof that DevDeck picked up what you just copied, and
// the fastest moment to say what it was. It lives in its own transparent,
// always-on-top window.
//
// The rule this file exists to keep: **it must never steal focus.** You copy
// something while typing in another app; a toast that grabs the keyboard is
// worse than no toast. So it's shown via SW_SHOWNOACTIVATE from Rust, and only
// asks for focus at the one moment you want it — when you click Configure.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import type { StashItem } from '../lib/types'

const COLLAPSED = { w: 340, h: 92 }
const EXPANDED = { w: 340, h: 330 }
/** How long a toast sits there before fading out on its own. */
const DISMISS_MS = 6000

const TYPE_CLS: Record<string, string> = {
  json: 'bg-sky-500/15 text-sky-400',
  sql: 'bg-violet-500/15 text-violet-400',
  url: 'bg-indigo-500/15 text-indigo-300',
  stacktrace: 'bg-red-500/15 text-err',
  jwt: 'bg-amber-500/15 text-warn',
  path: 'bg-emerald-500/10 text-ok',
}

export function CaptureToast() {
  const [item, setItem] = useState<StashItem | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  /** When to fade out, or null to stay. A deadline polled on an interval
   *  rather than one long setTimeout: this window never has focus, and
   *  browsers throttle timers hard in unfocused windows — a 6s timeout can
   *  simply not fire, leaving the toast stuck on screen. */
  const dismissAt = useRef<number | null>(null)

  const hide = useCallback(() => {
    dismissAt.current = null
    setItem(null)
    setExpanded(false)
    setError('')
    void ipc.toastHide()
  }, [])

  const armDismiss = useCallback(() => {
    dismissAt.current = Date.now() + DISMISS_MS
  }, [])

  const holdOpen = useCallback(() => {
    dismissAt.current = null
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (dismissAt.current != null && Date.now() >= dismissAt.current) hide()
    }, 400)
    return () => window.clearInterval(id)
  }, [hide])

  // If this component ever remounts while the window is up (a dev reload),
  // the window would be left on screen with no item behind it.
  useEffect(() => void ipc.toastHide(), [])

  useEffect(() => {
    const un = ipc.onStashItem(async (captured) => {
      // Honour the setting at capture time — cheap, and it means toggling it
      // in Settings takes effect immediately without a restart.
      const status = await ipc.stashStatus().catch(() => null)
      if (!status?.toast) return
      setItem(captured)
      setExpanded(false)
      setTitle(captured.title)
      setNote(captured.note)
      setTags('')
      setError('')
      await ipc.toastShow(COLLAPSED.w, COLLAPSED.h).catch(() => {})
      armDismiss()
    })
    return () => void un.then((u) => u())
  }, [armDismiss])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hide])

  if (!item) return null

  const configure = async () => {
    holdOpen()
    setExpanded(true)
    await ipc.toastShow(EXPANDED.w, EXPANDED.h)
    // Only now do we want the keyboard — you asked to type.
    await ipc.toastFocus()
  }

  const save = async () => {
    setError('')
    try {
      if (title !== item.title || note !== item.note) {
        await ipc.stashUpdate({ id: item.id, title, note })
      }
      if (tags.trim()) await ipc.stashTagAdd(item.id, [tags])
      await ipc.emitStashChanged()
      hide()
    } catch (e) {
      // Most likely the secret guardrail refusing an edited value. Show it.
      setError(String(e))
    }
  }

  const badge = item.is_secret
    ? 'bg-amber-500/15 text-warn'
    : (TYPE_CLS[item.item_type] ?? 'bg-white/5 text-dim')

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-line2 bg-menu shadow-2xl"
      onMouseEnter={holdOpen}
      onMouseLeave={() => !expanded && armDismiss()}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-[2px] font-mono text-[9px] font-bold uppercase tracking-[0.05em] ${badge}`}
        >
          {item.is_secret ? 'secret · hidden' : item.item_type}
        </span>
        <span className="font-mono text-[9.5px] text-muted">stashed</span>
        {item.project_name && (
          <span className="truncate rounded-full border border-indigo-500/30 px-1.5 py-[1px] font-mono text-[9.5px] text-indigo-300">
            {item.project_name}
          </span>
        )}
        <button
          className="ml-auto shrink-0 rounded p-0.5 text-muted hover:text-ink"
          title="Dismiss"
          onClick={hide}
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      <div className="truncate px-3 pt-1 font-mono text-[11px] text-dim">
        {item.is_secret ? (
          <span className="text-warn">{item.secret_reason} — value not stored</span>
        ) : (
          item.preview.split('\n')[0]
        )}
      </div>

      {!expanded ? (
        <div className="mt-auto flex items-center gap-2 px-3 pb-2.5">
          <button
            className="btn-ghost inline-flex items-center gap-1.5 text-[11px]"
            onClick={() => void configure()}
          >
            <Icon name="edit" size={11} /> Configure
          </button>
          <span className="ml-auto font-mono text-[9px] text-faint">esc dismisses</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2.5 pt-2">
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[10.5px] leading-snug text-err">
              {error}
            </div>
          )}
          <input
            autoFocus
            className="input w-full text-[12px]"
            placeholder="Name it"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="input w-full font-mono text-[11px]"
            placeholder="tags, comma separated"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <textarea
            className="input min-h-[70px] flex-1 resize-none text-[11.5px] leading-snug"
            placeholder="Note — why you kept this (searchable)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              // Enter saves from the note too; Shift+Enter is a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void save()
              }
            }}
          />
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-[11px]" onClick={hide}>
              Cancel
            </button>
            <button
              className="btn-primary ml-auto inline-flex items-center gap-1.5 text-[11px]"
              onClick={() => void save()}
            >
              <Icon name="check" size={11} /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
