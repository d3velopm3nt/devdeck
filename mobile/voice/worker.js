import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import { env } from '@huggingface/transformers';

// IndexedDB works on the existing LAN HTTP origin, unlike the Cache API.
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE = 'af_heart';
const nativeFetch = self.fetch.bind(self);
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('devdeck-local-voice-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Voice storage is unavailable.'));
});
async function stored(key, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const writing = value !== undefined;
    const tx = db.transaction('files', writing ? 'readwrite' : 'readonly');
    const request = writing ? tx.objectStore('files').put(value, key) : tx.objectStore('files').get(key);
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new Error('Could not save the voice. Check available phone storage.'));
    tx.onabort = () => reject(new Error('Voice download could not be saved.'));
  });
}
let storageFailed = false;
const cache = {
  async match(url) {
    const value = await stored(String(url));
    return value ? new Response(value.body, { status: 200, headers: value.headers }) : undefined;
  },
  async put(url, response) {
    if (!response.ok) throw new Error('Voice file download failed.');
    try { await stored(String(url), { body: await response.arrayBuffer(), headers: [...response.headers] }); }
    catch (error) { storageFailed = true; throw error; }
  },
};
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = cache;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = new URL('/voice-runtime/', self.location.href).href;
// Kokoro's voice files are fetched outside Transformers.js: cache those too.
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url || String(input);
  if (url.startsWith('https://huggingface.co/' + MODEL + '/resolve/main/voices/') && (!init?.method || init.method === 'GET')) {
    const hit = await cache.match(url);
    if (hit) return hit;
    const response = await nativeFetch(input, init);
    if (response.ok) await cache.put(url, response.clone());
    return response;
  }
  return nativeFetch(input, init);
};
let tts, busy = false, cancelledId = 0, lastProgress = 0;
async function load() {
  if (tts) return;
  storageFailed = false;
  tts = await KokoroTTS.from_pretrained(MODEL, {
    device: 'wasm', dtype: 'q8',
    progress_callback: p => { const now = Date.now(); if (p.status !== 'progress' || p.progress === 100 || now - lastProgress > 100) { lastProgress = now; self.postMessage({ type: 'progress', file: p.file, progress: p.progress, status: p.status }); } },
  });
  // Fetch the chosen voice and initialise the phonemizer before saying ready.
  await tts.generate('Dev is ready.', { voice: VOICE });
  if (storageFailed) throw new Error('Voice could not be saved. Free some phone storage and retry.');
  await stored('ready', true);
}
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { cancelledId = data.id; return; }
  if (busy) return;
  busy = true;
  try {
    if (data.type === 'status') {
      self.postMessage({ type: 'status', saved: !!await stored('ready') });
    } else if (data.type === 'download') {
      await load();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'speak') {
      await load();
      // Sentence-sized chunks avoid Kokoro truncating a long reply.
      const splitter = new TextSplitterStream();
      // Bound long sentences as well as closing the stream so the final sentence is emitted.
      const parts = data.text.match(/.{1,300}(?:\s|$)|\S{1,300}/gs) || [];
      for (const part of parts) { splitter.push(part); splitter.flush(); }
      splitter.close();
      for await (const chunk of tts.stream(splitter, { voice: VOICE })) {
        if (cancelledId === data.id) break;
        const samples = new Float32Array(chunk.audio.audio);
        self.postMessage({ type: 'audio', id: data.id, samples, rate: chunk.audio.sampling_rate }, [samples.buffer]);
      }
      self.postMessage({ type: 'complete', id: data.id });
    }
  } catch (error) {
    tts = undefined;
    self.postMessage({ type: 'error', id: data.id, message: error.message || 'Offline voice could not start.' });
  } finally { busy = false; }
};
