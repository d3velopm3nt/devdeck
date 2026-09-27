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
import * as ipc from '../lib/ipc'
import type { DomainEvent } from '../lib/aiw'
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
  // The bus keeps five thousand events in memory and loses them all when the
  // app stops. They are written to the database now, so there is a past to
  // look at — and the only division of it anyone asks for is "since I opened
  // this" against "ever".
  const [scope, setScope] = useState<'session' | 'all'>('session')
  const [kept, setKept] = useState<DomainEvent[]>([])
  const [counts, setCounts] = useState<[number, number]>([0, 0])
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void ipc
      .eventsHistory(scope === 'session', undefined, 2000)
      .then((rows) => setKept(rows as unknown as DomainEvent[]))
      .catch(() => setKept([]))
    void ipc.eventsCount().then(setCounts).catch(() => {})
  }, [scope, a.events.length])

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
    // The live feed and the kept one overlap by design: an event arrives on
    // the bus and is written at the same moment. Merged by id so it appears
    // once, and so the newest rows are there before the database is re-read.
    const seen = new Set<string>()
    const merged = [...a.events, ...kept].filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
    const list = needle
      ? merged.filter(
          (e) =>
            e.type.toLowerCase().includes(needle) ||
            describeEvent(e).toLowerCase().includes(needle) ||
            (e.agent_id ?? '').toLowerCase().includes(needle) ||
            (e.project_id ?? '').toLowerCase().includes(needle),
        )
      : merged
    // The bus hands them out newest first; read in the order they happened.
    return [...list].sort((x, y) => x.seq - y.seq)
  }, [a.events, kept, q])

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
          {q.trim() && ' shown'}
        </span>
        <div className="flex-1" />
        <div className="flex items-center overflow-hidden rounded border border-line2">
          {(['session', 'all'] as const).map((k) => (
            <button
              key={k}
              className={`px-2 py-[1px] text-[10.5px] ${
                scope === k ? 'bg-indigo-500/15 text-ink' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setScope(k)}
            >
              {k === 'session' ? `This session · ${counts[1]}` : `All · ${counts[0]}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[10.5px] text-muted">
          <input
            type="checkbox"
            className="h-3 w-3 accent-indigo-500"
            checked={raw}
            onChange={(e) => setRaw(e.target.checked)}
          />
          Payload
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

      {/* A header row, because four unlabelled columns is a puzzle. It does not
          scroll with the list: knowing which column is which matters most when
          you are a long way down. */}
      {rows.length > 0 && (
        <div className="flex shrink-0 items-baseline gap-2 border-b border-line px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          <span className="w-[42px] shrink-0 text-right">#</span>
          <span className="w-[112px] shrink-0">When</span>
          <span className="w-[132px] shrink-0">Type</span>
          <span className="w-[96px] shrink-0">Who</span>
          <span className="min-w-0 flex-1">What happened</span>
          <span className="w-[52px] shrink-0 text-right">Space</span>
        </div>
      )}

      <div ref={box} className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11.5px] text-muted">
            {a.events.length === 0 ? (
              <>
                <Icon name="history" size={13} className="text-faint" />
                {scope === 'session'
                  ? 'Nothing yet this session. Agents, bots and approvals all report here.'
                  : 'Nothing has ever been recorded here.'}
              </>
            ) : (
              <>Nothing matches “{q.trim()}”.</>
            )}
          </div>
        ) : (
          rows.map((e) => {
            const at = new Date(e.timestamp)
            return (
              <div key={e.id}>
                <div className="flex items-baseline gap-2 px-2 py-[3px] hover:bg-hover/30">
                  <span className="w-[42px] shrink-0 text-right text-faint">{e.seq}</span>
                  <span className="w-[112px] shrink-0 text-muted" title={at.toLocaleString()}>
                    {at.toLocaleDateString([], { day: '2-digit', month: 'short' })}{' '}
                    {at.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className={`w-[132px] shrink-0 truncate ${tone(e.type)}`} title={e.type}>
                    {e.type}
                  </span>
                  <span
                    className="w-[96px] shrink-0 truncate text-dim"
                    title={e.agent_id ?? 'nobody named'}
                  >
                    {e.agent_id ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body" title={describeEvent(e)}>
                    {describeEvent(e)}
                  </span>
                  <span className="w-[52px] shrink-0 truncate text-right text-faint">
                    {e.project_id ?? ''}
                  </span>
                </div>
                {raw && (
                  <pre className="mx-2 mb-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-raise px-2 py-1 text-[10px] leading-relaxed text-muted">
                    {JSON.stringify(e.payload ?? {}, null, 1)}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
