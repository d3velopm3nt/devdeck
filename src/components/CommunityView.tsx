// Community — open-source AI your bots can use.
//
// The pairing is the idea: Machine installs tools for *you*, Community
// installs them for *your bots*. Which is why it sits directly above Machine
// on the rail.
//
// **Installing is not granting, and this screen is built around that split.**
// Browse installs — it writes files and gives nobody the ability to call
// anything. Installed is where you say who may use it. They are two tabs
// rather than one list with toggles, because a row that installs and grants in
// the same click cannot show you the state in between, and the state in
// between is the one that matters: a server sitting there for six days that no
// bot can reach.
//
// So Installed leads with reach, and says "no agent can use this yet" in the
// place a green tick would otherwise go.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../lib/ipc'
import { Icon, type IconName } from '../lib/icons'
import { useAiw } from '../lib/aiwStore'
import { CAPTURE_COMMUNITY } from '../lib/devCapture'

type Tab = 'browse' | 'discover' | 'installed' | 'trending'

/// Screenshot harness guard; see the effect in CommunityView.
let ran = false

const KIND: Record<string, { label: string; icon: IconName; tint: string }> = {
  skill: { label: 'Skill', icon: 'list', tint: 'text-viol' },
  agent: { label: 'Agent', icon: 'agent', tint: 'text-indigo-400' },
  tool: { label: 'Tool', icon: 'tool', tint: 'text-info' },
}

/// Licence, in the words of someone deciding whether they can ship it.
const LICENCE: Record<string, { label: string; tone: string; why: string }> = {
  permissive: { label: 'Permissive', tone: 'text-ok', why: 'MIT-style — use it in anything.' },
  copyleft: {
    label: 'Copyleft',
    tone: 'text-warn',
    why: 'Shipping this inside a paid product has conditions. Read them.',
  },
  restricted: {
    label: 'Restricted',
    tone: 'text-err',
    why: 'Its licence limits how it may be used. Read it before installing.',
  },
  missing: {
    label: 'No licence',
    tone: 'text-err',
    why: 'No licence at all means no permission at all — legally you may not use it.',
  },
}

export function CommunityView() {
  const [tab, setTab] = useState<Tab>('browse')
  const [rows, setRows] = useState<ipc.CommunityListing[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /// The server a trust modal is asking about, or null.
  const [trust, setTrust] = useState<ipc.CommunityListing | null>(null)
  const [servers, setServers] = useState<ipc.McpServerStatus[]>([])
  const [feeds, setFeeds] = useState<ipc.CommunityFeed[]>([])
  const [looking, setLooking] = useState(false)
  const agents = useAiw((s) => s.agents)
  const reloadAgents = useAiw((s) => s.reloadAgents)

  const load = useCallback(async () => {
    try {
      setRows(await ipc.communityCatalog())
      // Best effort and separate: a failure to list processes must not blank
      // the catalogue, which is the thing the page is for.
      setServers(await ipc.communityServers().catch(() => []))
      setFeeds(await ipc.communityIndex().catch(() => []))
      setErr(null)
    } catch (e) {
      // Never an empty catalogue on failure: "nothing to install" and "we
      // could not read what is installed" are different, and only one of them
      // is worth acting on.
      setRows(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Screenshot harness: install and grant without a click, through the same
  // commands the buttons call. Guarded at module scope rather than with a ref,
  // because React mounts twice in development and an install run twice is two
  // installs. Empty in every shipped build.
  useEffect(() => {
    if (CAPTURE_COMMUNITY.length === 0 || ran) return
    ran = true
    void (async () => {
      for (const line of CAPTURE_COMMUNITY) {
        const [verb, id, who] = line.split(':')
        try {
          if (verb === 'tab') setTab(id as Tab)
          else if (verb === 'refresh') setFeeds(await ipc.communityRefreshIndex())
          else if (verb === 'install') await ipc.communityInstall(id)
          else if (verb === 'grant') await ipc.communityGrant(id, who, true)
          else if (verb === 'revoke') await ipc.communityGrant(id, who, false)
        } catch (e) {
          // Loudly, or a screenshot shows a step that silently never happened.
          console.error('[capture] community', line, e)
        }
      }
      await reloadAgents()
      await load()
    })()
  }, [load, reloadAgents])

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    setErr(null)
    try {
      await fn()
      await reloadAgents()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const installed = (rows ?? []).filter((r) => r.installed)
  const idle = installed.filter((r) => r.standing && r.standing.reach.length === 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="shrink-0 border-b border-line px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold text-ink">Community</h1>
          <p className="text-[11.5px] text-muted">
            Open-source skills, agents and tools your bots can use. Machine installs for you; this
            installs for them.
          </p>
        </div>
        <div className="mt-2.5 flex items-center gap-1">
          {(['browse', 'discover', 'installed', 'trending'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`rounded-md px-2.5 py-1 text-[12px] capitalize ${
                tab === t ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
              }`}
              onClick={() => setTab(t)}
            >
              {t}
              {t === 'installed' && installed.length > 0 && (
                <span className="ml-1.5 text-[10.5px] tabular-nums text-faint">
                  {installed.length}
                </span>
              )}
            </button>
          ))}
          <span className="flex-1" />
          {/* The uncomfortable thing, said in the header rather than buried:
              installs that nothing can reach are the normal failure of a
              module like this, and they are silent by nature. */}
          {idle.length > 0 && (
            <button
              className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-warn hover:bg-amber-500/25"
              onClick={() => setTab('installed')}
            >
              {idle.length} installed, no agent can use {idle.length === 1 ? 'it' : 'them'}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="mx-5 mt-3 flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{err}</span>
          <button className="btn-ghost shrink-0 text-[11px]" onClick={() => void load()}>
            <Icon name="update" size={11} /> Retry
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {rows === null && !err && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <Icon name="update" size={12} spin /> Reading the index…
          </div>
        )}

        {(tab === 'discover' || tab === 'trending') && (
          <Discover
            feeds={feeds.filter((f) =>
              tab === 'trending'
                ? f.source.startsWith('trending-') || f.source === 'year'
                : !f.source.startsWith('trending-') && f.source !== 'year',
            )}
            blurb={
              tab === 'trending'
                ? 'What is moving on GitHub, and what has grown over a year. None of it is installable — a trending row declares nothing, so there is nothing to run and nothing to guess.'
                : 'Two sources, kept apart because they answer different questions. Nothing is fetched until you ask — this is the only outbound call the module makes.'
            }
            looking={looking}
            onRefresh={async () => {
              setLooking(true)
              setErr(null)
              try {
                setFeeds(await ipc.communityRefreshIndex())
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e))
              } finally {
                setLooking(false)
              }
            }}
          />
        )}

        {rows !== null && tab === 'browse' && (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {rows.map((r) => (
              <Card
                key={r.id}
                row={r}
                busy={busy === r.id}
                onInstall={() =>
                  // A skill or an agent is text. A tool is a program that will
                  // run on this machine, so it is shown before it is agreed
                  // to — not after, in a row nobody re-reads.
                  r.kind === 'tool'
                    ? setTrust(r)
                    : void act(r.id, () => ipc.communityInstall(r.id))
                }
                onRemove={() => void act(r.id, () => ipc.communityUninstall(r.id))}
              />
            ))}
          </div>
        )}

        {rows !== null && tab === 'installed' && servers.length > 0 && (
          <div className="mb-3 rounded-lg border border-line bg-panel p-3">
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              Running now
            </div>
            {/* An MCP server is a process. It is not in the Processes bar —
                that watches services you configured, and these start
                themselves on an agent's first call — so it is said here
                instead of nowhere. */}
            {servers.map((sv) => (
              <div key={sv.id} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-emerald-400" />
                <span className="text-body">{sv.name}</span>
                <span className="font-mono text-[10.5px] text-faint">
                  pid {sv.pid} · {sv.tools} tool{sv.tools === 1 ? '' : 's'}
                  {sv.protocol ? ` · MCP ${sv.protocol}` : ''}
                </span>
                <span className="flex-1" />
                <button
                  className="btn-ghost text-[11px]"
                  title="Stop it. It starts again on the next call that needs it."
                  onClick={() => void act(sv.id, () => ipc.communityStopServer(sv.id))}
                >
                  Stop
                </button>
              </div>
            ))}
          </div>
        )}

        {rows !== null && tab === 'installed' && (
          <InstalledList
            rows={installed}
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            busy={busy}
            onGrant={(id, agentId, on) =>
              void act(id, () => ipc.communityGrant(id, agentId, on))
            }
            onRemove={(id) => void act(id, () => ipc.communityUninstall(id))}
            onBrowse={() => setTab('browse')}
          />
        )}
      </div>

      {trust && (
        <Trust
          row={trust}
          onCancel={() => setTrust(null)}
          onConfirm={() => {
            const id = trust.id
            setTrust(null)
            void act(id, () => ipc.communityInstall(id))
          }}
        />
      )}
    </div>
  )
}

/// The two indexes, kept apart on purpose.
///
/// One is the official MCP registry — what a server *is* and how to run it,
/// with no popularity signal at all. The other is GitHub search — stars, and
/// no idea how to run anything. Merging them would produce a list whose order
/// could not be described in a sentence, which is the exact failure the
/// Trending design warns about.
function Discover({
  feeds,
  blurb,
  looking,
  onRefresh,
}: {
  feeds: ipc.CommunityFeed[]
  blurb: string
  looking: boolean
  onRefresh: () => void
}) {
  const title: Record<string, string> = {
    registry: 'MCP registry',
    github: 'Most starred on GitHub',
    'trending-week': 'Trending this week',
    'trending-month': 'Trending this month',
    year: 'Over the year (ours)',
  }
  const never = feeds.every((f) => f.fetched_at === 0)
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-[11.5px] text-muted">{blurb}</p>
        <span className="flex-1" />
        <button className="btn-primary shrink-0 text-[12px]" disabled={looking} onClick={onRefresh}>
          <Icon name="update" size={12} spin={looking} />
          {looking ? 'Looking…' : never ? 'Fetch the index' : 'Refresh'}
        </button>
      </div>

      {feeds.map((f) => (
        <section key={f.source} className="mb-4">
          <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
            <h2 className="text-[12.5px] font-semibold text-ink">
              {title[f.source] ?? f.source}
            </h2>
            <span className="text-[10.5px] tabular-nums text-faint">{f.items.length} listed</span>
            {/* When the read last *succeeded* — the point of showing it is to
                say how stale what you are looking at might be. */}
            <span className="text-[10.5px] text-faint">
              {f.fetched_at === 0 ? 'never fetched' : `read ${new Date(f.fetched_at).toLocaleString()}`}
            </span>
          </div>
          <p className={`mb-2 text-[11px] leading-[1.5] ${f.ok ? 'text-muted' : 'text-err'}`}>
            {/* A failure says so here, and the list below is the last good
                answer rather than a claim that nothing exists. */}
            {f.ok ? f.note : `Could not look: ${f.note}`}
          </p>

          {f.items.length === 0 ? (
            <p className="text-[11.5px] text-muted">
              {f.fetched_at === 0
                ? 'Nothing read yet.'
                : 'This source returned nothing the last time it was read.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {f.items.slice(0, 20).map((i) => (
                <IndexRow key={i.id} item={i} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/// The GitHub owner behind a row, when there is one.
///
/// Only a github.com source yields one. A registry entry's author is a
/// reverse-DNS namespace like `agency.kesey` — not a GitHub login — and asking
/// github.com for its avatar would return a 404 rendered as a broken image.
function ownerOf(source: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/?/.exec(source.trim())
  return m ? m[1] : null
}

/// One row of an index: who made it, what it is, and a way to go and look.
function IndexRow({ item }: { item: ipc.CommunityItem }) {
  const owner = ownerOf(item.source)
  const [broken, setBroken] = useState(false)
  const repo = item.source.startsWith('https://github.com/')
  return (
    <div className="group flex items-start gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-hover/40">
      {/* An avatar, not a card. GitHub's OpenGraph image is handsomer and
          forty times the size; twenty of them is two megabytes fetched to
          decorate a list. The avatar is what people actually recognise. */}
      {owner && !broken ? (
        <img
          src={`https://github.com/${owner}.png?size=80`}
          alt=""
          loading="lazy"
          className="mt-0.5 h-8 w-8 shrink-0 rounded-md border border-line object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        // Never a broken image: a row whose owner we cannot resolve gets the
        // same shape in the same place, so the column stays a column.
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-raise text-[11px] font-semibold text-faint">
          {(item.author || item.name).slice(0, 1).toUpperCase()}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {repo ? (
            <button
              className="truncate text-[12px] font-medium text-ink hover:text-indigo-300 hover:underline"
              title={`Open ${item.source}`}
              onClick={() => void ipc.openUrl(item.source)}
            >
              {item.name}
            </button>
          ) : (
            <span className="truncate text-[12px] font-medium text-ink">{item.name}</span>
          )}
          {item.version && (
            <span className="shrink-0 text-[10.5px] tabular-nums text-faint">{item.version}</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.45] text-body">{item.summary}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
          <span className="truncate">{item.author}</span>
          <span>·</span>
          <span
            className={
              item.licence === 'permissive'
                ? 'text-ok'
                : item.licence === 'missing' || item.licence === 'restricted'
                  ? 'text-err'
                  : 'text-warn'
            }
          >
            {item.licence}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* No Install here. A registry entry is installable in a later slice;
            a repository is not installable at all, because nothing here knows
            how to run it — the manifest problem, said rather than guessed. */}
        <span className="text-[10px] text-faint">
          {item.command ? 'runnable' : 'No manifest'}
        </span>
        {repo && (
          <button
            className="rounded p-1 text-faint opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
            title={`Open ${item.source} in your browser`}
            onClick={() => void ipc.openUrl(item.source)}
          >
            <Icon name="external" size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/// What installing a server actually means, before you agree to it.
///
/// An MCP server is not a document — it is a program that will run on this
/// machine, started by an agent rather than by you, outliving the click that
/// installed it. So the command is shown verbatim, and the two things people
/// assume wrongly are said plainly: installing does not grant, and the process
/// is real.
function Trust({
  row,
  onCancel,
  onConfirm,
}: {
  row: ipc.CommunityListing
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onClick={onCancel}
    >
      <div
        className="w-[520px] rounded-xl border border-line2 bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[14px] font-semibold text-ink">Install {row.name}?</h2>
        <p className="mt-1 text-[12px] leading-[1.55] text-body">{row.summary}</p>

        <div className="mt-3">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            It will run this on your machine
          </div>
          <pre className="overflow-x-auto rounded-md border border-line bg-app px-3 py-2 font-mono text-[11.5px] text-body">
{row.command}
          </pre>
        </div>

        <ul className="mt-3 space-y-1.5 text-[11.5px] leading-[1.5] text-muted">
          <li>
            <span className="text-body">It is a process</span>, started the first time an agent
            calls it and running until you stop it or close DevDeck.
          </li>
          <li>
            <span className="text-body">Installing grants nothing.</span> No agent can call it
            until you say which, on the Installed tab.
          </li>
          <li>
            From <span className="font-mono text-[11px]">{row.source}</span> · {row.author} ·{' '}
            {row.licence}.
          </li>
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost text-[12px]" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary text-[12px]" onClick={onConfirm}>
            Install
          </button>
        </div>
      </div>
    </div>
  )
}

function Card({
  row,
  busy,
  onInstall,
  onRemove,
}: {
  row: ipc.CommunityListing
  busy: boolean
  onInstall: () => void
  onRemove: () => void
}) {
  const k = KIND[row.kind] ?? { label: row.kind, icon: 'package' as IconName, tint: 'text-dim' }
  const lic = LICENCE[row.licence] ?? LICENCE.missing
  return (
    <div className="flex flex-col rounded-lg border border-line bg-panel p-3.5">
      <div className="flex items-start gap-2.5">
        <span className={`mt-px shrink-0 ${k.tint}`}>
          <Icon name={k.icon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{row.name}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-[0.05em] text-faint">
              {k.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-[1.5] text-body">{row.summary}</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-[10.5px] text-muted">
        <span>{row.author}</span>
        <span className="text-faint">·</span>
        <span>v{row.version}</span>
        <span className="text-faint">·</span>
        <span className={lic.tone} title={lic.why}>
          {lic.label}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {row.installed ? (
          <>
            <span className="inline-flex items-center gap-1 text-[11.5px] text-ok">
              <Icon name="check" size={12} /> Installed
            </span>
            {/* Even here, the truth about reach — a card that said only
                "Installed" would be the green tick this module exists to
                avoid. */}
            {row.standing && row.standing.reach.length === 0 && (
              <span className="text-[11px] text-warn">· no agent can use it yet</span>
            )}
            <span className="flex-1" />
            <button className="btn-ghost text-[11px]" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary text-[11.5px]" disabled={busy} onClick={onInstall}>
              {busy ? <Icon name="update" size={11} spin /> : <Icon name="download" size={11} />}
              {busy ? 'Installing…' : 'Install'}
            </button>
            <span className="text-[10.5px] text-muted">Writes files. Grants nothing.</span>
          </>
        )}
      </div>
    </div>
  )
}

function InstalledList({
  rows,
  agents,
  busy,
  onGrant,
  onRemove,
  onBrowse,
}: {
  rows: ipc.CommunityListing[]
  agents: { id: string; name: string }[]
  busy: string | null
  onGrant: (id: string, agentId: string, on: boolean) => void
  onRemove: (id: string) => void
  onBrowse: () => void
}) {
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-[12px] leading-5 text-muted">
        <p className="text-body">Nothing installed yet.</p>
        <p className="mt-1">Skills, agents and tools you install here become available to grant.</p>
        <button className="btn-primary mt-3 text-[12px]" onClick={onBrowse}>
          Browse the index
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const s = r.standing
        const k = KIND[r.kind] ?? { label: r.kind, icon: 'package' as IconName, tint: 'text-dim' }
        // An agent is not granted to another agent — it simply exists once
        // installed — so it gets no grant row rather than an inert one.
        const grantable = r.kind !== 'agent'
        return (
          <div key={r.id} className="rounded-lg border border-line bg-panel p-3.5">
            <div className="flex items-start gap-2.5">
              <span className={`mt-px shrink-0 ${k.tint}`}>
                <Icon name={k.icon} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-ink">{r.name}</span>
                  <span className="text-[10px] uppercase tracking-[0.05em] text-faint">
                    {k.label}
                  </span>
                  <span className="text-[10.5px] text-muted">
                    installed {s ? (s.days === 0 ? 'today' : `${s.days}d ago`) : ''}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-[1.5] text-body">{r.summary}</p>
              </div>
              <button className="btn-ghost shrink-0 text-[11px]" onClick={() => onRemove(r.id)}>
                Remove
              </button>
            </div>

            {/* Reach first, because it is the answer to the only question the
                page is for: can anything actually use this. */}
            <div className="mt-2.5 border-t border-line pt-2.5">
              {s && s.reach.length > 0 ? (
                <div className="flex items-center gap-1.5 text-[11.5px] text-ok">
                  <Icon name="check" size={12} className="shrink-0" />
                  <span>
                    In use by {s.reach.join(', ')}
                  </span>
                </div>
              ) : (
                <div
                  className={`flex items-start gap-1.5 text-[11.5px] ${
                    s?.idle ? 'text-warn' : 'text-muted'
                  }`}
                >
                  <Icon name="alert" size={12} className="mt-px shrink-0" />
                  <span>
                    No agent can use this yet
                    {s?.idle && ` — and it has been here ${s.days} days`}. Installing wrote the
                    files; granting is the separate step below.
                  </span>
                </div>
              )}

              {s?.blocked && (
                <p className="mt-1.5 text-[11px] leading-[1.5] text-muted">{s.blocked}</p>
              )}

              {grantable && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10.5px] uppercase tracking-[0.05em] text-faint">
                    Grant to
                  </span>
                  {agents.map((a) => {
                    const on = !!s?.reach.includes(a.id)
                    return (
                      <button
                        key={a.id}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          on
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-ok'
                            : 'border-line2 text-dim hover:border-indigo-500/50 hover:text-ink'
                        }`}
                        disabled={busy === r.id}
                        title={
                          on
                            ? `Revoke ${r.name} from ${a.id}`
                            : r.kind === 'tool'
                              ? `Grant ${r.name} to ${a.id} — at approval, so the first call stops and asks`
                              : `Give ${a.id} the ${r.name} skill`
                        }
                        onClick={() => onGrant(r.id, a.id, !on)}
                      >
                        {a.id}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
