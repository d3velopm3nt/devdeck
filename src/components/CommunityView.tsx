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
import { aiw, type PermissionRow } from '../lib/aiw'

type Tab = 'browse' | 'bundles' | 'discover' | 'installed' | 'trending' | 'permissions' | 'models'

/// Screenshot harness guard; see the effect in CommunityView.
///
/// The last script that ran, not a boolean. A boolean meant that editing the
/// knob and letting hot reload carry it through did nothing — the second shot
/// silently kept the first shot's tab, and the screenshot looked like the
/// feature rather than like the harness.
let ran = ''

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
  const [trust, setTrust] = useState<ipc.CommunityItem | null>(null)
  const [servers, setServers] = useState<ipc.McpServerStatus[]>([])
  const [feeds, setFeeds] = useState<ipc.CommunityFeed[]>([])
  /// The entry whose own page is open, or null for the list. Not a tab: you
  /// arrive from a row and Back puts you where you were.
  const [openId, setOpenId] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const agents = useAiw((s) => s.agents)
  const reloadAgents = useAiw((s) => s.reloadAgents)

  const load = useCallback(async () => {
    try {
      setRows(await ipc.communityCatalog())
      setErr(null)
      // Best effort and separate: a failure to list processes must not blank
      // the catalogue, which is the thing the page is for.
      setServers(await ipc.communityServers().catch(() => []))
      // A failure here is not "there is no index": it is the page unable to
      // read one. Swallowing it into an empty array once made a blank Discover
      // tab look like a source that had gone quiet — so it is reported, after
      // the clear above rather than before it.
      setFeeds(
        await ipc.communityIndex().catch((e: unknown) => {
          setErr(e instanceof Error ? e.message : String(e))
          return []
        }),
      )
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
    const script = CAPTURE_COMMUNITY.join('|')
    if (script === '' || ran === script) return
    ran = script
    void (async () => {
      for (const line of CAPTURE_COMMUNITY) {
        const [verb, id, who] = line.split(':')
        try {
          if (verb === 'tab') setTab(id as Tab)
          else if (verb === 'open') setOpenId(id)
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

  const onGrant = (id: string, agentId: string, on: boolean, level?: string) =>
    void act(id, () => ipc.communityGrant(id, agentId, on, level))
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
          {(['browse', 'bundles', 'discover', 'installed', 'trending', 'permissions', 'models'] as Tab[]).map((t) => (
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
        {openId !== null && (
          <RepoPage
            id={openId}
            busy={busy}
            onBack={() => setOpenId(null)}
            onInstall={(r) =>
              r.kind === 'tool' ? setTrust(r) : void act(r.id, () => ipc.communityInstall(r.id))
            }
            onRemove={(id) => void act(id, () => ipc.communityUninstall(id))}
          />
        )}

        {openId === null && rows === null && !err && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <Icon name="update" size={12} spin /> Reading the index…
          </div>
        )}

        {openId === null && tab === 'bundles' && (
          <Bundles busy={busy} onDone={() => void load()} onGrant={onGrant} />
        )}

        {openId === null && tab === 'permissions' && <Permissions />}

        {openId === null && tab === 'models' && <Models />}

        {openId === null && (tab === 'discover' || tab === 'trending') && (
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
            onOpen={setOpenId}
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

        {openId === null && rows !== null && tab === 'browse' && (
          <Browse
            rows={rows}
            busy={busy}
            onInstall={(r) =>
              // A skill or an agent is text. A tool is a program that will run
              // on this machine, so it is shown before it is agreed to — not
              // after, in a row nobody re-reads.
              r.kind === 'tool'
                ? setTrust(r)
                : void act(r.id, () => ipc.communityInstall(r.id))
            }
            onRemove={(r) => void act(r.id, () => ipc.communityUninstall(r.id))}
          />
        )}

        {openId === null && rows !== null && tab === 'installed' && servers.length > 0 && (
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

        {openId === null && rows !== null && tab === 'installed' && (
          <InstalledList
            rows={installed}
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            busy={busy}
            onGrant={(id, agentId, on) => onGrant(id, agentId, on)}
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
/// One entry, in full.
///
/// The design's version of this page carries contributors, a readme, a version
/// history and a verified requirements list. Most of that is data DevDeck does
/// not have, and the page that ships is the one built from what it does — with
/// the one section the design got exactly right kept and made real: **what it
/// actually gives your bots**, read from the running server rather than
/// guessed from a manifest nobody verifies.
function RepoPage({
  id,
  busy,
  onBack,
  onInstall,
  onRemove,
}: {
  id: string
  busy: string | null
  onBack: () => void
  onInstall: (r: ipc.CommunityItem) => void
  onRemove: (id: string) => void
}) {
  const [repo, setRepo] = useState<ipc.CommunityRepo | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRepo(await ipc.communityRepo(id))
      setErr(null)
    } catch (e) {
      setRepo(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  const back = (
    <button className="btn-ghost mb-3 text-[11.5px]" onClick={onBack}>
      <Icon name="chevron-left" size={12} /> Back
    </button>
  )

  if (err)
    return (
      <div>
        {back}
        <Problem text={err} onRetry={() => void load()} />
      </div>
    )
  if (repo === null)
    return (
      <div>
        {back}
        <Loading what="what we know about it" />
      </div>
    )

  const i = repo.item
  const lic = LICENCE[i.licence] ?? LICENCE.missing
  const owner = ownerOf(i.source)
  const granted = repo.grants.filter(([, l]) => l !== 'none')
  const ungranted = repo.grants.filter(([, l]) => l === 'none')

  return (
    <div className="mx-auto max-w-[980px]">
      {back}

      {/* -- who and what -------------------------------------------------- */}
      <div className="mb-4 flex items-start gap-3">
        {owner ? (
          <img
            src={`https://github.com/${owner}.png?size=120`}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-raise text-[16px] font-semibold text-faint">
            {(i.author || i.name).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-[16px] font-semibold text-ink">{i.name}</h1>
            <span className="text-[11.5px] text-muted">{i.author}</span>
            <span className={`text-[11px] ${lic.tone}`} title={lic.why}>
              {lic.label}
            </span>
            <Counts item={i} />
            {repo.installed ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] text-ok">
                Installed
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] leading-[1.55] text-body">{i.summary}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
            {/* Where the row came from is part of what the page has to say: a
                registry entry and a trending row are trusted differently. */}
            <span>
              found in <span className="text-dim">{repo.found_in}</span>
            </span>
            {i.version && (
              <>
                <span>·</span>
                <span className="tabular-nums">{i.version}</span>
              </>
            )}
            {i.source.startsWith('https://github.com/') && (
              <>
                <span>·</span>
                <button
                  className="inline-flex items-center gap-1 text-dim hover:text-indigo-300 hover:underline"
                  onClick={() => void ipc.openUrl(i.source)}
                >
                  {i.source.replace('https://', '')} <Icon name="external" size={10} />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {repo.installed ? (
            <button
              className="btn-ghost text-[12px]"
              disabled={busy === i.id}
              onClick={() => onRemove(i.id)}
            >
              Uninstall
            </button>
          ) : i.command || i.body ? (
            <button
              className="btn-primary text-[12px]"
              disabled={busy === i.id}
              onClick={() => onInstall(i)}
            >
              Install
            </button>
          ) : (
            // The manifest problem, said rather than papered over with a
            // button that would fail.
            <span className="text-[11px] text-faint">Nothing here says how to run it</span>
          )}
        </div>
      </div>

      {/* -- what it gives your bots ---------------------------------------- */}
      <Section title="What it gives your bots">
        {repo.tools.length > 0 ? (
          <>
            <p className="mb-2 text-[11px] text-muted">
              Read from the server itself, not from a manifest. A tool the server marks read-only
              is reachable at <span className="text-info">Read</span>; everything else counts as a
              write.
            </p>
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {repo.tools.map((t) => (
                <div
                  key={t.name}
                  className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-0"
                >
                  <span className="w-[180px] shrink-0 truncate font-mono text-[11px] text-ink">
                    {t.name}
                  </span>
                  <span
                    className={`w-[48px] shrink-0 text-[10.5px] ${
                      t.read_only ? 'text-info' : 'text-warn'
                    }`}
                  >
                    {t.read_only ? 'read' : 'write'}
                  </span>
                  <span className="min-w-0 flex-1 text-[11px] leading-[1.45] text-body">
                    {t.description || 'No description from the server.'}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[11.5px] leading-[1.55] text-muted">{repo.tools_note}</p>
        )}
      </Section>

      {/* -- who can use it -------------------------------------------------- */}
      {repo.grants.length > 0 && (
        <Section title="Who can use it">
          {granted.length === 0 ? (
            <p className="text-[11.5px] text-warn">
              Nobody. Installing wrote the files and granted nothing — that is the default, and it
              is deliberate.
            </p>
          ) : (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {granted.map(([agent, level]) => (
                <span
                  key={agent}
                  className="rounded-md border border-line bg-raise px-2 py-0.5 text-[11px]"
                >
                  <span className="text-ink">{agent}</span>{' '}
                  <span
                    className={
                      level === 'full' ? 'text-ok' : level === 'read' ? 'text-info' : 'text-warn'
                    }
                  >
                    {level}
                  </span>
                </span>
              ))}
            </div>
          )}
          {ungranted.length > 0 && (
            // The sentence the design wanted this page to be able to say.
            <p className="text-[11px] text-faint">
              {ungranted.length} other {ungranted.length === 1 ? 'agent has' : 'agents have'} None
              — {ungranted.map(([a]) => a).join(', ')}. Change a grant on the Installed tab.
            </p>
          )}
        </Section>
      )}

      {/* -- what it needs --------------------------------------------------- */}
      {(i.command || repo.needs.length > 0) && (
        <Section title="What it runs, and what that needs">
          {i.command && (
            <pre className="mb-2 overflow-x-auto rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[11px] text-ink">
              {i.command}
            </pre>
          )}
          {repo.needs.map((n) => (
            <div key={n.what} className="flex items-center gap-2 py-0.5 text-[11.5px]">
              <span
                className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                  n.present ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-body">{n.what}</span>
              <span className={n.present ? 'text-ok' : 'text-warn'}>
                {n.present ? 'on PATH' : 'not found'}
              </span>
              {!n.present && (
                <span className="font-mono text-[10.5px] text-faint">{n.hint}</span>
              )}
            </div>
          ))}
          {/* Checked here, so it can be said plainly. The design's page listed
              what a server "can reach" from its own manifest; that is the
              publisher's claim, and printing it under DevDeck's heading would
              lend it authority nobody earned. The tool list above is the
              honest version of the same question. */}
          <p className="mt-2 text-[11px] text-faint">
            Checked against this machine just now. What the server then does with the network or
            the disk is not something DevDeck audits — the permission matrix is what limits it.
          </p>
        </Section>
      )}
    </div>
  )
}

/// A titled block on the repo page.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
        {title}
      </h2>
      {children}
    </section>
  )
}

/// The starter catalogue, searchable by the same rules as every other list.
///
/// The order and the filtering are done in Rust, over `catalog`, and the
/// result is matched back onto the rows that carry install state. One
/// implementation of "does this match" rather than two that drift — the
/// alternative was re-writing the rules in TypeScript, where this project has
/// nothing to test them with.
function Browse({
  rows,
  busy,
  onInstall,
  onRemove,
}: {
  rows: ipc.CommunityListing[]
  busy: string | null
  onInstall: (r: ipc.CommunityListing) => void
  onRemove: (r: ipc.CommunityListing) => void
}) {
  const [q, setQ] = useState('')
  const [kinds, setKinds] = useState<string[]>([])
  const [permissive, setPermissive] = useState(false)
  const typed = useDebounced(q, 120)
  const [order, setOrder] = useState<string[] | null>(null)

  const kindKey = kinds.join(',')
  useEffect(() => {
    let live = true
    void ipc
      .communityArrange('catalog', typed, kindKey === '' ? [] : kindKey.split(','), permissive, 'source')
      .then((items) => {
        if (live) setOrder(items.map((i) => i.id))
      })
      // Showing everything beats showing nothing: it is the search that
      // failed, not the catalogue.
      .catch(() => {
        if (live) setOrder(null)
      })
    return () => {
      live = false
    }
  }, [typed, kindKey, permissive])

  const visible =
    order === null
      ? rows
      : order.map((id) => rows.find((r) => r.id === id)).filter((r): r is ipc.CommunityListing => !!r)
  const filtered = typed.trim() !== '' || kinds.length > 0 || permissive

  return (
    <div>
      <FilterBar
        q={q}
        onQ={setQ}
        kinds={kinds}
        onKinds={setKinds}
        permissive={permissive}
        onPermissive={setPermissive}
        placeholder="Search what ships with DevDeck"
      />
      {filtered && (
        <p className="mb-2 text-[11px] text-faint">
          {visible.length} of {rows.length}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="text-[11.5px] text-muted">
          Nothing here matches. The catalogue still has {rows.length}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {visible.map((r) => (
            <Card
              key={r.id}
              row={r}
              busy={busy === r.id}
              onInstall={() => onInstall(r)}
              onRemove={() => onRemove(r)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Discover({
  feeds,
  blurb,
  looking,
  onRefresh,
  onOpen,
}: {
  feeds: ipc.CommunityFeed[]
  blurb: string
  looking: boolean
  onRefresh: () => void
  onOpen: (id: string) => void
}) {
  const title: Record<string, string> = {
    registry: 'MCP registry',
    github: 'Most starred on GitHub',
    'trending-week': 'Trending this week',
    'trending-month': 'Trending this month',
    year: 'Over the year (ours)',
  }
  const never = feeds.every((f) => f.fetched_at === 0)
  const [q, setQ] = useState('')
  const [permissive, setPermissive] = useState(false)
  const typed = useDebounced(q, 120)

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

      <FilterBar
        q={q}
        onQ={setQ}
        permissive={permissive}
        onPermissive={setPermissive}
        placeholder="Search every list — name, description, author, repository"
      />

      {feeds.map((f) => (
        <FeedSection
          key={f.source}
          feed={f}
          title={title[f.source] ?? f.source}
          q={typed}
          permissive={permissive}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

/// Hold a value still until the typing stops.
///
/// Arranging is a local call over a cached list, so it is cheap — but a render
/// per keystroke through IPC is still a render per keystroke, and the list
/// flickering under someone's hands while they type is the thing this avoids.
function useDebounced<T>(value: T, ms: number): T {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setHeld(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return held
}

/// Search, and the one licence question a paid product actually asks.
function FilterBar({
  q,
  onQ,
  permissive,
  onPermissive,
  placeholder,
  kinds,
  onKinds,
}: {
  q: string
  onQ: (v: string) => void
  permissive: boolean
  onPermissive: (v: boolean) => void
  placeholder: string
  /// Only passed where rows differ in kind. An index feed is tools all the way
  /// down, and a chip row that filters nothing is worse than no chip row.
  kinds?: string[]
  onKinds?: (v: string[]) => void
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Icon
          name="search"
          size={12}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="h-[28px] w-full rounded-md border border-line bg-raise pl-7 pr-7 text-[12px] text-ink placeholder:text-faint focus:border-line3 focus:outline-none"
        />
        {q && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:bg-hover hover:text-ink"
            title="Clear"
            onClick={() => onQ('')}
          >
            <Icon name="close" size={11} />
          </button>
        )}
      </div>

      {kinds && onKinds && (
        <div className="flex items-center gap-1">
          {(['skill', 'agent', 'tool'] as const).map((k) => {
            const on = kinds.includes(k)
            return (
              <button
                key={k}
                className={`h-[24px] rounded-md border px-2 text-[11px] ${
                  on
                    ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-300'
                    : 'border-line bg-raise text-dim hover:bg-hover'
                }`}
                onClick={() => onKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
              >
                {KIND[k]?.label ?? k}
              </button>
            )
          })}
        </div>
      )}

      {/* The one licence question with a cheap answer. The other three are
          "read it", which is not a filter. */}
      <button
        className={`h-[24px] rounded-md border px-2 text-[11px] ${
          permissive
            ? 'border-emerald-400/40 bg-emerald-500/15 text-ok'
            : 'border-line bg-raise text-dim hover:bg-hover'
        }`}
        title="Only MIT-style licences — the ones you can ship inside a paid product without conditions"
        onClick={() => onPermissive(!permissive)}
      >
        Permissive only
      </button>
    </div>
  )
}

/// One source's answer, in whichever order it can honestly be put in.
function FeedSection({
  feed,
  title,
  q,
  permissive,
  onOpen,
}: {
  feed: ipc.CommunityFeed
  title: string
  q: string
  permissive: boolean
  onOpen: (id: string) => void
}) {
  const [sort, setSort] = useState('source')
  const [rows, setRows] = useState<ipc.CommunityItem[]>(feed.items)
  const sorts = feed.sorts ?? []

  // A sort the feed no longer offers must not stay selected — a refresh can
  // change what the rows can answer, and holding a dead option would silently
  // fall back to the source order under a label saying otherwise.
  const known = sorts.some((s) => s.id === sort)
  useEffect(() => {
    if (!known) setSort('source')
  }, [known])

  useEffect(() => {
    let live = true
    void ipc
      .communityArrange(feed.source, q, [], permissive, sort)
      .then((r) => {
        if (live) setRows(r)
      })
      // Falling back to the unarranged list keeps the rows on screen; it is
      // the search that failed, not the index.
      .catch(() => {
        if (live) setRows(feed.items)
      })
    return () => {
      live = false
    }
  }, [feed.source, feed.items, q, permissive, sort])

  const chosen = sorts.find((s) => s.id === sort)
  const filtered = q.trim() !== '' || permissive

  return (
    <section className="mb-4">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">{title}</h2>
        <span className="text-[10.5px] tabular-nums text-faint">
          {/* When a filter is on, both numbers: "3 of 100" is the honest
              reading, and "3 listed" would look like the source went quiet. */}
          {filtered ? `${rows.length} of ${feed.items.length}` : `${feed.items.length} listed`}
        </span>
        <span className="text-[10.5px] text-faint">
          {feed.fetched_at === 0
            ? 'never fetched'
            : `read ${new Date(feed.fetched_at).toLocaleString()}`}
        </span>
        <span className="flex-1" />
        {sorts.length > 1 && (
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            title={chosen?.note ?? ''}
            className="h-[24px] rounded-md border border-line bg-raise px-1.5 text-[11px] text-dim focus:border-line3 focus:outline-none"
          >
            {sorts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className={`mb-2 text-[11px] leading-[1.5] ${feed.ok ? 'text-muted' : 'text-err'}`}>
        {/* A failure says so here, and the list below is the last good answer
            rather than a claim that nothing exists. */}
        {feed.ok ? feed.note : `Could not look: ${feed.note}`}
      </p>
      {/* What the chosen order actually means, because "Most starred" over a
          list of weekly gains would be a lie with a tidy label. */}
      {chosen && sort !== 'source' && (
        <p className="mb-2 text-[11px] leading-[1.5] text-faint">{chosen.note}</p>
      )}

      {feed.items.length === 0 ? (
        <p className="text-[11.5px] text-muted">
          {feed.fetched_at === 0
            ? 'Nothing read yet.'
            : 'This source returned nothing the last time it was read.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11.5px] text-muted">
          Nothing here matches. The list itself is fine — {feed.items.length} rows were read.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          {rows.slice(0, 20).map((i) => (
            <IndexRow key={i.id} item={i} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

/// Bundles: a kit, and the grants it suggests.
///
/// The roadmap flags the tension — a bundle carries grants, and this module
/// exists to keep installing and granting apart. So a bundle installs its
/// items and grants nothing, then shows the grants it *proposes*, named, for
/// one deliberate accept. One review instead of six clicks is a different
/// thing from no review.
function Bundles({
  busy,
  onDone,
  onGrant,
}: {
  busy: string | null
  onDone: () => void
  onGrant: (id: string, agentId: string, on: boolean, level?: string) => void
}) {
  const [rows, setRows] = useState<[ipc.CommunityBundle, ipc.CommunityPlan][] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [offered, setOffered] = useState<ipc.CommunityPlan | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await ipc.communityBundles())
      setErr(null)
    } catch (e) {
      setRows(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (err) return <Problem text={err} onRetry={() => void load()} />
  if (rows === null) return <Loading what="bundles" />

  return (
    <div className="space-y-2.5">
      {rows.map(([b, plan]) => (
        <div key={b.id} className="rounded-lg border border-line bg-panel p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-px shrink-0 text-viol">
              <Icon name="package" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-ink">{b.name}</span>
              <p className="mt-0.5 text-[11.5px] leading-[1.5] text-body">{b.summary}</p>
            </div>
            <button
              className="btn-primary shrink-0 text-[11.5px]"
              disabled={busy !== null || plan.to_install.length === 0}
              onClick={() => {
                void (async () => {
                  try {
                    const p = await ipc.communityInstallBundle(b.id)
                    setOffered(p)
                    onDone()
                    await load()
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e))
                  }
                })()
              }}
            >
              {plan.to_install.length === 0 ? 'All installed' : `Install ${plan.to_install.length}`}
            </button>
          </div>

          <div className="mt-2.5 border-t border-line pt-2.5 text-[11px] leading-[1.6] text-muted">
            <div>
              {plan.to_install.length > 0 && (
                <span>
                  Would write <span className="text-body">{plan.to_install.join(', ')}</span>.{' '}
                </span>
              )}
              {plan.already.length > 0 && (
                <span>Already here: {plan.already.join(', ')}. </span>
              )}
            </div>
            {plan.grants.length > 0 && (
              <div className="mt-1">
                Then offers {plan.grants.length} grant{plan.grants.length === 1 ? '' : 's'} —
                installing applies none of them.
              </div>
            )}
            {/* A broken bundle is the chooser's business, not something to
                skip quietly. */}
            {plan.missing.length > 0 && (
              <div className="mt-1 text-err">
                Names {plan.missing.join(', ')}, which the index does not have.
              </div>
            )}
            {plan.unknown_agents.length > 0 && (
              <div className="mt-1 text-warn">
                Expects {plan.unknown_agents.join(', ')}, who are not on this machine — those
                grants are not offered.
              </div>
            )}
          </div>
        </div>
      ))}

      {offered && offered.grants.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
          onClick={() => setOffered(null)}
        >
          <div
            className="w-[540px] rounded-xl border border-line2 bg-panel p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[14px] font-semibold text-ink">Installed. Grant them?</h2>
            <p className="mt-1 text-[11.5px] leading-[1.55] text-body">
              The files are written and no agent can use any of it yet. These are the grants the
              bundle suggests, one line each.
            </p>
            <div className="mt-3 overflow-hidden rounded-md border border-line">
              {offered.grants.map((g, i) => (
                <div
                  key={`${g.item}-${g.agent}-${i}`}
                  className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] last:border-0"
                >
                  <span className="font-mono text-[11px] text-ink">{g.agent}</span>
                  <span className="text-faint">may use</span>
                  <span className="min-w-0 flex-1 truncate text-body">{g.item}</span>
                  {g.level && (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 text-[10px] text-warn">
                      {g.level}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost text-[12px]" onClick={() => setOffered(null)}>
                Not now
              </button>
              <button
                className="btn-primary text-[12px]"
                onClick={() => {
                  for (const g of offered.grants) {
                    onGrant(g.item, g.agent, true, g.level || undefined)
                  }
                  setOffered(null)
                }}
              >
                Grant all {offered.grants.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/// The permission matrix, with community tools and built-ins in one table.
///
/// The design asks for this as its own page, and the reason is the table
/// itself: "what may this agent touch" has one answer, and a community server
/// judged on a different screen from `files` would make it look like two.
function Permissions() {
  const [rows, setRows] = useState<PermissionRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await aiw.permissions())
      setErr(null)
    } catch (e) {
      setRows(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (err) return <Problem text={err} onRetry={() => void load()} />
  if (rows === null) return <Loading what="the matrix" />
  if (rows.length === 0) return <p className="text-[12px] text-muted">No tools.</p>

  const agents = rows[0].grants.map(([id]) => id)
  const tone: Record<string, string> = {
    Full: 'text-ok',
    Read: 'text-info',
    Approval: 'text-warn',
    None: 'text-faint',
  }

  return (
    <div>
      <p className="mb-3 text-[11.5px] text-muted">
        Everything an agent can reach, judged by one rule. A row marked{' '}
        <span className="font-medium text-viol">COMMUNITY</span> is a tool from an MCP server you
        installed; the rest ship with DevDeck. Change a community grant on the Installed tab, and a
        built-in on the agent&rsquo;s own page.
      </p>
      {/* The columns are the team on this machine, not a fixed set. They are
          seeded once from the built-in roster and are files afterwards, so the
          honest thing is to say where they came from rather than let six
          columns read as a hard limit. */}
      <p className="mb-3 text-[11.5px] text-faint">
        One column per agent on this machine &mdash; {agents.length} of them. Add or remove an agent
        on the Team view and this table follows.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 border-b border-line bg-panel px-3 py-2 text-left font-semibold text-faint">
                Tool
              </th>
              {agents.map((a) => (
                <th
                  key={a}
                  className="border-b border-line px-3 py-2 text-left font-mono text-[10.5px] font-normal text-faint"
                >
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const community = r.tool.startsWith('mcp.')
              return (
                <tr key={r.tool}>
                  <td className="sticky left-0 border-b border-line bg-panel px-3 py-1.5">
                    <span className={community ? 'text-info' : 'text-body'}>{r.tool}</span>
                    {/* Named, not segregated: it is in the same table, and it
                        is still worth knowing which ones you installed. */}
                    {community && (
                      <span className="ml-1.5 text-[9.5px] uppercase tracking-[0.05em] text-faint">
                        community
                      </span>
                    )}
                  </td>
                  {r.grants.map(([a, level]) => (
                    <td key={a} className="border-b border-line px-3 py-1.5">
                      <span className={tone[level] ?? 'text-faint'}>{level}</span>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/// Models, and the runners that serve them.
///
/// Nothing is downloaded from here. A model is gigabytes, and pulling one is a
/// decision with a disk and bandwidth cost that belongs to the person — so this
/// says what is installed, what is answering, and what to type.
function Models() {
  const [rows, setRows] = useState<ipc.CommunityRunner[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await ipc.communityRunners())
      setErr(null)
    } catch (e) {
      setRows(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (err) return <Problem text={err} onRetry={() => void load()} />
  if (rows === null) return <Loading what="runners" />

  return (
    <div className="space-y-2.5">
      <p className="text-[11.5px] text-muted">
        A model is no use to a bot without something running it. Nothing is downloaded from here —
        a model is gigabytes, and that is your decision to make in the runner&rsquo;s own words.
      </p>
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border border-line bg-panel p-3.5">
          <div className="flex items-center gap-2">
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                r.responding ? 'bg-emerald-400' : r.installed ? 'bg-amber-400' : 'bg-faint'
              }`}
            />
            <span className="text-[13px] font-semibold text-ink">{r.name}</span>
            {r.version && <span className="font-mono text-[10.5px] text-faint">{r.version}</span>}
            <span className="flex-1" />
            <span className="text-[11px] text-muted">
              {/* Installed and not answering is its own state, and the fix is
                  different: start it, rather than install it. */}
              {r.responding ? 'answering' : r.installed ? 'installed, not answering' : 'not installed'}
            </span>
          </div>

          {r.note && <p className="mt-1.5 text-[11px] leading-[1.5] text-muted">{r.note}</p>}

          {!r.installed && (
            <p className="mt-1.5 text-[11px] text-muted">
              Machine installs it for you:{' '}
              <code className="rounded bg-raise px-1 py-px font-mono text-[10.5px] text-ink">
                {r.install_hint}
              </code>
            </p>
          )}

          {r.responding && (
            <div className="mt-2.5 border-t border-line pt-2.5">
              {r.models.length === 0 ? (
                <p className="text-[11px] text-muted">
                  Nothing pulled yet — which is an answer, not a failure.{' '}
                  <code className="rounded bg-raise px-1 py-px font-mono text-[10.5px] text-ink">
                    ollama pull llama3.2
                  </code>
                </p>
              ) : (
                r.models.map((m) => (
                  <div key={m.name} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                    <span className="font-mono text-[11px] text-body">{m.name}</span>
                    <span className="flex-1" />
                    <span className="tabular-nums text-[10.5px] text-faint">{m.size}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted">
      <Icon name="update" size={12} spin /> Reading {what}…
    </div>
  )
}

function Problem({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-err">
      <Icon name="alert" size={13} className="mt-px shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <button className="btn-ghost shrink-0 text-[11px]" onClick={onRetry}>
        <Icon name="update" size={11} /> Retry
      </button>
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
function IndexRow({ item, onOpen }: { item: ipc.CommunityItem; onOpen: (id: string) => void }) {
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
          {/* The name opens DevDeck's own page for it. Going to github.com is
              the icon on the right — a different act, and leaving the app
              should never be the thing a name does by default. */}
          <button
            className="truncate text-[12px] font-medium text-ink hover:text-indigo-300 hover:underline"
            title="What DevDeck knows about it"
            onClick={() => onOpen(item.id)}
          >
            {item.name}
          </button>
          {item.version && (
            <span className="shrink-0 text-[10.5px] tabular-nums text-faint">{item.version}</span>
          )}
          <Counts item={item} />
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

/// A count, in the shape a person reads.
const num = (n: number) => n.toLocaleString()

/// The two numbers a row can carry, never merged.
///
/// A total and a gain look alike and mean different things — "41,234" is how
/// many stars a repository has, "+1,204" is how many it picked up this week.
/// Shown differently so nobody reads one as the other.
function Counts({ item }: { item: ipc.CommunityItem }) {
  return (
    <>
      {item.stars !== null && item.stars !== undefined && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-[10.5px] tabular-nums text-faint"
          title={`${num(item.stars)} stars on GitHub`}
        >
          <Icon name="star" size={10} /> {num(item.stars)}
        </span>
      )}
      {item.gained !== null && item.gained !== undefined && (
        <span
          className="shrink-0 text-[10.5px] tabular-nums text-ok"
          title="Stars gained over this list's window — a change, not a total"
        >
          +{num(item.gained)}
        </span>
      )}
    </>
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
  // The entry, not the listing: a trust decision is about what will run, and
  // whether it happens to be installed is a different question. Taking the
  // narrower type is what lets an index row reach this modal at all.
  row: ipc.CommunityItem
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
