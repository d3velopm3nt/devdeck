// Rendering what the assistant actually writes.
//
// This replaced `whitespace-pre-wrap`. The comment it replaced said a
// half-working Markdown renderer that mangles a path or a snippet is worse
// than none, and that was true — but the premise underneath it had stopped
// being true. The assistant writes fenced code blocks, bold headings and
// numbered steps, and showing them as literal backticks and asterisks does not
// avoid the mangling, it guarantees it.
//
// So: a real CommonMark + GFM parser (`react-markdown` + `remark-gfm`) rather
// than a regex pass of our own, because parsing is the part that goes wrong,
// and every element mapped to the app's own tokens so it themes with
// everything else.
//
// Two things are deliberately not here:
//
//   * **No raw HTML.** `react-markdown` ignores it unless you add a plugin,
//     and we do not. Model output is not trusted markup.
//   * **No syntax highlighting.** It is weight for a small gain, and a
//     highlighter that guesses the wrong language colours a shell command
//     like broken JavaScript. A language label and a mono font say enough.

import { memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../../lib/icons'
import { CodeBlock } from './CodeBlock'

/// Run a text transform (the @mention pills) over the strings inside a node,
/// leaving every element alone.
///
/// Markdown gives us children that are a mix of strings and elements — "ask
/// @dev-a about " then a `<strong>`. Applying the transform to the whole
/// subtree would re-run it over code spans, where an `@` is an `@`.
function mapText(children: ReactNode, fn?: (t: string) => ReactNode): ReactNode {
  if (!fn) return children
  if (typeof children === 'string') return fn(children)
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === 'string' ? <span key={i}>{fn(c)}</span> : c,
    )
  }
  return children
}

export const Markdown = memo(function Markdown({
  text,
  renderText,
  /** Where a Run button should open its terminal. Empty disables Run. */
  dir,
}: {
  text: string
  renderText?: (t: string) => ReactNode
  dir?: string
}) {
  const T = (children: ReactNode) => mapText(children, renderText)

  return (
    <div className="text-[12.5px] leading-[1.65] text-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Paragraphs carry the rhythm. `last:mb-0` so a bubble does not end
          // in a gap the avatar column has to sit beside.
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{T(children)}</p>,

          // Headings inside a chat bubble are section markers, not page
          // titles — they step down in weight, not in size, or one answer
          // starts shouting over the next.
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-3 text-[14px] font-semibold text-ink first:mt-0">
              {T(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-3 text-[13.5px] font-semibold text-ink first:mt-0">
              {T(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2.5 text-[12.5px] font-semibold text-ink first:mt-0">
              {T(children)}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-2.5 text-[12.5px] font-semibold text-body first:mt-0">
              {T(children)}
            </h4>
          ),

          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{T(children)}</strong>
          ),
          em: ({ children }) => <em className="italic">{T(children)}</em>,
          del: ({ children }) => (
            <del className="text-muted line-through">{T(children)}</del>
          ),

          ul: ({ children }) => (
            <ul className="mb-2.5 ml-4 list-disc space-y-1 last:mb-0 marker:text-faint">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2.5 ml-4 list-decimal space-y-1 last:mb-0 marker:text-faint">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{T(children)}</li>,

          blockquote: ({ children }) => (
            <blockquote className="mb-2.5 border-l-2 border-line3 pl-3 text-muted last:mb-0">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="my-3 border-0 border-t border-line" />,

          // Links open in the real browser. A WebView is not a browser, and a
          // page that navigates the app away from itself has no back button.
          a: ({ href, children }) => (
            <a
              className="text-indigo-400 underline decoration-indigo-400/40 underline-offset-2 hover:decoration-indigo-400"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              {T(children)}
              <Icon name="external" size={10} className="ml-0.5 inline align-baseline" />
            </a>
          ),

          // A wide table scrolls inside itself rather than stretching the
          // bubble past the panel.
          table: ({ children }) => (
            <div className="mb-2.5 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-[11.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-line bg-raise px-2 py-1 text-left font-semibold text-ink">
              {T(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-line px-2 py-1 align-top">{T(children)}</td>
          ),

          // `pre` is where fenced blocks arrive. It is overridden rather than
          // `code` because the block chrome — language, copy, run — belongs to
          // the block, and `code` cannot tell reliably whether it is inside
          // one.
          pre: ({ children }) => <CodeBlock node={children} dir={dir} />,

          // Which leaves `code` handling inline spans only: `--ff-only`, a
          // path, a flag.
          code: ({ children }) => (
            <code className="rounded bg-raise px-1 py-px font-mono text-[11.5px] text-ink">
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
