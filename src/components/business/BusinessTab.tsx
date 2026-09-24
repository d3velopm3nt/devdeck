// A business space's Team tab: what the business is, who runs what, what it
// sells and who it deals with. Everything here is read from the business's
// record and its tree; nothing on this tab is typed in twice.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store'
import { isAgreed } from './shared'
import { openBusiness } from './TodayBusinesses'
import { openBot } from '../../lib/dock'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const ago = (ms: number | null) => {
  if (!ms) return 'has not woken yet'
  const mins = Math.round((Date.now() - ms) / 60_000)
  if (mins < 60) return `woke ${Math.max(mins, 1)} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `woke ${hours} h ago`
  return `woke ${Math.round(hours / 24)} days ago`
}

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</span>
      {note && <span className="text-[10.5px] text-faint">{note}</span>}
    </div>
  )
}

export function BusinessTab({ nodeId }: { nodeId: number }) {
  const { nodes } = useApp()
  const [view, setView] = useState<ipc.BusinessView | null>(null)
  const [space, setSpace] = useState<ipc.SpaceView | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    void Promise.all([ipc.businessGet(nodeId), ipc.businessSpace(nodeId)])
      .then(([v, s]) => {
        setView(v)
        setSpace(s)
      })
      .catch((e) => setErr(String(e)))
  }, [nodeId])

  if (err) return <div className="px-5 py-4 text-[12px] text-err">{err}</div>
  if (!view || !space) return <div className="px-5 py-4 text-[12px] text-muted">Reading the business…</div>

  const meta = view.meta
  const what = meta.items.find((i) => i.field === 'what' && isAgreed(i))
  const products = meta.items.filter((i) => i.field === 'product' && isAgreed(i))
  const services = meta.items.filter((i) => i.field === 'service' && isAgreed(i))
  const projectsOf = (id: number) => nodes.filter((n) => n.parent_id === id && n.kind === 'project')
  const directors = meta.directors.map((d) => (d.you ? 'You' : d.name)).filter(Boolean)

  return (
    <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
      {!meta.made && (
        <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2">
          <Icon name="ai" size={13} className="text-indigo-400" />
          <span className="flex-1 text-[12px] text-ink">{meta.name} is still being set up</span>
          <button className="btn-primary text-[11.5px]" onClick={() => openBusiness({ nodeId })}>
            Carry on
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {what && <span className="text-[13px] text-ink">{what.text}</span>}
        {meta.website && <span className="font-mono text-[11px] text-muted">{meta.website}</span>}
        {directors.length > 0 && <span className="text-[11px] text-muted">Directors: {directors.join(', ')}</span>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <section>
            {/* This is the same managers the Managers tab lists, from a
                different call — but it says two things that one does not:
                who else a manager works for, and what the directors kept.
                So it stays, as the reading view, and stops being inert: a
                row opens its manager, and the note says where the controls
                are rather than leaving you to hunt for them. */}
            <Head title="The team" note="open one to read it · Managers tab to wake or assign" />
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {space.members.length === 0 && (
                <div className="px-3 py-2.5 text-[12px] text-muted">Nobody on the team yet. The directors do it all.</div>
              )}
              {space.members.map((m) => (
                <button
                  key={m.handle}
                  className="flex w-full items-start gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-hover/40"
                  title={`Open ${m.name}`}
                  onClick={() => openBot(nodeId, m.name, false, m.handle)}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-[9.5px] font-semibold text-indigo-400">
                    {initials(m.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] text-ink">{m.name}</span>
                      <span className="font-mono text-[10.5px] text-faint">@{m.handle}</span>
                    </div>
                    <div className="text-[11.5px] text-body">{m.goal}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {m.open_items > 0 ? `${m.open_items} open item${m.open_items === 1 ? '' : 's'}` : 'nothing on its plan yet'}
                      {m.also_for.length > 0 ? ` · also works for ${m.also_for.join(' and ')}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[10.5px] text-faint">
                    <div>{m.rhythm}</div>
                    <div>{ago(m.last_woke)}</div>
                  </div>
                </button>
              ))}
              {space.keeps.length > 0 && (
                <div className="border-t border-line bg-raise px-3 py-2 text-[11px] text-muted">
                  The directors keep doing: {space.keeps.join(', ')}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section>
            <Head title="Products" />
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {products.length === 0 && <div className="px-3 py-2.5 text-[12px] text-muted">None agreed.</div>}
              {products.map((p) => {
                const projects = p.node_id ? projectsOf(p.node_id) : []
                return (
                  <div key={p.id} className="border-b border-line px-3 py-2 last:border-b-0">
                    <div className="flex items-center gap-2 text-[12.5px] text-ink">
                      <Icon name="package" size={13} className="text-indigo-400" />
                      {p.text}
                      <span className="ml-auto text-[10.5px] text-faint">
                        {projects.length} project{projects.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {projects.map((n) => (
                      <div key={n.id} className="flex h-[22px] items-center gap-1.5 pl-5 text-[11.5px] text-body">
                        <Icon name="code" size={11} className="text-muted" />
                        <span className="font-mono">{n.name}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>
          <section>
            <Head title="Services" />
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {services.length === 0 && <div className="px-3 py-2.5 text-[12px] text-muted">None agreed.</div>}
              {services.map((s) => (
                <div key={s.id} className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12.5px] text-ink last:border-b-0">
                  <Icon name="tool" size={13} className="text-info" />
                  {s.text}
                </div>
              ))}
            </div>
          </section>
          <section>
            <Head title="Organisations" note="from Learn" />
            <div className="grid grid-cols-2 gap-2">
              {space.organisations.map((o) => (
                <div key={o.folder} className="rounded-lg border border-line bg-panel px-3 py-2">
                  <div className="text-[18px] font-semibold tabular-nums text-ink">{o.count}</div>
                  <div className="text-[11px] text-muted">{o.folder}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
