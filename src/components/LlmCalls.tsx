// What the models were actually asked, and what they actually said.
//
// The thread shows the conversation; this shows the call. When an agent runs
// eight turns and touches nothing, the thread says "no summary" and this says
// why — the prompt it was given, the words that came back, the tools it was
// offered, and what the turn cost.
//
// In the bottom bar beside Logs, Processes and Events for the same reason the
// log is: when something surprising happens you want the raw thing, in order,
// without leaving the page you were on.

import { useEffect, useMemo, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import { costOf, money, resolvePricing, shortNumber } from '../lib/usage'

/// A call's tokens, or null when the provider said nothing.
function usageOf(c: ipc.LlmCall) {
  if (c.input_tokens == null) return null
  return {
    input: c.input_tokens ?? 0,
    output: c.output_tokens ?? 0,
    cache_read: c.cache_read_tokens ?? 0,
    cache_write: c.cache_write_tokens ?? 0,
  }
}

function Row({ c }: { c: ipc.LlmCall }) {
  const [open, setOpen] = useState(false)
  const u = usageOf(c)
  const cost = u ? costOf(u, resolvePricing(c.model, c.provider)) : null

  return (
    <div className="border-b border-line">
      <button
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover/40"
        onClick={() => setOpen(!open)}
      >
        <Icon
          name={open ? 'chevron-down' : 'chevron-right'}
          size={11}
          className="shrink-0 text-faint"
        />
        <span className="w-[52px] shrink-0 text-[10.5px] text-faint">
          {fmtAgo(c.at, Date.now())}
        </span>
        <span className="w-[130px] shrink-0 truncate text-[11.5px] text-ink">
          {c.speaker_name || c.speaker}
        </span>
        <span className="w-[180px] shrink-0 truncate font-mono text-[10.5px] text-muted">
          {c.provider === 'mock' ? 'mock' : `${c.provider} · ${c.model}`}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-dim">
          {c.ok ? c.reply.split('\n')[0] || '(no words, tool calls only)' : c.error}
        </span>
        {c.feature && (
          <span className="hidden shrink-0 rounded bg-soft px-1.5 text-[10px] text-muted lg:inline">
            {c.feature}
          </span>
        )}
        <span className="w-[86px] shrink-0 text-right text-[10.5px] text-muted">
          {u ? `${shortNumber(u.input + u.cache_read)}→${shortNumber(u.output)}` : 'not reported'}
        </span>
        <span className="w-[54px] shrink-0 text-right text-[10.5px] text-faint">
          {cost != null ? money(cost) : '—'}
        </span>
        <span className="w-[52px] shrink-0 text-right text-[10.5px] text-faint">
          {(c.ms / 1000).toFixed(1)}s
        </span>
        {!c.ok && <Icon name="alert" size={11} className="shrink-0 text-err" />}
      </button>

      {open && (
        <div className="grid gap-3 bg-app/40 px-3 py-2 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
              In
              <span className="font-normal normal-case tracking-normal">
                {c.prompt_len.toLocaleString()} chars
                {c.prompt.length < c.prompt_len && ' · showing the first 24k'}
                {c.tools > 0 && ` · ${c.tools} tools offered`}
                {c.turn > 0 && ` · turn ${c.turn + 1}`}
              </span>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-page px-2.5 py-2 font-mono text-[10.5px] leading-[1.5] text-dim">
              {c.prompt}
            </pre>
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
              Out
              <span className="font-normal normal-case tracking-normal">
                {c.reply_len.toLocaleString()} chars
                {u && ` · ${u.input} in · ${u.output} out · ${u.cache_read} cached`}
              </span>
            </div>
            <pre
              className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border px-2.5 py-2 font-mono text-[10.5px] leading-[1.5] ${
                c.ok ? 'border-line bg-page text-dim' : 'border-red-500/25 bg-red-500/[0.06] text-err'
              }`}
            >
              {c.ok ? c.reply || '(no words — the model answered with tool calls only)' : c.error}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export function LlmCalls() {
  const [calls, setCalls] = useState<ipc.LlmCall[] | null>(null)
  const [err, setErr] = useState('')
  const [who, setWho] = useState('')
  const [model, setModel] = useState('')
  const [q, setQ] = useState('')

  const load = () =>
    ipc
      .callsList(300)
      .then((c) => {
        setCalls(c)
        setErr('')
      })
      .catch((e) => setErr(String(e)))

  useEffect(() => {
    void load()
    // Cheap, and a panel that needs a button to be current is a panel you
    // stop trusting mid-session.
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [])

  const speakers = useMemo(
    () => Array.from(new Set((calls ?? []).map((c) => c.speaker_name || c.speaker))).sort(),
    [calls],
  )
  const models = useMemo(
    () =>
      Array.from(
        new Set((calls ?? []).map((c) => (c.provider === 'mock' ? 'mock' : `${c.provider} · ${c.model}`))),
      ).sort(),
    [calls],
  )

  const shown = (calls ?? []).filter((c) => {
    if (who && (c.speaker_name || c.speaker) !== who) return false
    if (model && (c.provider === 'mock' ? 'mock' : `${c.provider} · ${c.model}`) !== model) return false
    if (q && !(c.prompt + c.reply + c.error).toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <select
          className="input h-[24px] w-[150px] py-0 text-[11px]"
          value={who}
          onChange={(e) => setWho(e.target.value)}
        >
          <option value="">Everyone</option>
          {speakers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input h-[24px] w-[200px] py-0 text-[11px]"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">Every provider and model</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="input h-[24px] min-w-0 flex-1 py-0 text-[11px]"
          placeholder="Find in prompts and replies…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="shrink-0 text-[10.5px] text-faint">
          {shown.length} of {calls?.length ?? 0}
        </span>
        <button className="btn-ghost shrink-0 text-[11px]" onClick={() => void load()}>
          <Icon name="update" size={11} />
        </button>
      </div>

      {err && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/[0.06] px-3 py-1.5 text-[11px] text-err">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {calls == null ? (
          <div className="px-3 py-6 text-center text-[11.5px] text-muted">Reading the log…</div>
        ) : shown.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11.5px] leading-relaxed text-muted">
            {calls.length === 0
              ? 'No model calls yet. Every turn a bot, an agent or the assistant takes is written down here — what it was asked, what came back, and what it cost.'
              : 'Nothing matches those filters.'}
          </div>
        ) : (
          shown.map((c) => <Row key={c.id} c={c} />)
        )}
      </div>
    </div>
  )
}
