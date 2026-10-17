import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 await page.goto('http://localhost:5199/docs/test-reports/workforce-2026-10-16/report.html');
 const images=page.locator('img'); await images.first().waitFor(); assert.equal(await images.count(),11);
 for(const img of await images.all()) {await img.scrollIntoViewIfNeeded();await img.evaluate(el=>el.decode());assert(await img.evaluate(el=>el.naturalWidth>0));}
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'docs/test-reports/workforce-2026-10-16/report-preview.png',fullPage:false});
 console.log('PASS: report opens, all eleven evidence images load.');
} finally {await browser.close();}
