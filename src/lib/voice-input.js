// One speech-capture adapter for mobile and desktop. It emits text, never forms
// or network requests. Hosts submit that text through their normal chat path.
(function (root) {
  function create({ onState, onCaption, onText, onError, language = navigator.language, Recognition = root.SpeechRecognition || root.webkitSpeechRecognition }) {
    let current = null, startTimer, silenceTimer, endTimer, state = 'idle';
    const change = next => { state = next; onState(next); };
    const clear = () => { clearTimeout(startTimer); clearTimeout(silenceTimer); clearTimeout(endTimer); };
    function cancel() { const old = current; current = null; clear(); if (old) { try { old.instance.abort(); } catch {} } change('idle'); }
    function complete(run) {
      if (current !== run) return;
      current = null; clear(); change('idle');
      try { run.instance.abort(); } catch {}
      const parts = [...run.parts.values()];
      const final = parts.filter(p => p.final).map(p => p.text).join(' ').trim();
      const text = final || parts.map(p => p.text).join(' ').trim();
      if (text) { onCaption(text); void Promise.resolve(onText(text)).catch(e => onError(e.message || String(e))); }
      else onError('No speech was detected. Tap the microphone and try again.');
    }
    function finish() {
      const run = current; if (!run) return;
      clearTimeout(silenceTimer);
      try { run.instance.stop(); } catch { complete(run); }
      // Some Android implementations emit a transcript but omit the end event.
      if (current === run) endTimer = setTimeout(() => complete(run), 700);
    }
    function start() {
      cancel(); if (!Recognition) { onError('Voice input is unavailable in this browser.'); return; }
      let instance; try { instance = new Recognition(); } catch (e) { onError(e.message); return; }
      const run = { instance, parts: new Map() }; current = run; change('starting'); onCaption('');
      instance.lang = language || 'en-ZA'; instance.interimResults = true; instance.continuous = false;
      instance.onstart = () => { if (current !== run) return; clearTimeout(startTimer); change('listening'); };
      instance.onresult = event => {
        if (current !== run) return;
        for (let i = 0; i < event.results.length; i++) run.parts.set(i, { text: event.results[i][0].transcript, final: event.results[i].isFinal });
        // Replace updated results rather than appending repeated hypotheses.
        for (const i of run.parts.keys()) if (i >= event.results.length) run.parts.delete(i);
        onCaption([...run.parts.values()].map(p => p.text).join(' ').trim());
        clearTimeout(silenceTimer); silenceTimer = setTimeout(finish, 1800);
      };
      instance.onend = () => complete(run);
      instance.onerror = event => {
        if (current !== run) return;
        if (event.error === 'no-speech' && run.parts.size) { complete(run); return; }
        const hasFinal = [...run.parts.values()].some(p => p.final && p.text.trim());
        if (hasFinal) { complete(run); return; }
        cancel(); onError(event.error || 'Voice input could not start.');
      };
      startTimer = setTimeout(() => { if (current !== run) return; cancel(); onError('Microphone did not start. Check browser permissions and try again.'); }, 12000);
      try { instance.start(); } catch (e) { cancel(); onError(e.name === 'NotAllowedError' ? 'not-allowed' : e.message); }
    }
    return { start, finish, cancel, dispose: cancel, supported: !!Recognition, state: () => state };
  }
  root.DevVoiceInput = { create };
})(globalThis);
