import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const out = 'mobile/dist';
await mkdir(out, { recursive: true });
await build({ entryPoints: ['mobile/voice/worker.js'], bundle: true, platform: 'browser', conditions: ['onnxruntime-web-use-extern-wasm'], alias: { 'onnxruntime-web': 'onnxruntime-web/wasm' }, format: 'esm', target: 'es2022', minify: true, outfile: out + '/voice-worker.js' });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile('node_modules/onnxruntime-web/dist/' + name, out + '/' + name);
}
console.log('Mobile offline voice runtime staged.');

// The desktop uses the same worker and local synthesis engine as mobile.
await mkdir('public/voice-runtime', { recursive: true });
await copyFile(out + '/voice-worker.js', 'public/voice-worker.js');
await build({ entryPoints: ['mobile/voice/input-worker.js'], bundle: true, platform: 'browser', conditions: ['onnxruntime-web-use-extern-wasm'], alias: { 'onnxruntime-web': 'onnxruntime-web/wasm' }, format: 'esm', target: 'es2022', minify: true, outfile: 'public/voice-input-worker.js' });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(out + '/' + name, 'public/voice-runtime/' + name);
}
