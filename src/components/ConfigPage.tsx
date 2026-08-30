// Settings page (opens as a main-window tab): global behavior and
// detected shells. Editing individual commands / services / profiles
// lives in their own dedicated editor pages, opened from the side lists.

import { useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import { loadExampleWorkspace } from '../lib/example'
import { Icon } from '../lib/icons'

/** A labelled checkbox row, the shape the Git section already uses. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-body">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-indigo-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

const TAB_KEY = 'devdeck.settings.tab'

export function ConfigPage() {
  const { hotkey, setHotkey, shells, gitMonitorEnabled, gitMonitorIntervalMin, setGitMonitor, fetchGitStatus, theme, setTheme, stashStatus, refreshStashStatus, setStashCapture, refreshTree, labels, saveLabels } = useApp()
  const [draft, setDraft] = useState(hotkey)
  const [status, setStatus] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [gitIv, setGitIv] = useState(String(gitMonitorIntervalMin))
  const [vault, setVault] = useState('')
  const [vaultMsg, setVaultMsg] = useState('')
  const [vaultBusy, setVaultBusy] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [labelMsg, setLabelMsg] = useState('')
  const [tab, setTab] = useState(() => localStorage.getItem(TAB_KEY) ?? 'general')
  useEffect(() => localStorage.setItem(TAB_KEY, tab), [tab])

  useEffect(() => {
    void ipc.vaultRoot().then((r) => setVault(r ?? '')).catch(() => setVault(''))
    setLabelDraft(useApp.getState().labels.join('\n'))
    void refreshStashStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setStashOption = async (key: 'toast' | 'auto_paste', value: boolean) => {
    await ipc.stashSetOption(key, value)
    await refreshStashStatus()
  }

  // Retention: the input is a draft until you commit it, so typing "3" on the
  // way to "30" never prunes a month of clips.
  // Widget peek lives in settings rather than stash status, so it is read
  // and written directly.
  const [peek, setPeekState] = useState(true)
  useEffect(() => {
    void ipc.settingGet('widget_peek').then((v) => setPeekState(v == null ? true : v !== '0'))
  }, [])
  const setPeek = async (v: boolean) => {
    setPeekState(v)
    await ipc.settingSet('widget_peek', v ? '1' : '0')
  }

  const [retention, setRetention] = useState('')
  const [pruned, setPruned] = useState<string | null>(null)
  const retentionDays = stashStatus?.retention_days
  useEffect(() => {
    if (retentionDays != null) setRetention(String(retentionDays))
  }, [retentionDays])

  const applyRetention = async () => {
    const days = Math.max(0, Math.round(Number(retention)))
    if (!Number.isFinite(days)) return setPruned('That needs to be a number of days.')
    try {
      const n = await ipc.stashSetRetention(days)
      await refreshStashStatus()
      setPruned(
        days === 0
          ? 'Keeping every clip, forever.'
          : `Keeping ${days} days — ${n === 0 ? 'nothing needed removing' : `removed ${n} clip${n === 1 ? '' : 's'}`}.`,
      )
    } catch (e) {
      setPruned(String(e))
    }
  }

  const pruneNow = async () => {
    try {
      const n = await ipc.stashPrune()
      setPruned(n === 0 ? 'Nothing to prune.' : `Removed ${n} clip${n === 1 ? '' : 's'}.`)
    } catch (e) {
      setPruned(String(e))
    }
  }

  const moveVault = async () => {
    const dir = await openDialog({ directory: true, title: 'Move the vault to…' })
    if (typeof dir !== 'string') return
    setVaultBusy(true)
    setVaultMsg('')
    try {
      const now = await ipc.vaultMove(dir)
      setVault(now)
      await refreshTree()
      setVaultMsg('Moved. Everything came with it.')
    } catch (e) {
      setVaultMsg(String(e))
    } finally {
      setVaultBusy(false)
    }
  }

  // Switching adopts whatever is already there, so anything the app knows about
  // that is not in the new folder goes — along with its commands and services.
  // The count is shown before the click, not after.
  const switchVault = async () => {
    const dir = await openDialog({ directory: true, title: 'Switch to another vault…' })
    if (typeof dir !== 'string') return
    setVaultBusy(true)
    setVaultMsg('')
    try {
      const cost = await ipc.vaultSwitchCost(dir)
      const losing = cost.losing_commands + cost.losing_services
      const detail =
        cost.drops === 0
          ? 'Nothing will be lost.'
          : `${cost.drops} item${cost.drops === 1 ? '' : 's'} are not in that folder and will be removed` +
            (losing > 0
              ? `, along with ${losing} command${losing === 1 ? '' : 's'} and service${losing === 1 ? '' : 's'}.`
              : '.')
      if (!confirm(`Switch to ${dir}?

${cost.keeps} item${cost.keeps === 1 ? '' : 's'} match. ${detail}`)) {
        return
      }
      const now = await ipc.vaultSwitch(dir)
      setVault(now)
      await refreshTree()
      setVaultMsg('Switched.')
    } catch (e) {
      setVaultMsg(String(e))
    } finally {
      setVaultBusy(false)
    }
  }

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
    <div className="flex h-full bg-page text-body">
      {/* A settings page long enough to scroll is a settings page you hunt
          through. The nav is fixed and the pane scrolls, so where you are
          stays visible while you read. */}
      <nav className="flex w-[176px] shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2">
        <div className="px-2.5 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Settings
        </div>
            <button
              key="general"
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
                tab === 'general' ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
              }`}
              onClick={() => setTab('general')}
            >
              <Icon name="settings" size={14} className="shrink-0" />
              General
            </button>
            <button
              key="vault"
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
                tab === 'vault' ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
              }`}
              onClick={() => setTab('vault')}
            >
              <Icon name="folder" size={14} className="shrink-0" />
              Vault
            </button>
            <button
              key="dev"
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
                tab === 'dev' ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
              }`}
              onClick={() => setTab('dev')}
            >
              <Icon name="terminal" size={14} className="shrink-0" />
              Development
            </button>
            <button
              key="stash"
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
                tab === 'stash' ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
              }`}
              onClick={() => setTab('stash')}
            >
              <Icon name="stash" size={14} className="shrink-0" />
              Stash
            </button>
            <button
              key="data"
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
                tab === 'data' ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
              }`}
              onClick={() => setTab('data')}
            >
              <Icon name="database" size={14} className="shrink-0" />
              Data
            </button>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="max-w-2xl space-y-6">
        {tab === 'general' && (
          <>
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-ink">General</h2>
              <p className="text-[12px] text-muted">How DevDeck behaves and looks.</p>
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
          </>
        )}

        {tab === 'vault' && (
          <>
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-ink">Vault</h2>
              <p className="text-[12px] text-muted">Where your folders live, and the words you file them under.</p>
            </div>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Vault folder
          </h3>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-raise px-3 py-2">
            <Icon name="folder" size={15} className="shrink-0 text-ok" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body" title={vault}>
              {vault || 'Not set'}
            </span>
            <button
              className="btn-ghost text-[11.5px]"
              disabled={!vault}
              onClick={() => void ipc.revealInExplorer(vault).catch((e) => setVaultMsg(String(e)))}
            >
              <Icon name="reveal" size={12} /> Reveal
            </button>
          </div>

          <div className="mt-2 flex gap-2">
            <button className="btn-ghost text-[11.5px]" disabled={vaultBusy} onClick={() => void moveVault()}>
              Move…
            </button>
            <button className="btn-ghost text-[11.5px]" disabled={vaultBusy} onClick={() => void switchVault()}>
              Switch to another…
            </button>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            <span className="text-dim">Move</span> takes everything with it, so nothing loses its
            commands or services. <span className="text-dim">Switch</span> adopts a folder that
            already holds a vault — a clone of it on another machine — and drops anything not in
            there. It says how much before it does.
          </p>
          {vaultMsg && <p className="mt-1.5 text-[11px] text-ok">{vaultMsg}</p>}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Labels
          </h3>
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            The words offered when you label a folder — right-click one in the Explorer and these
            are the choices. One per line. They are a shortlist you keep, not kinds the app
            enforces, so you can still type anything on a folder&rsquo;s page.
          </p>
          <textarea
            className="input h-28 w-full resize-y font-mono text-[11.5px]"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn-primary text-[11.5px]"
              onClick={() => {
                void saveLabels(labelDraft.split(/[\n,]/)).then(() => setLabelMsg('Saved ✓'))
              }}
            >
              Save labels
            </button>
            <button
              className="btn-ghost text-[11.5px]"
              onClick={() => setLabelDraft(labels.join('\n'))}
            >
              Revert
            </button>
            {labelMsg && <span className="text-[11px] text-ok">{labelMsg}</span>}
          </div>
        </section>
          </>
        )}

        {tab === 'dev' && (
          <>
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-ink">Development</h2>
              <p className="text-[12px] text-muted">Repositories and the shells DevDeck can run.</p>
            </div>
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
          </>
        )}

        {tab === 'stash' && (
          <>
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-ink">Stash</h2>
              <p className="text-[12px] text-muted">Clipboard capture and what it keeps.</p>
            </div>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Stash
          </h3>
          <div className="space-y-2">
            <Toggle
              checked={stashStatus?.enabled ?? true}
              onChange={(v) => void setStashCapture(v)}
              label="Capture what I copy"
            />
            <Toggle
              checked={stashStatus?.toast ?? true}
              onChange={(v) => void setStashOption('toast', v)}
              label="Show a toast when a clip is captured"
            />
            <Toggle
              checked={peek}
              onChange={(v) => void setPeek(v)}
              label="Peek the widget when a service starts or crashes"
            />
            <Toggle
              checked={stashStatus?.auto_paste ?? false}
              onChange={(v) => void setStashOption('auto_paste', v)}
              label="Paste straight into the app I came from (instead of only copying)"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="text-[12px] text-body">Keep clips for</label>
            <input
              className="input w-16 text-center"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyRetention()
              }}
            />
            <span className="text-[12px] text-body">days</span>
            <button className="btn-ghost text-[11.5px]" onClick={() => void applyRetention()}>
              Apply
            </button>
            <button className="btn-ghost text-[11.5px]" onClick={() => void pruneNow()}>
              Prune now
            </button>
            {pruned && <span className="text-[11px] text-ok">{pruned}</span>}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            <b>0 keeps everything forever.</b> Pruning only ever removes clips you never touched —
            anything <b>pinned</b>, <b>tagged</b>, carrying a <b>note</b>, or that you{' '}
            <b>wrote as a note</b> is kept regardless of age. <b>Screenshots are never pruned</b>:
            they point at files in your Pictures folder, which is what actually decides they exist.
          </p>

          <p className="mt-1.5 text-[11px] leading-5 text-muted">
            Clips are stored in your own SQLite file — nothing leaves this machine. Anything
            shaped like a key, token or password is flagged and{' '}
            <b className="text-warn">its value is never written to disk</b>, and content your
            password manager marks sensitive is skipped entirely.
            <br />
            The widget <b>peeks without taking focus</b> when a service starts, and stays put
            when one crashes — a window that grabs the keyboard mid-keystroke is worse than no
            notification at all.
            <br />
            Auto-paste synthesises <code>Ctrl+V</code> into whichever window had focus before
            DevDeck. It's off by default, and Windows can refuse the focus change — when that
            happens the clip is still on your clipboard and DevDeck says so rather than
            pretending it pasted. <code>⇧⏎</code> in the widget pastes once regardless of this
            setting.
          </p>
        </section>
          </>
        )}

        {tab === 'data' && (
          <>
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-ink">Data</h2>
              <p className="text-[12px] text-muted">What is stored, and where.</p>
            </div>
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
          </>
        )}
        </div>
      </div>
    </div>
  )
}
