import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
try {
 await page.goto(process.env.CHAT_HARNESS_URL||'http://127.0.0.1:5220/harness/chat.html')
 await page.getByPlaceholder(/Ask the assistant/).fill('Unsaved conversation draft')
 await page.getByRole('button',{name:'Split',exact:true}).click()
 for(const name of ['Browser A place for websites and previews.','Files A place to explore project files.','Canvas A place for documents and visual work.']) {
  if(await page.getByRole('button',{name:'New workspace tab',exact:true}).isVisible()) await page.getByRole('button',{name:'New workspace tab',exact:true}).click()
  await page.getByRole('button',{name,exact:true}).click()
 }
 await page.getByRole('button',{name:'Close Browser tab',exact:true}).click()
 assert.equal(await page.getByRole('tab',{name:'Browser',exact:true}).count(),0)
 assert.equal(await page.getByRole('tab',{name:'Canvas',exact:true}).getAttribute('aria-selected'),'true')
 await page.getByRole('tab',{name:'Files',exact:true}).click();await page.keyboard.press('Delete')
 assert.equal(await page.getByRole('tab',{name:'Files',exact:true}).count(),0)
 assert.equal(await page.getByRole('tab',{name:'Canvas',exact:true}).getAttribute('aria-selected'),'true')
 await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='tab'&&document.activeElement?.textContent==='Canvas')
 assert(await page.getByRole('tab',{name:'Canvas',exact:true}).evaluate(e=>e===document.activeElement))
 await mkdir('.artifacts/chat-tabs',{recursive:true});await page.screenshot({path:'.artifacts/chat-tabs/per-tab-close.png'})
 await page.getByRole('button',{name:'Close Canvas tab',exact:true}).click()
 await page.getByRole('button',{name:'Close New tab tab',exact:true}).click()
 assert.equal(await page.getByRole('tab',{name:'New tab',exact:true}).count(),1)
 assert.equal(await page.getByPlaceholder(/Ask the assistant/).inputValue(),'Unsaved conversation draft')
 await page.reload();await page.getByRole('tab',{name:'New tab',exact:true}).waitFor()
 assert.equal(await page.getByRole('tab').count(),1)
 assert.deepEqual(errors,[])
 console.log('PASS: per-tab close, inactive close preserves active tab, Delete closes focused tab, adjacent selection, last-tab fallback, draft retention, reload, no runtime errors')
}finally{await browser.close()}
