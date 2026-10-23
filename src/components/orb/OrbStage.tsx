import { useCallback, useEffect, useRef, useState } from 'react'
import { DevOrb } from './DevOrb'
import type { OrbMode, OrbPreferences } from '../../lib/orb-engine.js'

const orbLabels: Record<OrbMode, string> = {
  idle: 'Ready when you are', connecting: 'Starting microphone…', listening: 'Listening…',
  thinking: 'Thinking…', preparing: 'Preparing voice…', speaking: 'Speaking…', offline: 'Disconnected',
}

// Settings and the conversation share this stage, including the audio analyser.
// Samples are local audio only and never enter the conversation or microphone.
export function OrbStage({ preferences, mode = 'idle', level = () => 0, pixels = 300, onActivate, disabled = false }:
  { preferences: OrbPreferences; mode?: OrbMode; level?: () => number; pixels?: number; onActivate?: () => void; disabled?: boolean }) {
  const [sample, setSample] = useState(false)
  const [error, setError] = useState('')
  const audio = useRef<{ context: AudioContext; source: AudioBufferSourceNode; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null)
  const serial = useRef(0)
  const stop = useCallback(() => {
    serial.current++
    const current = audio.current
    audio.current = null
    if (current) {
      current.source.onended = null
      try { current.source.stop() } catch { /* Sample already ended. */ }
      current.source.disconnect(); current.analyser.disconnect(); void current.context.close().catch(() => {})
    }
    setSample(false)
  }, [])
  useEffect(() => { stop() }, [mode, stop])
  useEffect(() => () => { stop() }, [stop])
  const play = async () => {
    if (sample) { stop(); return }
    stop(); setError('')
    const token = serial.current
    let context: AudioContext | undefined
    try {
      context = new AudioContext()
      const analyser = context.createAnalyser(); analyser.fftSize = 512
      const source = context.createBufferSource()
      const buffer = context.createBuffer(1, context.sampleRate * 5, context.sampleRate)
      const samples = buffer.getChannelData(0)
      for (let i = 0; i < samples.length; i++) {
        const t = i / context.sampleRate, syllable = t % .7
        const envelope = syllable < .46 ? Math.sin(Math.PI * syllable / .46) ** 2 : 0
        const pitch = 125 + Math.floor(t / .7) % 3 * 22
        samples[i] = envelope * (.23 * Math.sin(t * pitch * Math.PI * 2) + .08 * Math.sin(t * pitch * Math.PI * 4) + .04 * Math.sin(t * pitch * Math.PI * 6))
      }
      source.buffer = buffer; source.connect(analyser); analyser.connect(context.destination)
      audio.current = { context, source, analyser, data: new Uint8Array(analyser.fftSize) }
      await context.resume()
      if (serial.current !== token) { void context.close().catch(() => {}); return }
      source.onended = stop; setSample(true); source.start()
    } catch (e) { void context?.close().catch(() => {}); if (serial.current === token) { stop(); setError(`Sample audio could not play: ${String(e)}`) } }
  }
  const currentLevel = () => {
    const current = audio.current
    if (!current) return level()
    current.analyser.getByteTimeDomainData(current.data)
    let power = 0
    for (const value of current.data) power += ((value - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(power / current.data.length) * 5)
  }
  const canvas = <DevOrb mode={sample ? 'speaking' : mode} preferences={preferences} level={currentLevel} pixels={pixels}/>
  return <div className="flex max-w-full flex-col items-center" aria-label="Interactive Dev orb">
    {onActivate ? <button type="button" onClick={onActivate} disabled={disabled} aria-label={mode === 'listening' ? 'Finish listening' : 'Talk to Dev'} className="rounded-full focus-visible:outline-2 focus-visible:outline-violet-400">{canvas}</button> : canvas}
    <p role="status" className="mb-3 text-[14px] text-[#d7c5ee]">{sample ? 'Sample · Speaking…' : orbLabels[mode]}</p>
    <button type="button" className="rounded-full border border-[#635376] px-3 py-2 text-[12px] text-[#d7c5ee]" onClick={() => void play()} aria-pressed={sample}>{sample ? 'Stop sample' : 'Play orb sample'}</button>
    <p className="mt-2 text-center text-[11px] text-[#aaa0ba]">Local sample · no microphone or voice download needed</p>
    {error && <p role="alert" className="mt-2 text-[12px] text-[#edbdcb]">{error}</p>}
  </div>
}
