// Dockable IDE-style workspace built on dockview: every panel
// (explorer, terminals, services, logs, …) can be dragged, split,
// tabbed, floated, resized; layouts serialize to SQLite.

import {
  DockviewReact,
  themeDark,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import { Explorer } from './components/Explorer'
import { Dashboard } from './components/Dashboard'
import { CommandsPanel } from './components/CommandsPanel'
import { ServicesPanel } from './components/ServicesPanel'
import { ProcessDashboard } from './components/ProcessDashboard'
import { LogViewer } from './components/LogViewer'
import { ProfilesPanel } from './components/ProfilesPanel'
import { MachineSetup } from './components/MachineSetup'
import { SettingsPanel } from './components/SettingsPanel'
import { ConfigPage } from './components/ConfigPage'
import { CommandEditorPage } from './components/editors/CommandEditorPage'
import { ServiceEditorPage } from './components/editors/ServiceEditorPage'
import { ProfileEditorPage } from './components/editors/ProfileEditorPage'
import { NodeSetupPage } from './components/editors/NodeSetupPage'
import { SpaceDetailPage } from './components/SpaceDetailPage'
import { TerminalView } from './components/TerminalView'
import { TerminalTab } from './components/TerminalTab'
import { useEffect, useState } from 'react'
import { setDockApi, openInMain } from './lib/dock'
import * as ipc from './lib/ipc'
import { useApp } from './store'
import { openTerminal } from './lib/runner'
import { resolveDir } from './lib/tree'
import { loadExampleWorkspace } from './lib/example'

const AUTOSAVE = '__autosave__'

function Welcome() {
  const { shells, nodes, selectedNode } = useApp()
  const node = selectedNode()
  const dir = resolveDir(nodes, node)
  const [hasExample, setHasExample] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void ipc.exampleExists().then(setHasExample).catch(() => setHasExample(true))
  }, [nodes])

  const loadExample = async () => {
    setLoading(true)
    try {
      await loadExampleWorkspace()
    } catch (e) {
      alert(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[#0d1017] p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="text-2xl font-semibold text-slate-200">
          <span className="text-indigo-400">❯_</span> DevDeck
        </div>
        <p className="text-[13px] leading-6 text-slate-500">
          Your local development command center. Pick a project or folder in
          the Explorer, then open terminals, start services, and watch logs —
          all in one place.
        </p>

        {!hasExample && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.07] p-4">
            <div className="text-[13px] font-medium text-slate-200">New here?</div>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">
              Load an example workspace — a small demo project with a real web
              server and a background worker you can actually start, watch, and
              open in your browser.
            </p>
            <button className="btn-primary mt-3 text-[12px]" disabled={loading} onClick={() => void loadExample()}>
              {loading ? 'Setting up…' : '✨ Load example workspace'}
            </button>
            <p className="mt-2 text-[10.5px] text-slate-600">
              creates a small folder in your user directory · removable any time
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          {shells.map((s) => (
            <button
              key={s.command}
              className="btn-primary text-[12px]"
              onClick={() => void openTerminal(s.command, dir || undefined)}
            >
              ❯ {s.name}
            </button>
          ))}
        </div>
        {dir && (
          <p className="text-[11px] text-slate-600">
            terminals open in <span className="text-slate-400">{dir}</span>
          </p>
        )}
      </div>
    </div>
  )
}

const components = {
  explorer: () => <Explorer />,
  dashboard: () => <Dashboard />,
  commands: () => <CommandsPanel />,
  services: () => <ServicesPanel />,
  processes: () => <ProcessDashboard />,
  logs: () => <LogViewer />,
  profiles: () => <ProfilesPanel />,
  machine: () => <MachineSetup />,
  settings: () => <SettingsPanel />,
  config: () => <ConfigPage />,
  'command-editor': (props: IDockviewPanelProps<{ id: number; projectId?: number | null }>) => (
    <CommandEditorPage {...props} />
  ),
  'service-editor': (props: IDockviewPanelProps<{ id: number; projectId?: number | null }>) => (
    <ServiceEditorPage {...props} />
  ),
  'profile-editor': (props: IDockviewPanelProps<{ id: number; projectId?: number | null }>) => (
    <ProfileEditorPage {...props} />
  ),
  'node-setup': (props: IDockviewPanelProps<{ id: number }>) => <NodeSetupPage {...props} />,
  'space-detail': (props: IDockviewPanelProps<{ id: number }>) => <SpaceDetailPage {...props} />,
  welcome: () => <Welcome />,
  terminal: (props: IDockviewPanelProps<{ ptyId: number }>) => (
    <TerminalView ptyId={props.params.ptyId} />
  ),
}

// Custom tab headers. Only terminals use one (to confirm ending the
// session on close); everything else uses the default tab.
const tabComponents = {
  terminalTab: TerminalTab,
}

export function buildDefaultLayout(api: DockviewReadyEvent['api']) {
  api.clear()
  api.addPanel({ id: 'explorer', component: 'explorer', title: 'Explorer' })
  api.addPanel({
    id: 'dashboard',
    component: 'dashboard',
    title: 'Dashboard',
    position: { referencePanel: 'explorer', direction: 'right' },
  })
  api.addPanel({
    id: 'welcome',
    component: 'welcome',
    title: 'Welcome',
    position: { referencePanel: 'dashboard', direction: 'within' },
  })
  api.addPanel({
    id: 'commands',
    component: 'commands',
    title: 'Commands',
    position: { referencePanel: 'explorer', direction: 'below' },
  })
  api.addPanel({
    id: 'services',
    component: 'services',
    title: 'Services',
    position: { referencePanel: 'commands', direction: 'within' },
  })
  api.addPanel({
    id: 'profiles',
    component: 'profiles',
    title: 'Profiles',
    position: { referencePanel: 'commands', direction: 'within' },
  })
  // Logs & Processes now live in the app's bottom bar, not the dock.
  api.getPanel('commands')?.api.setActive()
  api.getPanel('dashboard')?.api.setActive()

  const explorer = api.getPanel('explorer')
  if (explorer) explorer.api.setSize({ width: 280 })
}

export function Dock() {
  const onReady = async (event: DockviewReadyEvent) => {
    setDockApi(event.api)

    // Restore the last session's layout, else build the default.
    let restored = false
    try {
      const layouts = await ipc.layoutsList()
      const auto = layouts.find((l) => l.name === AUTOSAVE)
      if (auto) {
        event.api.fromJSON(JSON.parse(auto.data))
        restored = true
      }
    } catch {
      restored = false
    }
    if (!restored) buildDefaultLayout(event.api)

    // Autosave layout (debounced) so the workspace reopens as you left it.
    // Registered BEFORE the cleanup below so that removing stale panels is
    // itself persisted — otherwise the old layout keeps coming back.
    let timer: ReturnType<typeof setTimeout> | undefined
    event.api.onDidLayoutChange(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void ipc.layoutSave(AUTOSAVE, JSON.stringify(event.api.toJSON()))
      }, 800)
    })

    // A restored layout may predate the Dashboard, or (from an earlier
    // build) contain it in the wrong dock. Force it into the main center
    // group so it never lands in the Explorer sidebar column.
    if (restored) {
      const stale = event.api.getPanel('dashboard')
      if (stale) event.api.removePanel(stale)
      openInMain('dashboard', 'dashboard', 'Dashboard')
      event.api.getPanel('dashboard')?.api.setActive()
    }

    // Logs & Processes moved to the bottom bar — drop any that a saved layout
    // (or an earlier build) left in the dock, whichever path we took above.
    for (const id of ['logs', 'processes']) {
      try {
        const p = event.api.getPanel(id)
        if (p) event.api.removePanel(p)
      } catch {
        /* not present / already gone */
      }
    }
  }

  return (
    <DockviewReact
      className="h-full w-full"
      theme={themeDark}
      components={components}
      tabComponents={tabComponents}
      onReady={(e: DockviewReadyEvent) => void onReady(e)}
    />
  )
}
