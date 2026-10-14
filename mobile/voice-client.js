/* Local Kokoro voice. No reply text is sent to a voice service. */
function createOfflineVoice({ button, status, onSpeaking, onIdle, onChange, onPreparing = () => {} }) {
  let worker, ready = false, loading = false, busy = false, context, analyser, waveform;
  let generation = 0, activeId = 0, endAt = 0, sources = [], finished = false;
  function update() {
    button.disabled = loading || busy || ready;
    button.textContent = loading ? 'Preparing voice…' : ready ? 'Voice ready' : 'Download voice';
    onChange();
  }
  function idleIfDone() {
    if (finished && sources.length === 0) { busy = false; status.textContent = 'Offline voice ready · Heart'; onIdle(); update(); }
  }
  function stop() {
    if (busy && worker) worker.postMessage({ type: 'cancel', id: activeId });
    activeId = ++generation;
    for (const source of sources) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } }
    sources = []; endAt = 0; if(finished)busy=false; onIdle();
    // Keep the worker alive so its downloaded runtime also works with the PC disconnected.
    // In-flight synthesis is ignored; do not queue another request until it completes.
    update();
  }
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('/voice-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        status.textContent = data.file ? 'Downloading ' + data.file + (Number.isFinite(data.progress) ? ' · ' + Math.round(data.progress) + '%' : '') : 'Preparing voice…';
      } else if (data.type === 'ready') {
        ready = true; loading = false; status.textContent = 'Offline voice ready · Heart'; update();
      } else if (data.type === 'audio' && data.id === activeId) {
        const buffer = context.createBuffer(1, data.samples.length, data.rate);
        buffer.copyToChannel(data.samples, 0);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(analyser);
        const start = Math.max(context.currentTime, endAt); endAt = start + buffer.duration;
        sources.push(source); status.textContent = 'Speaking offline · Heart'; onSpeaking();
        source.onended = () => { sources = sources.filter(s => s !== source); idleIfDone(); };
        source.start(start);
      } else if (data.type === 'complete') {
        if (data.id !== activeId) { busy = false; update(); }
        else { finished = true; idleIfDone(); }
      } else if (data.type === 'error') {
        loading = false; busy = false; ready = false; stop(); status.textContent = data.message; update();
      }
    };
    worker.onerror = () => {
      loading = false; busy = false; ready = false; stop();
      worker.terminate(); worker = undefined;
      status.textContent = 'Voice could not load. Reconnect to the PC and retry.'; update();
    };
    return worker;
  }
  button.onclick = () => {
    if (ready || loading || busy) return;
    loading = true; status.textContent = 'Downloading voice files. Internet is needed for the first download.'; update();
    try { getWorker().postMessage({ type: 'download' }); }
    catch (error) { loading = false; status.textContent = error.message; update(); }
  };
  async function unlock() {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
  }
  async function speak(text) {
    if (!ready || busy) return;
    // The microphone gesture unlocks audio before the asynchronous reply arrives.
    activeId = ++generation; const id = activeId;
    busy = true; finished = false; endAt = 0;
    status.textContent = 'Generating speech locally…'; onPreparing(); update();
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 256; waveform = new Uint8Array(analyser.fftSize); analyser.connect(context.destination); }
      await context.resume();
      if (id !== activeId) { busy = false; update(); return; }
      getWorker().postMessage({ type: 'speak', id, text });
    } catch (error) { busy = false; onIdle(); update(); throw error; }
  }
  function dispose() { stop(); worker?.terminate(); void context?.close(); }
  update();
  function level() {
    if (!analyser || sources.length === 0) return 0;
    analyser.getByteTimeDomainData(waveform);
    let sum = 0;
    for (const byte of waveform) { const sample = (byte - 128) / 128; sum += sample * sample; }
    return Math.min(1, Math.sqrt(sum / waveform.length) * 5);
  }
  return { speak, stop, unlock, dispose, level, isReady: () => ready, canSpeak: () => ready && !busy };
}
