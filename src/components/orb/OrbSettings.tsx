import { useEffect, useState } from 'react'
import { DevOrb } from './DevOrb'
import { OrbStage } from './OrbStage'
import { loadOrbPreferences, saveOrbPreferences } from '../../lib/orb/preferences'
import type { OrbMode, OrbPreferences } from '../../lib/orb-engine.js'
export function OrbSettings() {
  const [value, setValue] = useState<OrbPreferences>(globalThis.DevOrb.defaults)
  const [mode, setMode] = useState<OrbMode>('idle')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { let live = true; void loadOrbPreferences().then(p => { if(live){setValue(p);setReady(true)} }).catch(e => { if(live)setMessage(String(e)) }); return () => { live=false } }, [])
  const patch = (p: Partial<OrbPreferences>) => setValue(v => globalThis.DevOrb.normalize({ ...v, ...p }))
  const save = async () => { setSaving(true); try { await saveOrbPreferences(value);setMessage('Orb saved. Your connected phone picks it up automatically.') } catch(e){setMessage(String(e))} finally{setSaving(false)} }
  return <section className="rounded-lg border border-line bg-panel p-4" aria-label="Orb appearance">
    <h2 className="text-[14px] font-semibold text-ink">Dev orb library</h2>
    <p className="mt-1 text-[12px] text-dim">Choose an orb for desktop and mobile. Preview changes before saving.</p>
    <div className="mt-4 grid gap-4 md:grid-cols-[1fr_250px]">
      <div><div className="grid grid-cols-2 gap-3">{globalThis.DevOrb.styles.map(style => <button key={style.id} aria-pressed={value.style===style.id} onClick={() => patch({style:style.id})} className={`rounded-xl border p-3 text-left ${value.style===style.id?'border-violet-400 bg-violet-500/10':'border-line bg-raise'}`}><DevOrb preferences={{...value,style:style.id,size:1}} pixels={90}/><strong className="block text-[12px] text-ink">{style.name}</strong><span className="mt-1 block text-[11px] text-dim">{style.description}</span></button>)}</div>
      <div className="mt-4 flex gap-5">{(['primary','secondary'] as const).map(key => <label key={key} className="flex items-center gap-2 text-[12px] capitalize">{key} color<input type="color" aria-label={`${key} orb color`} value={value[key]} onChange={e=>patch({[key]:e.target.value})}/></label>)}</div>
      {([{key:'glow',name:'Glow',min:0,max:2},{key:'size',name:'Size',min:.7,max:1.3},{key:'movement',name:'Movement',min:0,max:2}] as const).map(c=><label key={c.key} className="mt-4 grid grid-cols-[85px_1fr_40px] items-center gap-3 text-[12px]">{c.name}<input type="range" aria-label={`Orb ${c.name.toLowerCase()}`} min={c.min} max={c.max} step="0.05" value={value[c.key]} onChange={e=>patch({[c.key]:Number(e.target.value)})}/><span>{value[c.key].toFixed(2)}</span></label>)}
      </div><div className="flex flex-col items-center rounded-xl bg-[#0c0e15] p-3"><OrbStage preferences={value} mode={mode} pixels={220} level={()=>mode==='speaking'||mode==='listening'?.5*(.55+.45*Math.sin(performance.now()/170)**2):0}/><label className="mt-4 text-[11px] text-[#d2c1ea]">Preview state<select aria-label="Orb preview state" className="ml-2 rounded border border-[#635376] bg-[#211b2d] p-1" value={mode} onChange={e=>setMode(e.target.value as OrbMode)}>{['idle','listening','thinking','preparing','speaking'].map(m=><option key={m}>{m}</option>)}</select></label><p className="mt-3 text-[11px] text-[#aaa0ba]">Same interactive component as chat</p></div>
    </div><div className="mt-4 flex items-center justify-end gap-3"><button className="btn-ghost" onClick={()=>setValue(globalThis.DevOrb.defaults)}>Reset orb</button><button className="btn-primary" disabled={!ready||saving} onClick={()=>void save()}>{saving?'Saving…':'Save orb'}</button></div>{message&&<p role="status" className="mt-2 text-[12px] text-dim">{message}</p>}
  </section>
}
