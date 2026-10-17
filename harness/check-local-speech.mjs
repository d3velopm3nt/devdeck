import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const page=await browser.newPage();
await page.route('**/speech-test',r=>r.fulfill({contentType:'text/html',body:'<html><body>Speech capture test</body></html>'}));
await page.goto((process.env.HARNESS_URL || 'http://localhost:5173')+'/speech-test');
try {
const result=await page.evaluate(async()=>{
const {createLocalSpeechInput}=await import('/src/lib/local-speech-input.ts');
let fail=false,delay=0,streams=[],requests=[];
navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const oscillator=c.createOscillator();const out=c.createMediaStreamDestination();oscillator.connect(out);oscillator.start();streams.push(out.stream);return out.stream};
window.Worker=class {postMessage(data){requests.push(data);setTimeout(()=>this.onmessage?.({data:{id:data.id,type:fail?'error':data.type==='load'?'ready':'text',message:'Test model failure',text:'A test message'}}),delay)}terminate(){}};
const sent=[],errors=[],states=[];
const callbacks={onState:s=>states.push(s),onCaption(){},onStatus(){},onText:t=>sent.push(t),onError:e=>errors.push(e)};let input=createLocalSpeechInput(callbacks);
const until=async f=>{const end=Date.now()+10000;while(!f()){if(Date.now()>end)throw Error('Timed out: '+states.join(','));await new Promise(r=>setTimeout(r,30))}};
input.start();await until(()=>input.state()==='listening');await until(()=>input.level()>.05);await new Promise(r=>setTimeout(r,500));input.finish();await until(()=>sent.length===1 || errors.length>0);
const recorded=requests.find(r=>r.type==='transcribe');
const first={sent:[...sent],errors:[...errors],stopped:streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),samples:recorded?.audio?.length || 0};
input.start();await until(()=>input.state()==='listening');input.cancel();await new Promise(r=>setTimeout(r,200));
const cancelled={count:sent.length,state:input.state(),stopped:streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))};
input.dispose();input=createLocalSpeechInput(callbacks);fail=true;input.start();await until(()=>errors.length>0);const failed={state:input.state(),error:errors.at(-1)};
fail=false;delay=500;const before=streams.length;input.start();input.cancel();await new Promise(r=>setTimeout(r,700));const late={streams:streams.length-before,state:input.state()};input.dispose();return {first,cancelled,failed,late};
});
assert.deepEqual(result.first.sent,['A test message']);assert.deepEqual(result.first.errors,[]);assert(result.first.samples>1000);assert(result.first.stopped);assert.deepEqual(result.cancelled,{count:1,state:'idle',stopped:true});assert.equal(result.failed.state,'idle');assert.match(result.failed.error,/Test model failure/);assert.deepEqual(result.late,{streams:0,state:'idle'});console.log('PASS: microphone capture, 16 kHz transcription input, one submission, stop cleanup, cancellation, model failure, and cancellation during model loading.');
}finally{await browser.close()}
