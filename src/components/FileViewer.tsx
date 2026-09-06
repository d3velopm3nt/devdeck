// A file from the tree, in an editor, as a document.
//
// It opens in the dock beside terminals and space pages, because that is what
// the surface is for — you get tabs, splits and a file open next to the
// terminal you are running it in, without any of that being written here.
//
// **Read-only, on purpose.** Most of what a vault holds is written by a bot:
// `work.md` is rewritten when an item moves, `_bot.md` when a routine changes.
// A cursor landing in one of those and a stray keystroke is a merge conflict
// with your own agent. Editing is a deliberate act and gets its own decision;
// this is the reading half, which is what was actually missing.
//
// The editor follows the app's theme, from the same CSS variables everything
// else uses — an editor with its own idea of "dark" is the one panel that
// stops following the theme switch and looks broken every time.

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import * as ipc from '../lib/ipc'
import type { FileText } from '../lib/ipc'
import { languageOf, monaco, useAppTheme } from '../lib/monaco'
import { useApp } from '../store'

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1_048_576).toFixed(1)} MB`

export function FileViewer({
  nodeId,
  rel,
  root,
}: {
  nodeId: number
  rel: string
  /// `whole` reads from the vault root and ignores the node entirely.
  root: 'work' | 'vault' | 'whole'
}) {
  const theme = useApp((s) => s.theme)
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [file, setFile] = useState<FileText | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setFile(null)
    setErr('')
    void (root === 'whole' ? ipc.vaultFileText(rel) : ipc.fileText(nodeId, rel, root))
      .then(setFile)
      // A file that could not be read and a file that is empty must never
      // render the same.
      .catch((e) => setErr(String(e)))
  }, [nodeId, rel, root])

  // One editor for the life of the panel; the model is swapped when the file
  // changes. Creating a new editor per file leaks workers and loses the
  // scroll position of the one you came back to.
  useEffect(() => {
    if (!host.current || editor.current) return
    editor.current = monaco.editor.create(host.current, {
      value: '',
      readOnly: true,
      // A read-only editor that still shows a blinking cursor is telling you
      // to type into it.
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
      fontSize: 12,
      lineHeight: 19,
      fontFamily: 'Cascadia Mono, Consolas, ui-monospace, monospace',
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      smoothScrolling: true,
      theme: useAppTheme(theme === 'light' ? 'light' : 'dark'),
    })
    return () => {
      editor.current?.getModel()?.dispose()
      editor.current?.dispose()
      editor.current = null
    }
  }, [])

  // The theme is re-derived from the live CSS variables, so flipping the app
  // moves the editor with it.
  useEffect(() => {
    if (!editor.current) return
    monaco.editor.setTheme(useAppTheme(theme === 'light' ? 'light' : 'dark'))
  }, [theme])

  useEffect(() => {
    const ed = editor.current
    if (!ed || !file) return
    const old = ed.getModel()
    const model = monaco.editor.createModel(
      file.readable ? file.text : '',
      languageOf(rel.split('/').pop() ?? rel),
    )
    ed.setModel(model)
    old?.dispose()
  }, [file, rel])

  const name = rel.split('/').pop() ?? rel

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <Icon name="note" size={12} className="shrink-0 text-dim" />
        <span className="shrink-0 text-[12px] text-ink">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint" title={file?.path}>
          {rel}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.04em] ${
            root === 'vault' ? 'bg-indigo-500/14 text-indigo-400' : 'bg-slate-500/14 text-dim'
          }`}
        >
          {root === 'vault' ? 'vault' : 'repo'}
        </span>
        {file && <span className="shrink-0 text-[10px] text-faint">{size(file.bytes)}</span>}
        <button
          className="btn-ghost shrink-0 px-1.5 text-[11px]"
          title="Show it in File Explorer"
          onClick={() => file && void ipc.revealInExplorer(file.path)}
        >
          <Icon name="folder" size={12} />
        </button>
      </div>

      {err && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[11.5px] text-err">
          {err}
        </div>
      )}

      {file && !file.readable && (
        <div className="shrink-0 border-b border-line bg-raise px-3 py-2 text-[11.5px] leading-[1.6] text-muted">
          {file.why} Nothing is shown rather than a screenful of noise — open it in File Explorer
          if you need it.
        </div>
      )}

      {file?.truncated && (
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.06] px-3 py-1.5 text-[11px] text-warn">
          Showing the first 2 MB of {size(file.bytes)}.
        </div>
      )}

      <div ref={host} className="min-h-0 flex-1" />

      <div className="flex shrink-0 items-center gap-3 border-t border-line px-3 py-1 text-[10px] text-faint">
        <span className="font-mono">{languageOf(name)}</span>
        <span className="ml-auto">
          Read-only — a bot writes most of these, and a stray keystroke here is a conflict with
          your own agent.
        </span>
      </div>
    </div>
  )
}
