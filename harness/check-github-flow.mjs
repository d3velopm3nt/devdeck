import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const b=await chromium.launch({channel:'chrome',headless:true});
const p=await b.newPage({viewport:{width:1100,height:760}});
try {
 await p.goto('http://localhost:5199/harness/github.html');
 await p.getByRole('button',{name:/View details for/}).click();
 await p.evaluate(async()=>{const {SEED}=await import(performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/harness/seed.ts')));SEED.issue_monitor_refresh=()=>{throw Error('GitHub is temporarily unavailable')};});
 await p.getByRole('button',{name:'Refresh',exact:true}).click();
 await p.getByRole('alert').filter({hasText:'GitHub is temporarily unavailable'}).waitFor();
 assert.ok(await p.locator('.gh-entry').count());
 await p.evaluate(async()=>{const {SEED}=await import(performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/harness/seed.ts')));SEED.issue_monitor_refresh=()=>SEED.issue_monitor_get();});
 await p.getByRole('button',{name:'Refresh',exact:true}).click();
 await p.waitForFunction(()=>!document.querySelector('.gh-workspace [role="alert"]'));
 await p.getByRole('button',{name:'Connect',exact:true}).click();
 await p.getByLabel('Repository',{exact:true}).fill('not a repo');
 await p.getByRole('button',{name:'Connect repository',exact:true}).click();
 await p.getByText('Error: Enter owner/repository or a GitHub repository URL.').waitFor();
 await p.getByRole('button',{name:'Cancel',exact:true}).click();
 await p.getByRole('button',{name:'Issues',exact:true}).click();
 await p.getByRole('button',{name:'Review work',exact:true}).waitFor();
 console.log('PASS refresh failure keeps saved rows, recovery clears error, repository validation and direct review action');
} finally {await b.close()}
