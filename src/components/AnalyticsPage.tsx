// Analytics — what the AI is costing, across every space.
//
// The same rows the call log shows one at a time, added up three ways: by
// space, by who was speaking, and by model. Costing is ported from
// x-platform's `ai-usage` package, so the two agree on the arithmetic:
// four token categories priced separately, because a cache read is a tenth of
// fresh input and an output token is five times it.
//
// Two rules this page keeps, both learned the hard way elsewhere in this app:
//
//   * **A provider that reported nothing is not zero.** Those calls are
//     counted separately and named, so a total is never quietly an average
//     over half the data.
//   * **The money is an estimate and says so.** No invoice is being read;
//     these are list prices against counted tokens.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { costOf, money, resolvePricing, shortNumber, totalTokens } from '../lib/usage'

const WINDOWS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 365, label: 'A year' },
]

/// What a group of calls cost, priced per model where we know the model and
/// at the group's own rate otherwise.
function rowCost(r: ipc.UsageRow, byModel: boolean): number {
  const pricing = resolvePricing(byModel ? r.key : null, r.provider)
  return costOf(
    { input: r.input, output: r.output, cache_read: r.cache_read, cache_write: r.cache_write },
    pricing,
  )
}

function Table({
  title,
  blurb,
  rows,
  byModel = false,
  empty,
}: {
  title: string
  blurb: string
  rows: ipc.UsageRow[]
  byModel?: boolean
  empty: string
}) {
  const max = Math.max(1, ...rows.map((r) => totalTokens(r)))
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="text-[10.5px] text-muted">{blurb}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-4 text-[11.5px] text-muted">{empty}</div>
      ) : (
        rows.map((r) => {
          const total = totalTokens(r)
          return (
            <div
              key={r.key || r.label}
              className="grid grid-cols-[minmax(0,1fr)_90px_110px_70px_70px] items-center gap-3 border-t border-line px-4 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] text-ink">
                  {r.label || r.key || 'unattributed'}
                </div>
                <div className="mt-1 h-[3px] overflow-hidden rounded bg-line">
                  <span
                    className="block h-full bg-indigo-500"
                    style={{ width: `${Math.round((total / max) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="text-right text-[11px] text-muted">
                {r.calls} call{r.calls === 1 ? '' : 's'}
                {r.unreported > 0 && (
                  <span className="block text-[10px] text-warn">{r.unreported} not reported</span>
                )}
              </div>
              <div className="text-right text-[11px] text-dim">
                {shortNumber(r.input + r.cache_read)} in · {shortNumber(r.output)} out
              </div>
              <div className="text-right text-[11px] text-muted">
                {shortNumber(r.cache_read)} cached
              </div>
              <div className="text-right text-[12px] font-semibold text-ink">
                {money(rowCost(r, byModel))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [report, setReport] = useState<ipc.UsageReport | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(
    (d: number) =>
      ipc
        .callsUsage(d)
        .then((r) => {
          setReport(r)
          setErr('')
        })
        // An empty page and a failed read must not look the same.
        .catch((e) => setErr(String(e))),
    [],
  )

  useEffect(() => {
    void load(days)
  }, [days, load])

  const totalCost = (report?.by_model ?? []).reduce((sum, r) => sum + rowCost(r, true), 0)
  const totalIn = (report?.input ?? 0) + (report?.cache_read ?? 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Analytics</h2>
          <p className="text-[11.5px] text-muted">
            What the AI is costing, across every space. Every turn a bot, an agent or the assistant
            takes.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                days === w.days
                  ? 'border-line2 bg-raise text-ink'
                  : 'border-line text-muted hover:text-dim'
              }`}
              onClick={() => setDays(w.days)}
            >
              {w.label}
            </button>
          ))}
          <button className="btn-ghost text-[11px]" onClick={() => void load(days)}>
            <Icon name="update" size={12} />
          </button>
        </div>
      </div>

      {err && (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/[0.06] px-5 py-2 text-[11.5px] text-err">
          {err}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {report == null && !err ? (
          <div className="py-10 text-center text-[12px] text-muted">Adding it up…</div>
        ) : report && report.calls === 0 ? (
          <div className="py-10 text-center text-[12px] leading-relaxed text-muted">
            No model calls in this window. Every turn is recorded from now on — talk to a bot, or
            hand an agent an item, and this fills in.
          </div>
        ) : (
          report && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-line bg-panel px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                    Estimated cost
                  </div>
                  <div className="mt-1 text-[22px] font-semibold leading-none text-ink">
                    {money(totalCost)}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted">list prices, not an invoice</div>
                </div>
                <div className="rounded-xl border border-line bg-panel px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                    Calls
                  </div>
                  <div className="mt-1 text-[22px] font-semibold leading-none text-ink">
                    {report.calls}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted">
                    {report.unreported > 0
                      ? `${report.unreported} without token counts`
                      : 'all reported their tokens'}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-panel px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                    Tokens in
                  </div>
                  <div className="mt-1 text-[22px] font-semibold leading-none text-ink">
                    {shortNumber(totalIn)}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted">
                    {shortNumber(report.cache_read)} of it cached
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-panel px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                    Tokens out
                  </div>
                  <div className="mt-1 text-[22px] font-semibold leading-none text-ink">
                    {shortNumber(report.output)}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted">five times the price of input</div>
                </div>
              </div>

              <Table
                title="By space"
                blurb="where the work is"
                rows={report.by_space}
                empty="Nothing attributed to a space yet."
              />
              <Table
                title="By bot and agent"
                blurb="who is spending it"
                rows={report.by_speaker}
                empty="Nobody has spoken yet."
              />
              <Table
                title="By model"
                blurb="what each is priced at"
                rows={report.by_model}
                byModel
                empty="No models used yet."
              />

              <p className="text-[10.5px] leading-[1.5] text-faint">
                Costing follows x-platform&rsquo;s ai-usage package: input, output, cache reads and
                cache writes priced separately. Prices are list rates for the model id, so a figure
                here is an estimate of what you will be billed, not a reading of your bill.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
