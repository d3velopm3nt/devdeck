// The document surface: terminals, space pages, and project setup, built on
// dockview so real documents can be split, tabbed and floated. Navigation
// (Explorer, Home, Machine, Settings) lives in the fixed shell around this —
// only documents get dock tabs.

import {
  DockviewReact,
  themeDark,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react'
import { NodeConfigPage } from './components/editors/NodeConfigPage'
import { NodeSetupPage } from './components/editors/NodeSetupPage'
import { SpaceDetailPage } from './components/SpaceDetailPage'
import { BotPage } from './components/bot/BotPage'
import { CAPTURE_BOT } from './lib/devCapture'
import { openBot } from './lib/dock'
import { ServiceDetailPage } from './components/ServiceDetailPage'
import { TerminalView } from './components/TerminalView'
import { TerminalTab } from './components/TerminalTab'
import { useEffect, useState } from 'react'
import { setDockApi } from './lib/dock'
import * as ipc from './lib/ipc'
import { useApp } from './store'
import { openTerminal } from './lib/runner'
import { resolveDir } from './lib/tree'
import { loadExampleWorkspace } from './lib/example'
import { Icon } from './lib/icons'

// v2: the shell restructure moved navigation out of the dock — old autosaves
// reference panels that no longer exist, so they get a fresh key.
const AUTOSAVE = '__autosave_v2__'

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
    <div className="flex h-full items-center justify-center bg-page p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="text-2xl font-semibold text-ink">
          <span className="text-indigo-400">❯_</span> DevDeck
        </div>
        <p className="text-[13px] leading-6 text-muted">
          Your local development command center. Pick a project or folder in
          the Explorer, then open terminals, start services, and watch logs —
          all in one place.
        </p>

        {!hasExample && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.07] p-4">
            <div className="text-[13px] font-medium text-ink">New here?</div>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              Load an example workspace — a small demo project with a real web
              server and a background worker you can actually start, watch, and
              open in your browser.
            </p>
            <button className="btn-primary mt-3 inline-flex items-center gap-1.5 text-[12px]" disabled={loading} onClick={() => void loadExample()}>
              {loading ? 'Setting up…' : <><Icon name="example" size={13} /> Load example workspace</>}
            </button>
            <p className="mt-2 text-[10.5px] text-faint">
              creates a small folder in your user directory · removable any time
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          {shells.map((s) => (
            <button
              key={s.command}
              className="btn-primary inline-flex items-center gap-1.5 text-[12px]"
              onClick={() => void openTerminal(s.command, dir || undefined)}
            >
              <Icon name="terminal" size={13} /> {s.name}
            </button>
          ))}
        </div>
        {dir && (
          <p className="text-[11px] text-faint">
            terminals open in <span className="text-dim">{dir}</span>
          </p>
        )}
      </div>
    </div>
  )
}

import { NodePage } from './components/node/NodePage'
import { AssistantThread } from './components/thread/AssistantThread'
import {
  AssistantPanel,
  ContextPanel,
  GitPanel,
  FeaturesPanel,
} from './components/aiw/ProjectPanels'
import { FileViewer } from './components/FileViewer'

const components = {
  'node-setup': (props: IDockviewPanelProps<{ id: number }>) => <NodeSetupPage {...props} />,
  'node-config': (props: IDockviewPanelProps<{ id: number }>) => <NodeConfigPage {...props} />,
  'node-thread': (props: IDockviewPanelProps<{ id: number }>) => <NodePage {...props} />,
  'assistant-thread': () => <AssistantThread />,
  'space-detail': (props: IDockviewPanelProps<{ id: number }>) => <SpaceDetailPage {...props} />,
  'bot-detail': (props: IDockviewPanelProps<{ id: number; ask?: boolean }>) => <BotPage {...props} />,
  'service-detail': (props: IDockviewPanelProps<{ id: number }>) => <ServiceDetailPage {...props} />,
  file: (props: IDockviewPanelProps<{ nodeId: number; rel: string; root: 'work' | 'vault' }>) => (
    <FileViewer nodeId={props.params.nodeId} rel={props.params.rel} root={props.params.root} />
  ),
  welcome: () => <Welcome />,
  terminal: (props: IDockviewPanelProps<{ ptyId: number }>) => (
    <TerminalView ptyId={props.params.ptyId} />
  ),
  // A project's AI views are documents like any other. Nothing swaps the
  // surface out any more; everything opens as a tab you can split and drag.
  'aiw-assistant': AssistantPanel,
  'aiw-context': ContextPanel,
  'aiw-git': GitPanel,
  'aiw-features': FeaturesPanel,
}

// Custom tab headers. Only terminals use one (to confirm ending the
// session on close); everything else uses the default tab.
const tabComponents = {
  terminalTab: TerminalTab,
}

export function buildDefaultLayout(api: DockviewReadyEvent['api']) {
  api.clear()
  api.addPanel({ id: 'welcome', component: 'welcome', title: 'Welcome' })
}

export function Dock() {
  const onReady = async (event: DockviewReadyEvent) => {
    setDockApi(event.api)

    // Restore the last session's layout, else build the default. A layout
    // from before the shell restructure references removed panels and fails
    // to parse — that error path lands on the default too.
    let restored = false
    try {
      const layouts = await ipc.layoutsList()
      const auto = layouts.find((l) => l.name === AUTOSAVE)
      if (auto) {
        event.api.fromJSON(JSON.parse(auto.data))
        restored = event.api.panels.length > 0
      }
    } catch {
      restored = false
    }
    if (!restored) buildDefaultLayout(event.api)

    // Dev-only: open one bot page straight away, so a screenshot can be taken
    // of a screen this session cannot click its way to. Inert when unset.
    if (CAPTURE_BOT) openBot(Number(CAPTURE_BOT), 'Bot')

    // Autosave layout (debounced) so the workspace reopens as you left it.
    let timer: ReturnType<typeof setTimeout> | undefined
    event.api.onDidLayoutChange(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void ipc.layoutSave(AUTOSAVE, JSON.stringify(event.api.toJSON()))
      }, 800)
    })
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
