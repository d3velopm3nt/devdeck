import { useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Icon } from '../lib/icons'
import * as ipc from '../lib/ipc'
import { DECK_DEFAULTS, loadDeckSettings, saveDeckSettings, type DeckEventKind, type DeckSettings as Preferences } from '../lib/deck'
import { useApp } from '../store'

const KINDS: DeckEventKind[] = ['info', 'alert', 'approval', 'blocker']
const FREQUENCIES: Record<DeckEventKind, number[]> = {
  info: [660], alert: [740, 560], approval: [660, 880], blocker: [440, 330],
}

function preview(kind: DeckEventKind) {
  const context = new AudioContext()
  const start = context.currentTime
  FREQUENCIES[kind].forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const volume = context.createGain()
    const at = start + index * 0.14
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    volume.gain.setValueAtTime(0.0001, at)
    volume.gain.exponentialRampToValueAtTime(0.055, at + 0.015)
    volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.12)
    oscillator.connect(volume).connect(context.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.13)
  })
  window.setTimeout(() => void context.close(), 600)
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-center gap-2 text-[12px] text-body">
    <input type="checkbox" className="accent-indigo-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}
  </label>
}

export function DeckSettings() {
  const nodes = useApp((s) => s.nodes)
  const spaces = nodes.filter((n) => n.kind === 'project')
  const [value, setValue] = useState<Preferences>(DECK_DEFAULTS)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [watchStatus, setWatchStatus] = useState('')
  useEffect(() => {
    void Promise.all([loadDeckSettings(), ipc.settingGet('deck.state_path'), ipc.settingGet('deck.watch.status'), ipc.vaultRoot()]).then(([settings, path, status, vault]) => {
      setValue(settings)
      setRepoPath(path || vault || '')
      setWatchStatus(status ?? '')
      setReady(true)
    }).catch((e) => setMessage(String(e)))
  }, [])
  const update = (patch: Partial<Preferences>) => setValue((v) => ({ ...v, ...patch }))
  const chooseRepo = async () => {
    const selected = await openDialog({ directory: true, title: 'Choose a local clone of your state vault' })
    if (typeof selected === 'string') setRepoPath(selected)
  }
  const save = async () => {
    setMessage('')
    try {
      await saveDeckSettings(value)
      await ipc.settingSet('deck.state_path', repoPath.trim())
      void ipc.emitDeckSettingsChanged()
      setMessage('Deck settings saved.')
    } catch (e) { setMessage(String(e)) }
  }
  const section = 'rounded-lg border border-line bg-panel px-4 py-3'
  const select = 'rounded-md border border-line2 bg-raise px-2 py-1.5 text-[12px] text-ink'
  return <div className="h-full overflow-y-auto bg-page px-7 py-6 text-body">
    <div className="mx-auto max-w-4xl space-y-4">
      <div><h1 className="text-[20px] font-semibold text-ink">Deck settings</h1>
        <p className="text-[12px] text-dim">Choose when Deck appears and how it notifies you. It follows the app theme.</p></div>
      {!ready ? <p className="text-dim">Loading…</p> : <>
        <section className={section}>
          <h2 className="mb-3 text-[13px] font-semibold text-ink">Shared spaces</h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Check checked={value.watch} onChange={(watch) => update({ watch })} label="Watch for updates" />
            <label className="flex items-center gap-2 text-[12px]">Check interval
              <select className={select} value={value.intervalMin} onChange={(e) => update({ intervalMin: Number(e.target.value) })}>
                {[1, 2, 5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n} minute{n === 1 ? '' : 's'}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input className="min-w-0 flex-1 rounded-md border border-line2 bg-raise px-2 py-1.5 text-[12px] text-ink" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="Local clone of the shared state repository" aria-label="State repository folder" />
            <button className="btn-ghost" onClick={() => void chooseRepo()}>Choose folder</button>
          </div>
          <p className="mt-1 text-[11px] text-muted">Each person selects their own authorized local clone. Deck never stores GitHub credentials here.</p>
          {watchStatus && <p className="mt-1 text-[11px] text-dim">Last check: {watchStatus}</p>}
        </section>
        <section className={section}>
          <h2 className="mb-3 text-[13px] font-semibold text-ink">Notifications</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Check checked={value.windowsNotifications} onChange={(windowsNotifications) => update({ windowsNotifications })} label="Windows notifications" />
            <Check checked={value.popups} onChange={(popups) => update({ popups })} label="Deck pop-ups" />
            <Check checked={value.groupUpdates} onChange={(groupUpdates) => update({ groupUpdates })} label="Group related changes" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Check checked={value.quietHours} onChange={(quietHours) => update({ quietHours })} label="Quiet hours" />
            {value.quietHours && <><input type="time" className={select} value={value.quietFrom} onChange={(e) => update({ quietFrom: e.target.value })} /><span>to</span><input type="time" className={select} value={value.quietTo} onChange={(e) => update({ quietTo: e.target.value })} /></>}
          </div>
        </section>
        <section className={section}>
          <h2 className="mb-2 text-[13px] font-semibold text-ink">Sounds</h2>
          <div className="divide-y divide-line">
            {KINDS.map((kind) => <div key={kind} className="flex items-center justify-between py-2">
              <Check checked={value.sounds[kind]} onChange={(enabled) => update({ sounds: { ...value.sounds, [kind]: enabled } })} label={kind[0].toUpperCase() + kind.slice(1)} />
              <button className="btn-ghost flex items-center gap-1" onClick={() => preview(kind)} title={`Play ${kind} sound`}><Icon name="run" size={12} /> Play</button>
            </div>)}
          </div>
        </section>
        <section className={section}>
          <h2 className="mb-3 text-[13px] font-semibold text-ink">Focus</h2>
          <div className="flex flex-wrap items-center gap-5 text-[12px]">
            <label className="flex items-center gap-2">Session length <select className={select} value={value.focusMinutes} onChange={(e) => update({ focusMinutes: Number(e.target.value) })}>{[15, 25, 30, 45, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
            <label className="flex items-center gap-2">Interrupt during Focus <select className={select} value={value.focusInterrupt} onChange={(e) => update({ focusInterrupt: e.target.value as Preferences['focusInterrupt'] })}>
              <option value="urgent">Approval &amp; Blocker</option><option value="none">Nothing</option><option value="all">All updates</option>
            </select></label>
          </div>
          <p className="mt-2 text-[11px] text-muted">Other updates wait until your session ends.</p>
        </section>
        <section className={section}>
          <h2 className="mb-2 text-[13px] font-semibold text-ink">Spaces</h2>
          {spaces.length === 0 ? <p className="text-[12px] text-dim">Add a space to set its notification preference.</p> : spaces.map((space) => <div key={space.id} className="border-t border-line py-2 first:border-t-0">
            <Check label={space.name} checked={!value.mutedSpaces.includes(String(space.id))} onChange={(enabled) => update({ mutedSpaces: enabled ? value.mutedSpaces.filter((s) => s !== String(space.id)) : [...value.mutedSpaces, String(space.id)] })} />
          </div>)}
        </section>
        {message && <p role="status" className="text-[12px] text-dim">{message}</p>}
        <div className="flex justify-end gap-2 pb-4"><button className="btn-ghost" onClick={() => setValue(DECK_DEFAULTS)}>Reset defaults</button><button className="btn-primary" onClick={() => void save()}>Save settings</button></div>
      </>}
    </div>
  </div>
}
