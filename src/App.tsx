import { useEffect, useRef, useState } from 'react'
import { Dock, buildDefaultLayout } from './Dock'
import { BottomBar } from './components/BottomBar'
import { SetupModal } from './components/SetupModal'
import { Sheet } from './components/Sheet'
import { UpdateBar, type UpState } from './components/UpdateBar'
import { Rail } from './shell/Rail'
import { Home } from './components/Home'
import { Explorer } from './components/Explorer'
import { MachineSetup } from './components/MachineSetup'
import { StashSidebar } from './components/StashSidebar'
import { StashView } from './components/StashView'
import { ConfigPage } from './components/ConfigPage'
import { Icon } from './lib/icons'
import { tauriSelfUpdate } from './lib/updater'
import * as ipc from './lib/ipc'
import { routeOutput } from './lib/termBus'
import { useApp } from './store'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { dockApi, openTerminalPanel, openEditor, openNodeSetup, openSingleton, saveLayout, restoreLayout } from './lib/dock'
import { openTerminal, launchProfile } from './lib/runner'
import { resolveDir } from './lib/tree'

// The widget's first-run tour asks the main window to perform each setup
// step here (its store is separate from the widget's).
async function handleTourAction(action: ipc.TourAction) {
  const st = useApp.getState()
  await ipc.focusMain()
  if (action === 'open-main') {
    st.setRailView('projects')
    return
  }
  if (action === 'workspace') {
    const ws = await ipc.nodeCreate(null, 'workspace', 'New workspace')
    await st.refreshTree()
    useApp.getState().setActiveWorkspace(ws.id)
    useApp.getState().setRailView('projects')
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
    useApp.getState().setRailView('projects')
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

function Menu({
  label,
  children,
  accent,
}: {
  label: React.ReactNode
  children: (close: () => void) => React.ReactNode
  accent?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        className={`inline-flex items-center gap-1 ${accent ? 'btn-primary' : 'btn-ghost'} text-[12px]`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 min-w-52 rounded border border-line2 bg-menu p-1 shadow-xl">
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
  const railView = app.railView

  // Apply the theme to <html> whenever it changes (bootstrap also sets it).
  useEffect(() => {
    document.documentElement.dataset.theme = app.theme
  }, [app.theme])

  // Bottom bar height is layout-local; tab/collapsed live in the store so
  // any view (Home's "open full log", service actions…) can reveal it.
  const [bottomHeight, setBottomHeight] = useState(
    () => Number(localStorage.getItem('devdeck.bottom.height')) || 260,
  )
  useEffect(() => localStorage.setItem('devdeck.bottom.height', String(bottomHeight)), [bottomHeight])
  const showBottom = app.showBottom

  // Self-update: check GitHub for a newer release, update via scoop.
  const [update, setUpdate] = useState<ipc.UpdateInfo | null>(null)
  const [upState, setUpState] = useState<UpState>('checking')
  const [upStatus, setUpStatus] = useState('')
  const [upHidden, setUpHidden] = useState(false)

  // Timestamp of the last completed check, so a background re-check doesn't
  // fire on every window focus.
  const lastCheck = useRef(0)

  const checkUpdate = (quiet = false) => {
    if (!quiet) {
      setUpHidden(false)
      setUpStatus('')
      setUpState('checking')
    }
    void ipc
      .appUpdateInfo()
      .then((info) => {
        lastCheck.current = Date.now()
        setUpdate(info)
        if (!info.ok) {
          // The check failed — say so. Reporting "up to date" here would be a
          // lie that hides real updates (and did, before this).
          setUpStatus("Couldn't reach the update server — check your connection, then re-check.")
          setUpState('error')
          return
        }
        setUpStatus('')
        setUpState(info.available ? 'available' : 'uptodate')
        if (info.available && quiet) setUpHidden(false)
      })
      .catch((e) => {
        setUpStatus(String(e))
        setUpState('error')
      })
  }
  useEffect(() => checkUpdate(), [])

  // Re-check periodically and when the window regains focus — a long-running
  // window used to never learn about a new release after startup.
  useEffect(() => {
    const STALE = 60 * 60_000 // an hour
    const tick = () => {
      const busy = upState === 'checking' || upState === 'updating' || upState === 'done'
      if (!busy && Date.now() - lastCheck.current > STALE) checkUpdate(true)
    }
    const id = setInterval(tick, 15 * 60_000)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upState])
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

  // Background git monitoring: fetch the active workspace's repos on an
  // interval so the "to pull" counts stay live. Re-arms when the toggle, the
  // interval, or the active workspace changes.
  useEffect(() => {
    if (!app.gitMonitorEnabled) return
    const tick = () => void useApp.getState().fetchGitStatus()
    tick()
    const id = setInterval(tick, Math.max(1, app.gitMonitorIntervalMin) * 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.gitMonitorEnabled, app.gitMonitorIntervalMin, app.activeWorkspaceId])

  // Stash stamps every captured clip with the project you were in when you
  // copied it — that context is the whole point of the vault. Only the main
  // window pushes it; the widget runs a separate store instance and would
  // otherwise fight this one over the same backend slot.
  const stashProject = app.selectedProject()
  const stashWorkspace = app.activeWorkspace()
  useEffect(() => {
    void ipc.stashSetContext(
      stashProject?.id ?? null,
      stashProject?.name ?? '',
      stashWorkspace?.name ?? '',
    )
  }, [stashProject?.id, stashProject?.name, stashWorkspace?.name])

  useEffect(() => {
    void app.bootstrap()
    const subs = [
      ipc.onPtyOutput((e) => routeOutput(e.id, e.data)),
      ipc.onPtyExit((e) => {
        useApp.getState().markPtyExited(e.id)
        routeOutput(e.id, '\r\n\x1b[90m[session ended]\x1b[0m\r\n')
      }),
      ipc.onSvcLog((e) => {
        useApp.getState().appendLog(e)
        // A "command not found"-style error on a service line → suggest the
        // tool to install. Cheap prefilter before the IPC round-trip.
        if (
          e.level === 'error' ||
          /not recognized|command not found|no such file/i.test(e.line)
        ) {
          void ipc.suggestInstall(e.line).then((t) => {
            if (t && !t.installed) useApp.getState().setInstallHint(t)
          })
        }
      }),
      ipc.onSvcStatus((e) => useApp.getState().updateSvcState(e)),
      ipc.onStats((e) => {
        useApp.getState().setStats(e)
        // Learn each running service's port from the monitor so you never have
        // to type it in.
        useApp.getState().adoptDetectedPorts()
      }),
      // The Command Widget opens terminals here in the main dock.
      ipc.onOpenTerminal((e) => {
        useApp.getState().setRailView('projects')
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
      // After a pull finishes, re-read local git status (counts change).
      ipc.onGitDone(() => void useApp.getState().refreshGit()),
      // A clip was captured, or the capture toast edited one — the Stash view
      // refreshes if it's on screen.
      ipc.onStashItem(() => useApp.getState().ingestStashItem()),
      ipc.onStashChanged(() => useApp.getState().ingestStashItem()),
      ipc.onStashShot(() => useApp.getState().ingestStashItem()),
    ]
    return () => {
      for (const s of subs) void s.then((un) => un())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runningCount = Object.values(app.svcStates).filter((s) => s.status === 'running').length
  const liveTerms = app.terminals.filter((t) => t.alive)

  return (
    <div className="flex h-screen flex-col bg-app text-body">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1.5">
        <span className="mr-1 select-none text-[13px] font-semibold text-ink">
          <span className="text-indigo-400">❯_</span> DevDeck
        </span>

        <Menu label={<><Icon name="add" size={13} /> Terminal</>} accent>
          {(close) => (
            <>
              {app.shells.map((s) => (
                <button
                  key={s.command}
                  className="menu-item inline-flex items-center gap-1.5"
                  onClick={() => {
                    close()
                    app.setRailView('projects')
                    void openTerminal(s.command, nodeDir || undefined)
                  }}
                >
                  <Icon name="terminal" size={13} /> {s.name}
                  {node && <span className="ml-1 text-muted">in {node.name}</span>}
                </button>
              ))}
              {liveTerms.length > 0 && <div className="my-1 border-t border-line" />}
              {liveTerms.map((t) => (
                <button
                  key={t.id}
                  className="menu-item"
                  onClick={() => {
                    close()
                    app.setRailView('projects')
                    openSingleton(`terminal-${t.id}`, 'terminal', t.title)
                  }}
                >
                  <span className="inline-flex items-center gap-1.5"><Icon name="terminal" size={13} /> #{t.id} {t.title}</span>
                </button>
              ))}
            </>
          )}
        </Menu>

        <Menu label={<><Icon name="service" size={13} /> Launch</>}>
          {(close) => (
            <>
              {app.profiles.length === 0 && (
                <div className="px-2 py-1 text-[11px] text-muted">no profiles yet</div>
              )}
              {app.profiles.map((p) => (
                <button
                  key={p.id}
                  className="menu-item inline-flex items-center gap-1.5"
                  onClick={() => {
                    close()
                    void launchProfile(p)
                  }}
                >
                  <Icon name="service" size={13} /> {p.name}
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
              <div className="my-1 border-t border-line" />
              {app.layouts
                .filter((l) => !l.name.startsWith('__autosave'))
                .map((l) => (
                  <button
                    key={l.id}
                    className="menu-item inline-flex items-center gap-1.5"
                    onClick={() => {
                      close()
                      app.setRailView('projects')
                      restoreLayout(l.data)
                    }}
                  >
                    <Icon name="layout" size={13} /> {l.name}
                  </button>
                ))}
            </>
          )}
        </Menu>

        <div className="flex-1" />
        {node && (
          <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] text-ok" title={nodeDir}>
            <Icon name={node.kind === 'folder' ? 'folder' : 'project'} size={12} /> {node.name}
          </span>
        )}
        <button
          className="btn-ghost flex items-center gap-1 text-[12px]"
          title={`Toggle the floating Command Widget  ·  ${app.hotkey}`}
          onClick={() => void ipc.widgetToggle()}
        >
          <Icon name="widget" size={13} /> Widget
        </button>
        <button
          className={`flex items-center gap-1 text-[12px] ${upState === 'available' ? 'rounded bg-amber-500/15 px-2 py-0.5 font-medium text-warn hover:bg-amber-500/25' : 'btn-ghost'}`}
          title={upState === 'available' ? `Update available — v${update?.latest}` : `DevDeck ${update ? 'v' + update.current : ''} — check for updates`}
          onClick={() => checkUpdate()}
        >
          <Icon name="update" size={13} spin={upState === 'checking' || upState === 'updating'} />
          {upState === 'available' ? `Update · v${update?.latest}` : ''}
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
          onRecheck={() => checkUpdate()}
          onDismiss={() => setUpHidden(true)}
        />
      )}

      {/* Shell: rail → contextual sidebar → view surface */}
      <div className="flex min-h-0 flex-1">
        <Rail />
        {railView === 'projects' && (
          <aside className="w-[280px] shrink-0 overflow-hidden border-r border-line">
            <Explorer />
          </aside>
        )}
        {railView === 'stash' && (
          <aside className="w-[230px] shrink-0 overflow-hidden border-r border-line">
            <StashSidebar />
          </aside>
        )}
        <main className="min-w-0 flex-1">
          {railView === 'home' && <Home />}
          {/* The Dock stays mounted (terminals live in it) — just hidden when
              another rail view is showing. */}
          <div className={railView === 'projects' ? 'h-full' : 'hidden'}>
            <Dock />
          </div>
          {railView === 'stash' && <StashView />}
          {railView === 'machine' && <MachineSetup />}
          {railView === 'settings' && <ConfigPage />}
        </main>
      </div>

      {/* Collapsible / resizable bottom bar: Logs + Processes */}
      <BottomBar
        tab={app.bottomTab}
        onTab={app.setBottomTab}
        collapsed={app.bottomCollapsed}
        onToggleCollapsed={() => app.setBottomCollapsed(!app.bottomCollapsed)}
        height={bottomHeight}
        onHeight={setBottomHeight}
      />

      {/* Status bar */}
      <div className="flex items-center gap-4 border-t border-line bg-panel px-3 py-1 text-[11px] text-muted">
        <span>
          <span className={runningCount ? 'text-ok' : ''}>{runningCount}</span> service
          {runningCount === 1 ? '' : 's'} running
        </span>
        <span>
          {liveTerms.length} terminal{liveTerms.length === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <span>{app.hotkey} summons · local-first · SQLite</span>
      </div>

      {/* Slide-over editor sheet */}
      <Sheet />

      {/* Project Setup: prepare-to-run prompt */}
      {app.setupPrompt && (
        <SetupModal
          svc={app.setupPrompt.svc}
          setup={app.setupPrompt.setup}
          dir={app.setupPrompt.dir}
          onClose={app.dismissSetup}
        />
      )}

      {/* Missing-tool hint from a command's error */}
      {app.installHint && (
        <div className="fixed bottom-16 right-4 z-[400] flex max-w-[360px] items-center gap-3 rounded-lg border border-amber-500/30 bg-menu px-3 py-2.5 text-[12px] shadow-2xl">
          <Icon name="puzzle" size={16} className="shrink-0 text-warn" />
          <div className="min-w-0">
            <div className="text-ink"><b>{app.installHint.name}</b> looks missing</div>
            <div className="truncate font-mono text-[11px] text-muted">{app.installHint.pkg_id}</div>
          </div>
          <button
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-indigo-500"
            onClick={() => {
              const t = app.installHint!
              showBottom('logs')
              void ipc.machineInstall([{ id: t.pkg_id, source: t.source }])
                .then(() => ipc.onMachineDone(() => void ipc.refreshPath()))
              app.setInstallHint(null)
            }}
          >
            <Icon name="download" size={13} /> Install
          </button>
          <button className="flex shrink-0 items-center rounded px-1 text-muted hover:text-ink" onClick={() => app.setInstallHint(null)}><Icon name="close" size={13} /></button>
        </div>
      )}
    </div>
  )
}
