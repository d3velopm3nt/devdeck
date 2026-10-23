import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const profile=await mkdtemp(path.join(tmpdir(),'devdeck-voice-cache-'));
const options={headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})};
const base=process.env.HARNESS_URL||'http://localhost:5173';
async function check(offline){
const context=await chromium.launchPersistentContext(profile,options);
let external=0;
try{
if(offline)await context.route('https://**/*',r=>{external++;return r.abort()});
const page=await context.newPage();
await page.route('**/cache-test',r=>r.fulfill({contentType:'text/html',body:'<html><body>Voice persistence test</body></html>'}));
await page.goto(base+'/cache-test');
for(const [url,type] of [['/voice-input-worker.js','load'],['/voice-worker.js','download']]){
console.log((offline?'Reloading saved ':'Preparing ')+url);
await page.evaluate(async({url,type})=>{
const w=new Worker(url,{type:'module'});
try{await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Model preparation timed out')),300000);w.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timeout);resolve(true)}else if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message))}};w.onerror=e=>reject(Error(e.message));w.postMessage({id:1,type})})}finally{w.terminate()}
},{url,type});
}
const saved=await page.evaluate(async()=>{const {savedVoiceModels}=await import('/src/lib/voice-cache.ts');return savedVoiceModels()});
assert.deepEqual(saved,{microphone:true,speaker:true});
if(offline)assert.equal(external,0,'Saved models must not attempt external downloads after restart');
}finally{await context.close()}
}
await check(false);await check(true);console.log('PASS: microphone and speaker survive a browser restart and prepare with no external network requests.');
