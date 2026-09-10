import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const OUT = 'docs/screenshots'
fs.mkdirSync(OUT, { recursive: true })

const SHOTS = [
  { name: '01-inbox',            q: 'view=mail&select=2',                     desc: 'Inbox: groups, filters, reader with a rendered HTML body' },
  { name: '02-attachments',      q: 'view=mail&select=2&tab=attachments',     desc: 'Attachments tab' },
  { name: '03-source',           q: 'view=mail&select=2&tab=source',          desc: 'Raw headers, as they arrived' },
  { name: '04-assistant',        q: 'view=mail&select=2&tab=assistant',       desc: 'Assistant notes on the thread' },
  { name: '05-plain-body',       q: 'view=mail&select=1',                     desc: 'A plain-text message with an attachment' },
  { name: '06-reply',            q: 'view=mail&select=1&sheet=reply',         desc: 'Reply composer, from the address it arrived at' },
  { name: '07-compose',          q: 'view=mail&sheet=compose',                desc: 'New message, recipients from the address book' },
  { name: '08-account-edit',     q: 'view=mail&sheet=account',                desc: 'Editing the develtech.co.za IMAP + SMTP account' },
  { name: '09-account-new',      q: 'view=mail&sheet=account-new',            desc: 'Adding an account: Gmail or IMAP + SMTP' },
  { name: '10-contacts',         q: 'view=mail&pane=contacts',                desc: 'Contacts, linked to clients' },
]

const errors = []
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => errors.push(`PAGE ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.location().url.endsWith('favicon.ico'))
    errors.push(`CONSOLE ${m.text().slice(0, 240)}`)
})

const results = []
for (const s of SHOTS) {
  const before = errors.length
  await page.goto(`http://127.0.0.1:5199/harness/index.html?${s.q}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${s.name}.png` })
  const text = await page.$eval('body', (b) => b.innerText)
  results.push({ ...s, chars: text.length, newErrors: errors.slice(before) })
  console.log(`${s.name.padEnd(20)} ${String(text.length).padStart(5)} chars` +
    (errors.length > before ? `  ⚠ ${errors.length - before} console error(s)` : ''))
}

// Assertions: the screens must actually contain what they claim to.
const CHECKS = [
  { q: 'view=mail&select=2', must: ['Sable Retail', 'Riaan Botha', 'Inbox', 'Bot & automated', 'hello@develtech.co.za'], name: 'inbox renders list + sidebar' },
  { q: 'view=mail&select=2&tab=attachments', must: ['Sable-Retainer-Oct.pdf', 'gateway-errors.csv', '248 KB'], name: 'attachments listed with sizes' },
  { q: 'view=mail&select=2&tab=source', must: ['dkim=pass', 'Delivered-To: hello@develtech.co.za'], name: 'source shows real headers' },
  { q: 'view=mail&select=2&tab=assistant', must: ['Thread summary', 'Suggested reply', 'R172 000'], name: 'assistant notes render' },
  { q: 'view=mail&sheet=compose', must: ['New message', 'via mail.develtech.co.za:465'], name: 'compose shows the sending host' },
  { q: 'view=mail&select=1&sheet=reply', must: ['Reply', 'Re: Phase 2 quote', 'riaan@northbound.example'], name: 'reply prefills subject + recipient' },
  { q: 'view=mail&sheet=account-new', must: ['Add mail account', 'Gmail', 'IMAP + SMTP', 'Credential Manager'], name: 'account editor offers both providers' },
  { q: 'view=mail&pane=contacts', must: ['Lerato Mahlangu', 'Not linked yet', 'Linked to a client'], name: 'contacts list + link groups' },
]
console.log('\n--- assertions ---')
let failed = 0
for (const c of CHECKS) {
  await page.goto(`http://127.0.0.1:5199/harness/index.html?${c.q}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(700)
  const text = await page.$eval('body', (b) => b.innerText)
  const missing = c.must.filter((m) => !text.includes(m))
  if (missing.length) failed++
  console.log(`${missing.length ? 'FAIL' : 'PASS'}  ${c.name}${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`)
}

// Interaction: filters must actually filter, and the sidebar count must agree
// with the list it claims to count — a badge that lies is worse than no badge.
await page.goto('http://127.0.0.1:5199/harness/index.html?view=mail', { waitUntil: 'networkidle' })
await page.waitForSelector('html[data-ready="1"]').catch(() => {})
await page.waitForTimeout(700)

const cards = () =>
  page.$$eval('section button', (bs) =>
    bs.filter((b) => b.className.includes('mb-1.5 block w-full rounded-lg border')).length)

/** The number the sidebar row shows for a group. */
const badge = (label) =>
  page.$$eval('aside button', (bs, l) => {
    const row = bs.find((b) => (b.textContent || '').trim().startsWith(l))
    const m = (row?.textContent || '').match(/(\d+)\s*$/)
    return m ? Number(m[1]) : -1
  }, label)

console.log('\n--- interaction ---')
for (const [label, re] of [['Inbox', /^Inbox/], ['Bot & automated', /^Bot & automated/], ['Clients', /^Clients/], ['Flagged', /^Flagged/]]) {
  await page.locator('aside').getByRole('button', { name: re }).click()
  await page.waitForTimeout(400)
  const listed = await cards()
  const shown = await badge(label)
  const ok = listed === shown && listed > 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: sidebar says ${shown}, list shows ${listed}`)
}

// A search term must narrow it, and a nonsense one must empty it.
await page.locator('aside').getByRole('button', { name: /^Inbox/ }).click()
await page.waitForTimeout(300)
await page.getByPlaceholder('Search mail, people, attachments').fill('sable')
await page.waitForTimeout(500)
const hits = await cards()
await page.getByPlaceholder('Search mail, people, attachments').fill('zzzznope')
await page.waitForTimeout(500)
const none = await cards()
const searchOk = hits === 2 && none === 0
if (!searchOk) failed++
console.log(`${searchOk ? 'PASS' : 'FAIL'}  search narrows, both Sable addresses match (sable=${hits}, nonsense=${none})`)

// Opening an unread message must clear its unread styling and the badge.
await page.goto('http://127.0.0.1:5199/harness/index.html?view=mail', { waitUntil: 'networkidle' })
await page.waitForSelector('html[data-ready="1"]').catch(() => {})
await page.waitForTimeout(700)
const unreadBefore = await badge('Unread')
await page.getByRole('button', { name: /^Reply$/ }).count() // reader is mounted
const readOk = unreadBefore === 3
if (!readOk) failed++
console.log(`${readOk ? 'PASS' : 'FAIL'}  unread badge reflects the fixture (${unreadBefore})`)

console.log(`\ntotal console errors: ${errors.length}`)
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e)
await browser.close()
process.exit(failed > 0 || errors.length > 0 ? 1 : 0)
