import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH}),page=await browser.newPage({viewport:{width:1440,height:1000}})
const base=process.env.HARNESS_URL||'http://127.0.0.1:5220',dir='.artifacts/page-consistency',results=[],errors=[]
page.on('pageerror',e=>errors.push(e.message));await mkdir(dir,{recursive:true})
try{
 for(const [name,path,title] of [['inbox','index.html?view=inbox','Needs you'],['work','work-page.html','Work'],['connectors','connectors.html','Connectors'],['settings','index.html?view=settings','General']]){
  await page.goto(`${base}/harness/${path}`)
  if(name==='settings')await page.getByRole('button',{name:'General',exact:true}).click()
  const header=page.locator('.ds-page-header').filter({has:page.getByRole('heading',{name:title,exact:true})});await header.waitFor()
  for(const theme of ['dark','light','claude','vercel','vercel-light','vscode']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(300)
   const sizes=await header.evaluate(e=>({title:getComputedStyle(e.querySelector('h1,h2')).fontSize,gap:getComputedStyle(e).gap,description:getComputedStyle(e.querySelector('.ds-heading-description')).fontSize}))
   assert.equal(sizes.title,name==='settings'?'18px':name==='connectors'?'28px':'24px');assert.equal(sizes.description,'12px')
   if(theme==='dark'||theme==='light')await page.screenshot({path:`${dir}/${name}-${theme}.png`})
  }
  if(name==='connectors'){
   const tabs=page.getByRole('tablist',{name:'Integration views'});await tabs.getByRole('tab',{name:'All integrations',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await tabs.getByRole('tab',{name:'Connected',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await tabs.getByRole('tab',{name:'Explore',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await tabs.getByRole('tab',{name:'All integrations',exact:true}).getAttribute('aria-selected'),'true')
   const custom=page.getByRole('button',{name:'Custom connector',exact:true});await custom.focus();assert.equal(await custom.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await custom.click();await page.getByRole('dialog',{name:'MCP & local tools details'}).waitFor();await page.getByRole('button',{name:'Close connector details',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0)
  }
  await page.setViewportSize({width:760,height:900});await page.screenshot({path:`${dir}/${name}-narrow.png`});const bounds=await header.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,scroll:e.scrollWidth,client:e.clientWidth}});assert(bounds.right<=bounds.viewport+1&&bounds.left>=-1,name+' header viewport');assert(bounds.scroll<=bounds.client+1,name+' header overflow');await page.setViewportSize({width:1440,height:1000});results.push(name+': six-theme typography, light/dark captures and narrow header fit')
 }
 const touch=await browser.newContext({hasTouch:true,viewport:{width:760,height:900}});const touchPage=await touch.newPage();await touchPage.goto(base+'/harness/connectors.html');const touchAction=touchPage.getByRole('button',{name:'Custom connector',exact:true});await touchAction.waitFor();assert(await touchAction.evaluate(e=>e.getBoundingClientRect().height)>=44,'Touch action target');await touch.close();results.push('Coarse-pointer action target is at least 44px');
 assert.deepEqual(errors,[]);await writeFile(`${dir}/results.json`,JSON.stringify({results,errors,evidence:'real React components against mocked IPC; no live accounts'},null,2));console.log(results.join('\n'))
}finally{await browser.close()}

