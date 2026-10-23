import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH}),page=await browser.newPage({viewport:{width:1440,height:1000}}),base=process.env.HARNESS_URL||'http://127.0.0.1:5222',results=[],errors=[],dir='.artifacts/page-rollout'
page.on('pageerror',e=>errors.push(e.message));await mkdir(dir,{recursive:true})
const inspect=async(name,heading,size)=>{const header=page.locator('.ds-page-header').filter({has:page.getByRole('heading',{name:heading,exact:true})});await header.waitFor();for(const theme of ['dark','light','claude','vercel','vercel-light','vscode']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);assert.equal(await header.locator('h1,h2').first().evaluate(e=>getComputedStyle(e).fontSize),size);if(theme==='dark'||theme==='light')await page.screenshot({path:`${dir}/${name}-${theme}.png`})}await page.setViewportSize({width:1000,height:900});assert(await header.evaluate(e=>e.scrollWidth<=e.clientWidth+1),name+' narrow header fit');await page.setViewportSize({width:1440,height:1000});results.push(name)}
try{
await page.goto(base+'/harness/desktop-design.html');await inspect('today','Today','24px')
await page.goto(base+'/harness/workforce.html');await inspect('teams','Teams','24px');const teamHeading=page.getByRole('heading',{name:/^Your teams/});await teamHeading.waitFor();assert.equal(await teamHeading.evaluate(e=>getComputedStyle(e).fontSize),'18px');await page.getByRole('button',{name:'Library',exact:true}).click();await inspect('library','Agent Library','24px');assert.equal(await page.getByRole('heading',{name:/^Your library/}).evaluate(e=>getComputedStyle(e).fontSize),'18px')
await page.goto(base+'/harness/visibility.html');await inspect('activity','Activity board','24px');const tabs=page.getByRole('tablist',{name:'Activity views'});await tabs.getByRole('tab',{name:'Timeline',exact:true}).focus();await page.keyboard.press('End');assert.equal(await tabs.getByRole('tab',{name:'GitHub issues',exact:true}).getAttribute('aria-selected'),'true')
await page.goto(base+'/harness/visibility.html?sessions');await inspect('sessions','Sessions','24px')
await page.goto(base+'/harness/index.html?view=settings');for(const[name,title]of [['Notifications','Notifications'],['Deck','Deck settings'],['Routines','Scheduler'],['Setup','Core setup'],['AI','Settings'],['GitHub','GitHub']]){await page.getByRole('button',{name,exact:true}).filter({has:page.locator('svg')}).last().click();await inspect('settings-'+name.toLowerCase(),title,'24px')}
assert.deepEqual(errors,[]);await writeFile(`${dir}/results.json`,JSON.stringify({results,errors,mode:'isolated fixture IPC; no live accounts'},null,2));console.log('PASS '+results.join(', '))
}finally{await browser.close()}


