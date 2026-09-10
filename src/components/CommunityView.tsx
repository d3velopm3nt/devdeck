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

type Tab = 'browse' | 'installed'

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
  const agents = useAiw((s) => s.agents)
  const reloadAgents = useAiw((s) => s.reloadAgents)

  const load = useCallback(async () => {
    try {
      setRows(await ipc.communityCatalog())
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
          if (verb === 'install') await ipc.communityInstall(id)
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
          {(['browse', 'installed'] as Tab[]).map((t) => (
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

        {rows !== null && tab === 'browse' && (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {rows.map((r) => (
              <Card
                key={r.id}
                row={r}
                busy={busy === r.id}
                onInstall={() => void act(r.id, () => ipc.communityInstall(r.id))}
                onRemove={() => void act(r.id, () => ipc.communityUninstall(r.id))}
              />
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
