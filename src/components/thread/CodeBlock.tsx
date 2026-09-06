// A fenced code block, with the two things you actually want to do with one.
//
// **Copy** always. **Run** only when the block is a command (see
// `lib/runnable.ts` for the rule, which is a whitelist rather than a guess).
//
// Run opens a real terminal in the space's own directory and types the
// command into it. It does not run anything invisibly and it does not report
// back a result it did not watch: you get the terminal, the command is on the
// prompt line, and the output is where output goes. That is the honest
// version — an assistant suggesting `git stash drop` and a button that
// silently did it is a different and much worse product.
//
// Multi-line blocks send every line in order. Comments and blank lines are
// dropped, because `#` is not a comment in cmd.exe.

import { useState, type ReactNode } from 'react'
import { Icon } from '../../lib/icons'
import { commandLines, looksRunnable } from '../../lib/runnable'
import { openTerminal } from '../../lib/runner'
import * as ipc from '../../lib/ipc'

/// Pull the language and the raw text back out of what `react-markdown` hands
/// a `pre`: a single `code` element carrying `className="language-xxx"`.
///
/// Defensive because this is the one place we read someone else's element
/// shape. A block we cannot read still renders — as a plain block, with copy
/// and without run.
function unwrap(node: ReactNode): { lang: string; text: string } {
  const el = Array.isArray(node) ? node[0] : node
  const props =
    el && typeof el === 'object' && 'props' in el
      ? (el.props as { className?: string; children?: ReactNode })
      : null
  if (!props) return { lang: '', text: typeof node === 'string' ? node : '' }
  const lang = /language-([\w-]+)/.exec(props.className ?? '')?.[1] ?? ''
  const kids = props.children
  const text =
    typeof kids === 'string'
      ? kids
      : Array.isArray(kids)
        ? kids.filter((k) => typeof k === 'string').join('')
        : ''
  // Markdown always ends a fenced block with a newline; it is not content.
  return { lang, text: text.replace(/\n$/, '') }
}

export function CodeBlock({ node, dir }: { node: ReactNode; dir?: string }) {
  const { lang, text } = unwrap(node)
  const [copied, setCopied] = useState(false)
  const [ran, setRan] = useState<'no' | 'opening' | 'sent'>('no')
  const [err, setErr] = useState<string | null>(null)

  // Run needs somewhere to run. Without a directory the button is not drawn
  // at all rather than drawn and refusing — a button that cannot work is a
  // question you have to answer by clicking it.
  const runnable = !!dir && looksRunnable(lang, text)
  const lines = runnable ? commandLines(text) : []

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const run = async () => {
    if (lines.length === 0) return
    setRan('opening')
    setErr(null)
    try {
      const ptyId = await openTerminal(undefined, dir, lines[0].slice(0, 40))
      // A beat before typing: a freshly spawned ConPTY drops the first
      // keystroke if it has not printed its prompt yet, which is how `npx …`
      // becomes `px …`. The leading space absorbs one lost character.
      window.setTimeout(() => {
        void (async () => {
          for (const line of lines) {
            await ipc.ptyWrite(ptyId, ' ' + line + '\r')
          }
        })()
      }, 900)
      setRan('sent')
      window.setTimeout(() => setRan('no'), 2000)
    } catch (e) {
      setRan('no')
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="group/code mb-2.5 overflow-hidden rounded-md border border-line bg-app last:mb-0">
      <div className="flex items-center gap-1.5 border-b border-line bg-raise px-2.5 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
          {/* An unlabelled block we recognised as commands says so. Calling it
              "text" next to a Run button is the label disagreeing with the
              button beside it. */}
          {lang || (runnable ? 'shell' : 'text')}
        </span>
        {lines.length > 1 && (
          <span className="text-[10px] text-faint">· {lines.length} commands</span>
        )}
        <span className="flex-1" />
        {err && <span className="truncate text-[10px] text-err">{err}</span>}
        {runnable && (
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-dim hover:bg-hover hover:text-ink"
            title={
              lines.length > 1
                ? `Open a terminal here and run all ${lines.length} lines`
                : `Open a terminal here and run: ${lines[0]}`
            }
            disabled={ran === 'opening'}
            onClick={() => void run()}
          >
            <Icon
              name={ran === 'sent' ? 'check' : 'run'}
              size={11}
              className={ran === 'sent' ? 'text-ok' : ''}
            />
            {ran === 'opening' ? 'Opening…' : ran === 'sent' ? 'In terminal' : 'Run'}
          </button>
        )}
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-dim hover:bg-hover hover:text-ink"
          title="Copy"
          onClick={() => void copy()}
        >
          <Icon name={copied ? 'check' : 'copy'} size={11} className={copied ? 'text-ok' : ''} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-body">
        <code>{text}</code>
      </pre>
    </div>
  )
}
