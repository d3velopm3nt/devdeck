import { useEffect, useState } from 'react'
import { Dock, buildDefaultLayout } from './Dock'
import * as ipc from './lib/ipc'
import { routeOutput } from './lib/termBus'
import { useApp } from './store'
import { dockApi, openSingleton, openInMain, openTerminalPanel, saveLayout, restoreLayout } from './lib/dock'
import { openTerminal, launchProfile } from './lib/runner'
import { resolveDir } from './lib/tree'

const PANELS: Array<{ id: string; component: string; title: string; main?: boolean }> = [
  { id: 'dashboard', component: 'dashboard', title: 'Dashboard' },
  { id: 'explorer', component: 'explorer', title: 'Explorer' },
  { id: 'commands', component: 'commands', title: 'Commands' },
  { id: 'services', component: 'services', title: 'Services' },
  { id: 'profiles', component: 'profiles', title: 'Profiles' },
  { id: 'logs', component: 'logs', title: 'Logs' },
  { id: 'processes', component: 'processes', title: 'Processes' },
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
      ipc.onStats((e) => useApp.getState().setStats(e)),
      // The Command Widget opens terminals here in the main dock.
      ipc.onOpenTerminal((e) => {
        void useApp.getState().refreshTerminals().then(() => openTerminalPanel(e.ptyId, e.title))
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
          title="Settings"
          onClick={() => openInMain('config', 'config', 'Settings')}
        >
          ⚙ Settings
        </button>
      </div>

      {/* Dock area */}
      <div className="min-h-0 flex-1">
        <Dock />
      </div>

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
