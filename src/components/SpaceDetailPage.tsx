// Personalized detail page for one space (Project): a themed hero header,
// live activity/sessions, and the space's Services, Commands, and Profiles
// with run controls (including multi-select "Run selected" for services).

import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { openEditor, openNodeSetup, openService, openTerminalPanel } from '../lib/dock'
import { openTerminal, runCommandInNewTerminal, runCommandInBackground, launchProfile } from '../lib/runner'
import { subtreeIds, resolveDir, serviceDir, nodeLabel } from '../lib/tree'
import { nodeColor, avatarLabel } from '../lib/spaces'
import { ColorPicker } from './ColorPicker'
import { Icon } from '../lib/icons'
import type { ProfileStep, ProfileDef, ServiceDef, CommandDef } from '../lib/types'

function fmtUptime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

type Tab = 'services' | 'commands' | 'profiles'

export function SpaceDetailPage(props: IDockviewPanelProps<{ id: number }>) {
  const projectId = props.params.id
  const { nodes, services, commands, profiles, svcStates, stats, terminals, refreshTree } = useApp()
  const [tab, setTab] = useState<Tab>('services')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)

  const project = nodes.find((n) => n.id === projectId) ?? null
  const color = project ? nodeColor(project) : '#7C8CF8'

  const setColor = async (hex: string) => {
    await ipc.nodeUpdate(projectId, { color: hex })
    await refreshTree()
  }
  const scope = useMemo(() => new Set(subtreeIds(nodes, projectId)), [nodes, projectId])
  const baseDir = project ? resolveDir(nodes, project) : ''

  const spaceServices = useMemo(
    () => services.filter((s) => s.project_id != null && scope.has(s.project_id)),
    [services, scope],
  )
  const spaceCommands = useMemo(
    () => commands.filter((c) => c.project_id != null && scope.has(c.project_id)),
    [commands, scope],
  )
  const spaceProfiles = useMemo(
    () => profiles.filter((p) => p.project_id != null && scope.has(p.project_id)),
    [profiles, scope],
  )
  const folders = useMemo(() => nodes.filter((n) => n.kind === 'folder' && scope.has(n.id)), [nodes, scope])

  const runningServices = spaceServices.filter((s) => svcStates[s.id]?.status === 'running')

  const sessionTerminals = useMemo(() => {
    if (!baseDir) return []
    const base = baseDir.toLowerCase()
    return terminals.filter((t) => t.alive && (t.cwd ?? '').toLowerCase().startsWith(base))
  }, [terminals, baseDir])

  const statOf = (kind: 'service' | 'terminal', id: number) =>
    stats.find((p) => p.kind === kind && p.id === id)

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-page text-[13px] text-muted">
        This space no longer exists.
      </div>
    )
  }

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      alert(String(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleSel = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const runSelected = async () => {
    const ids = [...selected].filter((id) => svcStates[id]?.status !== 'running')
    for (const id of ids) {
      try {
        await ipc.svcStart(id)
      } catch (e) {
        console.error('start failed', id, e)
      }
    }
    setSelected(new Set())
  }

  const startAll = async () => {
    for (const s of spaceServices) {
      if (svcStates[s.id]?.status !== 'running') {
        try {
          await ipc.svcStart(s.id)
        } catch (e) {
          console.error(e)
        }
      }
    }
  }

  const stopAll = async () => {
    for (const s of runningServices) {
      try {
        await ipc.svcStop(s.id)
      } catch (e) {
        console.error(e)
      }
    }
  }

  const openBrowser = (port: number) => void ipc.openUrl(`http://localhost:${port}`).catch((e) => alert(String(e)))
  const profileStepCount = (p: ProfileDef): number => {
    try {
      return (JSON.parse(p.steps) as ProfileStep[]).length
    } catch {
      return 0
    }
  }

  const chip = (label: string, value: React.ReactNode, accent?: string) => (
    <div className="rounded-lg border border-line bg-raise/80 px-3 py-1.5">
      <div className="text-[15px] font-semibold leading-none" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  )

  return (
    <div className="flex h-full flex-col overflow-auto bg-page text-body">
      {/* Hero */}
      <div
        className="relative border-b border-line px-5 pb-4 pt-5"
        style={{ background: `linear-gradient(135deg, ${hexA(color, 0.18)} 0%, rgba(15,19,27,0) 60%)` }}
      >
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[20px] font-bold text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${color}, ${hexA(color, 0.65)})`, boxShadow: `0 6px 20px ${hexA(color, 0.35)}` }}
          >
            {avatarLabel(project.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted">{nodeLabel(nodes, project)}</div>
            <div className="truncate text-[22px] font-semibold text-ink">{project.name}</div>
            {baseDir && (
              <button
                className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-muted hover:text-ink"
                title="Reveal in File Explorer"
                onClick={() => void ipc.revealInExplorer(baseDir).catch((e) => alert(String(e)))}
              >
                <span className="truncate">{baseDir}</span> <Icon name="external" size={12} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <ColorPicker
              color={color}
              custom={!!project.color}
              onPick={(hex) => void setColor(hex)}
              onReset={() => void setColor('')}
            />
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-line2 bg-soft px-3 py-1.5 text-[12px] text-ink hover:border-line3"
              disabled={!baseDir}
              onClick={() => void openTerminal(undefined, baseDir || undefined)}
            >
              <Icon name="terminal" size={13} /> Terminal
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
              style={{ background: color, boxShadow: `0 4px 14px ${hexA(color, 0.35)}` }}
              disabled={spaceServices.length === 0}
              title="Start every service in this space"
              onClick={() => void startAll()}
            >
              <Icon name="run" size={13} /> Start all
            </button>
            {runningServices.length > 0 && (
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[12px] text-err hover:bg-red-500/25"
                onClick={() => void stopAll()}
              >
                <Icon name="stop" size={13} /> Stop all
              </button>
            )}
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-line2 bg-soft px-3 py-1.5 text-[12px] text-ink hover:border-line3"
              onClick={() => openNodeSetup(project.id, project.name)}
            >
              <Icon name="settings" size={13} /> Setup
            </button>
          </div>
        </div>

        {/* Stat chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          {chip('running', <span>{runningServices.length}<span className="text-muted">/{spaceServices.length}</span></span>, runningServices.length ? '#4ADE80' : undefined)}
          {chip('services', spaceServices.length)}
          {chip('commands', spaceCommands.length)}
          {chip('profiles', spaceProfiles.length)}
          {chip('folders', folders.length)}
          {chip('sessions', sessionTerminals.length, sessionTerminals.length ? '#38BDF8' : undefined)}
        </div>
      </div>

      {/* Active sessions */}
      {(runningServices.length > 0 || sessionTerminals.length > 0) && (
        <div className="border-b border-line px-5 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Active now</div>
          <div className="flex flex-wrap gap-2">
            {runningServices.map((s) => {
              const st = statOf('service', s.id)
              return (
                <div key={`svc-${s.id}`} className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-2.5 py-1.5 text-[12px]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  <span className="text-ink">{s.name}</span>
                  {st && <span className="font-mono text-[10px] text-muted">{fmtUptime(st.uptime_secs)} · {st.mem_mb.toFixed(0)}mb</span>}
                  {s.health_port != null && (
                    <button className="flex items-center text-info hover:underline" title={`Open http://localhost:${s.health_port}`} onClick={() => openBrowser(s.health_port!)}><Icon name="globe" size={13} /></button>
                  )}
                  <button className="flex items-center text-err" title="Stop" onClick={() => void act(s.id, () => ipc.svcStop(s.id))}><Icon name="stop" size={13} /></button>
                </div>
              )
            })}
            {sessionTerminals.map((t) => (
              <button
                key={`term-${t.id}`}
                className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/[0.07] px-2.5 py-1.5 text-[12px] hover:border-sky-500/60"
                onClick={() => openTerminalPanel(t.id, t.title)}
              >
                <span className="text-ok">❯_</span>
                <span className="text-ink">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-line px-4 pt-2">
        {(['services', 'commands', 'profiles'] as Tab[]).map((t) => {
          const active = tab === t
          const count = t === 'services' ? spaceServices.length : t === 'commands' ? spaceCommands.length : spaceProfiles.length
          return (
            <button
              key={t}
              className={`relative px-3 py-2 text-[12.5px] capitalize ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
              onClick={() => setTab(t)}
            >
              {t} <span className="text-[10px] text-muted">{count}</span>
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: color }} />}
            </button>
          )
        })}
      </div>

      {/* Panels */}
      <div className="flex-1 p-4">
        {tab === 'services' && (
          <ServicesTab
            list={spaceServices}
            svcStates={svcStates}
            selected={selected}
            busy={busy}
            color={color}
            onToggle={toggleSel}
            onRunSelected={runSelected}
            onClearSel={() => setSelected(new Set())}
            onAct={act}
            openBrowser={openBrowser}
            dirOf={(s) => serviceDir(nodes, s)}
          />
        )}
        {tab === 'commands' && <CommandsTab list={spaceCommands} />}
        {tab === 'profiles' && <ProfilesTab list={spaceProfiles} stepCount={profileStepCount} />}
      </div>
    </div>
  )
}

function ServicesTab({
  list,
  svcStates,
  selected,
  busy,
  color,
  onToggle,
  onRunSelected,
  onClearSel,
  onAct,
  openBrowser,
  dirOf,
}: {
  list: ServiceDef[]
  svcStates: Record<number, { status: string; pid: number | null } | undefined>
  selected: Set<number>
  busy: number | null
  color: string
  onToggle: (id: number) => void
  onRunSelected: () => void
  onClearSel: () => void
  onAct: (id: number, fn: () => Promise<unknown>) => Promise<void>
  openBrowser: (port: number) => void
  dirOf: (s: ServiceDef) => string
}) {
  if (list.length === 0)
    return <Empty text="No services in this space yet." action={{ label: '+ New service', onClick: () => openEditor('service', 0, 'New service') }} />
  const selCount = [...selected].filter((id) => list.some((s) => s.id === id)).length
  return (
    <div className="space-y-2">
      {selCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px]" style={{ borderColor: hexA(color, 0.4), background: hexA(color, 0.08) }}>
          <span className="text-ink">{selCount} selected</span>
          <span className="flex-1" />
          <button className="rounded px-2 py-0.5 text-[11px] text-dim hover:text-ink" onClick={onClearSel}>Clear</button>
          <button className="inline-flex items-center gap-1 rounded px-3 py-0.5 text-[11px] font-medium text-white" style={{ background: color }} onClick={onRunSelected}><Icon name="run" size={12} /> Run selected</button>
        </div>
      )}
      {list.map((s) => {
        const st = svcStates[s.id]
        const running = st?.status === 'running'
        const isSel = selected.has(s.id)
        const dir = dirOf(s)
        return (
          <div key={s.id} className="group flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3 py-2 hover:border-line2">
            <input type="checkbox" className="accent-indigo-500" checked={isSel} onChange={() => onToggle(s.id)} title="Select for Run selected" />
            <span className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse bg-emerald-400' : st?.status === 'crashed' ? 'bg-red-400' : 'bg-faint'}`} />
            <button className="min-w-0 flex-1 text-left" title="Open the service page" onClick={() => openService(s.id, s.name || 'Service')}>
              <div className="truncate text-[12.5px] text-ink">{s.name}</div>
              <div className="truncate font-mono text-[10.5px] text-muted">{s.command}</div>
            </button>
            <button
              className="hidden shrink-0 items-center rounded px-1 text-[12px] text-dim hover:bg-hover hover:text-ink group-hover:flex disabled:opacity-40"
              title={dir ? `Reveal in File Explorer\n${dir}` : 'No folder set for this service'}
              disabled={!dir}
              onClick={() => void ipc.revealInExplorer(dir).catch((e) => alert(String(e)))}
            ><Icon name="reveal" size={13} /></button>
            {s.health_port != null && (
              <button className="hidden shrink-0 items-center rounded px-1 text-[12px] text-dim hover:bg-hover hover:text-ink group-hover:flex" title={`Open http://localhost:${s.health_port}`} onClick={() => openBrowser(s.health_port!)}><Icon name="globe" size={13} /></button>
            )}
            {running ? (
              <>
                <button className="btn-ghost flex items-center text-[11px]" disabled={busy === s.id} title="Restart" onClick={() => void onAct(s.id, () => ipc.svcRestart(s.id))}><Icon name="restart" size={12} /></button>
                <button className="btn-danger inline-flex items-center gap-1 text-[11px]" disabled={busy === s.id} onClick={() => void onAct(s.id, () => ipc.svcStop(s.id))}><Icon name="stop" size={12} /> Stop</button>
              </>
            ) : (
              <button className="btn-primary inline-flex items-center gap-1 text-[11px]" disabled={busy === s.id} onClick={() => void onAct(s.id, () => ipc.svcStart(s.id))}><Icon name="run" size={12} /> Start</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CommandsTab({ list }: { list: CommandDef[] }) {
  if (list.length === 0)
    return <Empty text="No commands in this space yet." action={{ label: '+ New command', onClick: () => openEditor('command', 0, 'New command') }} />
  return (
    <div className="space-y-2">
      {list.map((c) => (
        <div key={c.id} className="group flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3 py-2 hover:border-line2">
          <span className="flex items-center text-indigo-400"><Icon name="command" size={13} /></span>
          <button className="min-w-0 flex-1 text-left" onClick={() => openEditor('command', c.id, c.name || 'Command')}>
            <div className="truncate text-[12.5px] text-ink">{c.name}</div>
            <div className="truncate font-mono text-[10.5px] text-muted">{c.command}</div>
          </button>
          <button className="btn-ghost inline-flex items-center gap-1 text-[11px]" title="Run in background" onClick={() => void runCommandInBackground(c).catch((e) => alert(String(e)))}><Icon name="logs" size={12} /> Bg</button>
          <button className="btn-primary inline-flex items-center gap-1 text-[11px]" title="Run in a new terminal" onClick={() => void runCommandInNewTerminal(c).catch((e) => alert(String(e)))}><Icon name="run" size={12} /> Run</button>
        </div>
      ))}
    </div>
  )
}

function ProfilesTab({ list, stepCount }: { list: ProfileDef[]; stepCount: (p: ProfileDef) => number }) {
  if (list.length === 0)
    return <Empty text="No launch profiles in this space yet." action={{ label: '+ New profile', onClick: () => openEditor('profile', 0, 'New profile') }} />
  return (
    <div className="space-y-2">
      {list.map((p) => (
        <div key={p.id} className="group flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3 py-2 hover:border-line2">
          <span className="flex items-center text-warn"><Icon name="service" size={13} /></span>
          <button className="min-w-0 flex-1 text-left" onClick={() => openEditor('profile', p.id, p.name || 'Profile')}>
            <div className="truncate text-[12.5px] text-ink">{p.name}</div>
            <div className="text-[10.5px] text-muted">{stepCount(p)} step{stepCount(p) === 1 ? '' : 's'}</div>
          </button>
          <button className="btn-primary inline-flex items-center gap-1 text-[11px]" title="Launch profile" onClick={() => void launchProfile(p).catch((e) => alert(String(e)))}><Icon name="service" size={12} /> Launch</button>
        </div>
      ))}
    </div>
  )
}

function Empty({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line py-10 text-center">
      <div className="text-[12.5px] text-muted">{text}</div>
      {action && (
        <button className="btn-primary text-[12px]" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
