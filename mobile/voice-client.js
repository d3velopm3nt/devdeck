/* Local Kokoro voice. No reply text is sent to a voice service. */
function createOfflineVoice({ button, status, onSpeaking, onIdle, onChange, onPreparing = () => {} }) {
  let worker, ready = false, loading = false, busy = false, context, analyser, waveform;
  let queuedText = null, activeError = null;
  let preparation = null, prepared, preparationFailed;
  let generation = 0, activeId = 0, workerRequestId = 0, endAt = 0, sources = [], finished = false;
  function update() {
    button.disabled = loading || busy || ready;
    button.textContent = loading ? 'Preparing voice…' : ready ? 'Voice ready' : 'Download voice';
    onChange();
  }
  function drain(){if(!busy&&queuedText){const text=queuedText;queuedText=null;void speak(text).catch(error=>{status.textContent=error.message;});}}
  function idleIfDone() {
    if (finished && sources.length === 0) { busy = false; status.textContent = 'Offline voice ready · Heart'; onIdle(); update(); drain(); }
  }
  function stop() {
    queuedText=null; activeError=null;
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
        onChange();
      } else if (data.type === 'ready') {
        ready = true; loading = false; status.textContent = 'Offline voice ready · Heart'; update();
        prepared?.(); preparation = null; prepared = preparationFailed = null;
      } else if (data.type === 'audio' && data.id === activeId) {
        activeError=null;
        const buffer = context.createBuffer(1, data.samples.length, data.rate);
        buffer.copyToChannel(data.samples, 0);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(analyser);
        const start = Math.max(context.currentTime, endAt); endAt = start + buffer.duration;
        sources.push(source); status.textContent = 'Speaking offline · Heart'; onSpeaking();
        source.onended = () => { sources = sources.filter(s => s !== source); idleIfDone(); };
        source.start(start);
      } else if (data.type === 'complete') {
        if (data.id !== activeId) { busy = false; update(); drain(); }
        else { activeError=null; finished = true; idleIfDone(); }
      } else if (data.type === 'error') {
        if (data.id && data.id !== workerRequestId) return;
        if (data.id && data.id !== activeId) { busy=false; update(); drain(); return; }
        const notify=activeError;
        preparationFailed?.(new Error(data.message)); preparation = null; prepared = preparationFailed = null;
        loading = false; busy = false; ready = false; stop(); status.textContent = data.message; update(); notify?.();
      }
    };
    worker.onerror = () => {
      const notify=activeError;
      preparationFailed?.(new Error('Local voice could not load. Retry voice setup.')); preparation = null; prepared = preparationFailed = null;
      loading = false; busy = false; ready = false; stop();
      worker.terminate(); worker = undefined;
      status.textContent = 'Voice could not load. Reconnect to the PC and retry.'; update(); notify?.();
    };
    return worker;
  }
  function prepare() {
    if (ready) return Promise.resolve();
    if (preparation) return preparation;
    preparation = new Promise((resolve, reject) => { prepared = resolve; preparationFailed = reject; });
    const result = preparation;
    loading = true; status.textContent = 'Preparing voice files · only missing files need internet.'; update();
    try { getWorker().postMessage({ type: 'download' }); }
    catch (error) { loading = false; status.textContent = error.message; update(); preparationFailed?.(error); preparation = null; prepared = preparationFailed = null; }
    return result;
  }
  button.onclick = () => { void prepare().catch(error => { status.textContent = error.message; }); };
  async function unlock() {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
  }
  async function speak(text, onError = null) {
    if (!ready) return;
    if(busy){queuedText=text;status.textContent='Waiting for local voice…';onPreparing();update();return;}
    // The microphone gesture unlocks audio before the asynchronous reply arrives.
    activeId = ++generation; const id = activeId;
    busy = true; finished = false; endAt = 0; activeError=onError;
    status.textContent = 'Generating speech locally…'; onPreparing(); update();
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 256; waveform = new Uint8Array(analyser.fftSize); analyser.connect(context.destination); }
      await context.resume();
      if (id !== activeId) { busy = false; update(); drain(); return; }
      workerRequestId=id;
      getWorker().postMessage({ type: 'speak', id, text });
    } catch (error) { activeError=null; busy = false; onIdle(); update(); throw error; }
  }
  function dispose() { preparationFailed?.(new Error('Voice view closed.')); preparation = null; prepared = preparationFailed = null; stop(); worker?.terminate(); void context?.close(); }
  update();
  function level() {
    if (!analyser || sources.length === 0) return 0;
    analyser.getByteTimeDomainData(waveform);
    let sum = 0;
    for (const byte of waveform) { const sample = (byte - 128) / 128; sum += sample * sample; }
    return Math.min(1, Math.sqrt(sum / waveform.length) * 5);
  }
  return { prepare, speak, stop, unlock, dispose, level, isReady: () => ready, canSpeak: () => ready && !busy };
}
// A shared adapter: ESM desktop imports and classic mobile scripts use one engine.
globalThis.createOfflineVoice = createOfflineVoice;
