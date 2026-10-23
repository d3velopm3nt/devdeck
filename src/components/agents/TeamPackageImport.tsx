import { useState } from 'react'
import * as ipc from '../../lib/ipc'
import { open } from '@tauri-apps/plugin-dialog'

export function TeamPackageImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [folder, setFolder] = useState('')
  const [preview, setPreview] = useState<ipc.TeamPackagePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const browse = async () => {
    setError('')
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose a team package or repository folder' })
      if (typeof selected === 'string') { setFolder(selected); setPreview(null) }
    } catch (e) { setError(String(e)) }
  }
  const inspect = async () => {
    setBusy(true); setError(''); setPreview(null)
    try { setPreview(await ipc.teamPackageInspect(folder.trim())) }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  const create = async () => {
    if (!preview) return
    setBusy(true); setError('')
    try { await ipc.teamPackageSaveTemplate(preview); onImported() }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  return <div className="wf-overlay"><section className="wf-picker" role="dialog" aria-modal="true" aria-label="Import a team package">
    <h2>Import a team package</h2>
    <p className="wf-muted">Inspect a local repository folder containing team.json, agents and skills. Import the package as a reusable Library template.</p>
    <form onSubmit={e => { e.preventDefault(); void inspect() }}>
      <label>Package folder<input autoFocus aria-label="Package folder" className="input w-full" placeholder="C:/Projects/my-repo/factories/my-team" value={folder} disabled={busy} onChange={e => { setFolder(e.target.value); setPreview(null); setError('') }} /></label>
      <button type="button" className="wf-secondary mt-2" disabled={busy} onClick={() => void browse()}>Choose folder…</button>
      <div className="wf-actions mt-3"><button className="wf-secondary" type="submit" disabled={busy || !folder.trim()}>{busy ? 'Working…' : 'Inspect package'}</button><button type="button" className="wf-secondary" disabled={busy} onClick={onClose}>Cancel</button></div>
    </form>
    {error && <p role="alert" className="text-err">{error}</p>}
    {preview && <>
      <h3>{preview.team.name}</h3><p>{preview.team.description}</p>
      <p>{preview.team.roles.length} agents · {preview.texts.filter(t => t.kind === 'skill').length} skills</p>
      <div className="wf-table-wrap"><table className="wf-table"><thead><tr><th>Role</th><th>Reports to</th><th>Skills and handoffs</th></tr></thead><tbody>{preview.team.roles.map(role => <tr key={role.name}><td><strong>{role.name}</strong><p>{role.kind}</p></td><td>{role.reports_to || 'Team lead'}</td><td>{(preview.skills[role.name] || []).join(', ') || 'None'}<p>Handoffs: {(role.handoffs || []).join(', ') || 'None'}</p></td></tr>)}</tbody></table></div>
      <details><summary>Read imported instructions</summary>{preview.texts.map(item => <details key={item.kind + item.id}><summary>{item.path}</summary><pre className="whitespace-pre-wrap break-words text-xs">{item.content}</pre></details>)}{preview.context && <details><summary>Shared README instructions</summary><pre className="whitespace-pre-wrap break-words text-xs">{preview.context}</pre></details>}</details>
      <p className="wf-muted">Saves the team folder, agent briefs and skills in your Library. No configured agents or working team are created.</p>
      <button className="wf-primary" disabled={busy} onClick={() => void create()}>{busy ? 'Importing…' : 'Import into Library'}</button>
    </>}
  </section></div>
}
