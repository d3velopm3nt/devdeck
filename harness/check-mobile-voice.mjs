// Actual Kokoro inference and cache reuse; optional, using downloaded upstream model fixtures.
import http from 'node:http';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const modelDir = process.env.VOICE_MODEL_DIR;
if (!modelDir) throw new Error('Set VOICE_MODEL_DIR to a directory containing config.json, tokenizer.json, tokenizer_config.json, model_quantized.onnx and af_heart.bin.');
const root=process.cwd();
const csp="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co";
const server=http.createServer((req,res)=>{
 const routes={'/voice-worker.js':'mobile/dist/voice-worker.js','/voice-runtime/ort-wasm-simd-threaded.mjs':'mobile/dist/ort-wasm-simd-threaded.mjs','/voice-runtime/ort-wasm-simd-threaded.wasm':'mobile/dist/ort-wasm-simd-threaded.wasm'};
 if(req.url.startsWith('/model/')){const model=modelDir+'/'+req.url.split('/').at(-1);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Length',fs.statSync(model).size);return fs.createReadStream(model).pipe(res);}
 const file=routes[req.url];res.setHeader('Content-Security-Policy',csp);
 if(file){res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':'application/javascript');return res.end(fs.readFileSync(root+'/'+file));}
 res.setHeader('Content-Type','text/html');res.end('<html><body>Voice runtime test</body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext();let offline=false,downloads=0;
await context.route('https://huggingface.co/**',async route=>{
 if(offline)throw new Error('Unexpected remote fetch after caching: '+route.request().url());
 const name=new URL(route.request().url()).pathname.split('/').at(-1);const file=modelDir+'/'+name;
 if(!fs.existsSync(file))return route.fulfill({status:404,body:'Missing optional file',headers:{'access-control-allow-origin':'*'}});
 downloads++;await route.fulfill({status:302,body:'',headers:{'access-control-allow-origin':'*',location:'http://127.0.0.1:'+server.address().port+'/model/'+name}});
});
const page=await context.newPage();page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
try {
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>{window.results=[];window.start=()=>{window.w=new Worker('/voice-worker.js',{type:'module'});w.onmessage=e=>{results.push({type:e.data.type,message:e.data.message,id:e.data.id,size:e.data.samples?.length});};w.onerror=e=>results.push({type:'error',message:e.message});w.postMessage({type:'download'});};start();});
 await page.waitForFunction(()=>results.some(x=>x.type==='ready'||x.type==='error'),{},{timeout:60000});
 let result=await page.evaluate(()=>results);console.log('initial',result.filter(x=>x.type!=='progress'), 'files',downloads);
 if(result.some(x=>x.type==='error'))throw new Error(JSON.stringify(result.filter(x=>x.type==='error')));
 offline=true;
 await page.evaluate(()=>{w.terminate();results=[];start();});
 await page.waitForFunction(()=>results.some(x=>x.type==='ready'||x.type==='error'),{},{timeout:60000});
 result=await page.evaluate(()=>results);console.log('cached',result.filter(x=>x.type!=='progress'));
 if(result.some(x=>x.type==='error'))throw new Error(JSON.stringify(result));
 await page.evaluate(()=>w.postMessage({type:'speak',id:1,text:'Dev is ready. Your voice runs locally.'}));
 await page.waitForFunction(()=>results.some(x=>x.type==='complete'||x.type==='error'),{},{timeout:60000});
 result=await page.evaluate(()=>results);if(!result.some(x=>x.type==='audio'&&x.size>0))throw new Error('No audio');
 console.log('offline audio',result.filter(x=>x.type==='audio'||x.type==='complete'||x.type==='error'));
} finally {await browser.close();server.close();}
