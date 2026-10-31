import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const browser = await chromium.launch({headless:true})
const page = await browser.newPage({viewport:{width:1440,height:1000}})
page.setDefaultTimeout(60_000)
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
try {
  await page.goto((process.env.HARNESS_URL || 'http://127.0.0.1:5217')+'/harness/external-services.html')
  await page.getByText('Started outside DevDeck.',{exact:false}).waitFor()
  await page.getByText(/^up \d{1,2}s$/).waitFor()
  const row=page.getByRole('row').filter({hasText:'Outside worker'})
  assert.match(await row.innerText(),/running externally/i)
  assert.match(await row.innerText(),/42123/)
  assert.match(await row.innerText(),/2.5/)
  assert.match(await row.innerText(),/43127/)
  assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),2)
  for(const button of await page.getByRole('button',{name:/^(Stop|Restart)$/}).all()) assert.equal(await button.isDisabled(),true)
  fs.mkdirSync('docs/test-reports/external-services-2026-10-31',{recursive:true})
  await page.screenshot({path:'docs/test-reports/external-services-2026-10-31/running.png',fullPage:true})
  await page.evaluate(()=>window.externalStopped())
  await page.getByRole('button',{name:'Start',exact:true}).first().waitFor()
  assert.match(await row.innerText(),/stopped/i)
  assert.equal(await page.getByText('Started outside DevDeck.',{exact:false}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Start',exact:true}).count(),2)
  for(const button of await page.getByRole('button',{name:'Start',exact:true}).all()) assert.equal(await button.isEnabled(),true)
  assert.deepEqual(errors,[])
  await page.screenshot({path:'docs/test-reports/external-services-2026-10-31/stopped.png',fullPage:true})
  console.log('PASS: external service status, live stats, controls disabled, exit event restores Start, no browser errors')
} finally { await browser.close() }
