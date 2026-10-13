// Real mobile client with deterministic transport fixtures. No model calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const history = Array.from({length:70},(_,i)=>({from:i%2?'assistant':'user',text:`History message ${i}`,at:new Date().toISOString()}))
history.push({from:'user',text:'What is the next step for DevDeck?',at:new Date().toISOString()},{from:'assistant',text:'Your workspace is ready. What would you like to work on?',at:new Date().toISOString()})
let paired=false, offline=false, cursor=0, executions=0
const events=[], accepted=new Map()
const emit=e=>events.push({cursor:++cursor,event:e})
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost')
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(fs.readFileSync('mobile/index.html','utf8'))}
  if(url.pathname==='/voice-orb.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('mobile/voice-orb.js','utf8'))}
  if(url.pathname==='/voice-client.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('mobile/voice-client.js','utf8'))}
  if(offline)return json({error:'PC unavailable'},503)
  let raw='';for await(const chunk of req)raw+=chunk
  const input=raw?JSON.parse(raw):{}
  if(url.pathname==='/api/pair'){assert.equal(input.code,'fixture-pair');paired=true;return json({})}
  if(!paired)return json({error:'Pair this device on the desktop'},401)
  if(url.pathname==='/api/unpair'){paired=false;return json({})}
  if(url.pathname==='/api/snapshot')return json({nodes:[{id:1,parent_id:null,kind:'workspace',name:'Develtech'},{id:2,parent_id:1,kind:'project',name:'DevDeck'},{id:3,parent_id:2,kind:'folder',name:'Mobile companion'}],conversations:[{id:'room-1',title:'Main assistant',preview:'Your workspace is ready.'}],recent:[{id:'room-1',messages:history.slice(-30)}],sessions:[{id:'run-1',agent_id:'builder',status:'working',started_at:'2026-10-10T10:00:00Z'}],agents:[{id:'builder',name:'Builder',role:'developer'}],cursor})
  if(url.pathname.startsWith('/api/conversation/')){const before=Math.min(Number(url.searchParams.get('before')??history.length),history.length);const start=Math.max(0,before-50);return json({id:'room-1',title:'Main assistant',messages:history.slice(start,before),before:start})}
  if(url.pathname==='/api/node')return json({id:'room-1',title:'DevDeck'})
  if(url.pathname==='/api/conversations')return json({id:'room-1',title:'Main assistant'})
  if(url.pathname==='/api/events'){await new Promise(r=>setTimeout(r,120));if(!paired)return json({error:'Device revoked'},401);const after=Number(url.searchParams.get('after'));return json({cursor,events:events.filter(e=>e.cursor>after).map(e=>e.event)})}
  if(url.pathname==='/api/send'){
    if(accepted.has(input.request_id)){emit(accepted.get(input.request_id));return json({accepted:true,duplicate:true},202)}
    executions++
    history.push({from:'user',text:input.text,at:new Date().toISOString()})
    const receipt={kind:'receipt',conversation_id:input.conversation_id,request_id:input.request_id,error:null}
    accepted.set(input.request_id,receipt)
    emit({kind:'turn',conversation_id:'room-1',done:false,by:'assistant',name:'Dev'})
    setTimeout(()=>emit({kind:'delta',conversation_id:'room-1',text:'I can see your spaces.'}),100)
    setTimeout(()=>{history.push({from:'assistant',text:'I can see your spaces.',at:new Date().toISOString()});emit({kind:'done',conversation_id:'room-1'});emit(receipt)},250)
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
  window.voiceRequests = [];
  window.Worker = class {
    postMessage(data) {
      window.voiceRequests.push(data.type);
      if (data.type === 'download') {
        setTimeout(() => this.onmessage({data:{type:'progress',file:'model_quantized.onnx',progress:50}}), 20);
        setTimeout(() => this.onmessage({data:{type:'ready'}}), 60);
      }
      if (data.type === 'speak') {
        setTimeout(() => this.onmessage({data:{type:'audio',id:data.id,samples:new Float32Array(24000),rate:24000}}), 30);
        setTimeout(() => this.onmessage({data:{type:'complete',id:data.id}}), 80);
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
  await page.goto(base+'/#pair=fixture-pair')
  await page.getByText('PC connected',{exact:true}).waitFor()
  assert.equal(new URL(page.url()).hash,'','Pairing secret is removed from history')
  await page.locator('.message.assistant').filter({hasText:'Your workspace is ready. What would you like to work on?'}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow')
  const tabs=page.getByRole('navigation',{name:'Mobile views'}).getByRole('button')
  assert.deepEqual(await tabs.allTextContents(),['Spaces','Folders','Dev','Team','Activity'])
  const centre=await page.getByRole('button',{name:'Dev',exact:true}).boundingBox()
  assert.ok(Math.abs(centre.x+centre.width/2-195)<3,'Dev occupies the middle navigation position')
  const composer=await page.getByLabel('Message to Dev').boundingBox()
  assert.ok(composer.y+composer.height<780,'Composer stays above navigation')
  assert.equal(await page.getByRole('button',{name:'Read latest reply'}).isDisabled(),true,'Read waits for downloaded model');
  await page.getByRole('button',{name:'Download voice',exact:true}).click();
  await page.getByText('Offline voice ready · Heart',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Read latest reply'}).isEnabled(),true);
  await page.getByRole('button',{name:'Read latest reply'}).click();
  await page.getByText('Speaking…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Stop reading aloud'}).click();
  await page.getByText('Ready when you are',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.voiceRequests),['download','speak','cancel']);
  await page.screenshot({path:path.join(shots,'01-chat.png')})
  await page.setViewportSize({width:375,height:667})
  const compactComposer=await page.getByLabel('Message to Dev').boundingBox()
  const compactNav=await page.getByRole('navigation',{name:'Mobile views'}).boundingBox()
  assert.ok(compactComposer.y+compactComposer.height<compactNav.y,'Small-phone composer remains reachable')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.getByRole('button',{name:'Spaces',exact:true}).click()
  await page.getByRole('button',{name:'Dev',exact:true}).click()
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'Load older messages'}).click()
  await page.locator('.message.user').filter({hasText:'History message 0'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Load older messages'}).isVisible(),false)
  await page.getByRole('button',{name:'Spaces',exact:true}).click()
  await page.getByRole('button',{name:'Develtech workspace',exact:true}).waitFor()
  await page.screenshot({path:path.join(shots,'02-spaces.png')})
  await page.getByRole('button',{name:'Folders',exact:true}).click()
  await page.getByRole('button',{name:/Mobile companion/}).waitFor()
  await page.screenshot({path:path.join(shots,'02-folders.png')})
  await page.getByRole('button',{name:/Mobile companion/}).click()
  await page.getByLabel('Message to Dev').fill('Show my spaces')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByText('Reply saved in your desktop conversation.',{exact:true}).waitFor()
  await page.locator('.message.assistant').filter({hasText:'I can see your spaces.'}).waitFor()
  assert.equal(executions,1)
  await page.getByRole('button',{name:'Team',exact:true}).click()
  await page.getByRole('button',{name:/Builder/}).waitFor()
  await page.screenshot({path:path.join(shots,'03-team.png')})
  await page.getByRole('button',{name:/Builder/}).click()
  assert.equal(await page.getByLabel('Message to Dev').inputValue(),'@builder ')
  await page.getByLabel('Message to Dev').fill('')
  await page.getByRole('button',{name:'Activity',exact:true}).click()
  await page.getByText(/No recent checkpoint/).waitFor()
  await page.screenshot({path:path.join(shots,'03-activity.png')})
  await page.getByRole('button',{name:'Dev',exact:true}).click()
  offline=true
  await page.getByText('Offline · saved view',{exact:true}).waitFor()
  await page.getByLabel('Message to Dev').fill('Saved while offline')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByRole('button',{name:'Retry saved request'}).waitFor()
  assert.equal(executions,1,'Offline request does not execute')
  await page.screenshot({path:path.join(shots,'04-offline.png')})
  await page.reload()
  await page.getByRole('button',{name:'Retry saved request'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Retry saved request'}).isDisabled(),true)
  offline=false
  await page.getByText('PC connected',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Retry saved request'}).click()
  await page.getByText('Reply saved in your desktop conversation.',{exact:true}).waitFor()
  assert.equal(executions,2,'Saved request executes once on explicit retry')
  await page.getByRole('button',{name:'Unpair',exact:true}).click()
  await page.getByRole('heading',{name:'Connect with Dev'}).waitFor()
  assert.equal(await page.evaluate(()=>localStorage.getItem('devdeck-companion-v1')),null,'Unpair clears private cache')
  assert.deepEqual(errors,[])
  console.log('Mobile client: pairing, history, room routing, live replies, stale labels, offline draft/reconnect and unpair passed. Screenshots: '+shots)
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
