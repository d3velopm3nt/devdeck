import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'file:///C:/Users/d3vel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/d3vel/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'})
const page=await browser.newPage({viewport:{width:1440,height:960}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
try {
 await page.goto('http://localhost:5204/harness/chat.html')
 await page.getByRole('button',{name:'Split',exact:true}).click()
 await page.getByRole('button',{name:'Progress Follow work item steps, progress and evidence.'}).click()
 await page.getByRole('combobox',{name:'Conversation work item'}).selectOption('workflow-test')
 await page.getByText('Verify the rendered design',{exact:true}).waitFor()
 await page.getByText('Inspecting sidebar layout and keyboard navigation.',{exact:true}).waitFor()
 await mkdir('test-results/chat-workflow',{recursive:true})
 await page.screenshot({path:'test-results/chat-workflow/running.png'})
 await page.getByRole('button',{name:'Hide workspace',exact:true}).click()
 await page.getByRole('button',{name:'Open progress',exact:true}).waitFor()
 await page.screenshot({path:'test-results/chat-workflow/summary.png'})
 await page.reload()
 await page.getByRole('button',{name:'Open progress',exact:true}).click()
 assert.equal(await page.getByRole('combobox',{name:'Conversation work item'}).inputValue(),'workflow-test')
 await page.evaluate(()=>window.finishWorkflow())
 await page.getByText('3/3 steps accepted',{exact:true}).waitFor({timeout:15000})
 await page.getByText('Research discussion',{exact:true}).click()
 assert.equal(await page.getByRole('combobox',{name:'Conversation work item'}).inputValue(),'')
 assert.equal(await page.getByText('Teams navigation review',{exact:true}).count(),0)
 assert.deepEqual(errors,[])
 console.log('PASS: workflow rendering, summary, persistence, live refresh, conversation isolation')
} finally {await browser.close()}
