// App settings: global summon hotkey and detected shells.

import { useState } from 'react'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'

export function SettingsPanel() {
  const { hotkey, setHotkey, shells } = useApp()
  const [draft, setDraft] = useState(hotkey)
  const [status, setStatus] = useState<string | null>(null)

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
    <div className="h-full space-y-4 overflow-y-auto bg-[#11141c] p-3 text-[12.5px] text-slate-300">
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Global hotkey
        </h3>
        <div className="flex gap-1.5">
          <input className="input w-52" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn-primary" onClick={() => void apply()}>
            Apply
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Summons / hides DevDeck from anywhere, e.g. <code>ctrl+shift+Space</code>, <code>alt+F9</code>.
        </p>
        {status && <p className="mt-1 text-[11px] text-emerald-400">{status}</p>}
      </section>

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Detected shells
        </h3>
        <div className="space-y-1">
          {shells.map((s) => (
            <div key={s.command} className="flex items-center gap-2 rounded bg-[#151923] px-2 py-1">
              <span className="text-emerald-400">❯_</span>
              <span className="w-28 text-slate-200">{s.name}</span>
              <span className="truncate font-mono text-[10.5px] text-slate-500">{s.command}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Data
        </h3>
        <p className="text-[11px] leading-5 text-slate-500">
          Everything is stored locally in SQLite (<code>%APPDATA%\devdeck\devdeck.sqlite</code>).
          No cloud, no accounts. Your original term-widget launcher commands were imported
          into the Commands panel under the “Imported” group.
        </p>
      </section>
    </div>
  )
}
