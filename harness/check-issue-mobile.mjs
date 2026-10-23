import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
let snapshot={nodes:[],conversations:[],recent:[],sessions:[],approvals:[],claims:[],queue:[],agents:[],cursor:0,bridge_id:'issue-test',products:[{id:'devdeck',name:'DevDeck',repository:'d3velopm3nt/devdeck'}],visibility_warnings:[],workflows:{items:[],warnings:[]},issue_monitor:{enabled:true,sources:[{repository:'d3velopm3nt/devdeck',fetched_at:new Date().toISOString(),items:[{number:33,title:'Documentation smoke test: DevDeck automatic issue intake',state:'open',url:'https://github.com/d3velopm3nt/devdeck/issues/33',assignees:[]}],warnings:[]}],dispatches:[{repository:'d3velopm3nt/devdeck',number:33,status:'blocked',message:'Worker runner is unavailable'}]}};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v))};
 if(url.pathname==='/api/pair')return json({});
 if(url.pathname==='/api/snapshot')return json(snapshot);
 if(url.pathname==='/api/issues/devdeck')return json(snapshot.issue_monitor.sources[0]);
 if(url.pathname==='/api/events')return setTimeout(()=>json({cursor:0,events:[]}),200);
 if(url.pathname.startsWith('/api/'))return json({});
 if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end()}
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(!/^[a-zA-Z0-9._-]+$/.test(name)){res.statusCode=404;return res.end()}
 const file=['voice-input.js','orb-engine.js'].includes(name)?'src/lib/'+name:'mobile/'+name;
 if(!fs.existsSync(file)){res.statusCode=404;return res.end()}
 res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 page.on('pageerror', e=>console.log('PAGE ERROR',e.message)); page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 await page.goto('http://127.0.0.1:'+server.address().port+'/#pair=fixture');

 await page.waitForFunction(()=>document.getElementById('status').textContent==='PC connected');
 await page.locator('nav [data-view=activity]').click(); await page.locator('#issue-project').selectOption('devdeck');
 await page.getByText('Dispatch: blocked · Worker runner is unavailable',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'docs/test-reports/workforce-2026-10-16/issue-mobile-blocked-fixture.png',fullPage:true});
 snapshot.issue_monitor.dispatches[0].status='review';snapshot.issue_monitor.dispatches[0].message='';
 snapshot.workflows.items=[{node:3,id:'issue-test',definition:{title:'Documentation smoke test',ticket_url:'https://github.com/d3velopm3nt/devdeck/issues/33',steps:[{id:'docs',title:'Draft checklist',status:'review',evidence:'Ready for review'}]}}];
 await page.reload();await page.waitForFunction(()=>document.getElementById('status').textContent==='PC connected');await page.locator('nav [data-view=activity]').click(); await page.locator('#issue-project').selectOption('devdeck');
 await page.getByText(/Documentation smoke test · 0\/1 accepted · Draft checklist · review/).waitFor();
 await page.screenshot({path:'docs/test-reports/workforce-2026-10-16/issue-mobile-review-fixture.png',fullPage:true});
 console.log('PASS: mobile blocked dispatch reason, review status, and 390px layout (fixture transport, not a live run)');
}finally{await browser.close();server.close();}
