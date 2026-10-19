// Run alongside the Vite harness server. The snapshot comes from the exact base commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const files=['src/components/workers/BeforeLibraryPanel.tsx','harness/design-systems-before.tsx','harness/design-systems-before.html'];
let browser;
try {
  fs.writeFileSync(files[0],execFileSync('git',['show','196ab0590af76d93e22442225ca00923d5f78911:src/components/workers/LibraryPanel.tsx']));
  fs.writeFileSync(files[1],fs.readFileSync('harness/design-systems.tsx','utf8').replace('workers/LibraryPanel','workers/BeforeLibraryPanel'));
  fs.writeFileSync(files[2],fs.readFileSync('harness/design-systems.html','utf8').replace('design-systems.tsx','design-systems-before.tsx'));
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:5199/harness/design-systems-before.html');
  await page.getByText('Give your next agent a head start',{exact:true}).waitFor();
  fs.mkdirSync('test-results/design-systems',{recursive:true});
  await page.screenshot({path:'test-results/design-systems/before-library.png',fullPage:true});
} finally {
  await browser?.close();
  for(const file of files) fs.rmSync(file,{force:true});
}
