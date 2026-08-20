// Machine Setup: install dev software via winget/scoop, see what's already
// installed, pick one-click bundles, and export/import a machine manifest to
// rebuild a fresh Windows box. Install output streams to the bottom-bar Logs.

import { useEffect, useMemo, useState } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import {
  PACKAGES,
  BUNDLES,
  CATEGORY_LABELS,
  type CatalogPackage,
  type PkgCategory,
} from '../lib/machineCatalog'

type ItemStatus = 'installing' | 'ok' | 'failed'

const byId = new Map(PACKAGES.map((p) => [p.id, p]))

export function MachineSetup() {
  const [winget, setWinget] = useState<Set<string>>(new Set())
  const [scoop, setScoop] = useState<Set<string>>(new Set())
  const [avail, setAvail] = useState<{ winget: boolean; scoop: boolean }>({ winget: true, scoop: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [live, setLive] = useState<Map<string, ItemStatus>>(new Map())
  const [installing, setInstalling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | 'winget' | 'scoop'>('all')

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

  const isInstalled = (p: CatalogPackage): boolean => {
    if (live.get(p.id) === 'ok') return true
    return p.source === 'scoop' ? scoop.has(p.id.toLowerCase()) : winget.has(p.id.toLowerCase())
  }
  const statusOf = (p: CatalogPackage): 'installed' | 'installing' | 'failed' | 'none' => {
    const l = live.get(p.id)
    if (l === 'installing') return 'installing'
    if (isInstalled(p)) return 'installed'
    if (l === 'failed') return 'failed'
    return 'none'
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return PACKAGES.filter(
      (p) =>
        (source === 'all' || p.source === source) &&
        (q === '' || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.blurb ?? '').toLowerCase().includes(q)),
    )
  }, [search, source])

  const groups = useMemo(() => {
    const map = new Map<PkgCategory, CatalogPackage[]>()
    for (const p of visible) map.set(p.category, [...(map.get(p.category) ?? []), p])
    return [...map.entries()]
  }, [visible])

  const installedCount = PACKAGES.filter((p) => isInstalled(p)).length
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
    ids
      .map((id) => byId.get(id))
      .filter((p): p is CatalogPackage => !!p)
      .map((p) => ({ id: p.id, source: p.source }))

  const installSelected = async () => {
    if (selectableSelected.length === 0) return
    setInstalling(true)
    setLive((m) => {
      const n = new Map(m)
      for (const id of selectableSelected) n.set(id, 'installing')
      return n
    })
    try {
      await ipc.machineInstall(itemsFor(selectableSelected))
    } catch (e) {
      alert(String(e))
      setInstalling(false)
    }
  }

  const installOne = async (p: CatalogPackage) => {
    setLive((m) => new Map(m).set(p.id, 'installing'))
    setInstalling(true)
    try {
      await ipc.machineInstall([{ id: p.id, source: p.source }])
    } catch (e) {
      alert(String(e))
      setInstalling(false)
    }
  }

  const manifestFromSelection = (): ipc.Manifest => ({
    name: 'dev machine',
    version: 1,
    packages: [...selected].map((id) => {
      const p = byId.get(id)
      return { id, source: p?.source ?? 'winget', elevate: p?.elevate }
    }),
    steps: [],
    repos: [],
  })

  const doExport = async () => {
    if (selected.size === 0) return alert('Select some packages first, then Export.')
    const path = await saveDialog({ title: 'Export machine manifest', defaultPath: 'devdeck.machine.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (typeof path !== 'string') return
    await ipc.machineExport(path, manifestFromSelection())
  }

  const doSnapshot = async () => {
    const known = PACKAGES.map((p) => ({ id: p.id, source: p.source }))
    const manifest = await ipc.machineSnapshot('my dev machine', known)
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
        for (const pkg of m.packages) {
          const p = byId.get(pkg.id)
          if (p && !isInstalled(p)) n.add(pkg.id)
        }
        return n
      })
    } catch (e) {
      alert(String(e))
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0e14] text-slate-300">
      {/* header */}
      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold text-slate-100">Machine Setup</h1>
            <p className="mt-1 max-w-[62ch] text-[12.5px] text-slate-500">
              Install and track your toolchain in one place. Export it as a manifest, then rebuild a
              fresh Windows install in one click.
            </p>
          </div>
          <div className="ml-auto flex shrink-0 gap-1.5">
            <button className="btn-ghost text-[12px]" onClick={() => void doImport()}>↥ Import</button>
            <button className="btn-ghost text-[12px]" onClick={() => void doExport()}>↧ Export</button>
            <button className="btn-ghost text-[12px]" title="Read what's installed and write a manifest" onClick={() => void doSnapshot()}>📸 Snapshot machine</button>
            <button className="btn-primary text-[12px]" disabled={selectableSelected.length === 0 || installing} onClick={() => void installSelected()}>
              {installing ? 'Installing…' : `⤓ Install selected · ${selectableSelected.length}`}
            </button>
          </div>
        </div>
      </div>

      {/* availability warnings */}
      {(!avail.winget || !avail.scoop) && (
        <div className="border-b border-slate-800 bg-amber-500/[0.06] px-5 py-2 text-[11.5px] text-amber-400/90">
          {!avail.winget && <span>winget was not found on this machine — winget installs are disabled. </span>}
          {!avail.scoop && <span>scoop is not installed — scoop packages are disabled (install scoop to enable CLI tools). </span>}
        </div>
      )}

      {/* toolbar */}
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* bundles */}
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

        {/* stats */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Stat n={installedCount} label="Installed" color="text-emerald-400" dot="bg-emerald-400" />
          <Stat n={selectableSelected.length} label="Selected to install" color="text-indigo-300" dot="bg-indigo-400" />
          <Stat n={PACKAGES.length - installedCount} label="Available" color="text-slate-300" dot="bg-slate-600" />
        </div>

        {/* catalog */}
        {groups.map(([cat, pkgs]) => (
          <div key={cat} className="mt-5">
            <div className="flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
              {CATEGORY_LABELS[cat]} <span className="text-slate-600">{pkgs.length}</span>
              <span className="h-px flex-1 bg-gradient-to-r from-slate-800 to-transparent" />
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {pkgs.map((p) => {
                const st = statusOf(p)
                const disabled = st === 'installed' || (p.source === 'scoop' ? !avail.scoop : !avail.winget)
                return (
                  <div key={p.id} className="group flex items-center gap-3 rounded-lg border border-slate-800 bg-[#151923] px-3 py-2 hover:border-slate-600">
                    <input type="checkbox" className="h-4 w-4 accent-indigo-500" disabled={disabled} checked={selected.has(p.id) && st !== 'installed'} onChange={() => toggle(p.id)} />
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-700 bg-[#0d1017] text-[12px] font-semibold text-slate-400">{p.name[0]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-100">{p.name}</span>
                        {p.elevate && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold text-amber-400" title="Needs admin (UAC)">admin</span>}
                      </div>
                      <div className="truncate font-mono text-[11px] text-slate-500">{p.id}{p.blurb ? `  ·  ${p.blurb}` : ''}</div>
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[9.5px] font-semibold ${p.source === 'scoop' ? 'bg-emerald-500/12 text-emerald-400' : 'bg-sky-500/12 text-sky-400'}`}>{p.source}</span>
                    <StatusBadge status={st} />
                    <button
                      className={`min-w-[76px] shrink-0 rounded-md px-2.5 py-1 text-[11px] ${st === 'installed' ? 'text-slate-500' : st === 'installing' ? 'border border-slate-700 text-slate-400' : 'bg-indigo-600 font-semibold text-white hover:bg-indigo-500'}`}
                      disabled={disabled || st === 'installing'}
                      onClick={() => void installOne(p)}
                    >
                      {st === 'installed' ? 'Installed' : st === 'installing' ? 'Installing…' : st === 'failed' ? 'Retry' : 'Install'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="mt-6 text-[12px] text-slate-500">No packages match “{search}”.</div>}
      </div>
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
  if (status === 'installed')
    return <span className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10.5px] text-emerald-400">Installed</span>
  if (status === 'installing')
    return <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10.5px] text-indigo-300">Installing…</span>
  if (status === 'failed')
    return <span className="shrink-0 rounded-full bg-red-500/12 px-2 py-0.5 text-[10.5px] text-red-400">Failed</span>
  return <span className="shrink-0 rounded-full bg-white/[0.045] px-2 py-0.5 text-[10.5px] text-slate-500">Not installed</span>
}
