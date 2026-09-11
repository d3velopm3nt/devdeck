// Services and commands, in full, on the node that owns them.
//
// The column beside the thread shows the same things in one line each, because
// there it is answering "is anything up right now". This answers the other
// question — what is configured, what it runs, and where — which needs the
// room a card does not have.
//
// Both live here rather than one tab called "Runs": a service is supervised and
// keeps running, a command is a thing you fire and watch. They are started the
// same way and that is the only thing they share.

import { useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { openEditor } from '../../lib/dock'
import { focusCommandSession, runCommandInNewTerminal } from '../../lib/runner'
import type { TreeNode } from '../../lib/types'

export function NodeRuns({ node, only }: { node: TreeNode; only: 'services' | 'commands' }) {
  const app = useApp()
  const { commands, services, svcStates, requestStartService } = app
  const [busy, setBusy] = useState<number | null>(null)

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  if (only === 'services') {
    const rows = services.filter((s) => s.project_id === node.id)
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        {rows.map((sv) => {
          const st = svcStates[sv.id]
          const running = st?.status === 'running'
          const crashed = st?.status === 'crashed'
          return (
            <div
              key={sv.id}
              className="flex items-start gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
            >
              <span
                className={`mt-1 h-[7px] w-[7px] shrink-0 rounded-full ${
                  running ? 'animate-pulse bg-emerald-400' : crashed ? 'bg-red-400' : 'bg-line2'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[12.5px] text-ink">{sv.name}</span>
                  {!!sv.health_port && (
                    <span className="shrink-0 font-mono text-[10.5px] text-muted">
                      :{sv.health_port}
                    </span>
                  )}
                  {/* Said, not implied by a grey dot: a service that fell over
                      and one that was never started look the same otherwise. */}
                  {crashed && <span className="shrink-0 text-[10.5px] text-err">crashed</span>}
                  {sv.auto_restart && (
                    <span className="shrink-0 text-[10px] text-faint">restarts itself</span>
                  )}
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted">{sv.command}</div>
                {sv.cwd && <div className="mt-0.5 truncate text-[10.5px] text-faint">{sv.cwd}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  className="btn-ghost text-[11px]"
                  disabled={busy === sv.id}
                  onClick={() =>
                    void act(sv.id, () => (running ? ipc.svcStop(sv.id) : requestStartService(sv)))
                  }
                >
                  {running ? 'Stop' : 'Start'}
                </button>
                <button
                  className="btn-ghost text-[11px]"
                  onClick={() => openEditor('service', sv.id, sv.name, node.id)}
                >
                  <Icon name="settings" size={11} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const rows = commands.filter((c) => c.project_id === node.id)
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      {rows.map((c) => (
        <div
          key={c.id}
          className="flex items-start gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
        >
          <Icon name="run" size={13} className="mt-0.5 shrink-0 text-dim" />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink">{c.name}</span>
            <span className="mt-1 block truncate font-mono text-[11px] text-muted">{c.command}</span>
            {c.cwd && <span className="mt-0.5 block truncate text-[10.5px] text-faint">{c.cwd}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              className="btn-ghost text-[11px]"
              onClick={() => {
                // Its existing session if it has one, rather than a second
                // terminal running the same thing beside the first.
                if (!focusCommandSession(c.id)) void runCommandInNewTerminal(c)
              }}
            >
              Run
            </button>
            <button
              className="btn-ghost text-[11px]"
              onClick={() => openEditor('command', c.id, c.name, node.id)}
            >
              <Icon name="settings" size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
