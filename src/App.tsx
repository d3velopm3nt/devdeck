import { useEffect, useState } from 'react'
import { Dock, buildDefaultLayout } from './Dock'
import { BottomBar, type BottomTab } from './components/BottomBar'
import { UpdateBar, type UpState } from './components/UpdateBar'
import { tauriSelfUpdate } from './lib/updater'
import * as ipc from './lib/ipc'
import { routeOutput } from './lib/termBus'
import { useApp } from './store'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { dockApi, openSingleton, openInMain, openTerminalPanel, openEditor, openNodeSetup, saveLayout, restoreLayout } from './lib/dock'
import { openTerminal, launchProfile } from './lib/runner'
import { resolveDir } from './lib/tree'

// The widget's first-run tour asks the main window to perform each setup
// step here (its store is separate from the widget's).
async function handleTourAction(action: ipc.TourAction) {
  const st = useApp.getState()
  await ipc.focusMain()
  if (action === 'open-main') {
    openSingleton('explorer', 'explorer', 'Explorer')
    return
  }
  if (action === 'workspace') {
    const ws = await ipc.nodeCreate(null, 'workspace', 'New workspace')
    await st.refreshTree()
    useApp.getState().setActiveWorkspace(ws.id)
    openSingleton('explorer', 'explorer', 'Explorer')
    void ipc.emitDataChanged()
    return
  }
  if (action === 'project') {
    let ws = useApp.getState().nodes.find((n) => n.kind === 'workspace')
    if (!ws) {
      ws = await ipc.nodeCreate(null, 'workspace', 'New workspace')
      await st.refreshTree()
    }
    const dir = await openDialog({ directory: true, title: 'Select the project base folder (repo root)' })
    if (typeof dir !== 'string') return
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const created = await ipc.nodeCreate(ws.id, 'project', name, dir)
    await st.refreshTree()
    useApp.getState().setActiveWorkspace(ws.id)
    useApp.getState().setSelectedNode(created.id)
    openNodeSetup(created.id, name)
    void ipc.emitDataChanged()
    return
  }
  // command / service / profile → open the create editor scoped to a project
  const nodes = useApp.getState().nodes
  const proj = nodes.find((n) => n.kind === 'project')
  const target = proj?.id ?? useApp.getState().selectedNodeId ?? null
  if (action === 'command') openEditor('command', 0, 'New command', target)
  else if (action === 'service') openEditor('service', 0, 'New service', target)
  else if (action === 'profile') openEditor('profile', 0, 'New profile', target)
}

// Logs & Processes live in the collapsible bottom bar, not the dock.
const PANELS: Array<{ id: string; component: string; title: string; main?: boolean }> = [
  { id: 'dashboard', component: 'dashboard', title: 'Dashboard' },
  { id: 'explorer', component: 'explorer', title: 'Explorer' },
  { id: 'commands', component: 'commands', title: 'Commands' },
  { id: 'services', component: 'services', title: 'Services' },
  { id: 'profiles', component: 'profiles', title: 'Profiles' },
  { id: 'machine', component: 'machine', title: 'Machine Setup', main: true },
  { id: 'config', component: 'config', title: 'Settings', main: true },
  { id: 'welcome', component: 'welcome', title: 'Welcome' },
]

function Menu({
  label,
  children,
  accent,
}: {
  label: string
  children: (close: () => void) => React.ReactNode
  accent?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        className={accent ? 'btn-primary text-[12px]' : 'btn-ghost text-[12px]'}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 min-w-52 rounded border border-slate-700 bg-[#1a1f2b] p-1 shadow-xl">
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const app = useApp()
  const node = app.selectedNode()
  const nodeDir = resolveDir(app.nodes, node)

  // Bottom bar (Logs / Processes) — collapsed state, active tab and height
  // persist across restarts.
  const [bottomTab, setBottomTab] = useState<BottomTab>(
    () => (localStorage.getItem('devdeck.bottom.tab') as BottomTab) || 'logs',
  )
  const [bottomCollapsed, setBottomCollapsed] = useState(
    () => localStorage.getItem('devdeck.bottom.collapsed') === '1',
  )
  const [bottomHeight, setBottomHeight] = useState(
    () => Number(localStorage.getItem('devdeck.bottom.height')) || 260,
  )
  useEffect(() => localStorage.setItem('devdeck.bottom.tab', bottomTab), [bottomTab])
  useEffect(() => localStorage.setItem('devdeck.bottom.collapsed', bottomCollapsed ? '1' : '0'), [bottomCollapsed])
  useEffect(() => localStorage.setItem('devdeck.bottom.height', String(bottomHeight)), [bottomHeight])

  const showBottom = (t: BottomTab) => {
    setBottomTab(t)
    setBottomCollapsed(false)
  }

  // Self-update: check GitHub for a newer release, update via scoop.
  const [update, setUpdate] = useState<ipc.UpdateInfo | null>(null)
  const [upState, setUpState] = useState<UpState>('checking')
  const [upStatus, setUpStatus] = useState('')
  const [upHidden, setUpHidden] = useState(false)

  const checkUpdate = () => {
    setUpHidden(false)
    setUpStatus('')
    setUpState('checking')
    void ipc
      .appUpdateInfo()
      .then((info) => {
        setUpdate(info)
        setUpState(info.available ? 'available' : 'uptodate')
      })
      .catch((e) => {
        setUpStatus(String(e))
        setUpState('error')
      })
  }
  useEffect(checkUpdate, [])
  useEffect(() => {
    // Reflect scoop-update progress (streamed to the log bus) in the bar.
    const un = ipc.onSvcLog((e) => {
      if (e.service !== 'devdeck update') return
      setUpStatus(e.line)
      if (/finished|restart DevDeck/i.test(e.line)) setUpState('done')
      else if (/failed/i.test(e.line)) setUpState('error')
    })
    return () => void un.then((u) => u())
  }, [])
  // Non-scoop installer path (Rust downloads + runs the installer, streamed to
  // the log bus). Fallback when the signed updater has nothing published yet.
  const updateViaInstaller = () => {
    setUpStatus('Fetching the latest installer…')
    showBottom('logs')
    void ipc.appUpdate().catch((e) => {
      setUpStatus(String(e))
      setUpState('error')
    })
  }

  const runUpdate = () => {
    if (!update) return
    setUpState('updating')
    if (update.via_scoop) {
      // scoop owns the install → scoop update (streams to Logs).
      setUpStatus('Starting scoop update…')
      showBottom('logs')
      void ipc.appUpdate().catch((e) => {
        setUpStatus(String(e))
        setUpState('error')
      })
      return
    }
    // Prefer the signed Tauri updater; fall back to the installer download if
    // no signed manifest is published yet (or it errors).
    setUpStatus('Checking for a signed update…')
    void tauriSelfUpdate(setUpStatus)
      .then((r) => {
        if (r === 'none') updateViaInstaller()
      })
      .catch((e) => {
        console.warn('signed updater unavailable, using installer:', e)
        updateViaInstaller()
      })
  }

  // Install scoop from the update bar (to enable one-click updates + CLI tools).
  const [scoopInstalling, setScoopInstalling] = useState(false)
  const installScoop = () => {
    setScoopInstalling(true)
    setUpStatus('Installing scoop (per-user, no admin)…')
    showBottom('logs')
    void ipc.machineInstallScoop().catch((e) => {
      setUpStatus(String(e))
      setScoopInstalling(false)
    })
  }
  useEffect(() => {
    // scoop install (and package installs) emit machine:done — re-check after.
    const un = ipc.onMachineDone(() => {
      if (scoopInstalling) {
        setScoopInstalling(false)
        checkUpdate()
      }
    })
    return () => void un.then((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoopInstalling])

  useEffect(() => {
    void app.bootstrap()
    const subs = [
      ipc.onPtyOutput((e) => routeOutput(e.id, e.data)),
      ipc.onPtyExit((e) => {
        useApp.getState().markPtyExited(e.id)
        routeOutput(e.id, '\r\n\x1b[90m[session ended]\x1b[0m\r\n')
      }),
      ipc.onSvcLog((e) => useApp.getState().appendLog(e)),
      ipc.onSvcStatus((e) => useApp.getState().updateSvcState(e)),
      ipc.onStats((e) => {
        useApp.getState().setStats(e)
        // Learn each running service's port from the monitor so you never have
        // to type it in.
        useApp.getState().adoptDetectedPorts()
      }),
      // The Command Widget opens terminals here in the main dock.
      ipc.onOpenTerminal((e) => {
        void useApp.getState().refreshTerminals().then(() => openTerminalPanel(e.ptyId, e.title))
      }),
      // The widget's setup tour drives create flows in this window.
      ipc.onTourAction((a) => void handleTourAction(a)),
      // When the widget changes data (or vice-versa), refresh.
      ipc.onDataChanged(() => {
        const s = useApp.getState()
        void s.refreshTree()
        void s.refreshCommands()
        void s.refreshServices()
        void s.refreshProfiles()
      }),
    ]
    return () => {
      for (const s of subs) void s.then((un) => un())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runningCount = Object.values(app.svcStates).filter((s) => s.status === 'running').length
  const liveTerms = app.terminals.filter((t) => t.alive)

  return (
    <div className="flex h-screen flex-col bg-[#0b0e14] text-slate-300">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 bg-[#11141c] px-2 py-1.5">
        <span className="mr-1 select-none text-[13px] font-semibold text-slate-100">
          <span className="text-indigo-400">❯_</span> DevDeck
        </span>

        <Menu label="＋ Terminal" accent>
          {(close) =>
            app.shells.map((s) => (
              <button
                key={s.command}
                className="menu-item"
                onClick={() => {
                  close()
                  void openTerminal(s.command, nodeDir || undefined)
                }}
              >
                ❯ {s.name}
                {node && <span className="ml-1 text-slate-500">in {node.name}</span>}
              </button>
            ))
          }
        </Menu>

        <Menu label="⚡ Launch">
          {(close) => (
            <>
              {app.profiles.length === 0 && (
                <div className="px-2 py-1 text-[11px] text-slate-500">no profiles yet</div>
              )}
              {app.profiles.map((p) => (
                <button
                  key={p.id}
                  className="menu-item"
                  onClick={() => {
                    close()
                    void launchProfile(p)
                  }}
                >
                  ⚡ {p.name}
                </button>
              ))}
            </>
          )}
        </Menu>

        <Menu label="Panels">
          {(close) => (
            <>
              {PANELS.map((p) => (
                <button
                  key={p.id}
                  className="menu-item"
                  onClick={() => {
                    close()
                    if (p.main) openInMain(p.id, p.component, p.title)
                    else openSingleton(p.id, p.component, p.title)
                  }}
                >
                  {p.title}
                </button>
              ))}
              <div className="my-1 border-t border-slate-700" />
              <button className="menu-item" onClick={() => { close(); showBottom('logs') }}>
                Logs (bottom bar)
              </button>
              <button className="menu-item" onClick={() => { close(); showBottom('processes') }}>
                Processes (bottom bar)
              </button>
              <div className="my-1 border-t border-slate-700" />
              {liveTerms.map((t) => (
                <button
                  key={t.id}
                  className="menu-item"
                  onClick={() => {
                    close()
                    openSingleton(`terminal-${t.id}`, 'terminal', t.title)
                  }}
                >
                  ❯ #{t.id} {t.title}
                </button>
              ))}
            </>
          )}
        </Menu>

        <Menu label="Layout">
          {(close) => (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  const name = prompt('Save layout as')?.trim()
                  if (name) {
                    void saveLayout(name).then(() => useApp.getState().refreshLayouts())
                  }
                }}
              >
                Save current as…
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  const api = dockApi()
                  if (api) buildDefaultLayout(api)
                }}
              >
                Reset to default
              </button>
              <div className="my-1 border-t border-slate-700" />
              {app.layouts
                .filter((l) => l.name !== '__autosave__')
                .map((l) => (
                  <button
                    key={l.id}
                    className="menu-item"
                    onClick={() => {
                      close()
                      restoreLayout(l.data)
                    }}
                  >
                    ▦ {l.name}
                  </button>
                ))}
            </>
          )}
        </Menu>

        <div className="flex-1" />
        {node && (
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400" title={nodeDir}>
            {node.kind === 'folder' ? '▤' : '▣'} {node.name}
          </span>
        )}
        <button
          className="btn-ghost text-[12px]"
          title={`Toggle the floating Command Widget  ·  ${app.hotkey}`}
          onClick={() => void ipc.widgetToggle()}
        >
          ▧ Widget
        </button>
        <button
          className="btn-ghost text-[12px]"
          title="Install & manage dev software"
          onClick={() => openInMain('machine', 'machine', 'Machine Setup')}
        >
          🖥 Machine
        </button>
        <button
          className={`text-[12px] ${upState === 'available' ? 'rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300 hover:bg-amber-500/25' : 'btn-ghost'}`}
          title={upState === 'available' ? `Update available — v${update?.latest}` : `DevDeck ${update ? 'v' + update.current : ''} — check for updates`}
          onClick={checkUpdate}
        >
          {upState === 'available' ? `⟳ Update · v${update?.latest}` : '⟳'}
        </button>
        <button
          className="btn-ghost text-[12px]"
          title="Settings"
          onClick={() => openInMain('config', 'config', 'Settings')}
        >
          ⚙ Settings
        </button>
      </div>

      {/* Self-update status bar */}
      {!upHidden && (
        <UpdateBar
          state={upState}
          current={update?.current ?? ''}
          latest={update?.latest ?? ''}
          viaScoop={update?.via_scoop ?? false}
          scoopAvailable={update?.scoop_available ?? true}
          scoopInstalling={scoopInstalling}
          status={upStatus}
          onUpdate={runUpdate}
          onInstallScoop={installScoop}
          onRecheck={checkUpdate}
          onDismiss={() => setUpHidden(true)}
        />
      )}

      {/* Dock area */}
      <div className="min-h-0 flex-1">
        <Dock />
      </div>

      {/* Collapsible / resizable bottom bar: Logs + Processes */}
      <BottomBar
        tab={bottomTab}
        onTab={setBottomTab}
        collapsed={bottomCollapsed}
        onToggleCollapsed={() => setBottomCollapsed((c) => !c)}
        height={bottomHeight}
        onHeight={setBottomHeight}
      />

      {/* Status bar */}
      <div className="flex items-center gap-4 border-t border-slate-800 bg-[#11141c] px-3 py-1 text-[11px] text-slate-500">
        <span>
          <span className={runningCount ? 'text-emerald-400' : ''}>{runningCount}</span> service
          {runningCount === 1 ? '' : 's'} running
        </span>
        <span>
          {liveTerms.length} terminal{liveTerms.length === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <span>{app.hotkey} summons · local-first · SQLite</span>
      </div>
    </div>
  )
}
