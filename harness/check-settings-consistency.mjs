import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message))
const base=process.env.SETTINGS_HARNESS_URL||'http://127.0.0.1:5220/harness/index.html?view=settings'
const contrast=async()=>page.locator('button[style]').filter({has:page.locator('span.text-ink')}).evaluateAll(cards=>{
 const ctx=document.createElement('canvas').getContext('2d')
 const rgb=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)}
 const lum=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
 const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)
 return cards.map(card=>{const title=card.querySelector('.text-ink'),note=card.querySelector('.text-muted'),background=getComputedStyle(card).backgroundColor;return{name:title.textContent,title:ratio(getComputedStyle(title).color,background),note:ratio(getComputedStyle(note).color,background),selected:card.getAttribute('aria-pressed')}})
})
try{
 await page.goto(base);await page.getByRole('button',{name:'General',exact:true}).waitFor()
 const nav=page.getByRole('button',{name:'General',exact:true}).locator('..')
 for(const name of await nav.locator('button').allTextContents()){
  await nav.getByRole('button',{name:name.trim(),exact:true}).click()
  assert.equal(await page.getByRole('heading',{name:'Mail attachments',exact:true}).count(),name.trim()==='General'?1:0,'attachment scope '+name)
 }
 results.push('Mail attachment controls appear in General only across all 11 Settings sections')
 for(const theme of ['dark','light','claude','vercel','vercel-light','vscode']){
  await nav.getByRole('button',{name:'AI',exact:true}).click();await page.getByText('Choose a provider',{exact:true}).waitFor()
  await page.evaluate(t=>window.__app.getState().setTheme(t),theme);await page.waitForTimeout(250)
  let rows=await contrast();assert(rows.length>=7)
  assert.deepEqual(rows.filter(r=>r.title<4.5||r.note<4.5),[],theme+' provider text contrast')
  const measurements=[...rows]
  for(const card of await page.locator('button[style]').filter({has:page.locator('span.text-ink')}).all()){
   await card.click();assert.equal(await card.getAttribute('aria-pressed'),'true')
   rows=await contrast();assert.deepEqual(rows.filter(r=>r.title<4.5||r.note<4.5),[],theme+' selected provider contrast');measurements.push(...rows)
  }
  await nav.getByRole('button',{name:'General',exact:true}).click();await page.waitForTimeout(200)
  const pairs=await page.evaluate(()=>{
   const st=getComputedStyle(document.documentElement),ctx=document.createElement('canvas').getContext('2d')
   const lum=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)}
   const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)
   const token=n=>st.getPropertyValue('--c-'+n).trim()
   const button=document.querySelector('.btn-primary'),bs=getComputedStyle(button)
   return {muted:['page','panel','raise'].map(surface=>ratio(token('muted'),token(surface))),primary:ratio(bs.color,bs.backgroundColor),accent:ratio(token('accent'),token('page'))}
  })
  assert(pairs.muted.every(r=>r>=4.5),theme+' muted text');assert(pairs.primary>=4.5,theme+' primary button');assert(pairs.accent>=4.5,theme+' accent text')
  results.push({theme,minimumProviderTitle:Math.min(...measurements.map(r=>r.title)),minimumProviderNote:Math.min(...measurements.map(r=>r.note)),...pairs})
 }
 assert.deepEqual(errors,[]);await mkdir('.artifacts/settings-consistency',{recursive:true});await writeFile('.artifacts/settings-consistency/results.json',JSON.stringify({results,errors,mode:'isolated mock IPC; no live accounts'},null,2));console.log(JSON.stringify(results,null,2))
}finally{await browser.close()}
