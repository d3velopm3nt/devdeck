// Real mobile client with deterministic transport fixtures. No model calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const history = Array.from({length:70},(_,i)=>({from:i%2?'assistant':'user',text:`History message ${i}`,at:new Date().toISOString()}))
history.push({from:'user',text:'What is the next step for DevDeck?',at:new Date().toISOString()},{from:'assistant',text:'Your workspace is ready. What would you like to work on?',at:new Date().toISOString()})
let paired=false, offline=false, cursor=0, executions=0, fixtureBridge='bridge-fixture', orbPreferences=null
const events=[], accepted=new Map()
const emit=e=>events.push({cursor:++cursor,event:e})
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost')
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(fs.readFileSync('mobile/index.html','utf8'))}
  if(['/orb-engine.js','/voice-input.js'].includes(url.pathname)){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('src/lib'+url.pathname,'utf8'))}
  if(url.pathname==='/voice-orb.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('mobile/voice-orb.js','utf8'))}
  if(url.pathname==='/voice-client.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('mobile/voice-client.js','utf8'))}
  if(['/companion.js','/companion.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'application/javascript');return res.end(fs.readFileSync(url.pathname==='/companion.js'&&process.env.MOBILE_CONTROLLER?process.env.MOBILE_CONTROLLER:'mobile'+url.pathname,'utf8'))}
  if(offline)return json({error:'PC unavailable'},503)
  let raw='';for await(const chunk of req)raw+=chunk
  const input=raw?JSON.parse(raw):{}
  if(url.pathname==='/api/pair'){assert.equal(input.code,'fixture-pair');paired=true;return json({})}
  if(!paired)return json({error:'Pair this device on the desktop'},401)
  if(url.pathname==='/api/unpair'){paired=false;return json({})}
  if(url.pathname==='/api/snapshot')return json({nodes:[{id:1,parent_id:null,kind:'workspace',name:'Develtech'},{id:2,parent_id:1,kind:'project',name:'DevDeck'},{id:3,parent_id:2,kind:'folder',name:'Mobile companion'}],conversations:[{id:'room-1',title:'Main assistant',preview:'Your workspace is ready.'}],recent:[{id:'room-1',messages:history.slice(-30)}],sessions:[{id:'run-1',agent_id:'builder',agent_name:'Builder',project_id:'devdeck',feature_id:'Mobile polish',summary:'Building mobile views',transcript:[{at:'2026-10-10T10:00:00Z',text:'Implemented home screen'}],files_touched:['mobile/index.html'],status:'working',started_at:'2026-10-10T10:00:00Z'}],bridge_id:fixtureBridge,orb_preferences:orbPreferences,queue:[...accepted.values()].map(r=>({request_id:r.request_id,conversation_id:r.conversation_id,text:r.text,status:r.status})),approvals:[{id:'approval-1',agent_id:'builder',project_id:'devdeck',summary:'Run the project build',requested_at:new Date().toISOString()}],claims:[],agents:[{id:'builder',name:'Builder',role:'developer'}],cursor})
  if(url.pathname.startsWith('/api/conversation/')){const before=Math.min(Number(url.searchParams.get('before')??history.length),history.length);const start=Math.max(0,before-50);return json({id:'room-1',title:'Main assistant',messages:history.slice(start,before),before:start})}
  if(url.pathname==='/api/node')return json({id:'room-1',title:'DevDeck'})
  if(url.pathname==='/api/conversations')return json({id:'room-1',title:'Main assistant'})
  if(url.pathname==='/api/events'){await new Promise(r=>setTimeout(r,120));if(!paired)return json({error:'Device revoked'},401);const after=Number(url.searchParams.get('after'));return json({cursor,events:events.filter(e=>e.cursor>after).map(e=>e.event)})}
  if(url.pathname==='/api/send'){
    if(accepted.has(input.request_id)){emit(accepted.get(input.request_id));return json({accepted:true,duplicate:true},202)}
    executions++
    history.push({from:'user',text:input.text,at:new Date().toISOString()})
    const receipt={kind:'receipt',conversation_id:input.conversation_id,request_id:input.request_id,error:null,text:input.text,status:'running'}
    accepted.set(input.request_id,receipt)
    emit({kind:'turn',conversation_id:'room-1',done:false,by:'assistant',name:'Dev'})
    setTimeout(()=>emit({kind:'delta',conversation_id:'room-1',text:'I can see your spaces.'}),100)
    setTimeout(()=>{receipt.status='completed';history.push({from:'assistant',text:'I can see your spaces.',at:new Date().toISOString()});emit({kind:'done',conversation_id:'room-1'});emit({kind:'receipt',conversation_id:receipt.conversation_id,request_id:receipt.request_id,error:null})},input.text==='Slow task'?900:250)
    return json({accepted:true},202)
  }
  json({error:'Missing fixture route'},404)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})})
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Africa/Johannesburg'})
await context.addInitScript(() => {
  // Test client transitions against a deterministic voice worker. Model inference is a separate check.
  // Reproduce the LAN regression: the browser exposes recognition although the
  // origin is not flagged secure. This fixture proves we attempt it; physical
  // browser permission and transcription still require device testing.
  Object.defineProperty(window,'isSecureContext',{value:false,configurable:true});
  window.SpeechRecognition=class {
    constructor(){window.lastRecognition=this;}
    start(){this.startTimer=setTimeout(()=>this.onstart?.(),80);}
    stop(){clearTimeout(this.startTimer);this.onend?.();}
    abort(){clearTimeout(this.startTimer);this.onend?.();}
  };
  window.voiceTexts = [];window.voiceRequests = [];
  window.Worker = class {
    postMessage(data) {
      window.voiceRequests.push(data.type);
      if (data.type === 'download') {
        setTimeout(() => this.onmessage({data:{type:'progress',file:'model_quantized.onnx',progress:50}}), 20);
        setTimeout(() => this.onmessage({data:{type:'ready'}}), 60);
      }
      if (data.type === 'speak') {
        window.voiceTexts.push(data.text);
        const samples=Float32Array.from({length:24000},(_,i)=>Math.sin(i*2*Math.PI*440/24000)*.2);
        setTimeout(() => this.onmessage({data:{type:'audio',id:data.id,samples,rate:24000}}), 1000);
        setTimeout(() => this.onmessage({data:{type:'complete',id:data.id}}), 1050);
      }
    }
    terminate() {}
  };
});
const page=await context.newPage(), errors=[]
page.on('pageerror',e=>errors.push(e.message))
const shots=process.env.MOBILE_SCREENSHOTS||'/tmp/devdeck-mobile-screenshots'
fs.mkdirSync(shots,{recursive:true})
try{
  await page.goto(base+'/#pair=fixture-pair');
  await page.getByText('PC connected',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.locator('#home').isVisible(),true,'Home starts first');
  await page.screenshot({path:path.join(shots,'00-home.png')});
  const tabs=page.locator('nav button');
  assert.deepEqual(await tabs.allTextContents(),['Home','Folders','Dev','Teams','Activity']);
  const centre=await page.locator('nav [data-view=chat]').boundingBox();
  assert.ok(Math.abs(centre.x+centre.width/2-195)<3);
  await page.locator('#home-dev').click();
  assert.equal(await page.locator('nav').isVisible(),false);
  assert.equal(await page.locator('#transcript').isVisible(),false);
  assert.ok((await page.locator('#orb').boundingBox()).width>250);
  await page.screenshot({path:path.join(shots,'00-orb.png')});
  await page.getByRole('button',{name:'Show chat',exact:true}).click();
  await page.locator('.message.assistant').filter({hasText:'Your workspace is ready. What would you like to work on?'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{window.orbToneCount=0;const original=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(...args){window.orbToneCount++;return original.apply(this,args)}});
  assert.equal(await page.evaluate(()=>window.isSecureContext),false);
  assert.equal(await page.locator('#mic').isEnabled(),true,'LAN origin must not pre-disable exposed recognition');
  await page.locator('#orb').click();
  await page.getByText('Starting microphone…',{exact:true}).waitFor();
  await page.getByText('Listening…',{exact:true}).waitFor();
  await page.locator('#mic').click();
  await page.getByText('Ready when you are',{exact:true}).waitFor();
  await page.locator('#mic').click();
  await page.getByText('Listening…',{exact:true}).waitFor();
  await page.evaluate(()=>lastRecognition.onerror({error:'not-allowed'}));
  await page.getByText(/The browser denied microphone access/).waitFor();
  assert.equal(await page.locator('#mic').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#mic').isEnabled(),true,'A denied attempt stays retryable');
  await page.evaluate(()=>lastRecognition.onend());
  await page.locator('#mic').click();
  await page.getByText('Starting microphone…',{exact:true}).waitFor();
  await page.locator('#mic').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#orb').getAttribute('data-state'),'idle','Cancelling startup ignores late recognition events');
  assert.equal(await page.locator('#read').count(),0);
  await page.getByRole('button',{name:'Download voice',exact:true}).click();
  await page.getByText('Offline voice ready · Heart',{exact:true}).waitFor({state:'attached'});
  
  assert.equal(await page.locator('#mute-voice').isDisabled(),true);
  await page.locator('#mic').click();
  await page.getByText('Listening…',{exact:true}).waitFor();
  await page.evaluate(()=>lastRecognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Read my reply'}],{isFinal:true})]}));
  await page.locator('#mic').click();
  await page.getByText('Preparing voice…',{exact:true}).waitFor();
  await page.getByText('Speaking…',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>voiceRequests.filter(x=>x==='speak').length),1,'Voice replies speak automatically once');
  executions=0;await page.evaluate(()=>window.orbToneCount=0);
  await page.waitForFunction(()=>localVoice.level()>.05);
  await page.locator('#mute-voice').click();
  await page.getByText('Ready when you are',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localVoice.level()),0);
  await page.waitForFunction(()=>localVoice.canSpeak());
  assert.equal(await page.locator('#mute-voice').isDisabled(),true);
  assert.ok(await page.locator('#transcript').evaluate(el=>el.clientHeight)>250);
  await page.screenshot({path:path.join(shots,'01-chat.png')});
  await page.locator('#load-older').click();
  await page.locator('.message.user').filter({hasText:'History message 0'}).waitFor();
  await page.evaluate(()=>document.getElementById('transcript').scrollTop=80);
  const pos=await page.locator('#transcript').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>renderChat());
  assert.equal(await page.locator('#transcript').evaluate(el=>el.scrollTop),pos);
  for(const [width,height] of [[375,667],[360,540],[320,568]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.querySelector('.app').scrollTop=10000);
    const c=await page.locator('#compose').boundingBox();
    assert.ok(c.y+c.height<=height,'Composer reachable on a short screen');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Back to workspace'}).click();
  assert.equal(await page.locator('#home').isVisible(),true);
  await page.locator('#home-all-spaces').click();
  await page.locator('#nodes button').filter({hasText:'Develtech'}).first().waitFor();
  await page.screenshot({path:path.join(shots,'02-spaces.png')});
  await page.locator('nav [data-view=folders]').click();
  await page.screenshot({path:path.join(shots,'02-folders.png')});
  await page.locator('#folder-nodes button').filter({hasText:'Mobile companion'}).click();
  await page.locator('#text').fill('Show my spaces');
  await page.locator('#send').click();
  await page.getByText('Thinking…',{exact:true}).waitFor();
  await page.getByText('Reply saved in your desktop conversation.',{exact:true}).waitFor();
  assert.equal(executions,1);
  await page.waitForFunction(()=>window.orbToneCount===2);
  assert.equal(await page.evaluate(()=>window.orbToneCount),2,'Accepted message chimes once');
  await page.locator('#text').fill('Slow task');await page.locator('#send').click();
  await page.getByText('Thinking…',{exact:true}).waitFor();
  await page.locator('#text').fill('Keep chatting');
  assert.equal(await page.locator('#send').isEnabled(),true,'Sending stays available during desktop work');
  await page.locator('#send').click();
  await page.waitForFunction(()=>outbox.length===0);
  assert.equal(executions,3);
  await page.locator('nav [data-view=team]').click();
  await page.locator('#team-members button').filter({hasText:'Builder'}).waitFor();
  await page.getByText('Needs approval',{exact:true}).waitFor();
  await page.screenshot({path:path.join(shots,'03-team.png')});
  await page.locator('#team-members button').first().click();
  assert.equal(await page.locator('#text').inputValue(),'@builder ');
  await page.locator('#text').fill('');
  await page.locator('nav [data-view=activity]').click();
  await page.getByText('Run the project build',{exact:true}).waitFor();
  await page.locator('#runs button').first().click();
  await page.getByText(/Implemented home screen/).waitFor();
  await page.locator('#detail-close').click();
  await page.locator('[data-filter=done]').click();
  await page.getByText('No work in this view yet.',{exact:true}).waitFor();
  await page.locator('[data-filter=all]').click();
  await page.evaluate(()=>document.querySelector('.app').scrollTop=0);await page.screenshot({path:path.join(shots,'03-activity.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('nav [data-view=chat]').click();
  await page.getByRole('button',{name:'Show chat',exact:true}).click();
  await page.emulateMedia({reducedMotion:'no-preference'});
  offline=true;
  await page.getByText('PC offline · tasks saved here',{exact:true}).waitFor();
  assert.equal(await page.locator('#mic').isDisabled(),true,'Disconnected desktop cannot accept voice');
  await page.locator('#text').fill('Saved while offline');
  await page.locator('#send').click();
  assert.equal(executions,3);
  await page.getByRole('button',{name:'Retry saved request'}).waitFor();
  await page.screenshot({path:path.join(shots,'04-offline.png')});
  await page.reload();
  await page.locator('#home-dev').click();
  await page.getByRole('button',{name:'Show chat',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Retry saved request'}).isDisabled(),true);
  offline=false;
  await page.getByText('PC connected',{exact:true}).waitFor({state:'attached'});
  await page.getByText('Reply saved in your desktop conversation.',{exact:true}).waitFor();
  assert.equal(executions,4,'Reconnect automatically sends the saved request once');
  await page.locator('#mic').click();
  await page.getByText('Listening…',{exact:true}).waitFor();
  assert.equal(await page.locator('#mic').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>lastRecognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Voice request'}],{isFinal:true})]}));
  await page.locator('#mic').click();
  await page.getByText('Thinking…',{exact:true}).waitFor();
  await page.waitForFunction(()=>outbox.length===0);
  assert.equal(executions,5,'Voice input follows the same desktop queue');
  offline=true;await page.getByText('PC offline · tasks saved here',{exact:true}).waitFor();
  await page.locator('#text').fill('Check restart safety');await page.locator('#send').click();
  fixtureBridge='bridge-restarted';offline=false;
  await page.getByText('Desktop restarted. Check your conversations before retrying saved requests.',{exact:true}).waitFor();
  assert.equal(executions,5,'A new bridge never automatically replays old work');
  await page.getByRole('button',{name:'Retry saved request'}).click();
  await page.waitForFunction(()=>outbox.length===0);
  assert.equal(executions,6);
  // Regression: capture is independent of the hidden composer and disabled Send.
  await page.getByRole('button',{name:'Hide chat',exact:true}).click();
  await page.getByRole('button',{name:'Download voice',exact:true}).click();
  await page.getByText('Offline voice ready · Heart',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.locator('#compose').isVisible(),false);
  assert.equal(await page.locator('#send').isDisabled(),true);
  await page.locator('#mic').click();await page.getByText('Listening…',{exact:true}).waitFor();
  await page.evaluate(()=>{lastRecognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Interim only Android message'}],{isFinal:false})]});lastRecognition.onend();});
  await page.waitForFunction(()=>outbox.length===0&&document.getElementById('orb').dataset.state!=='listening');
  assert.equal(executions,7,'Interim-only speech reaches the same desktop endpoint with chat hidden');
  assert.ok([...accepted.values()].some(r=>r.text==='Interim only Android message'));
  await page.getByText('Speaking…',{exact:true}).waitFor();await page.locator('#mute-voice').click();
  await page.locator('#mic').click();await page.getByText('Listening…',{exact:true}).waitFor();
  await page.evaluate(()=>{const result=(text,final)=>({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:final})]});lastRecognition.onresult(result('Repeated guess',false));lastRecognition.onresult(result('Final voice message',true));lastRecognition.onresult(result('Final voice message',true));lastRecognition.onend();lastRecognition.onend();});
  await page.waitForFunction(()=>outbox.length===0&&document.getElementById('orb').dataset.state!=='listening');
  assert.equal(executions,8,'Repeated recognition results and end events deliver exactly once');
  assert.ok([...accepted.values()].some(r=>r.text==='Final voice message'));
  await page.getByText('Speaking…',{exact:true}).waitFor();await page.locator('#mute-voice').click();
  await page.locator('#mic').click();await page.getByText('Listening…',{exact:true}).waitFor();
  await page.evaluate(()=>{lastRecognition.stop=()=>{};lastRecognition.onresult({resultIndex:0,results:[Object.assign([{transcript:'Missing end event'}],{isFinal:true})]});});
  await page.waitForFunction(()=>outbox.length===0&&document.getElementById('voice-caption').textContent==='Missing end event'&&document.getElementById('orb').dataset.state!=='listening');
  assert.equal(executions,9,'A captured transcript still delivers if the browser omits end');
  await page.getByText('Speaking…',{exact:true}).waitFor();await page.locator('#mute-voice').click();
  await page.waitForFunction(()=>localVoice.canSpeak());
  await page.evaluate(async()=>{const old=localVoice.speak('Obsolete reply');localVoice.stop();await localVoice.speak('Replacement reply');await old;});
  await page.getByText('Speaking…',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>voiceTexts.at(-1)),'Replacement reply','Cancelled synthesis does not swallow a new spoken reply');
  await page.locator('#mute-voice').click();
  orbPreferences={style:'particles',primary:'#12bb88',secondary:'#b87aff',glow:1.5,size:.7,movement:.5};
  await page.evaluate(()=>refresh());
  assert.equal(await page.evaluate(()=>snapshot.orb_preferences.primary),'#12bb88');
  assert.equal(await page.evaluate(()=>DevOrb.normalize(snapshot.orb_preferences).style),'particles');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--orb-size')),'231px','Desktop appearance from snapshot changes mobile sizing');
  await page.getByRole('button',{name:'Back to workspace'}).click();
  await page.locator('#disconnect').click();
  await page.getByRole('heading',{name:'Connect with Dev'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('devdeck-companion-v1')),null);
  assert.deepEqual(errors,[]);
  console.log('Mobile passed: home, orb/chat, history, LAN recognition attempts, denied-permission recovery, startup cancellation, voice states, acceptance chime, responsive layouts, Teams/Activity/details, offline automatic reconnect and unpair. Screenshots: '+shots);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}

