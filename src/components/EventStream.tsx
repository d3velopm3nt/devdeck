// Every event the AI Workspace has processed, as it happens.
//
// The Assistant's Activity page shows the same bus filtered by category and
// read as prose — what happened, in words. This is the other view of it: the
// raw ordered stream, sequence numbers and all, in the bottom bar beside Logs
// and Processes where you go when you want to know what the machine actually
// did rather than what it decided to tell you.
//
// It belongs down here for the same reason the log does. When an agent does
// something surprising, "read the narrated summary" is the wrong tool; you
// want the events in order, with the ids that tie them together, and you want
// them without leaving the page you were on.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAiw } from '../lib/aiwStore'
import { aiw, describeEvent } from '../lib/aiw'
import { Icon } from '../lib/icons'

/// The colour of a kind of event. Failures are the only red, conflicts the
/// only amber — a stream where everything is coloured is one where nothing
/// stands out.
function tone(type: string): string {
  if (type.endsWith('.failed') || type.endsWith('.denied')) return 'text-err'
  if (type.startsWith('conflict')) return 'text-warn'
  if (type.startsWith('approval')) return 'text-viol'
  if (type.startsWith('agent') || type.startsWith('session')) return 'text-ok'
  return 'text-dim'
}

export function EventStream() {
  const a = useAiw()
  const [q, setQ] = useState('')
  const [follow, setFollow] = useState(true)
  const [raw, setRaw] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // The bus is subscribed here as well as in the Assistant, because the bottom
  // bar is visible from every view and the point of this panel is that you do
  // not have to be looking at the Assistant to see what agents are doing.
  useEffect(() => {
    if (!a.ready) void a.bootstrap()
    let stop: (() => void) | undefined
    void aiw.onEvent((e) => a.pushEvent(e)).then((un) => {
      stop = un
    })
    return () => stop?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? a.events.filter(
          (e) =>
            e.type.toLowerCase().includes(needle) ||
            describeEvent(e).toLowerCase().includes(needle) ||
            (e.agent_id ?? '').toLowerCase().includes(needle) ||
            (e.project_id ?? '').toLowerCase().includes(needle),
        )
      : a.events
    // The bus hands them out newest first; read in the order they happened.
    return [...list].sort((x, y) => x.seq - y.seq)
  }, [a.events, q])

  useEffect(() => {
    if (follow) box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [rows.length, follow])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <input
          className="input h-6 w-[220px] px-2 py-0 text-[11px]"
          placeholder="Filter events…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-[10.5px] text-faint">
          {rows.length}
          {q.trim() && ` of ${a.events.length}`}
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[10.5px] text-muted">
          <input
            type="checkbox"
            className="h-3 w-3 accent-indigo-500"
            checked={raw}
            onChange={(e) => setRaw(e.target.checked)}
          />
          Raw type
        </label>
        <label className="flex items-center gap-1.5 text-[10.5px] text-muted">
          <input
            type="checkbox"
            className="h-3 w-3 accent-indigo-500"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow
        </label>
      </div>

      <div ref={box} className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11.5px] text-muted">
            {a.events.length === 0 ? (
              <>
                <Icon name="history" size={13} className="text-faint" />
                Nothing on the bus yet. Agents, bots and approvals all report here.
              </>
            ) : (
              <>Nothing matches “{q.trim()}”.</>
            )}
          </div>
        ) : (
          rows.map((e) => (
            <div key={e.id} className="flex items-baseline gap-2 px-2 py-[3px] hover:bg-hover/30">
              <span className="w-[46px] shrink-0 text-right text-faint">{e.seq}</span>
              <span className="w-[62px] shrink-0 text-muted">
                {new Date(e.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className={`min-w-0 flex-1 ${tone(e.type)}`}>
                {raw ? e.type : describeEvent(e)}
              </span>
              {e.agent_id && <span className="shrink-0 text-faint">{e.agent_id}</span>}
              {e.project_id && <span className="shrink-0 text-faint">·{e.project_id}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
