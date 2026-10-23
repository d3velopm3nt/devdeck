// One speech-capture adapter for mobile and desktop. It emits text, never forms
// or network requests. Hosts submit that text through their normal chat path.
(function (root) {
  function create({ onState, onCaption, onText, onError, language = navigator.language, Recognition = root.SpeechRecognition || root.webkitSpeechRecognition }) {
    let current = null, startTimer, silenceTimer, endTimer, state = 'idle';
    const change = next => { state = next; onState(next); };
    const clear = () => { clearTimeout(startTimer); clearTimeout(silenceTimer); clearTimeout(endTimer); };
    function stopMeter(run) {
      run.stream?.getTracks().forEach(track => track.stop());
      run.source?.disconnect();
      run.analyser?.disconnect();
      if (run.audio) void run.audio.close().catch(() => {});
      run.stream = run.source = run.analyser = run.audio = null;
    }
    async function startMeter(run) {
      const Audio = root.AudioContext || root.webkitAudioContext;
      if (!Audio || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (current !== run || run.finishing) { stream.getTracks().forEach(track => track.stop()); return; }
        run.stream = stream;
        run.audio = new Audio();
        run.analyser = run.audio.createAnalyser(); run.analyser.fftSize = 512;
        run.samples = new Uint8Array(run.analyser.fftSize);
        run.source = run.audio.createMediaStreamSource(stream);
        run.source.connect(run.analyser);
        await run.audio.resume();
      } catch {
        // Metering is optional: recognition still works if raw audio is unavailable.
        stopMeter(run);
      }
    }
    function level() {
      const run = current;
      if (!run?.analyser || state !== 'listening' || run.finishing) return 0;
      run.analyser.getByteTimeDomainData(run.samples);
      let sum = 0;
      for (const sample of run.samples) sum += ((sample - 128) / 128) ** 2;
      const amplitude = Math.min(1, Math.max(0, Math.sqrt(sum / run.samples.length) - .008) * 7);
      run.level = (run.level || 0) * .65 + amplitude * .35;
      return run.level;
    }
    function cancel() { const old = current; current = null; clear(); if (old) { stopMeter(old); try { old.instance.abort(); } catch {} } change('idle'); }
    function transcript(run) {
      const segments = [], chain = [];
      let growth = 0, generation = -1;
      const flush = () => {
        // A single prefix pair can be genuine speech ("yes", "yes please").
        // Only a repeated growing hypothesis sequence is normalized.
        if (growth >= 2) segments.push(chain.at(-1));
        else segments.push(...chain);
        chain.length = 0; growth = 0;
      };
      for (const part of run.parts.values()) {
        const text = part.text.trim();
        if (!text) continue;
        if (generation !== part.generation) { flush(); generation = part.generation; }
        const previous = chain.at(-1);
        if (previous && text.toLowerCase() !== previous.toLowerCase() && !text.toLowerCase().startsWith(previous.toLowerCase() + ' ')) flush();
        else if (previous && text.toLowerCase() !== previous.toLowerCase()) growth++;
        chain.push(text);
      }
      flush();
      return segments.join(' ').trim();
    }
    function complete(run) {
      if (current !== run) return;
      current = null; clear(); stopMeter(run); change('idle');
      try { run.instance.abort(); } catch {}
      const text = transcript(run);
      if (text) { onCaption(text); void Promise.resolve(onText(text)).catch(e => onError(e.message || String(e))); }
      else onError('No speech was detected. Tap the microphone and try again.');
    }
    function finish() {
      const run = current; if (!run) return;
      run.finishing = true;
      stopMeter(run);
      clearTimeout(silenceTimer);
      try { run.instance.stop(); } catch { complete(run); }
      // Some Android implementations emit a transcript but omit the end event.
      if (current === run) endTimer = setTimeout(() => complete(run), 700);
    }
    function start() {
      cancel(); if (!Recognition) { onError('Voice input is unavailable in this browser.'); return; }
      let instance; try { instance = new Recognition(); } catch (e) { onError(e.message); return; }
      const run = { instance, parts: new Map(), offset: 0, finishing: false }; current = run; change('starting'); onCaption('');
      instance.lang = language || 'en-ZA'; instance.interimResults = true; instance.continuous = true;
      instance.onstart = () => { if (current !== run) return; clearTimeout(startTimer); change('listening'); };
      instance.onresult = event => {
        if (current !== run) return;
        for (let i = 0; i < event.results.length; i++) run.parts.set(run.offset + i, { text: event.results[i][0].transcript, final: event.results[i].isFinal, generation: run.offset });
        // Replace updated results rather than appending repeated hypotheses.
        for (const i of run.parts.keys()) if (i >= run.offset + event.results.length) run.parts.delete(i);
        onCaption(transcript(run));
        clearTimeout(silenceTimer); silenceTimer = setTimeout(finish, 3200);
      };
      instance.onend = () => {
        if (current !== run) return;
        if (run.finishing || !run.parts.size) { complete(run); return; }
        // Android can end recognition before our pause window expires.
        // Preserve the captured segment and resume without submitting early.
        run.offset = run.parts.size;
        try { instance.start(); } catch { /* The silence timer still submits the saved text. */ }
      };
      instance.onerror = event => {
        if (current !== run) return;
        if (event.error === 'no-speech' && run.parts.size) return;
        if (run.parts.size && event.error !== 'not-allowed' && event.error !== 'service-not-allowed') { run.finishing = true; finish(); return; }
        cancel(); onError(event.error || 'Voice input could not start.');
      };
      startTimer = setTimeout(() => { if (current !== run) return; cancel(); onError('Microphone did not start. Check browser permissions and try again.'); }, 12000);
      try { instance.start(); void startMeter(run); } catch (e) { cancel(); onError(e.name === 'NotAllowedError' ? 'not-allowed' : e.message); }
    }
    return { start, finish, cancel, dispose: cancel, supported: !!Recognition, state: () => state, level };
  }
  root.DevVoiceInput = { create };
})(globalThis);
