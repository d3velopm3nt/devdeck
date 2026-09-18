// Step three: link the code.
//
// Pick the repositories that belong to the business and say which product
// each is part of. Each becomes a project inside that product, cloned where
// you say, or used where it already is. Services have no code and are not
// listed. A website repository is offered to Marketing, and a repository
// whose name looks like part of a product is a labelled guess.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store'
import { Err, Header } from '../setup/LearnStep'
import { CAPTURE_BUSINESS_AUTO } from '../../lib/devCapture'
import { Foot } from './BusinessStep'
import { BizFrame, hostOf, type StepProps } from './shared'

const tokens = (name: string) => name.toLowerCase().split(/[-_.\s]+/).filter((t) => t.length >= 4)

const when = (iso: string) => {
  const t = Date.parse(iso)
  if (!t) return ''
  const days = Math.round((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'updated today'
  if (days === 1) return 'updated yesterday'
  if (days < 14) return `updated ${days} days ago`
  if (days < 60) return `updated ${Math.round(days / 7)} weeks ago`
  return `updated ${new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`
}

export function CodeStep({ view, setView, nav, onClose, next }: StepProps) {
  const { nodes, refreshTree } = useApp()
  const [list, setList] = useState<ipc.RepoList | null>(null)
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Record<string, number>>({})
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [cloneInto, setCloneInto] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [results, setResults] = useState<string[]>([])

  const load = async () => {
    setErr('')
    try {
      const l = await ipc.businessRepos()
      setList(l)
      const slug = (view?.meta.name ?? '').toLowerCase()
      const owners = [...new Set(l.repos.map((r) => r.owner))]
      setOwner(owners.find((o) => o.toLowerCase() === slug) ?? owners[0] ?? '')
    } catch (e) {
      setErr(String(e))
    }
  }
  useEffect(() => {
    void load()
    if (view) void ipc.businessCloneFolder(view.node_id).then(setCloneInto).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.node_id])

  const folders = view?.folders ?? []
  const marketing = folders.find((f) => f.name.toLowerCase() === 'marketing')
  const products = useMemo(
    () =>
      (view?.meta.items ?? [])
        .filter((i) => i.field === 'product' && i.node_id > 0 && i.state !== 'declined')
        .map((i) => ({ id: i.node_id, name: i.text })),
    [view],
  )
  // Screenshot harness: give the agreed products their folders, pick the
  // example repositories and link them, without a mouse. Throwaway profile only.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !view || !list || !cloneInto) return
    if (CAPTURE_BUSINESS_AUTO !== 'pick' && CAPTURE_BUSINESS_AUTO !== 'link') return
    autoRan.current = true
    void (async () => {
      let v = view
      if (!v.meta.items.some((i) => i.field === 'product' && i.node_id > 0)) {
        v = await ipc.businessCommitItems(v.node_id)
        setView(v)
      }
      const prods = v.meta.items.filter((i) => i.field === 'product' && i.node_id > 0)
      const mkt = v.folders.find((f) => f.name.toLowerCase() === 'marketing')
      const picks: Record<string, number> = {}
      for (const r of list.repos) {
        if (r.owner !== 'innotrack' || r.name === 'mobile-scanner') continue
        if (r.name === 'website') {
          if (mkt) picks[r.full_name] = mkt.node_id
        } else if (r.name === 'rfid-gateway' && prods[1]) {
          picks[r.full_name] = prods[1].node_id
        } else if (prods[0]) {
          picks[r.full_name] = prods[0].node_id
        }
      }
      setPick(picks)
      if (CAPTURE_BUSINESS_AUTO === 'link') window.setTimeout(() => void link(picks), 3000)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, cloneInto, view?.node_id])

  const parents = [...products, ...(marketing ? [{ id: marketing.node_id, name: 'Marketing' }] : [])]
  const nameOf = (id: number) => parents.find((p) => p.id === id)?.name ?? ''
  const projectsUnder = (id: number) => nodes.filter((n) => n.parent_id === id && n.kind === 'project')
  const linkedNames = new Set(parents.flatMap((p) => projectsUnder(p.id).map((n) => n.name.toLowerCase())))

  if (!view) return null
  const host = hostOf(view.meta.website).replace(/^www\./, '')
  const repos = (list?.repos ?? []).filter(
    (r) =>
      (!owner || r.owner === owner) &&
      (!q.trim() || `${r.full_name} ${r.description}`.toLowerCase().includes(q.trim().toLowerCase())),
  )
  const owners = [...new Set((list?.repos ?? []).map((r) => r.owner))]
  const picked = Object.entries(pick)

  // Guesses, each labelled as one.
  const siteRepo = (list?.repos ?? []).find(
    (r) =>
      !pick[r.full_name] &&
      !linkedNames.has(r.name.toLowerCase()) &&
      !dismissed.has(r.full_name) &&
      (/^(website|site|www|homepage|web-site)$/i.test(r.name) || (!!host && r.name.toLowerCase().includes(host.split('.')[0]))),
  )
  const kin = (list?.repos ?? [])
    .filter((r) => !pick[r.full_name] && !linkedNames.has(r.name.toLowerCase()) && !dismissed.has(r.full_name) && r !== siteRepo)
    .map((r) => {
      const mine = tokens(r.name)
      const match = picked.find(([full]) => {
        const other = full.split('/')[1] ?? full
        return tokens(other).some((t) => mine.includes(t))
      })
      if (!match) return null
      const shared = tokens(match[0].split('/')[1] ?? '').find((t) => mine.includes(t)) ?? ''
      return { repo: r, parent: match[1], shared, with: match[0].split('/')[1] ?? match[0] }
    })
    .filter((x): x is { repo: ipc.Repo; parent: number; shared: string; with: string } => !!x)[0]

  const link = async (picksArg: Record<string, number> = pick) => {
    setBusy('link')
    setErr('')
    const out: string[] = []
    for (const [full, parent] of Object.entries(picksArg)) {
      const repo = list?.repos.find((r) => r.full_name === full)
      if (!repo) continue
      try {
        const l = await ipc.businessLinkRepo({ business: view.node_id, parent, repo, clone_into: cloneInto })
        out.push(
          `${repo.full_name}: ${l.reused ? 'used where it already was' : 'cloned'}, ${l.commands} command${
            l.commands === 1 ? '' : 's'
          } and ${l.services} service${l.services === 1 ? '' : 's'}`,
        )
      } catch (e) {
        out.push(`${repo.full_name}: ${String(e)}`)
      }
    }
    setResults(out)
    setPick({})
    await refreshTree()
    setBusy('')
  }

  return (
    <BizFrame step="code" view={view} nav={nav} onClose={onClose} wide>
      <Header
        icon="github"
        title="Link the code"
        text={`Pick the repositories that belong to ${view.meta.name} and say which product each one is part of. Each becomes a project inside that product. Services have no code, so they are not listed here.`}
      />

      {list && !list.signed_in ? (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel p-4">
          <span className="text-[12.5px] text-ink">Connect GitHub to list your repositories</span>
          <span className="text-[11px] leading-relaxed text-muted">
            Paste a personal access token with the repo and read:org scopes. It goes to Windows Credential
            Manager and is never shown again.
          </span>
          <div className="flex items-center gap-2">
            <input
              className="input min-w-0 flex-1 font-mono text-[12px]"
              placeholder="ghp_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="btn-primary text-[12px]"
              disabled={!token.trim() || !!busy}
              onClick={async () => {
                setBusy('token')
                setErr('')
                try {
                  await ipc.githubTokenPaste(token)
                  setToken('')
                  await load()
                } catch (e) {
                  setErr(String(e))
                } finally {
                  setBusy('')
                }
              }}
            >
              Connect
            </button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4">
          <div className="min-h-0 overflow-auto rounded-[10px] border border-line bg-panel">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">GitHub</span>
              <span className="truncate text-[10.5px] text-faint">
                {list?.source === 'example'
                  ? list.note
                  : list
                    ? `signed in as ${list.login} · your repositories and organisations`
                    : 'reading your repositories…'}
              </span>
              <span className="flex-1" />
              <div className="flex w-[200px] items-center gap-1.5 rounded border border-line2 bg-page px-2 py-1">
                <Icon name="search" size={12} className="text-muted" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
                  placeholder="Search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
              {owners.map((o) => (
                <button
                  key={o}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    o === owner ? 'border-indigo-500 bg-indigo-500/10 text-ink' : 'border-line2 text-dim hover:text-ink'
                  }`}
                  onClick={() => setOwner(o === owner ? '' : o)}
                >
                  {o}
                </button>
              ))}
            </div>
            {repos.map((r) => {
              const on = pick[r.full_name] !== undefined
              const linked = linkedNames.has(r.name.toLowerCase())
              return (
                <div key={r.full_name} className="flex items-center gap-2.5 border-t border-line px-4 py-2">
                  <input
                    type="checkbox"
                    disabled={linked || parents.length === 0}
                    checked={on || linked}
                    onChange={(e) =>
                      setPick((cur) => {
                        const nextPick = { ...cur }
                        if (e.target.checked) nextPick[r.full_name] = products[0]?.id ?? marketing?.node_id ?? 0
                        else delete nextPick[r.full_name]
                        return nextPick
                      })
                    }
                  />
                  <Icon name="code" size={14} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px] text-ink">{r.full_name}</div>
                    <div className="truncate text-[11px] text-muted">
                      {r.private ? 'Private' : 'Public'} · {when(r.updated_at)}
                      {r.description ? ` · ${r.description}` : ''}
                    </div>
                  </div>
                  <span className="w-[70px] shrink-0 text-right text-[10.5px] text-faint">{r.language}</span>
                  {linked ? (
                    <span className="w-[210px] shrink-0 text-[11px] text-ok">already a project</span>
                  ) : on ? (
                    <select
                      className="input w-[210px] shrink-0 text-[11.5px]"
                      value={pick[r.full_name]}
                      onChange={(e) => setPick((cur) => ({ ...cur, [r.full_name]: Number(e.target.value) }))}
                    >
                      {parents.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="w-[210px] shrink-0" />
                  )}
                </div>
              )
            })}
            {list && repos.length === 0 && (
              <div className="border-t border-line px-4 py-3 text-[12px] text-muted">No repositories match.</div>
            )}
            {kin && (
              <div className="flex items-center gap-2.5 border-t border-line bg-amber-500/5 px-4 py-2.5">
                <Icon name="ai" size={14} className="shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-ink">
                    {kin.repo.name} looks like part of {nameOf(kin.parent)}
                  </div>
                  <div className="text-[11px] text-muted">
                    its name shares {'“'}
                    {kin.shared}
                    {'”'} with {kin.with}. A guess
                  </div>
                </div>
                <button
                  className="btn-primary text-[11.5px]"
                  onClick={() => setPick((cur) => ({ ...cur, [kin.repo.full_name]: kin.parent }))}
                >
                  Link it
                </button>
                <button
                  className="btn-ghost text-[11.5px]"
                  onClick={() => setDismissed((cur) => new Set(cur).add(kin.repo.full_name))}
                >
                  No
                </button>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <div className="rounded-[10px] border border-line bg-panel">
              <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Products and their projects
              </div>
              {parents.length === 0 && (
                <div className="border-t border-line px-4 py-2.5 text-[12px] text-muted">
                  No products agreed yet. Go back a step to agree what the business sells.
                </div>
              )}
              {parents.map((p) => {
                const existing = projectsUnder(p.id)
                const waiting = picked.filter(([, parent]) => parent === p.id).map(([full]) => full.split('/')[1] ?? full)
                if (p.name === 'Marketing' && existing.length === 0 && waiting.length === 0) return null
                return (
                  <div key={p.id} className="border-t border-line px-4 py-2">
                    <div className="flex items-center gap-2 text-[12.5px] text-ink">
                      <Icon name={p.name === 'Marketing' ? 'folder' : 'package'} size={13} className="text-indigo-400" />
                      {p.name}
                      <span className="ml-auto text-[10.5px] text-faint">
                        {existing.length + waiting.length} project{existing.length + waiting.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {existing.map((n) => (
                      <div key={n.id} className="flex h-[22px] items-center gap-1.5 pl-5 text-[11.5px] text-body">
                        <Icon name="code" size={11} className="text-muted" />
                        <span className="font-mono">{n.name}</span>
                      </div>
                    ))}
                    {waiting.map((w) => (
                      <div key={w} className="flex h-[22px] items-center gap-1.5 pl-5 text-[11.5px] text-muted">
                        <Icon name="add" size={11} />
                        <span className="font-mono">{w}</span>
                        <span className="text-[10px] text-faint">to link</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel p-4">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">On this machine</span>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-muted">Clone new ones into</span>
                <input
                  className="input font-mono text-[11.5px]"
                  value={cloneInto}
                  onChange={(e) => setCloneInto(e.target.value)}
                />
              </label>
              <span className="text-[10.5px] leading-relaxed text-faint">
                A repository already cloned somewhere is found and used where it is. How to run and build each
                one is read from the repository itself.
              </span>
            </div>

            {siteRepo && marketing && (
              <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel p-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">The website</span>
                <span className="text-[11.5px] leading-relaxed text-muted">
                  {siteRepo.full_name} is not a product. It can go under Marketing, where the site is looked after.
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-[11.5px]"
                    onClick={() => setPick((cur) => ({ ...cur, [siteRepo.full_name]: marketing.node_id }))}
                  >
                    Put it in Marketing
                  </button>
                  <button
                    className="btn-ghost text-[11.5px]"
                    onClick={() => setDismissed((cur) => new Set(cur).add(siteRepo.full_name))}
                  >
                    Leave it
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="rounded-[10px] border border-line bg-panel px-4 py-2.5">
          {results.map((r) => (
            <div key={r} className="text-[11.5px] leading-relaxed text-body">
              {r}
            </div>
          ))}
        </div>
      )}
      {err && <Err>{err}</Err>}
      <div className="flex items-center gap-3">
        {picked.length > 0 ? (
          <button className="btn-primary text-[12px]" disabled={!!busy || !cloneInto.trim()} onClick={() => void link(pick)}>
            {busy === 'link' ? 'Linking…' : `Link ${picked.length} ${picked.length === 1 ? 'repository' : 'repositories'}`}
          </button>
        ) : (
          <button className="btn-primary text-[12px]" onClick={() => next('mail')}>
            Next: mail
          </button>
        )}
        <button className="btn-ghost text-[12px]" onClick={() => nav.onGo('sells')}>
          Back
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">
          {picked.length > 0 ? 'Nothing is cloned until you press Link' : 'Linking code is optional'}
        </span>
      </div>
      <Foot icon="code">
        Nothing is pushed to any repository, and nothing is changed in one. Linking reads a repository and
        records it as a project.
      </Foot>
    </BizFrame>
  )
}
