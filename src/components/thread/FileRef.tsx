// An inline code span that turns out to be a file you can open.
//
// The rule is: look before offering. A span that is *shaped* like a path
// (`lib/runnable.ts`, `.env.example`) is checked against the node's actual
// files, and only becomes a link when the file is really there. Everything
// else — a class name, a git ref, a file the assistant invented — stays the
// plain code chip it was.
//
// That check is a directory listing rather than a read: one `node_files` call
// per folder, cached for the session, and every path in that folder is then
// free. A message mentioning six files under `src/` costs one call, and reading
// six files to find out they exist would be a strange way to ask.

import { useEffect, useState } from 'react'
import { filesIn } from '../../lib/fileIndex'
import { openFile } from '../../lib/dock'
import { dirOf, looksLikePath, nameOf, normalise, stripLocation } from '../../lib/filepath'

export function FileRef({ text, nodeId }: { text: string; nodeId?: number }) {
  const rel = normalise(stripLocation(text))
  const eligible = nodeId != null && looksLikePath(rel)
  const [real, setReal] = useState(false)

  useEffect(() => {
    if (!eligible || nodeId == null) return
    let alive = true
    void filesIn(nodeId, dirOf(rel)).then((names) => {
      if (alive) setReal(names.has(nameOf(rel)))
    })
    return () => {
      alive = false
    }
  }, [eligible, nodeId, rel])

  const chip =
    'rounded bg-raise px-1 py-px font-mono text-[11.5px] text-ink'

  if (!real) return <code className={chip}>{text}</code>

  return (
    <button
      className={`${chip} cursor-pointer underline decoration-indigo-400/40 decoration-dotted underline-offset-2 hover:bg-hover hover:text-indigo-300`}
      title={`Open ${rel}`}
      onClick={() => openFile(nodeId as number, rel, 'work', nameOf(rel))}
    >
      {text}
    </button>
  )
}
