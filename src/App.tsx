import { useEffect, useRef, useState } from 'react'
import { Dock, buildDefaultLayout } from './Dock'
import { BottomBar } from './components/BottomBar'
import { InboxPage } from './components/InboxPage'
import { TeamPage } from './components/team/TeamPage'
import { BotsPage } from './components/BotsPage'
import { AnalyticsPage } from './components/AnalyticsPage'
import { CalendarPage } from './components/CalendarPage'
import { ApprovalBar } from './components/aiw/ApprovalBar'
import { FocusBar } from './components/FocusBar'
import { SetupModal } from './components/SetupModal'
import { VaultSetup } from './components/VaultSetup'
import { Sheet } from './components/Sheet'
import { UpdateBar, VersionPill, type UpState } from './components/UpdateBar'
import { ClockToast } from './components/ClockToast'
import { Rail } from './shell/Rail'
import { WorkspaceTabs } from './shell/WorkspaceTabs'
import { WindowControls } from './shell/WindowControls'
import { AgentCluster, NotificationBell, AccountChip } from './shell/TopBarStatus'
import { Home } from './components/Home'
import { Explorer } from './components/Explorer'
import { MachineSetup } from './components/MachineSetup'
import { StashSidebar } from './components/StashSidebar'
import { StashView } from './components/StashView'
import { ConnectionsSidebar } from './components/ConnectionsSidebar'
import {
  CAPTURE_CHECK,
  CAPTURE_EVENT,
  CAPTURE_NODE,
  CAPTURE_RAIL,
  CAPTURE_SAY,
} from './lib/devCapture'
import { AiwSidebar } from './components/aiw/AiwSidebar'
import { AiWorkspace } from './components/aiw/AiWorkspace'
import { ConnectionsView } from './components/ConnectionsView'
import { ConnectionEditor } from './components/ConnectionEditor'
import { ConfigPage } from './components/ConfigPage'
import { Icon } from './lib/icons'
import { tauriSelfUpdate } from './lib/updater'
import * as ipc from './lib/ipc'
import { aiw as aiwApi } from './lib/aiw'
import { routeOutput } from './lib/termBus'
import { useApp } from './store'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openNodeThread, dockApi, openTerminalPanel, openEditor, openNodeSetup, openSingleton, saveLayout, restoreLayout } from './lib/dock'
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
    const ws = await ipc.vaultCreate(null, 'New workspace')
    await st.refreshTree()
    useApp.getState().setActiveWorkspace(ws.id)
    useApp.getState().setRailView('projects')
    void ipc.emitDataChanged()
    return
  }
  if (action === 'project') {
    let ws = useApp.getState().nodes.find((n) => n.kind === 'workspace')
    if (!ws) {
      ws = await ipc.vaultCreate(null, 'New workspace')
      await st.refreshTree()
    }
    const dir = await openDialog({ directory: true, title: 'Select the project base folder (repo root)' })
    if (typeof dir !== 'string') return
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const created = await ipc.vaultCreate(ws.id, name)
    await ipc.vaultSetMeta(created.id, { repo: dir })
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
  bar,
}: {
  label: React.ReactNode
  children: (close: () => void) => React.ReactNode
  accent?: boolean
  /// A menu-bar item: flat until hovered or open, so a row of them reads as
  /// one bar rather than five buttons.
  bar?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        className={
          bar
            ? `inline-flex items-center rounded px-2.5 py-1 text-[12px] ${
                open ? 'bg-hover text-ink' : 'text-body hover:bg-hover/60 hover:text-ink'
              }`
            : `inline-flex items-center gap-1 ${accent ? 'btn-primary' : 'btn-ghost'} text-[12px]`
        }
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

/// Whether the capture harness has already said its piece this session.
let said = false
let checked = false
let evented = false

export default function App() {
  const app = useApp()
  const node = app.selectedNode()
  const nodeDir = resolveDir(app.nodes, node)
  const railView = app.railView

  // We are on screen. The window was created hidden; this is what shows it.
  // Deliberately the first effect in the shell and dependency-free, so it
  // fires on the first paint whatever else is still loading.
  useEffect(() => {
    void ipc.appReady().catch(() => {})
  }, [])

  // Screenshot harness: put a one-off on the calendar, through the same
  // command the interface calls. `ISO|title|minutes`, comma-separated.
  useEffect(() => {
    if (!CAPTURE_EVENT || evented) return
    evented = true
    void (async () => {
      for (const spec of CAPTURE_EVENT.split(',')) {
        const [iso, title, mins] = spec.split('|')
        if (!iso || !title) continue
        try {
          await ipc.scheduleSave({
            name: title,
            kind: 'reminder',
            nodeId: null,
            every: 'once',
            atMin: 0,
            atMs: new Date(iso).getTime(),
            durationMin: Number(mins) || 0,
            days: '',
            payload: '',
            catchUp: false,
          })
        } catch (e) {
          console.error('[capture] could not add', spec, e)
        }
      }
    })()
  }, [])

  // Screenshot harness: prove a model answers, through the same command the
  // button calls. `provider:model`, comma-separated. A real request each, so
  // it only ever runs when this is deliberately set.
  useEffect(() => {
    // Guarded like CAPTURE_SAY, and for the same reason: an effect that runs
    // twice in development makes two real API calls.
    if (!CAPTURE_CHECK || checked) return
    checked = true
    void (async () => {
      for (const pair of CAPTURE_CHECK.split(',')) {
        const [provider, ...rest] = pair.split(':')
        if (!provider || rest.length === 0) continue
        try {
          console.log('[capture] check', await aiwApi.modelCheck(provider, rest.join(':')))
        } catch (e) {
          console.error('[capture] check failed', pair, e)
        }
      }
    })()
  }, [])

  // Screenshot harness (temporary): applied at runtime so a hot module
  // update takes effect without a full reload.
  useEffect(() => {
    if (CAPTURE_RAIL && railView !== CAPTURE_RAIL) app.setRailView(CAPTURE_RAIL as typeof railView)
  })

  // Screenshot harness: open a node's thread, and say things in it.
  //
  // This session cannot deliver clicks or keystrokes to WebView2, so evidence
  // that a thread works has to be produced some other way. It goes through the
  // same commands the composer calls — real personas, real provider, real
  // transcript on disk. All this chooses is *what gets said*; nothing about
  // what comes back is scripted, which is the only way a screenshot of it is
  // worth anything.
  useEffect(() => {
    if (CAPTURE_NODE) {
      // The dock mounts after the tree loads, and opening a panel before it
      // exists is a silent no-op — which looks exactly like the feature not
      // working. Wait for it.
      const id = Number(CAPTURE_NODE)
      const open = window.setInterval(() => {
        const node = useApp.getState().nodes.find((n) => n.id === id)
        // Not just "the dock exists": the saved layout is restored a moment
        // after it does, and restoring replaces whatever was open. Waiting for
        // panels means waiting for that to have happened.
        const api = dockApi()
        if (!node || !api || api.panels.length === 0) return
        window.clearInterval(open)
        openNodeThread(node.id, node.name)
      }, 400)
      window.setTimeout(() => window.clearInterval(open), 20000)
    }
    // React runs effects twice in development, and a message sent twice is
    // two messages. Guarded at module scope rather than with a ref, because
    // the second run is a second mount of the same component.
    if (CAPTURE_SAY.length === 0 || said) return
    said = true
    let stopped = false
    void (async () => {
      for (const line of CAPTURE_SAY) {
        if (stopped) return
        const [kind, id, ...rest] = line.split(':')
        try {
          if (kind === 'feature') {
            await ipc.featureThreadSend(Number(id), rest[0], rest.slice(1).join(':'))
          } else if (kind === 'node') {
            await ipc.nodeThreadSend(Number(id), rest.join(':'))
          } else if (kind === 'bot') {
            await ipc.botThreadSend(Number(id), rest.join(':'))
          }
        } catch (e) {
          // Failing loudly in the console beats a screenshot of a thread that
          // silently never got its message.
          console.error('[capture] could not say', line, e)
        }
      }
    })()
    return () => {
      stopped = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.nodes.length])

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
  const [upHidden, setUpHidden] = useState(true)
  // The bar stays out of the way until you ask for it — the version pill in
  // the top bar carries the status, and clicking it opens this.

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
      })
      .catch((e) => {
        setUpStatus(String(e))
        setUpState('error')
      })
  }
  // Check on launch, but quietly: the pill reports the result, not the bar.
  useEffect(() => checkUpdate(true), [])

  // The label registry, read once so the tree menu and the config page agree.
  useEffect(() => void useApp.getState().refreshLabels(), [])

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
      // One stream: services, queries, pulls, clips and screenshots all land here.
      ipc.onActivity((a) => useApp.getState().pushActivity(a)),
    ]
    return () => {
      for (const s of subs) void s.then((un) => un())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // undefined = not asked yet (render nothing), null = no vault chosen.
  const [vaultRoot, setVaultRoot] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    void ipc
      .vaultRoot()
      .then((r) => setVaultRoot(r))
      .catch(() => setVaultRoot(null))
  }, [])

  const runningCount = Object.values(app.svcStates).filter((s) => s.status === 'running').length
  const liveTerms = app.terminals.filter((t) => t.alive)

  // Nothing works without a vault folder, so ask for one before showing a
  // shell whose Explorer would only ever be empty.
  // Not asked yet: paint the ground rather than a shell that is about to be
  // replaced by the setup screen.
  if (vaultRoot === undefined) return <div className="h-screen bg-app" />
  if (vaultRoot === null) {
    return (
      <div className="flex h-screen flex-col bg-app text-body">
        <VaultSetup
          onDone={() => {
            setVaultRoot('')
            void app.refreshTree()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-app text-body">
      {/* Top bar: the app menu, then the workspaces, then what needs you.
          Launch, Layout and Widget folded into the menu — they are things you
          *start*, and they were sitting in the corner you look at to find out
          whether anything is waiting. Terminal moved for the same reason: it
          opens a terminal somewhere, so it belongs to a project, not to the
          app. */}
      {/* The window has no native frame, so this row is the title bar: empty
          space in it drags the window, double-click maximises, and the three
          controls live at its right end. Interactive children are unaffected —
          Tauri only starts a drag when the element you pressed carries the
          attribute itself. */}
      <div className="flex items-stretch border-b border-line bg-panel" data-tauri-drag-region>
        <Menu
          label={
            <span className="inline-flex items-center gap-1.5">
              <span className="text-indigo-400">❯_</span> DevDeck
            </span>
          }
        >
          {(close) => (
            <>
              <div className="px-2 py-1.5 text-[11px] text-muted">
                DevDeck {update?.current ? `v${update.current}` : ''}
              </div>
              <div className="my-1 border-t border-line" />
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  app.setRailView('settings')
                }}
              >
                <Icon name="settings" size={13} /> Settings
              </button>
            </>
          )}
        </Menu>

        {/* The four standard menus, beside the brand rather than inside it.
            Every item here already existed in the one DevDeck dropdown; this
            only says out loud which kind of thing each one is. */}
        <div className="flex items-center gap-0.5 self-center pl-1">
          <Menu bar label="File">
            {(close) => (
              <>
                <div className="px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  New terminal
                </div>
                {app.shells.map((sh) => (
                  <button
                    key={sh.command}
                    className="menu-item"
                    onClick={() => {
                      close()
                      app.setRailView('projects')
                      void openTerminal(sh.command, nodeDir || undefined)
                    }}
                  >
                    <Icon name="terminal" size={13} /> {sh.name}
                  </button>
                ))}
                {liveTerms.length > 0 && (
                  <>
                    <div className="my-1 border-t border-line" />
                    <div className="px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                      Open terminals
                    </div>
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
                        <Icon name="terminal" size={13} /> #{t.id} {t.title}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </Menu>

          <Menu bar label="View">
            {(close) => (
              <>
                <div className="px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Layout
                </div>
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
                {app.layouts
                  .filter((l) => !l.name.startsWith('__autosave'))
                  .map((l) => (
                    <button
                      key={l.id}
                      className="menu-item"
                      onClick={() => {
                        close()
                        app.setRailView('projects')
                        restoreLayout(l.data)
                      }}
                    >
                      <Icon name="layout" size={13} /> {l.name}
                    </button>
                  ))}

                <div className="my-1 border-t border-line" />
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    app.showBottom('logs')
                  }}
                >
                  <Icon name="logs" size={13} /> Logs
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    app.showBottom('processes')
                  }}
                >
                  <Icon name="machine" size={13} /> Processes
                </button>

                <div className="my-1 border-t border-line" />
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    void ipc.widgetToggle()
                  }}
                >
                  <Icon name="widget" size={13} /> Command widget
                  <span className="ml-auto text-[10px] text-faint">{app.hotkey}</span>
                </button>
              </>
            )}
          </Menu>

          <Menu bar label="Build">
            {(close) => (
              <>
                {app.profiles.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11.5px] text-muted">No launch profiles yet.</div>
                ) : (
                  <>
                    <div className="px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-faint">
                      Launch
                    </div>
                    {app.profiles.map((pr) => (
                      <button
                        key={pr.id}
                        className="menu-item"
                        onClick={() => {
                          close()
                          void launchProfile(pr)
                        }}
                      >
                        <Icon name="service" size={13} /> {pr.name}
                      </button>
                    ))}
                  </>
                )}
                {node && (node.kind === 'project' || node.kind === 'folder') && (
                  <>
                    <div className="my-1 border-t border-line" />
                    <button
                      className="menu-item"
                      onClick={() => {
                        close()
                        openNodeSetup(node.id, node.name)
                      }}
                    >
                      <Icon name="tool" size={13} /> Set up “{node.name}”…
                    </button>
                  </>
                )}
              </>
            )}
          </Menu>

          <Menu bar label="Help">
            {(close) => (
              <>
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    void checkUpdate()
                  }}
                >
                  <Icon name="update" size={13} /> Check for updates
                  {update && <span className="ml-auto text-[10px] text-faint">v{update.current}</span>}
                </button>
                <div className="my-1 border-t border-line" />
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    void ipc.openUrl('https://github.com/d3velopm3nt/devdeck')
                  }}
                >
                  <Icon name="external" size={13} /> GitHub repository
                </button>
              </>
            )}
          </Menu>
        </div>

        <div className="ml-auto flex items-center gap-2.5 pl-2 pr-1">
          <AgentCluster />
          {/* The widget has a global hotkey, but a hotkey you have to remember
              is not a way in. It keeps a button. */}
          <button
            className="flex items-center rounded p-1 text-dim hover:bg-hover hover:text-ink"
            title={`Toggle the floating Command Widget  ·  ${app.hotkey}`}
            onClick={() => void ipc.widgetToggle()}
          >
            <Icon name="widget" size={15} />
          </button>
          {/* The version, always visible, coloured by update state. Green means
              you're current; clicking opens the update bar and re-checks. */}
          <VersionPill
            state={upState}
            current={update?.current ?? ''}
            latest={update?.latest ?? ''}
            open={!upHidden}
            onClick={() => (upHidden ? checkUpdate() : setUpHidden(true))}
          />
          <div className="h-4 w-px bg-line" />
          <NotificationBell />
          <AccountChip />
        </div>

        <WindowControls />
      </div>

      {/* Workspaces get the row to themselves. Sharing the title bar with the
          menus meant two different kinds of thing — commands and places —
          competing for the same strip. */}
      <div className="flex items-stretch border-b border-line bg-panel" data-tauri-drag-region>
        <WorkspaceTabs />
      </div>


      {/* The goal you are on, when you are on one. Above the update bar
          because it is about right now and the update bar is not. */}
      <FocusBar />
      <ClockToast />

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

      {/* An agent stopped mid-turn is on a 90-second clock, and the Assistant
          is no longer a place you sit — so the prompt lives above every view
          rather than on one of them. */}
      <ApprovalBar />

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
        {railView === 'connections' && (
          <aside className="w-[250px] shrink-0 overflow-hidden border-r border-line">
            <ConnectionsSidebar />
          </aside>
        )}
        {railView === 'aiworkspace' && (
          <aside className="w-[224px] shrink-0 overflow-hidden border-r border-line">
            <AiwSidebar />
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
          {railView === 'connections' && <ConnectionsView />}
          {railView === 'aiworkspace' && <AiWorkspace />}
          {railView === 'machine' && <MachineSetup />}
          {railView === 'inbox' && <InboxPage />}
          {railView === 'team' && <TeamPage />}
          {railView === 'bots' && <BotsPage />}
          {railView === 'analytics' && <AnalyticsPage />}
          {railView === 'calendar' && <CalendarPage />}
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

      {/* Slide-over editor sheets */}
      <Sheet />
      <ConnectionEditor />

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
