import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH}),page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message));const composer=page.getByLabel('Conversation composer',{exact:true});await fs.mkdir('.artifacts/chat-composer-design',{recursive:true})
try {
 await page.goto((process.env.HARNESS_URL||'http://127.0.0.1:5222')+'/harness/chat.html')
 await composer.getByRole('button',{name:'Conversation provider and model',exact:true}).waitFor()
 await composer.locator('textarea').fill('Review the attached notes and suggest the next step.')
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
  for(const width of [1200,390]){
   await page.setViewportSize({width,height:1000})
   if(width===390&&await page.getByRole('button',{name:'Hide conversation details',exact:true}).isVisible())await page.getByRole('button',{name:'Hide conversation details',exact:true}).click()
   if(width===390&&await page.getByRole('button',{name:'Hide conversations',exact:true}).first().isVisible())await page.getByRole('button',{name:'Hide conversations',exact:true}).first().click()
   for(let i=0;i<3;i++){
    const link=composer.getByRole('button',{name:'Link context',exact:true});await link.click();assert.equal(await link.getAttribute('aria-expanded'),'true');await composer.getByLabel('Context link').fill('https://example.org/reference');await composer.getByLabel('Context link').press('Escape');assert.equal(await link.getAttribute('aria-expanded'),'false');assert(await composer.locator('textarea').evaluate(e=>e===document.activeElement))
    const model=composer.getByRole('button',{name:'Conversation provider and model',exact:true});await model.click();await composer.getByRole('region',{name:'Conversation model settings'}).getByRole('button',{name:'Cancel',exact:true}).click();assert(await model.evaluate(e=>e===document.activeElement))
   }
   await composer.locator('summary').focus();await page.keyboard.press('Enter');assert(await composer.locator('details').evaluate(e=>e.open));await page.keyboard.press('Enter');assert.equal(await composer.locator('details').evaluate(e=>e.open),false)
   assert.equal(await composer.locator('textarea').inputValue(),'Review the attached notes and suggest the next step.')
   assert.equal((await page.evaluate(()=>window.__unified.requests.filter(r=>r.input))).length,0)
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   const send=composer.getByRole('button',{name:'Send',exact:true});assert((await send.boundingBox()).width>=32)
   await page.evaluate(()=>document.activeElement?.blur());await composer.screenshot({path:`.artifacts/chat-composer-design/${theme}-${width}.png`})
   results.push(`${theme} ${width}: repeated link/model/help toggles, keyboard focus, draft preserved, no send, no page overflow`)
  }
 }
 await page.setViewportSize({width:1200,height:1000});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await composer.getByRole('button',{name:'Conversation provider and model',exact:true}).click();await composer.screenshot({path:'.artifacts/chat-composer-design/model-settings.png'});await composer.getByRole('region',{name:'Conversation model settings'}).getByRole('button',{name:'Cancel',exact:true}).click();await composer.locator('input[type=file]').first().setInputFiles({name:'design-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Demo design notes')});await composer.screenshot({path:'.artifacts/chat-composer-design/with-context.png'});assert.deepEqual(errors,[]);await fs.writeFile('.artifacts/chat-composer-design/results.json',JSON.stringify({results,errors,evidence:'Rendered real components with fixture IPC. No live inference or accounts.'},null,2));results.forEach(x=>console.log('PASS:',x))
}finally{await browser.close()}
