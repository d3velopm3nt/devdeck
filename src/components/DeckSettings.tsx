import { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import * as ipc from '../lib/ipc'
import { DECK_DEFAULTS, loadDeckSettings, saveDeckSettings, type DeckSettings as Preferences } from '../lib/deck'
import { useApp } from '../store'
import { OrbSettings } from './orb/OrbSettings'
import { MobilePairing } from './MobilePairing'

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
    void Promise.all([loadDeckSettings(), ipc.settingGet('deck.watch.status'), ipc.vaultRoot()]).then(([settings, status, vault]) => {
      setValue(settings)
      setRepoPath(vault || '')
      setWatchStatus(status ?? '')
      setReady(true)
    }).catch((e) => setMessage(String(e)))
  }, [])
  const update = (patch: Partial<Preferences>) => setValue((v) => ({ ...v, ...patch }))
  const save = async () => {
    setMessage('')
    try {
      const current=await loadDeckSettings()
      await saveDeckSettings({...current,watch:value.watch,intervalMin:value.intervalMin,focusMinutes:value.focusMinutes,focusInterrupt:value.focusInterrupt,mutedSpaces:value.mutedSpaces})
      void ipc.emitDeckSettingsChanged()
      setMessage('Deck settings saved.')
    } catch (e) { setMessage(String(e)) }
  }
  const section = 'rounded-lg border border-line bg-panel px-4 py-3'
  const select = 'rounded-md border border-line2 bg-raise px-2 py-1.5 text-[12px] text-ink'
  return <div className="h-full overflow-y-auto bg-page px-7 py-6 text-body">
    <div className="mx-auto max-w-4xl space-y-4">
      <div><h1 className="text-[20px] font-semibold text-ink">Deck settings</h1>
        <p className="text-[12px] text-dim">Configure your widget, shared spaces and focus sessions.</p></div>
      {!ready ? <p className="text-dim">Loading…</p> : <>
        <MobilePairing />
        <OrbSettings />
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
            <input className="min-w-0 flex-1 rounded-md border border-line2 bg-raise px-2 py-1.5 text-[12px] text-ink" value={repoPath} readOnly placeholder="Choose your state folder in Storage settings" aria-label="State repository folder" />
            <button className="btn-ghost" onClick={() => { useApp.getState().setSettingsTab('vault'); useApp.getState().setRailView('settings') }}>Storage settings</button>
          </div>
          <p className="mt-1 text-[11px] text-muted">Deck watches the same state folder as the Explorer. Connect or switch your repository in Storage settings.</p>
          {watchStatus && <p className="mt-1 text-[11px] text-dim">Last check: {watchStatus}</p>}
        </section>
        <button className="flex w-full items-center gap-3 border-y border-line py-4 text-left" onClick={()=>{useApp.getState().setSettingsTab('notifications')}}><Icon name="history" size={18}/><span className="flex-1"><strong className="block text-sm">Notifications &amp; sounds</strong><small className="text-muted">Delivery, quiet hours and sound preferences</small></span><Icon name="chevron-right" size={14}/></button>
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
