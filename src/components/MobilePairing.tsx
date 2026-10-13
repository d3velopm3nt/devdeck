import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PairingView } from '../lib/companion'

export function MobilePairing() {
  const [address, setAddress] = useState('127.0.0.1')
  const [pair, setPair] = useState<PairingView | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expires, setExpires] = useState(0)
  useEffect(() => {
    if (!pair) return
    let disposed = false
    void import('qrcode').then((m) => m.default.toDataURL(pair.url, { width: 240, margin: 3 })).then((image) => {
      if (!disposed) setQr(image)
    }).catch((e) => { if (!disposed) setError(String(e)) })
    const timer = window.setInterval(() => setExpires((v) => Math.max(0, v - 1)), 1000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [pair])
  const start = async (renew: boolean) => {
    setBusy(true); setError('')
    try {
      const view = await invoke<PairingView>(renew ? 'companion_pair' : 'companion_start', renew ? {} : { address })
      setPair(view); setExpires(view.expires_in); setQr('')
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try { await invoke('companion_stop'); setPair(null); setQr(''); setError('') }
    catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  return <section className="rounded-lg border border-line bg-panel px-4 py-3">
    <h2 className="mb-2 text-[13px] font-semibold text-ink">Mobile companion · local preview</h2>
    <p className="mb-3 text-[12px] text-dim">Pair your phone to read spaces and chat with Dev. DevDeck must stay running, including in the tray.</p>
    <label className="flex flex-wrap items-center gap-2 text-[12px]">This PC’s IPv4 address
      <input aria-label="Companion listen address" value={address} disabled={!!pair || busy} onChange={(e) => setAddress(e.target.value)} className="rounded border border-line2 bg-raise px-2 py-1 text-ink" />
    </label>
    <p className="my-2 text-[11px] text-muted">For a phone, use this PC’s Wi-Fi IPv4 address from ipconfig, such as 192.168.1.20. 127.0.0.1 tests on this PC. This preview uses HTTP: use a trusted private network only. Voice input and remote access need HTTPS.</p>
    <div className="flex gap-2"><button disabled={busy} className="btn-primary" onClick={() => void start(!!pair)}>{pair ? 'New pairing code' : 'Start companion'}</button>
      {pair ? <button disabled={busy} className="btn-ghost" onClick={() => void stop()}>Stop &amp; revoke all devices</button> : null}</div>
    {pair ? <div className="mt-3 flex flex-wrap items-center gap-4">
      {qr && expires > 0 ? <img src={qr} width={240} height={240} alt="Scan to pair this phone with DevDeck" /> : null}
      <div className="max-w-md text-[12px]"><p role="status">{expires > 0 ? `Scan within ${expires}s. Each code works once.` : 'Pairing code expired. Generate another code.'}</p>
        {expires > 0 ? <a className="mt-2 block break-all text-indigo-400" href={pair.url} target="_blank" rel="noreferrer">Open companion on this PC</a> : null}
        <p className="mt-2 text-dim">Approvals remain on the desktop. Restarting the companion requires pairing again.</p></div>
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-[12px] text-red-400">{error}</p> : null}
  </section>
}
