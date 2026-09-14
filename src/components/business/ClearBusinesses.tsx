// Starting old business workspaces again: clearing them first.
//
// You chose clear, not archive, so this screen says exactly what goes and
// what never does before the red button does anything. A space whose folder
// holds a repository is refused, because clearing it would delete code.

import { useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Err, Frame, Header } from '../setup/LearnStep'
import { Foot } from './BusinessStep'
import { openBusiness } from './TodayBusinesses'

export function ClearBusinesses({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<ipc.ClearPreview | null>(null)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    void ipc
      .businessClearPreview()
      .then((p) => {
        setPreview(p)
        setTicked(new Set(p.spaces.filter((s) => s.suggested && !s.blocked).map((s) => s.node_id)))
      })
      .catch((e) => setErr(String(e)))
  }, [])

  const clear = async () => {
    setBusy(true)
    setErr('')
    try {
      setDone(await ipc.businessClear([...ticked]))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Frame step="" order={[]} onClose={onClose}>
        <Header icon="check" ok title="Cleared" text="The workspaces are gone from the tree and the vault. Your repositories are where they were." />
        <div className="rounded-[10px] border border-line bg-panel px-4 py-3">
          {done.map((d) => (
            <div key={d} className="text-[12px] leading-relaxed text-body">
              {d}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn-primary text-[12px]"
            onClick={() => {
              onClose()
              window.setTimeout(() => openBusiness(), 50)
            }}
          >
            Add a business
          </button>
          <button className="btn-ghost text-[12px]" onClick={onClose}>
            Close
          </button>
        </div>
      </Frame>
    )
  }

  const spaces = preview?.spaces ?? []
  const repos = [...new Set(spaces.flatMap((s) => s.projects.map((p) => p.repo)).filter(Boolean))]
  const n = ticked.size

  return (
    <Frame step="" order={[]} onClose={onClose} wide>
      <Header
        icon="reset"
        title="Start your businesses again"
        text="These were made before there were business steps. Clearing them removes them from the tree and the vault, and then each business is set up again from a clean start."
      />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          {!preview && !err && <div className="text-[12px] text-muted">Reading what is there…</div>}
          {preview && spaces.length === 0 && (
            <div className="rounded-[10px] border border-line bg-panel px-4 py-3 text-[12px] text-muted">
              Nothing to clear.
            </div>
          )}
          {spaces.map((s) => {
            const on = ticked.has(s.node_id)
            return (
              <div
                key={s.node_id}
                className={`rounded-[10px] border bg-panel ${on ? 'border-red-500/40' : 'border-line'} ${s.blocked ? 'opacity-80' : ''}`}
              >
                <label className="flex items-center gap-2.5 px-4 py-2.5">
                  <input
                    type="checkbox"
                    disabled={!!s.blocked}
                    checked={on}
                    onChange={(e) =>
                      setTicked((cur) => {
                        const next = new Set(cur)
                        if (e.target.checked) next.add(s.node_id)
                        else next.delete(s.node_id)
                        return next
                      })
                    }
                  />
                  <span className="text-[13px] font-semibold text-ink">{s.name}</span>
                  {s.label && (
                    <span className="rounded-full bg-indigo-500/15 px-2 text-[9px] font-semibold uppercase leading-[1.6] tracking-wider text-indigo-400">
                      {s.label}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-[10.5px] text-faint">{s.suggested ? 'ticked because it is tagged Business' : 'not ticked'}</span>
                </label>
                <div className="flex flex-col gap-1 border-t border-line px-4 py-2.5 text-[11.5px] text-body">
                  <span>
                    {s.folders} folder{s.folders === 1 ? '' : 's'}, {s.projects.length} project{s.projects.length === 1 ? '' : 's'}
                    {s.reminders ? `, ${s.reminders} reminder${s.reminders === 1 ? '' : 's'}` : ''}
                  </span>
                  {s.managers.length > 0 && <span>Managers: {s.managers.join(', ')}</span>}
                  {s.services + s.commands > 0 && (
                    <span>
                      {s.services} service{s.services === 1 ? '' : 's'} and {s.commands} command{s.commands === 1 ? '' : 's'} saved on
                      its projects
                    </span>
                  )}
                  {s.vault_dir && (
                    <span className="truncate font-mono text-[10.5px] text-muted" title={s.vault_dir}>
                      removes {s.vault_dir}
                    </span>
                  )}
                  {s.blocked && <span className="text-warn">{s.blocked}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-[10px] border border-line bg-panel">
            <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Never touched</div>
            <div className="flex items-start gap-2.5 border-t border-line px-4 py-2.5">
              <Icon name="code" size={14} className="mt-0.5 text-ok" />
              <div className="min-w-0">
                <div className="text-[12.5px] text-ink">Your repositories on disk</div>
                {repos.map((r) => (
                  <div key={r} className="break-all font-mono text-[10.5px] text-muted">
                    {r}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-t border-line px-4 py-2.5">
              <Icon name="home" size={14} className="text-ok" />
              <span className="text-[12.5px] text-ink">Home, Life and Your life</span>
            </div>
            <div className="flex items-center gap-2.5 border-t border-line px-4 py-2.5">
              <Icon name="mail" size={14} className="text-ok" />
              <span className="text-[12.5px] text-ink">Your mail, and what Learn kept</span>
            </div>
          </div>
        </div>
      </div>
      {err && <Err>{err}</Err>}
      <div className="flex items-center gap-3">
        <button className="btn-danger text-[12px]" disabled={busy || n === 0} onClick={() => void clear()}>
          {busy ? 'Clearing…' : `Clear ${n === 1 ? 'it' : `these ${n}`} and start again`}
        </button>
        <button className="btn-ghost text-[12px]" onClick={onClose}>
          Not now
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">Nothing is cleared until you press the red button.</span>
      </div>
      <Foot icon="alert">
        Cleared, not archived: the folders are removed, not moved to a bin. Services and commands can be read
        back from each repository when it is linked again.
      </Foot>
    </Frame>
  )
}
