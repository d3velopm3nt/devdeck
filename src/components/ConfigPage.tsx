// Settings page (opens as a main-window tab): global behavior and
// detected shells. Editing individual commands / services / profiles
// lives in their own dedicated editor pages, opened from the side lists.

import { useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { loadExampleWorkspace } from '../lib/example'
import { Icon } from '../lib/icons'

export function ConfigPage() {
  const { hotkey, setHotkey, shells, gitMonitorEnabled, gitMonitorIntervalMin, setGitMonitor, fetchGitStatus, theme, setTheme } = useApp()
  const [draft, setDraft] = useState(hotkey)
  const [status, setStatus] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [gitIv, setGitIv] = useState(String(gitMonitorIntervalMin))

  const apply = async () => {
    try {
      await ipc.hotkeyApply(draft.replace(/\s/g, ''))
      await ipc.settingSet('hotkey', draft)
      setHotkey(draft)
      setStatus('Hotkey applied ✓')
    } catch (e) {
      setStatus(`Error: ${e}`)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-page px-6 py-5 text-body">
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">Settings</h2>
          <p className="text-[12px] text-muted">Global behavior and detected shells.</p>
        </div>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Global hotkey
          </h3>
          <div className="flex gap-2">
            <input className="input w-60" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn-primary" onClick={() => void apply()}>
              Apply
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Summons / hides DevDeck from anywhere, e.g. <code>ctrl+shift+Space</code>, <code>alt+F9</code>.
          </p>
          {status && <p className="mt-1 text-[11px] text-ok">{status}</p>}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Appearance
          </h3>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-[12.5px] font-medium capitalize transition-colors ${
                  theme === t
                    ? 'border-indigo-500 bg-indigo-500/10 text-ink'
                    : 'border-line2 text-dim hover:border-line3 hover:text-ink'
                }`}
                onClick={() => void setTheme(t)}
              >
                <span
                  className="h-4 w-4 rounded-full border"
                  style={{
                    background: t === 'dark' ? '#0b0e14' : '#f6f7f9',
                    borderColor: t === 'dark' ? '#334155' : '#c3cbd8',
                  }}
                />
                {t}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">Applies instantly — terminals and panels included.</p>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Git monitoring
          </h3>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-body">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-500"
              checked={gitMonitorEnabled}
              onChange={(e) => void setGitMonitor(e.target.checked, Number(gitIv) || gitMonitorIntervalMin)}
            />
            Auto-check repositories for changes to pull
          </label>
          <div className="mt-2 flex items-center gap-2 text-[12px] text-dim">
            <span>Every</span>
            <input
              className="input w-16 text-center"
              type="number"
              min={1}
              value={gitIv}
              disabled={!gitMonitorEnabled}
              onChange={(e) => setGitIv(e.target.value)}
              onBlur={() => void setGitMonitor(gitMonitorEnabled, Number(gitIv) || 5)}
            />
            <span>minutes</span>
            <button
              className="btn-ghost inline-flex items-center gap-1 text-[12px]"
              title="Fetch the active workspace's repositories now"
              onClick={() => void fetchGitStatus()}
            >
              <Icon name="restart" size={12} /> Check now
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            Runs a quiet <code>git fetch</code> for the active workspace's repositories using your
            existing git credentials, then shows how many commits each project is ahead/behind.
            Nothing is pulled automatically — click a project's <span className="text-warn">↓</span> badge to fast-forward.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Detected shells
          </h3>
          <div className="space-y-1">
            {shells.map((s) => (
              <div key={s.command} className="flex items-center gap-3 rounded bg-raise px-3 py-1.5">
                <span className="text-ok">❯_</span>
                <span className="w-28 text-ink">{s.name}</span>
                <span className="truncate font-mono text-[11px] text-muted">{s.command}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Example workspace
          </h3>
          <p className="mb-2 text-[11px] leading-5 text-muted">
            A small demo project with a real web server and a background worker you can start,
            watch, and open in your browser. It's written to{' '}
            <code>%USERPROFILE%\DevDeck Demo</code> — delete that folder and the workspace any time.
          </p>
          <button
            className="btn-primary inline-flex items-center gap-1.5 text-[12px]"
            disabled={seeding}
            onClick={() => {
              setSeeding(true)
              void loadExampleWorkspace()
                .catch((e) => alert(String(e)))
                .finally(() => setSeeding(false))
            }}
          >
            {seeding ? 'Setting up…' : <><Icon name="example" size={13} /> Load example workspace</>}
          </button>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Data</h3>
          <p className="text-[11px] leading-5 text-muted">
            Stored locally in SQLite (<code>%APPDATA%\devdeck\devdeck.sqlite</code>). No cloud, no
            accounts. Commands, services, and profiles are edited in their own pages — click any
            item in the side lists, or use “+ New”.
          </p>
        </section>
      </div>
    </div>
  )
}
