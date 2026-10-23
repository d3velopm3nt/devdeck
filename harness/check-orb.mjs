import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const context=await browser.newContext({viewport:{width:1280,height:900}});
await context.addInitScript(()=>{
  navigator.mediaDevices.getUserMedia=async()=>{
    if(window.denyMic)throw new DOMException('Denied','NotAllowedError');
    const context=new AudioContext();await context.resume();const oscillator=context.createOscillator();const output=context.createMediaStreamDestination();oscillator.connect(output);oscillator.start();return output.stream;
  };
  window.Worker=class{
    constructor(url){this.url=url}
    postMessage(data){
      if(data.type==='load'||data.type==='download'){
        const name=data.type==='load'?'devdeck-local-input-v1':'devdeck-local-voice-v1';
        const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('files');
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('files','readwrite');tx.objectStore('files').put(true,'ready');tx.oncomplete=()=>{db.close();this.onmessage?.({data:{type:'ready',id:data.id}})}};
      }
      if(data.type==='transcribe')setTimeout(()=>this.onmessage?.({data:{type:'text',id:data.id,text:'Desktop spoken message'}}),20);
      if(data.type==='speak'){window.spokenText=data.text;const samples=new Float32Array(24000).fill(.1);setTimeout(()=>this.onmessage?.({data:{type:'audio',id:data.id,samples,rate:24000}}),100);setTimeout(()=>this.onmessage?.({data:{type:'complete',id:data.id}}),150)}
    }
    terminate(){}
  };
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto((process.env.HARNESS_URL||'http://127.0.0.1:5199')+'/harness/orb.html');
  await page.getByRole('button',{name:'Save orb',exact:true}).waitFor();
  await page.getByRole('button',{name:/Light ribbons/}).click();
  await page.getByLabel('primary orb color',{exact:true}).fill('#12bb88');
  await page.getByLabel('Orb glow',{exact:true}).fill('1.5');
  await page.getByLabel('Orb size',{exact:true}).fill('1.2');
  await page.getByLabel('Orb movement',{exact:true}).fill('0.5');
  await page.getByLabel('Orb preview state',{exact:true}).selectOption('thinking');
  await page.getByRole('button',{name:'Save orb',exact:true}).click();
  await page.getByText('Orb saved. Your connected phone picks it up automatically.',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dev.orb.preferences')));
  assert.equal(saved.style,'ribbons');assert.equal(saved.primary,'#12bb88');assert.equal(saved.glow,1.5);assert.equal(saved.size,1.2);
  await page.screenshot({path:path.join(tmpdir(),'devdeck-orb-settings.png')});
  await page.reload();assert.equal(await page.getByLabel('primary orb color').inputValue(),'#12bb88');
  await page.getByRole('button',{name:/Particle surface/}).click();
  await page.getByLabel('primary orb color',{exact:true}).fill('#54ddff');
  await page.getByRole('button',{name:'Save orb',exact:true}).click();
  await page.getByText('Orb saved. Your connected phone picks it up automatically.',{exact:true}).waitFor();
  await page.reload();
  assert.equal(await page.getByRole('button',{name:/Particle surface/}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dev.orb.preferences')).style),'particles');
  for(const state of ['idle','listening','thinking','preparing','speaking']){
    await page.getByLabel('Orb preview state',{exact:true}).selectOption(state);
    await page.waitForFunction(()=>{
      const canvas=[...document.querySelectorAll('[aria-label="Orb appearance"] canvas')].at(-1);
      return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some(v=>v>0);
    });
  }
  await page.screenshot({path:path.join(tmpdir(),'devdeck-particle-orb.png')});
  const previewCanvas=page.locator('[aria-label="Interactive Dev orb"] canvas');
  const idleFrame=await previewCanvas.evaluate(c=>c.toDataURL());
  await page.waitForTimeout(400);
  assert.notEqual(await previewCanvas.evaluate(c=>c.toDataURL()),idleFrame,'Preview canvas actually animates');
  await page.getByRole('button',{name:'Play orb sample',exact:true}).click();
  await page.getByText('Sample · Speaking…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Stop sample',exact:true}).click();
  await page.getByRole('button',{name:'Play orb sample',exact:true}).waitFor();
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await page.getByPlaceholder('Message Dev…').fill('Typed still works');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Received Typed still works',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Talk to Dev',exact:true}).click();
  await page.getByRole('button',{name:'Play orb sample',exact:true}).click();
  await page.getByText('Sample · Speaking…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Stop sample',exact:true}).click();
  await page.getByRole('button',{name:'Set up voice',exact:true}).click();
  await page.getByText('Voice ready · microphone and speaker',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Start voice input',exact:true}).click();
  await page.getByText('Listening…',{exact:true}).waitFor();
  await page.waitForTimeout(1500);await page.getByRole('button',{name:'Finish listening',exact:true}).last().click();
  await page.getByText('Speaking…',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>spokenText),'Received Desktop spoken message');
  const calls=await page.evaluate(()=>__orbCalls);assert.deepEqual(calls.map(c=>[c.conversationId,c.text]),[['orb-thread','Typed still works'],['orb-thread','Desktop spoken message']]);
  await page.screenshot({path:path.join(tmpdir(),'devdeck-desktop-orb.png')});
  await page.getByRole('button',{name:'Mute spoken replies',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Enable spoken replies',exact:true}).getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>{window.denyMic=true});await page.getByRole('button',{name:'Start voice input',exact:true}).click();
  await page.getByText(/Microphone access was denied/).waitFor();
  await page.getByLabel('Message Dev in voice view',{exact:true}).fill('Dictated desktop message');
  await page.getByRole('button',{name:'Send',exact:true}).last().click();
  await page.getByText('Received Dictated desktop message',{exact:true}).waitFor();
  assert.deepEqual((await page.evaluate(()=>__orbCalls)).at(-1),{conversationId:'orb-thread',text:'Dictated desktop message'});
  await page.getByRole('button',{name:'Show chat',exact:true}).first().click();
  await page.getByText('Received Desktop spoken message',{exact:true}).waitFor();
  await page.getByPlaceholder('Message Dev…').fill('Typed after voice');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Received Typed after voice',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Talk to Dev',exact:true}).click();await page.getByText('Voice ready · microphone and speaker',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Set up voice',exact:true}).count(),0);assert.deepEqual(errors,[]);console.log('Shared orb: appearance save/reload, preview states, desktop typed and spoken delivery through one command, automatic local speech, mute and return to chat passed.');
}finally{await browser.close()}
