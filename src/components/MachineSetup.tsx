// Machine Setup: install dev software via winget/scoop, see what's already
// installed, pick one-click bundles, and fully control the catalog — every
// package (curated or your own) is seeded into the DB and editable. Export/
// import a machine manifest to rebuild a fresh Windows box. Install output
// streams to the bottom-bar Logs.

import { useEffect, useMemo, useState } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import { PACKAGES, BUNDLES, CATEGORY_LABELS, type PkgCategory } from '../lib/machineCatalog'

type Pkg = ipc.MachinePackage
type ItemStatus = 'installing' | 'ok' | 'failed'

// The curated TS list, shaped for the DB seed + "reset to default".
const SEED: Pkg[] = PACKAGES.map((p, i) => ({
  id: p.id, name: p.name, source: p.source, category: p.category,
  blurb: p.blurb ?? '', elevate: !!p.elevate, custom: false, hidden: false, sort: i,
}))
const seedById = new Map(SEED.map((p) => [p.id, p]))

// Mirrors machine.rs::install_command.
const previewCmd = (p: { id: string; source: string }) =>
  p.source === 'scoop'
    ? `scoop install ${p.id}`
    : `winget install --id ${p.id} --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`

interface Draft {
  orig?: string
  isCustom: boolean
  id: string
  name: string
  source: 'winget' | 'scoop'
  category: PkgCategory
  blurb: string
  elevate: boolean
}
const blankDraft = (): Draft => ({ isCustom: true, id: '', name: '', source: 'winget', category: 'custom', blurb: '', elevate: false })

export function MachineSetup() {
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [winget, setWinget] = useState<Set<string>>(new Set())
  const [scoop, setScoop] = useState<Set<string>>(new Set())
  const [avail, setAvail] = useState<{ winget: boolean; scoop: boolean }>({ winget: true, scoop: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [live, setLive] = useState<Map<string, ItemStatus>>(new Map())
  const [installing, setInstalling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | 'winget' | 'scoop'>('all')

  const [detail, setDetail] = useState<Pkg | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)

  const reloadPkgs = async () => {
    try {
      setPkgs(await ipc.machinePackagesList())
    } catch (e) {
      console.error(e)
    }
  }

  const refreshStatus = async () => {
    setLoading(true)
    try {
      const s = await ipc.machineStatus()
      setWinget(new Set(s.winget.map((x) => x.toLowerCase())))
      setScoop(new Set(s.scoop.map((x) => x.toLowerCase())))
      setAvail({ winget: s.winget_available, scoop: s.scoop_available })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Seed curated packages on first run (adds any newly-shipped ones on later
    // runs), then load the user's editable catalog.
    void ipc.machinePackagesSeed(SEED).then(reloadPkgs).catch(reloadPkgs)
    void refreshStatus()
    const subs = [
      ipc.onMachineItem((e) => setLive((m) => new Map(m).set(e.id, e.status))),
      ipc.onMachineDone(() => {
        setInstalling(false)
        void refreshStatus()
      }),
    ]
    return () => {
      for (const s of subs) void s.then((un) => un())
    }
  }, [])

  const visiblePkgs = useMemo(() => pkgs.filter((p) => !p.hidden), [pkgs])
  const byId = useMemo(() => new Map(visiblePkgs.map((p) => [p.id, p])), [visiblePkgs])

  const isInstalled = (p: Pkg): boolean => {
    if (live.get(p.id) === 'ok') return true
    return p.source === 'scoop' ? scoop.has(p.id.toLowerCase()) : winget.has(p.id.toLowerCase())
  }
  const statusOf = (p: Pkg): 'installed' | 'installing' | 'failed' | 'none' => {
    const l = live.get(p.id)
    if (l === 'installing') return 'installing'
    if (isInstalled(p)) return 'installed'
    if (l === 'failed') return 'failed'
    return 'none'
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visiblePkgs.filter(
      (p) =>
        (source === 'all' || p.source === source) &&
        (q === '' || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q)),
    )
  }, [search, source, visiblePkgs])

  const groups = useMemo(() => {
    const map = new Map<string, Pkg[]>()
    for (const p of visible) map.set(p.category, [...(map.get(p.category) ?? []), p])
    return [...map.entries()]
  }, [visible])

  const installedCount = visiblePkgs.filter((p) => isInstalled(p)).length
  const selectableSelected = [...selected].filter((id) => {
    const p = byId.get(id)
    return p && !isInstalled(p)
  })

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const addBundle = (ids: string[]) =>
    setSelected((s) => {
      const n = new Set(s)
      for (const id of ids) {
        const p = byId.get(id)
        if (p && !isInstalled(p)) n.add(id)
      }
      return n
    })

  const itemsFor = (ids: string[]): ipc.InstallItem[] =>
    ids.map((id) => byId.get(id)).filter((p): p is Pkg => !!p).map((p) => ({ id: p.id, source: p.source }))

  const runInstall = async (items: ipc.InstallItem[]) => {
    if (items.length === 0) return
    setInstalling(true)
    setLive((m) => {
      const n = new Map(m)
      for (const it of items) n.set(it.id, 'installing')
      return n
    })
    try {
      await ipc.machineInstall(items)
    } catch (e) {
      alert(String(e))
      setInstalling(false)
    }
  }
  const installSelected = () => void runInstall(itemsFor(selectableSelected))
  const installOne = (p: Pkg) => void runInstall([{ id: p.id, source: p.source }])

  // ---- catalog editing ----
  const saveDraft = async (d: Draft) => {
    const id = d.id.trim()
    if (!id || !d.name.trim()) return alert('Name and package id are required.')
    const existing = pkgs.find((p) => p.id === (d.orig ?? id))
    const pkg: Pkg = {
      id, name: d.name.trim(), source: d.source, category: d.category,
      blurb: d.blurb.trim(), elevate: d.elevate,
      custom: existing?.custom ?? true, hidden: false, sort: existing?.sort ?? pkgs.length,
    }
    // Custom packages may be renamed to a new id — drop the old row.
    if (d.orig && d.orig !== id && (existing?.custom ?? true)) await ipc.machinePackageDelete(d.orig)
    await ipc.machinePackageSave(pkg)
    await reloadPkgs()
    setEditing(null)
    setDetail(pkg)
  }
  const removePkg = async (p: Pkg) => {
    const msg = p.custom ? `Delete “${p.name}”?` : `Remove “${p.name}” from the catalog? (you can restore defaults later)`
    if (!confirm(msg)) return
    await ipc.machinePackageDelete(p.id)
    await reloadPkgs()
    setDetail(null)
  }
  const resetPkg = async (p: Pkg) => {
    const seed = seedById.get(p.id)
    if (!seed) return
    await ipc.machinePackageSave({ ...seed, sort: p.sort })
    await reloadPkgs()
    setDetail({ ...seed, sort: p.sort })
  }
  const restoreDefaults = async () => {
    await ipc.machinePackagesSeed(SEED)
    // Un-hide curated packages the user had removed.
    for (const p of pkgs.filter((x) => x.hidden && !x.custom)) {
      const seed = seedById.get(p.id)
      if (seed) await ipc.machinePackageSave({ ...seed, sort: p.sort })
    }
    await reloadPkgs()
  }

  // ---- manifest ----
  const manifestFromSelection = (): ipc.Manifest => ({
    name: 'dev machine', version: 1,
    packages: [...selected].map((id) => { const p = byId.get(id); return { id, source: p?.source ?? 'winget', elevate: p?.elevate } }),
    steps: [], repos: [],
  })
  const doExport = async () => {
    if (selected.size === 0) return alert('Select some packages first, then Export.')
    const path = await saveDialog({ title: 'Export machine manifest', defaultPath: 'devdeck.machine.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    await ipc.machineExport(path, manifestFromSelection())
  }
  const doSnapshot = async () => {
    const manifest = await ipc.machineSnapshot('my dev machine', visiblePkgs.map((p) => ({ id: p.id, source: p.source })))
    const path = await saveDialog({ title: 'Snapshot installed → manifest', defaultPath: 'devdeck.machine.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    await ipc.machineExport(path, manifest)
  }
  const doImport = async () => {
    const path = await openDialog({ title: 'Import machine manifest', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    try {
      const m = await ipc.machineImport(path)
      setSelected((s) => {
        const n = new Set(s)
        for (const pkg of m.packages) { const p = byId.get(pkg.id); if (p && !isInstalled(p)) n.add(pkg.id) }
        return n
      })
    } catch (e) {
      alert(String(e))
    }
  }

  const openDetail = (p: Pkg) => { setDetail(p); setInfo(null) }
  const fetchInfo = async (p: Pkg) => {
    setInfoLoading(true)
    setInfo(null)
    try {
      setInfo(await ipc.machineShow(p.id, p.source))
    } catch (e) {
      setInfo(String(e))
    } finally {
      setInfoLoading(false)
    }
  }
  const editFrom = (p: Pkg): Draft => ({ orig: p.id, isCustom: p.custom, id: p.id, name: p.name, source: p.source as 'winget' | 'scoop', category: p.category as PkgCategory, blurb: p.blurb, elevate: p.elevate })

  return (
    <div className="flex h-full flex-col bg-[#0b0e14] text-slate-300">
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold text-slate-100">Machine Setup</h1>
            <p className="mt-1 max-w-[62ch] text-[12.5px] text-slate-500">
              Install and track your toolchain. Every package is yours to edit; export it as a
              manifest, then rebuild a fresh Windows install in one click.
            </p>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1.5">
            <button className="btn-ghost text-[12px]" onClick={() => setEditing(blankDraft())}>＋ Add software</button>
            <button className="btn-ghost text-[12px]" onClick={() => void doImport()}>↥ Import</button>
            <button className="btn-ghost text-[12px]" onClick={() => void doExport()}>↧ Export</button>
            <button className="btn-ghost text-[12px]" title="Read what's installed and write a manifest" onClick={() => void doSnapshot()}>📸 Snapshot</button>
            <button className="btn-primary text-[12px]" disabled={selectableSelected.length === 0 || installing} onClick={installSelected}>
              {installing ? 'Installing…' : `⤓ Install selected · ${selectableSelected.length}`}
            </button>
          </div>
        </div>
      </div>

      {(!avail.winget || !avail.scoop) && (
        <div className="border-b border-slate-800 bg-amber-500/[0.06] px-5 py-2 text-[11.5px] text-amber-400/90">
          {!avail.winget && <span>winget was not found — winget installs are disabled. </span>}
          {!avail.scoop && <span>scoop is not installed — scoop packages are disabled (install scoop to enable CLI tools). </span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-[#0d1017] px-3 py-2 text-slate-400">
          🔎
          <input className="flex-1 bg-transparent text-[13px] text-slate-200 outline-none placeholder:text-slate-600" placeholder="Search winget & scoop — e.g. “docker”, “node”, “vscode”…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {(['all', 'winget', 'scoop'] as const).map((s) => (
            <button key={s} className={`px-3 py-1.5 text-[11.5px] ${source === s ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => setSource(s)}>
              {s === 'all' ? 'All sources' : s}
            </button>
          ))}
        </div>
        <button className="btn-ghost text-[11.5px]" disabled={loading} onClick={() => void refreshStatus()}>{loading ? 'Checking…' : '↻ Refresh'}</button>
        <button className="btn-ghost text-[11.5px]" title="Re-seed curated packages and un-hide removed ones" onClick={() => void restoreDefaults()}>Restore defaults</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">One-click bundles</div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
          {BUNDLES.map((b) => {
            const total = b.packages.length
            const done = b.packages.filter((id) => { const p = byId.get(id); return p && isInstalled(p) }).length
            return (
              <button key={b.id} className="group rounded-lg border border-slate-800 bg-[#151923] p-3 text-left hover:border-indigo-500/50" onClick={() => addBundle(b.packages)} title={`Add ${total - done} package(s) to install`}>
                <div className="flex items-center gap-2">
                  <span className="text-[16px]">{b.icon}</span>
                  <span className="text-[12.5px] font-semibold text-slate-100">{b.name}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-slate-500">{done}/{total}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{b.description}</div>
                <div className="mt-2 text-[10.5px] text-indigo-400 opacity-0 transition group-hover:opacity-100">+ Add to selection</div>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Stat n={installedCount} label="Installed" color="text-emerald-400" dot="bg-emerald-400" />
          <Stat n={selectableSelected.length} label="Selected to install" color="text-indigo-300" dot="bg-indigo-400" />
          <Stat n={visiblePkgs.length - installedCount} label="Available" color="text-slate-300" dot="bg-slate-600" />
        </div>

        {groups.map(([cat, list]) => (
          <div key={cat} className="mt-5">
            <div className="flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
              {CATEGORY_LABELS[cat as PkgCategory] ?? cat} <span className="text-slate-600">{list.length}</span>
              <span className="h-px flex-1 bg-gradient-to-r from-slate-800 to-transparent" />
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {list.map((p) => {
                const st = statusOf(p)
                const disabled = st === 'installed' || (p.source === 'scoop' ? !avail.scoop : !avail.winget)
                return (
                  <div key={p.id} className="group flex items-center gap-3 rounded-lg border border-slate-800 bg-[#151923] px-3 py-2 hover:border-slate-600">
                    <input type="checkbox" className="h-4 w-4 accent-indigo-500" disabled={disabled} checked={selected.has(p.id) && st !== 'installed'} onChange={() => toggle(p.id)} />
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-700 bg-[#0d1017] text-[12px] font-semibold text-slate-400">{p.name[0]}</div>
                    <button className="min-w-0 flex-1 text-left" title="View & edit configuration" onClick={() => openDetail(p)}>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-100">{p.name}</span>
                        {p.custom && <span className="shrink-0 rounded bg-violet-500/15 px-1.5 py-px text-[9px] font-semibold text-violet-300">custom</span>}
                        {p.elevate && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold text-amber-400" title="Needs admin (UAC)">admin</span>}
                      </div>
                      <div className="truncate font-mono text-[11px] text-slate-500">{p.id}{p.blurb ? `  ·  ${p.blurb}` : ''}</div>
                    </button>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[9.5px] font-semibold ${p.source === 'scoop' ? 'bg-emerald-500/12 text-emerald-400' : 'bg-sky-500/12 text-sky-400'}`}>{p.source}</span>
                    <StatusBadge status={st} />
                    <button className="shrink-0 rounded-md border border-slate-700 px-1.5 py-1 text-[11px] text-slate-400 opacity-0 hover:border-slate-500 hover:text-white group-hover:opacity-100" title="Edit configuration" onClick={() => setEditing(editFrom(p))}>✎</button>
                    <button className="shrink-0 rounded-md border border-slate-700 px-1.5 py-1 text-[11px] text-slate-400 hover:border-slate-500 hover:text-white" title="Configuration" onClick={() => openDetail(p)}>ⓘ</button>
                    <button
                      className={`min-w-[76px] shrink-0 rounded-md px-2.5 py-1 text-[11px] ${st === 'installed' ? 'text-slate-500' : st === 'installing' ? 'border border-slate-700 text-slate-400' : 'bg-indigo-600 font-semibold text-white hover:bg-indigo-500'}`}
                      disabled={disabled || st === 'installing'}
                      onClick={() => installOne(p)}
                    >
                      {st === 'installed' ? 'Installed' : st === 'installing' ? 'Installing…' : st === 'failed' ? 'Retry' : 'Install'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="mt-6 text-[12px] text-slate-500">No packages match “{search}”. <button className="text-indigo-400 hover:underline" onClick={() => setEditing({ ...blankDraft(), name: search })}>Add it as custom software →</button></div>}
      </div>

      {detail && !editing && (
        <DetailModal
          pkg={detail}
          changed={(() => {
            const s = seedById.get(detail.id)
            return !detail.custom && !!s && (s.name !== detail.name || s.source !== detail.source || s.category !== detail.category || s.blurb !== detail.blurb || s.elevate !== detail.elevate)
          })()}
          installCmd={previewCmd(detail)}
          info={info}
          infoLoading={infoLoading}
          onFetchInfo={() => void fetchInfo(detail)}
          onEdit={() => setEditing(editFrom(detail))}
          onReset={seedById.has(detail.id) ? () => void resetPkg(detail) : undefined}
          onDelete={() => void removePkg(detail)}
          onInstall={() => { installOne(detail); setDetail(null) }}
          onClose={() => setDetail(null)}
        />
      )}
      {editing && <EditModal draft={editing} idLocked={!!editing.orig && !editing.isCustom} onChange={setEditing} onSave={() => void saveDraft(editing)} onCancel={() => setEditing(null)} />}
    </div>
  )
}

function Stat({ n, label, color, dot }: { n: number; label: string; color: string; dot: string }) {
  return (
    <div className="min-w-[130px] flex-1 rounded-lg border border-slate-800 bg-[#151923] px-3 py-2">
      <div className={`text-[19px] font-bold tabular-nums ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] text-slate-500"><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${dot}`} />{label}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'installed' | 'installing' | 'failed' | 'none' }) {
  if (status === 'installed') return <span className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10.5px] text-emerald-400">Installed</span>
  if (status === 'installing') return <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10.5px] text-indigo-300">Installing…</span>
  if (status === 'failed') return <span className="shrink-0 rounded-full bg-red-500/12 px-2 py-0.5 text-[10.5px] text-red-400">Failed</span>
  return <span className="shrink-0 rounded-full bg-white/[0.045] px-2 py-0.5 text-[10.5px] text-slate-500">Not installed</span>
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-slate-700 bg-[#11141c] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
function FieldLbl({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-[11px] text-slate-500">{label}</div>{children}</div>
}
function Config({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#151923] px-3 py-2">
      <div className="text-[10.5px] text-slate-500">{label}</div>
      <div className="mt-0.5 text-[12.5px] text-slate-200">{value}</div>
    </div>
  )
}

function DetailModal(props: {
  pkg: Pkg
  changed: boolean
  installCmd: string
  info: string | null
  infoLoading: boolean
  onFetchInfo: () => void
  onEdit: () => void
  onReset?: () => void
  onDelete: () => void
  onInstall: () => void
  onClose: () => void
}) {
  const { pkg, changed, installCmd, info, infoLoading } = props
  return (
    <Overlay onClose={props.onClose}>
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-700 bg-[#0d1017] text-[14px] font-semibold text-slate-300">{pkg.name[0]}</div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-slate-100">{pkg.name}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">{pkg.id}</div>
        </div>
        <button className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-slate-700 hover:text-white" onClick={props.onClose}>✕</button>
      </div>
      <div className="space-y-3 px-5 py-4 text-[12.5px]">
        <div className="grid grid-cols-2 gap-3">
          <Config label="Source" value={pkg.source} />
          <Config label="Category" value={CATEGORY_LABELS[pkg.category as PkgCategory] ?? pkg.category} />
          <Config label="Needs admin" value={pkg.elevate ? 'Yes (UAC)' : 'No'} />
          <Config label="Origin" value={pkg.custom ? 'Custom (yours)' : changed ? 'Curated · edited' : 'Curated'} />
        </div>
        {pkg.blurb && <div className="text-[12px] text-slate-400">{pkg.blurb}</div>}
        <FieldLbl label="Install command">
          <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0d1017] px-3 py-2 font-mono text-[11.5px] text-slate-300">{installCmd}</pre>
        </FieldLbl>
        <FieldLbl label="Live details from the source">
          {info == null ? (
            <button className="btn-ghost text-[11.5px]" disabled={infoLoading} onClick={props.onFetchInfo}>{infoLoading ? 'Fetching…' : `Fetch ${pkg.source} info`}</button>
          ) : (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0d1017] px-3 py-2 font-mono text-[11px] leading-5 text-slate-400">{info}</pre>
          )}
        </FieldLbl>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-3">
        <button className="btn-ghost text-[12px]" onClick={props.onEdit}>✎ Edit</button>
        {changed && props.onReset && <button className="btn-ghost text-[12px]" onClick={props.onReset}>↺ Reset to default</button>}
        <button className="text-[12px] text-red-400 hover:underline" onClick={props.onDelete}>{pkg.custom ? 'Delete' : 'Remove'}</button>
        <button className="btn-primary ml-auto text-[12px]" onClick={props.onInstall}>⤓ Install</button>
      </div>
    </Overlay>
  )
}

function EditModal({ draft, idLocked, onChange, onSave, onCancel }: { draft: Draft; idLocked: boolean; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const input = 'w-full rounded-lg border border-slate-700 bg-[#0d1017] px-3 py-2 text-[13px] text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-60'
  return (
    <Overlay onClose={onCancel}>
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
        <div className="text-[14px] font-semibold text-slate-100">{draft.orig ? `Edit ${draft.isCustom ? 'software' : 'curated package'}` : 'Add your own software'}</div>
        <button className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-slate-700 hover:text-white" onClick={onCancel}>✕</button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <FieldLbl label="Name"><input className={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. My Internal CLI" /></FieldLbl>
        <FieldLbl label={idLocked ? 'Package id (locked for curated packages)' : 'Package id (exact winget/scoop id)'}>
          <input className={`${input} font-mono`} value={draft.id} disabled={idLocked} onChange={(e) => set({ id: e.target.value })} placeholder="e.g. Company.MyTool" />
        </FieldLbl>
        <div className="grid grid-cols-2 gap-3">
          <FieldLbl label="Source">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              {(['winget', 'scoop'] as const).map((s) => (
                <button key={s} className={`px-3 py-1.5 text-[12px] ${draft.source === s ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => set({ source: s })}>{s}</button>
              ))}
            </div>
          </FieldLbl>
          <FieldLbl label="Category">
            <select className={input} value={draft.category} onChange={(e) => set({ category: e.target.value as PkgCategory })}>
              {(Object.keys(CATEGORY_LABELS) as PkgCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </FieldLbl>
        </div>
        <FieldLbl label="Note (optional)"><input className={input} value={draft.blurb} onChange={(e) => set({ blurb: e.target.value })} placeholder="What is it?" /></FieldLbl>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-400">
          <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={draft.elevate} onChange={(e) => set({ elevate: e.target.checked })} />
          Needs admin (UAC)
        </label>
        <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0d1017] px-3 py-2 font-mono text-[11px] text-slate-500">{draft.id ? previewCmd({ id: draft.id, source: draft.source }) : 'install command preview…'}</pre>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-3">
        <button className="btn-ghost ml-auto text-[12px]" onClick={onCancel}>Cancel</button>
        <button className="btn-primary text-[12px]" onClick={onSave}>{draft.orig ? 'Save' : 'Add software'}</button>
      </div>
    </Overlay>
  )
}
