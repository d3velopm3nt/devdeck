import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const page=await browser.newPage();page.on('console',m=>{if(m.type()==='error')console.log(m.text())});
await page.route('**/speech-test',r=>r.fulfill({contentType:'text/html',body:'<html><body>Local model smoke test</body></html>'}));
await page.goto((process.env.HARNESS_URL || 'http://localhost:5173')+'/speech-test');
try {
const text=await page.evaluate(async()=>{
const worker=new Worker('/voice-input-worker.js',{type:'module'});
const call=(data)=>new Promise((resolve,reject)=>{worker.onmessage=e=>{if(e.data.type==='error')reject(Error(e.data.message));else if(e.data.type!=='progress')resolve(e.data)};worker.onerror=e=>reject(Error(e.message));worker.postMessage(data)});
try {
await call({type:'load',id:1});
const context=new AudioContext();
try {
const wav=await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav').then(r=>r.arrayBuffer());
const decoded=await context.decodeAudioData(wav);
const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const resampled=await offline.startRendering();
return await call({type:'transcribe',id:2,audio:resampled.getChannelData(0)});
} finally {await context.close()}
} finally {worker.terminate()}
});assert.match(text.text,/fellow Americans/i);console.log('PASS: real local Whisper model transcribes a public spoken sample.');
} finally {await browser.close()}
