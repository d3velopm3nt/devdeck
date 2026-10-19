import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'file:///C:/Users/d3vel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const b=await chromium.launch({headless:true,executablePath:'C:/Users/d3vel/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const p=await b.newPage({viewport:{width:1400,height:950}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
const dir='test-results/work-completion';await mkdir(dir,{recursive:true});
try{
await p.goto('http://127.0.0.1:5208/harness/work-completion.html');
await p.getByRole('button',{name:'Complete work item',exact:true}).click();
const submit=p.getByRole('button',{name:'Complete and close GitHub issue',exact:true});assert(await submit.isDisabled());
await p.getByLabel('Completion evidence',{exact:true}).fill('Accepted plan satisfies the planning-only request. Build and Verify are outside its scope.');
assert(await submit.isDisabled());await p.getByRole('checkbox').check();assert(!(await submit.isDisabled()));
await p.screenshot({path:dir+'/01-scope-review.png',fullPage:true});await submit.click();
await p.getByText('GitHub closure pending',{exact:true}).waitFor();await p.getByText('Fixture: GitHub unavailable.').waitFor();
await p.screenshot({path:dir+'/02-sync-failure.png',fullPage:true});await p.getByRole('button',{name:'Retry GitHub sync'}).click();
await p.getByText('GitHub issue closed',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Complete work item',exact:true}).count(),0);
const calls=await p.evaluate(()=>window.__completionCalls);assert.equal(calls[0].exclusions.length,2);assert.equal(calls[1].command,'sync');
await p.screenshot({path:dir+'/03-closed.png',fullPage:true});
await p.goto('http://127.0.0.1:5208/harness/work-completion.html?messages');
await p.getByRole('heading',{name:'Plan progress and handoff documentation · Plan'}).waitFor();
await p.getByLabel('Filter messages by task').selectOption('github:owner/devdeck:37');
await p.getByLabel('Filter messages by project').selectOption('3');
assert.equal(await p.getByRole('button',{name:/Reply to/}).count(),0);
await p.getByText('Read agent report',{exact:true}).click();await p.getByText('Accepted planning report. No implementation was performed.').waitFor();
await p.screenshot({path:dir+'/04-factory-messages.png',fullPage:true});await p.setViewportSize({width:480,height:900});
await p.screenshot({path:dir+'/05-messages-narrow.png',fullPage:true});assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
assert.deepEqual(errors,[]);await writeFile(dir+'/assertions.json',JSON.stringify({fixture:true,passed:['explicit scope confirmation','excluded IDs preserved','sync failure visible','retry confirms closure','factory report and task/project filters','no fake reply action','narrow layout'],calls},null,2));console.log('PASS: completion UI, sync retry, Factory report filters, narrow layout. Fixture evidence; live test separate.');
}finally{await b.close()}
