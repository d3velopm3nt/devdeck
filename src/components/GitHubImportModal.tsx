// "＋ From GitHub": paste a repo URL and DevDeck clones it, creates a project,
// scans its scripts into commands/services, and installs tools + runs the
// bootstrap so it's ready to run — no manual commands. It stops at "ready"
// (it doesn't auto-start the service). Relies on your existing git credentials.

import { useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { guessKind, guessPort } from '../lib/pm'

const PARENT_KEY = 'devdeck.clone.parent'

type Phase = 'idle' | 'working' | 'error' | 'done'

export function GitHubImportModal({ onClose }: { onClose: () => void }) {
  const { activeWorkspaceId, refreshTree, refreshCommands, refreshServices, setSelectedNode } = useApp()
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(() => localStorage.getItem(PARENT_KEY) ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  // Live sub-status from the clone/setup log stream.
  useEffect(() => {
    if (phase !== 'working') return
    const un = ipc.onSvcLog((e) => {
      if (['git clone', 'project setup'].includes(e.service) || e.service.includes('.')) setStatus(e.line)
    })
    return () => void un.then((u) => u())
  }, [phase])

  const pickParent = async () => {
    const dir = await openDialog({ directory: true, title: 'Where to clone into (parent folder)' })
    if (typeof dir === 'string') setParent(dir)
  }

  const runSetupAndWait = (tools: { pkg_id: string; source: string }[], steps: string[], cwd: string) =>
    new Promise<boolean>((resolve) => {
      let un: (() => void) | null = null
      void ipc.onSetupDone((ok) => { un?.(); resolve(ok) }).then((u) => { un = u })
      void ipc.runProjectSetup(tools, steps, cwd).catch(() => resolve(false))
    })

  const gitMissing = /git isn'?t installed/i.test(error)

  const installGit = async () => {
    setStatus('Installing Git…')
    await ipc.machineInstall([{ id: 'Git.Git', source: 'winget' }])
    await new Promise<void>((r) => { void ipc.onMachineDone(() => r()) })
    await ipc.refreshPath()
    setError('')
    void run()
  }

  const run = async () => {
    if (activeWorkspaceId == null) return setError('Create or select a workspace first.')
    if (!url.trim()) return setError('Enter a repository URL.')
    if (!parent.trim()) return setError('Choose a folder to clone into.')
    setPhase('working')
    setError('')
    try {
      setStatus('Cloning…')
      const dir = await ipc.cloneRepo(url.trim(), parent.trim())
      localStorage.setItem(PARENT_KEY, parent.trim())
      const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? 'project'

      setStatus('Creating project…')
      const project = await ipc.nodeCreate(activeWorkspaceId, 'project', name, dir)

      setStatus('Scanning scripts…')
      const detected = await ipc.scanProject(dir).catch(() => [])
      for (const r of detected) {
        try {
          if (guessKind(r.name, r.command) === 'service') {
            const port = guessPort(r.command)
            await ipc.serviceSave({ id: 0, project_id: project.id, name: r.name, command: r.command, cwd: '', env: '', auto_restart: false, health_port: port ?? null, shell: '' })
          } else {
            await ipc.commandSave({ id: 0, project_id: project.id, group_name: r.group, name: r.name, command: r.command, cwd: '', shell: '', sort: 0 })
          }
        } catch {
          /* skip a bad row */
        }
      }

      setStatus('Checking setup…')
      const setup = await ipc.detectProjectSetup(dir)
      if (!setup.ready) {
        setStatus('Installing tools & bootstrapping…')
        await runSetupAndWait(
          setup.tools.filter((t) => !t.installed).map((t) => ({ pkg_id: t.pkg_id, source: t.source })),
          setup.steps.filter((s) => !s.done).map((s) => s.run),
          dir,
        )
      }

      await Promise.all([refreshTree(), refreshCommands(), refreshServices()])
      setSelectedNode(project.id)
      setPhase('done')
      setStatus('Ready — press Start on a service to run it.')
      setTimeout(onClose, 1200)
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }

  const busy = phase === 'working'

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 p-6" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-slate-700 bg-[#11141c] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
          <span className="text-[15px]">🐙</span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-100">Add a project from GitHub</div>
            <div className="text-[11px] text-slate-500">Clone, scan, and set it up — ready to run in one go.</div>
          </div>
          {!busy && <button className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-slate-700 hover:text-white" onClick={onClose}>✕</button>}
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <div className="mb-1 text-[11px] text-slate-500">Repository URL</div>
            <input
              className="w-full rounded-lg border border-slate-700 bg-[#0d1017] px-3 py-2 font-mono text-[13px] text-slate-200 outline-none focus:border-indigo-500"
              placeholder="https://github.com/you/tyrex"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
            />
          </div>
          <div>
            <div className="mb-1 text-[11px] text-slate-500">Clone into</div>
            <div className="flex gap-1">
              <input
                className="w-full rounded-lg border border-slate-700 bg-[#0d1017] px-3 py-2 font-mono text-[12.5px] text-slate-200 outline-none focus:border-indigo-500"
                placeholder="C:\code"
                value={parent}
                disabled={busy}
                onChange={(e) => setParent(e.target.value)}
              />
              <button className="btn-ghost shrink-0" disabled={busy} onClick={() => void pickParent()}>…</button>
            </div>
          </div>

          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.07] px-3 py-2 text-[12px] text-indigo-200">
              <span className="inline-block animate-spin">⟳</span>
              <span className="min-w-0 truncate">{status}</span>
            </div>
          )}
          {phase === 'done' && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-[12px] text-emerald-300">✓ {status}</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-[12px] text-red-300">
              {error}
              {gitMissing && (
                <button className="ml-2 rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-500" onClick={() => void installGit()}>⤓ Install Git & retry</button>
              )}
            </div>
          )}
          <p className="text-[11px] leading-4 text-slate-600">Uses your existing git credentials. Progress shows in the Logs panel.</p>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-3">
          {!busy && <button className="text-[12px] text-slate-400 hover:text-slate-200" onClick={onClose}>Cancel</button>}
          <button className="btn-primary ml-auto text-[12px]" disabled={busy} onClick={() => void run()}>
            {busy ? 'Working…' : '⤓ Clone & set up'}
          </button>
        </div>
      </div>
    </div>
  )
}
