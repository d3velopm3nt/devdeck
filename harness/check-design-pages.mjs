import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true})
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(45000)
const errors=[];page.on('pageerror',e=>errors.push(e.message))
try {
 for(const [view,label] of [['calendar','Calendar view'],['analytics','Analytics period'],['community','Community views'],['machine','Machine setup'],['team','Work views']]) {
  await page.goto('http://localhost:5199/harness/index.html?view='+view)
  const group=page.getByRole('group',{name:label,exact:true});await group.waitFor()
  const buttons=group.getByRole('button');await buttons.nth(1).click();assert.equal(await buttons.nth(1).getAttribute('aria-pressed'),'true')
  await page.screenshot({path:'test-results/design-system/'+view+'.png'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,view+' overflow')
  console.log('PASS: '+view+' view switching and layout')
 }
 assert.deepEqual(errors,[])
} catch(e){console.error(errors);await page.screenshot({path:'test-results/design-system/pages-failure.png'});throw e}
finally {await browser.close()}
