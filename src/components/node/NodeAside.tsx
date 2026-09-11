// The column beside the thread: what this node is doing, at a glance.
//
// Every card answers "right now" rather than "what exists" — the tabs and the
// tree already answer the second. So Git says how far behind you are and
// offers the pull; Services says what is up and offers the switch; Next says
// what this folder has asked of you and when.
//
// Cards appear only when they have something to say. A client folder has no
// branch and no services, so it gets neither — and what is left is Next and
// Files, which is exactly what a client is. That is the same rule as the tab
// strip: shaped by what the node is, never a fixed set with the empty ones
// greyed out.

import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { Icon } from '../../lib/icons'
import { resolveDir } from '../../lib/tree'
import { focusCommandSession, runCommandInNewTerminal } from '../../lib/runner'
import { DAY_MS, startOfDay } from '../../lib/calendarWindow'
import type { TreeNode } from '../../lib/types'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
        {title}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">{children}</div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0">
      {children}
    </div>
  )
}

function Dot({ tone }: { tone: string }) {
  return <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${tone}`} />
}

/// "every weekday at 08:00", from the fields a schedule carries.
function rhythm(s: ipc.Schedule): string {
  const at = `${String(Math.floor(s.at_min / 60)).padStart(2, '0')}:${String(s.at_min % 60).padStart(2, '0')}`
  if (s.every === 'once') return s.at_ms ? new Date(s.at_ms).toLocaleDateString() : 'once'
  if (s.every === 'hourly') return 'every hour'
  return `${s.every} at ${at}`
}

export function NodeAside({ node, isProject }: { node: TreeNode; isProject: boolean }) {
  const app = useApp()
  const { nodes, commands, services, svcStates, gitByNode, requestStartService } = app
  const [reminders, setReminders] = useState<ipc.Schedule[]>([])
  const [files, setFiles] = useState<ipc.FileRow[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [pulling, setPulling] = useState(false)

  const nodeId = node.id
  const git = gitByNode[nodeId]
  const myCommands = commands.filter((c) => c.project_id === nodeId)
  const myServices = services.filter((s) => s.project_id === nodeId)

  const load = useCallback(async () => {
    const all = await ipc.schedulesList().catch(() => [] as ipc.Schedule[])
    setReminders(all.filter((s) => s.node_id === nodeId && s.kind === 'reminder' && s.enabled))
    // The node's own root, whichever directory it has. Best effort: a folder
    // we cannot read must not blank the cards beside it.
    setFiles(await ipc.nodeFiles(nodeId, '', isProject ? 'work' : 'vault').catch(() => []))
  }, [nodeId, isProject])
  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const today = startOfDay(new Date()).getTime()

  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-4 overflow-auto">
      {isProject && git?.branch && (
        <Card title="Git">
          <Row>
            <Dot tone={git.behind > 0 ? 'bg-amber-400' : 'bg-emerald-400'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] text-ink">{git.branch}</span>
              <span className="mt-0.5 block text-[10.5px] text-muted">
                {git.behind > 0
                  ? `${git.behind} to pull`
                  : git.ahead > 0
                    ? `${git.ahead} to push`
                    : 'up to date'}
              </span>
            </span>
            {git.behind > 0 && (
              <button
                className="btn-ghost text-[11px]"
                disabled={pulling}
                onClick={() => {
                  const dir = resolveDir(nodes, node)
                  if (!dir) return
                  setPulling(true)
                  app.showBottom('logs')
                  void ipc.gitPull(dir).finally(() => setPulling(false))
                }}
              >
                {pulling ? 'Pulling…' : 'Pull'}
              </button>
            )}
          </Row>
        </Card>
      )}

      {myServices.length > 0 && (
        <Card title="Services">
          {myServices.map((sv) => {
            const st = svcStates[sv.id]
            const running = st?.status === 'running'
            return (
              <Row key={sv.id}>
                <Dot
                  tone={
                    running ? 'bg-emerald-400' : st?.status === 'crashed' ? 'bg-red-400' : 'bg-line2'
                  }
                />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-body">{sv.name}</span>
                {!!sv.health_port && (
                  <span className="shrink-0 font-mono text-[10.5px] text-muted">:{sv.health_port}</span>
                )}
                <button
                  className="btn-ghost shrink-0 text-[11px]"
                  disabled={busy === sv.id}
                  onClick={() =>
                    void act(sv.id, () => (running ? ipc.svcStop(sv.id) : requestStartService(sv)))
                  }
                >
                  {running ? 'Stop' : 'Start'}
                </button>
              </Row>
            )
          })}
        </Card>
      )}

      {myCommands.length > 0 && (
        <Card title="Commands">
          {myCommands.slice(0, 5).map((c) => (
            <Row key={c.id}>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body">
                {c.name}
              </span>
              <button
                className="btn-ghost shrink-0 text-[11px]"
                onClick={() => {
                  // Its own session if it already has one, rather than a
                  // second terminal running the same thing.
                  if (!focusCommandSession(c.id)) void runCommandInNewTerminal(c)
                }}
              >
                Run
              </button>
            </Row>
          ))}
        </Card>
      )}

      {reminders.length > 0 && (
        <Card title="Next">
          {reminders.slice(0, 3).map((s) => {
            const doneToday = !!s.last_run && s.last_run >= today
            const missed = s.last_run ? Math.floor((Date.now() - s.last_run) / DAY_MS) : null
            return (
              <Row key={s.id}>
                <Dot
                  tone={
                    doneToday
                      ? 'bg-emerald-400'
                      : missed != null && missed >= 2
                        ? 'bg-red-400'
                        : 'bg-line2'
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-ink">{s.name}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-muted">
                    {rhythm(s)}
                  </span>
                </span>
                {doneToday && <span className="shrink-0 text-[10.5px] text-ok">done</span>}
              </Row>
            )
          })}
        </Card>
      )}

      {files.length > 0 && (
        <Card title="Files">
          {files.slice(0, 5).map((f) => (
            <Row key={f.rel}>
              <Icon
                name={f.dir ? 'folder' : 'note'}
                size={12}
                className={`shrink-0 ${f.dir ? 'text-dim' : 'text-faint'}`}
              />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-body">{f.name}</span>
            </Row>
          ))}
        </Card>
      )}
    </div>
  )
}
