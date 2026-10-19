import { env, pipeline } from '@huggingface/transformers';
import { cache, stored } from './input-cache.js';

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = cache;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = new URL('/voice-runtime/', self.location.href).href;
let transcriber;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      cache.failed = false;
      transcriber ||= await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        device: 'wasm', dtype: 'q8',
        progress_callback: p => {
          if (p.status === 'progress') self.postMessage({ id: data.id, type: 'progress', progress: p.progress });
        },
      });
      if (cache.failed) throw new Error('Microphone model could not be saved. Check available disk space and retry.');
      if (data.type === 'load') { await stored('ready', true); self.postMessage({ id: data.id, type: 'ready' }); }
      else {
        const result = await transcriber(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
        self.postMessage({ id: data.id, type: 'text', text: result.text.trim() });
      }
    } catch (error) {
      transcriber = undefined;
      self.postMessage({ id: data.id, type: 'error', message: error.message || 'Local transcription could not start.' });
    }
  });
};
