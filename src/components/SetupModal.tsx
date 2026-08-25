// Shown when a service can't run yet because its project needs tools installed
// or a bootstrap step (e.g. `pnpm install`). "Set it up & run" installs the
// missing tools, refreshes PATH, runs the steps, then starts the service.

import { useEffect, useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import type { ServiceDef } from '../lib/types'
import { Icon } from '../lib/icons'

export function SetupModal({
  svc,
  setup,
  dir,
  onClose,
}: {
  svc: ServiceDef
  setup: ipc.ProjectSetup
  dir: string
  onClose: () => void
}) {
  const { refreshServices } = useApp()
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')

  const missingTools = setup.tools.filter((t) => !t.installed)
  const pendingSteps = setup.steps.filter((s) => !s.done)

  // When setup finishes, start the service we were preparing.
  useEffect(() => {
    if (!running) return
    const subs = [
      ipc.onSvcLog((e) => {
        if (e.service === 'project setup') setStatus(e.line)
      }),
      ipc.onSetupDone((ok) => {
        if (ok) void ipc.svcStart(svc.id).finally(() => void refreshServices())
        setRunning(false)
        onClose()
      }),
    ]
    return () => {
      for (const s of subs) void s.then((u) => u())
    }
  }, [running, svc.id, onClose, refreshServices])

  const setupAndRun = () => {
    setRunning(true)
    setStatus('Starting…')
    void ipc
      .runProjectSetup(
        missingTools.map((t) => ({ pkg_id: t.pkg_id, source: t.source })),
        pendingSteps.map((s) => s.run),
        dir,
      )
      .catch((e) => {
        setStatus(String(e))
        setRunning(false)
      })
  }

  const startAnyway = () => {
    void ipc.svcStart(svc.id).finally(() => void refreshServices())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-6" onClick={running ? undefined : onClose}>
      <div className="max-h-[86vh] w-full max-w-[540px] overflow-y-auto rounded-xl border border-line2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Icon name="tool" size={16} className="shrink-0 text-body" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">Set up “{svc.name}” to run</div>
            <div className="truncate text-[11px] text-muted">This project needs a few things before it can start.</div>
          </div>
          {!running && (
            <button className="ml-auto flex items-center rounded px-2 py-1 text-muted hover:bg-hover hover:text-ink" onClick={onClose}><Icon name="close" size={14} /></button>
          )}
        </div>

        <div className="space-y-4 px-5 py-4">
          {setup.tools.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Required tools</div>
              <div className="flex flex-col gap-1.5">
                {setup.tools.map((t) => (
                  <div key={t.binary} className="flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${t.installed ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className="text-[12.5px] font-medium text-ink">{t.name}</span>
                    <span className="truncate font-mono text-[11px] text-muted">{t.pkg_id}</span>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${t.installed ? 'bg-emerald-500/12 text-ok' : 'bg-amber-500/15 text-warn'}`}>
                      {t.installed ? 'Installed' : 'Will install'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {setup.steps.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Setup steps</div>
              <div className="flex flex-col gap-1.5">
                {setup.steps.map((s) => (
                  <div key={s.run} className="flex items-center gap-2.5 rounded-lg border border-line bg-raise px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${s.done ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-ink">{s.label}</div>
                      <div className="truncate font-mono text-[11px] text-muted">{s.run}</div>
                    </div>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${s.done ? 'bg-emerald-500/12 text-ok' : 'bg-amber-500/15 text-warn'}`}>
                      {s.done ? 'Done' : 'Will run'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {running && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.07] px-3 py-2 text-[12px] text-indigo-200">
              <span className="inline-block animate-spin">⟳</span>
              <span className="min-w-0 truncate">{status || 'Setting up… (progress in the Logs panel)'}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {!running && (
            <button className="text-[12px] text-dim hover:text-ink" onClick={startAnyway}>Start anyway</button>
          )}
          <button className="btn-primary ml-auto inline-flex items-center gap-1.5 text-[12px]" disabled={running} onClick={setupAndRun}>
            {running ? 'Setting up…' : <><Icon name="settings" size={13} /> Set it up & run</>}
          </button>
        </div>
      </div>
    </div>
  )
}
