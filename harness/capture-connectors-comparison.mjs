import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert(process.argv[2], 'Pass the downloaded reference PNG path');
const url=path=>`data:image/png;base64,${fs.readFileSync(path).toString('base64')}`;
const out='.artifacts/connectors-visual';
const reference=url(process.argv[2]);
const desktop=url(`${out}/01-desktop.png`);
const narrow=url(`${out}/03-narrow.png`);
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1100},deviceScaleFactor:1});
  await page.setContent(`<html><head><style>
    body{margin:0;padding:24px;background:#10131b;color:#e2e8f0;font:14px system-ui}
    main{display:grid;grid-template-columns:669px 669px 282px;gap:16px}
    h1{margin:0 0 7px;font-size:21px}p{margin:0 0 22px;color:#a3aec4;font-size:12px}
    h2{font-size:13px;font-weight:500;margin:0 0 12px}img{display:block}
    .reference{width:669px;height:580px;overflow:hidden;background:#0d1017;position:relative}
    .reference img{width:793px;max-width:none;position:absolute;left:-124px}
    .desktop{width:669px}.narrow{width:282px}
    section{min-width:0}
  </style></head><body><h1>Connectors visual comparison</h1><p>Reference concept content area, rendered desktop and responsive narrow layout. Rendered accounts and service responses are fixtures.</p><main>
    <section><h2>Reference concept - shell cropped for content comparison</h2><div class="reference"><img src="${reference}"></div></section>
    <section><h2>Rendered desktop - actual React catalogue</h2><img class="desktop" src="${desktop}"></section>
    <section><h2>Rendered narrow - 390 px viewport</h2><img class="narrow" src="${narrow}"></section>
    </main></body></html>`);
  await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
  await page.screenshot({path:`${out}/06-reference-comparison.png`,fullPage:true});
  console.log('Reference, desktop and narrow comparison captured.');
} finally {await browser.close();}
