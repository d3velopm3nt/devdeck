import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5199/harness/desktop-design.html');await page.getByRole('heading',{name:'Today',exact:true}).waitFor();await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
 await mkdir('docs/test-reports/design-2026-10-17',{recursive:true});await page.screenshot({path:'docs/test-reports/design-2026-10-17/today.png'});
 await page.getByRole('group',{name:'Activity source'}).getByRole('button',{name:'Mail',exact:true}).click();await page.locator('.today-activity').getByRole('button',{name:/3 unread messages/}).waitFor();
 await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
 await page.getByRole('button',{name:/All activity/}).click();await page.getByRole('switch',{name:/Scheduled quiet hours/}).check();await page.getByLabel('From',{exact:true}).fill('21:30');await page.getByRole('button',{name:'Save changes'}).click();await page.getByText('Notification preferences saved.').waitFor();
 if(JSON.parse(await page.evaluate(()=>localStorage.getItem('deck.settings'))).quietFrom!=='21:30')throw Error('Save failed');
 await page.getByLabel('Alert type').selectOption('blocker');await page.getByRole('button',{name:'Send test in 5 seconds'}).click();if((await page.evaluate(()=>window.lastTest)).kind!=='blocker')throw Error('Test category lost');
 await page.locator('.notification-settings').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'docs/test-reports/design-2026-10-17/notifications.png'});
 await page.reload();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('switch',{name:/Scheduled quiet hours/}).waitFor();if(!await page.getByRole('switch',{name:/Scheduled quiet hours/}).isChecked())throw Error('Preferences not restored');
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'docs/test-reports/design-2026-10-17/notifications-light.png'});
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:'docs/test-reports/design-2026-10-17/notifications-narrow.png'});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS: dashboard source filter, settings save/reload, category test, light and narrow layout; no page errors');
}finally{await browser.close()}
