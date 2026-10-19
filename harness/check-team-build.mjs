const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();
 await page.goto('http://localhost:5199/harness/workforce.html');
 await page.evaluate(async()=>{const {SEED}=await import('/harness/seed.ts');window.answers=[];SEED.aiw_team_planner_send=({text})=>{window.answers.push(text);return {reply:JSON.stringify({message:'How large should the team be?',choices:['Small team','Larger team']})}};});
 await page.getByRole('button',{name:'Build Plan your team',exact:true}).click();
 await page.getByLabel('What should this team do?',{exact:true}).fill('Build an app');
 await page.getByRole('button',{name:'Discuss my team',exact:true}).click();
 await page.getByRole('button',{name:'Small team',exact:true}).click();
 await page.getByRole('button',{name:'Other / write my own',exact:true}).click();
 assert(await page.getByLabel('Your reply or additional details').evaluate(e=>e===document.activeElement));
 assert((await page.evaluate(()=>window.answers[1])).includes('Small team'));
 await page.getByLabel('Your reply or additional details').fill('Keep this draft');
 await page.reload();
 await page.getByRole('button',{name:'Build Plan your team',exact:true}).click();
 assert.equal(await page.getByLabel('Your reply or additional details').inputValue(),'Keep this draft');
 assert.equal(await page.getByRole('button',{name:'Small team',exact:true}).count(),1);
 assert.equal(await page.getByText('Build an app',{exact:true}).count(),1);
 await page.getByRole('button',{name:'New discussion',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Small team',exact:true}).count(),0);
 await page.reload();
 await page.getByRole('button',{name:'Build Plan your team',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Small team',exact:true}).count(),0);
 console.log('Choices, draft and discussion restore after reload, and persistent reset passed.');
} finally {await browser.close();}
