type State = 'idle' | 'starting' | 'listening' | 'transcribing'
type Options = {
  onState: (state: State) => void
  onCaption: (text: string) => void
  onText: (text: string) => void | Promise<void>
  onError: (text: string) => void
  onStatus: (text: string) => void
}

/** Desktop capture uses raw microphone audio and local Whisper, never Web Speech. */
export function createLocalSpeechInput(options: Options) {
  let state: State = 'idle', generation = 0, sequence = 0, disposed = false
  let prepared = false
  let worker: Worker | undefined
  let stream: MediaStream | undefined, recorder: MediaRecorder | undefined
  let context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined
  let analyser: AnalyserNode | undefined, samples: Float32Array<ArrayBuffer> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let amplitude = 0, heard = false, speechFrames = 0
  const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>()
  const change = (next: State) => { state = next; if (!disposed) options.onState(next) }
  const release = () => {
    clearInterval(timer); timer = undefined
    stream?.getTracks().forEach(track => track.stop()); stream = undefined
    source?.disconnect(); source = undefined
    analyser?.disconnect(); analyser = undefined; samples = undefined; amplitude = 0
    if (context) void context.close().catch(() => {})
    context = undefined
  }
  const failPending = (message: string) => {
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error(message)) }
    pending.clear()
  }
  const request = (type: 'load' | 'transcribe', audio?: Float32Array): Promise<string> => {
    if (!worker) {
      worker = new Worker('/voice-input-worker.js', { type: 'module' })
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id)
        if (!p) return
        if (data.type === 'progress') {
          if ((state === 'starting' || !prepared) && !disposed) options.onStatus(`Preparing local microphone model${Number.isFinite(data.progress) ? ` · ${Math.round(data.progress)}%` : ''}…`)
          return
        }
        clearTimeout(p.timeout); pending.delete(data.id)
        if (data.type === 'error') p.reject(new Error(data.message))
        else p.resolve(data.text || '')
      }
      worker.onerror = () => { prepared = false; failPending('Local speech could not load. Check your connection for the first model download, then retry.'); worker?.terminate(); worker = undefined }
    }
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        prepared = false; failPending('Local speech took too long. Please retry.'); worker?.terminate(); worker = undefined
      }, 300000)
      pending.set(id, { resolve, reject, timeout })
      try { worker!.postMessage({ id, type, audio }, audio ? [audio.buffer] : []) }
      catch (e) { clearTimeout(timeout); pending.delete(id); reject(e) }
    })
  }
  const cancel = () => {
    generation++
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; if (recorder.state !== 'inactive') recorder.stop(); recorder = undefined }
    release(); change('idle')
  }
  const finish = () => {
    if (state !== 'listening' || !recorder) return
    change('transcribing'); options.onStatus('Transcribing on this device…')
    clearInterval(timer)
    recorder.stop()
    // Stop the microphone immediately; decode uses a separate context below.
    release()
  }
  const prepare = async () => {
    if (prepared) return
    await request('load')
    if (!disposed) prepared = true
  }
  const start = async () => {
    if (disposed || state !== 'idle') return
    const token = ++generation
    change('starting'); options.onCaption(''); options.onStatus(prepared ? 'Starting microphone…' : 'Preparing local microphone model · first use needs internet…')
    try {
      await prepare()
      if (token !== generation || disposed) return
      options.onStatus('Allow microphone access to speak.')
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (token !== generation || disposed) { media.getTracks().forEach(track => track.stop()); return }
      stream = media; context = new AudioContext(); await context.resume()
      if (token !== generation || disposed) return
      source = context.createMediaStreamSource(media); analyser = context.createAnalyser(); analyser.fftSize = 2048
      samples = new Float32Array(analyser.fftSize); source.connect(analyser)
      const chunks: Blob[] = []
      const recording = new MediaRecorder(media); recorder = recording; heard = false; speechFrames = 0
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recording.onerror = () => { if (token === generation) { cancel(); options.onError('Microphone recording failed. Check the selected input device and try again.') } }
      recording.onstop = () => {
        recorder = undefined
        if (token === generation && !disposed) { release(); change('transcribing') }
        void (async () => {
          if (token !== generation || disposed) return
          let decoder: AudioContext | undefined
          try {
            if (!heard || !chunks.length) throw new Error('No speech was detected. Check your microphone and try again.')
            decoder = new AudioContext()
            const decoded = await decoder.decodeAudioData(await new Blob(chunks, { type: recording.mimeType }).arrayBuffer())
            const resampler = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
            const input = resampler.createBufferSource(); input.buffer = decoded; input.connect(resampler.destination); input.start()
            const resampled = await resampler.startRendering()
            if (token !== generation || disposed) return
            const text = await request('transcribe', resampled.getChannelData(0).slice())
            if (token !== generation || disposed) return
            if (!text) throw new Error('No speech was detected. Please try again.')
            change('idle'); options.onStatus('Microphone ready · local English transcription'); options.onCaption(text)
            await options.onText(text)
          } catch (e) {
            if (token === generation && !disposed) { change('idle'); options.onError(e instanceof Error ? e.message : String(e)) }
          } finally { if (decoder) void decoder.close().catch(() => {}) }
        })()
      }
      recording.start(); change('listening'); options.onStatus('Listening locally · tap again to finish')
      const started = Date.now(); let lastSpeech = started
      timer = setInterval(() => {
        if (!analyser || !samples || token !== generation) return
        analyser.getFloatTimeDomainData(samples)
        let sum = 0; for (const value of samples) sum += value * value
        const rms = Math.sqrt(sum / samples.length); amplitude = Math.min(1, rms * 7)
        if (rms > .012) { speechFrames++; lastSpeech = Date.now(); if (speechFrames >= 3) heard = true }
        if ((heard && Date.now() - lastSpeech > 3200) || (!heard && Date.now() - started > 12000) || Date.now() - started > 60000) finish()
      }, 100)
    } catch (e) {
      if (token !== generation || disposed) return
      cancel()
      const name = e instanceof Error ? e.name : ''
      options.onStatus('Microphone unavailable')
      options.onError(name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access for DevDeck in Windows settings, then retry.' : name === 'NotFoundError' ? 'No microphone was found. Connect an input device and retry.' : `Local speech could not start. ${e instanceof Error ? e.message : String(e)} You can still type below.`)
    }
  }
  return { prepare, start: () => { void start() }, finish, cancel, state: () => state, level: () => amplitude,
    supported: !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined',
    dispose: () => { disposed = true; cancel(); failPending('Voice view closed.'); worker?.terminate(); worker = undefined },
  }
}
