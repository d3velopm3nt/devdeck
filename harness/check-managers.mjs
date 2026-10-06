// Real React/store/IPC/event subscriptions; only native IPC and model responses are fixtures.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH may point at a sandbox browser installation.
import fs from 'node:fs'
import path from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const packaged = process.env.CHROMIUM_ARGS_MODULE
  ? (await import(process.env.CHROMIUM_ARGS_MODULE)).default
  : null
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  ...(packaged ? { args: packaged.args } : {}),
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const out = path.resolve('docs/screenshots/manager-teams')
fs.mkdirSync(out, { recursive: true })
const checks = []
const check = (name, ok) => {
  if (!ok) throw new Error(name)
  checks.push(name)
}
const shot = (name) =>
  page.screenshot({ path: path.join(out, name + '.png'), fullPage: false })
try {
  await page.goto(
    'http://127.0.0.1:5199/harness/index.html?view=workers&scenario=managers'
  )
  await page
    .getByRole('heading', { name: 'Your management team', exact: true })
    .waitFor()
  check(
    'community removed from primary navigation',
    (await page
      .locator('nav')
      .getByText('Community', { exact: true })
      .count()) === 0
  )
  await shot('agents-overview-dark')
  await page.getByRole('button', { name: /^Business manager/ }).click()
  await page
    .getByLabel('Manager role', { exact: true })
    .fill('Product delivery manager')
  await page
    .getByRole('button', { name: 'Save responsibilities', exact: true })
    .click()
  await page
    .getByRole('status')
    .getByText('Responsibilities and team saved.')
    .waitFor()
  check(
    'manager responsibility changes saved',
    (await page.getByLabel('Manager role', { exact: true }).inputValue()) ===
      'Product delivery manager'
  )
  await shot('manager-responsibilities-dark')
  await page.getByRole('button', { name: 'Communication', exact: true }).click()
  await page
    .getByRole('heading', {
      name: 'Protect tomorrow’s family time',
      exact: true,
    })
    .waitFor()
  await shot('manager-communication-dark')
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  await page.getByRole('button', { name: 'Review inbox', exact: true }).click()
  await page.getByRole('button', { name: 'Ask manager', exact: true }).click()
  await page
    .getByText('Mock agent: the review can finish by 15:00.', { exact: false })
    .waitFor()
  check(
    'mock manager processes request and sends a reply',
    await page.evaluate(() =>
      window.__managerScenario
        .pending()
        .some(
          (m) => m.kind === 'reply' && m.from === 'business' && m.to === 'life'
        )
    )
  )
  await shot('manager-conversation-dark')
  await page.getByRole('button', { name: /^Life coordinator/ }).click()
  await page.getByRole('button', { name: 'Communication', exact: true }).click()
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  check(
    'acknowledgement closes reply',
    await page.evaluate(() =>
      window.__managerScenario
        .pending()
        .some((m) => m.kind === 'acknowledgement')
    )
  )
  await page.getByLabel('Switch space', { exact: true }).selectOption('103')
  await page
    .getByRole('heading', { name: 'Business managers', exact: true })
    .waitFor()
  check(
    'space switcher filters the manager roster',
    (await page.getByRole('button', { name: /^Life coordinator/ }).count()) ===
      0
  )
  await shot('business-scope-dark')
  await page.getByLabel('Switch space', { exact: true }).selectOption('')
  await page.getByRole('button', { name: 'New manager', exact: true }).click()
  await page.getByLabel('Manager name', { exact: true }).fill('Learning coach')
  await page.getByLabel('Manager space', { exact: true }).selectOption('102')
  await page
    .getByLabel('Role starter', { exact: true })
    .selectOption('personal')
  await page
    .getByRole('button', { name: 'Create manager', exact: true })
    .click()
  await page
    .getByRole('heading', { name: 'Learning coach', exact: true })
    .waitFor()
  check(
    'new personal manager created with responsibilities',
    (await page
      .getByLabel('Responsibilities', { exact: true })
      .inputValue()) !== ''
  )
  await page.getByRole('button', { name: 'Switch theme', exact: true }).click()
  await page.getByRole('button', { name: 'DevDeck light', exact: true }).click()
  check(
    'top-right theme switch updates existing theme',
    (await page.locator('html').getAttribute('data-theme')) === 'light'
  )
  await shot('agents-light')
  await page.setViewportSize({ width: 1100, height: 800 })
  check(
    'no document horizontal overflow at laptop size',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  )
  await shot('agents-laptop-light')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page
    .getByRole('region', { name: 'Life, personal and business spaces' })
    .waitFor()
  await shot('today-light')
  await page.getByLabel('Switch space', { exact: true }).selectOption('103')
  await page.reload()
  await page
    .getByRole('heading', { name: 'Business managers', exact: true })
    .waitFor()
  check(
    'selected space survives a reload',
    (await page.getByLabel('Switch space', { exact: true }).inputValue()) ===
      '103'
  )
  await page
    .locator('nav')
    .getByRole('button', { name: 'Work', exact: true })
    .click()
  await page.getByRole('heading', { name: 'Goals', exact: true }).waitFor()
  check(
    'work view uses the shared space',
    (await page
      .getByText('0 moving · 0 waiting on you · Business', { exact: true })
      .count()) === 1
  )
  await shot('work-space-dark')
  await page
    .locator('nav')
    .getByRole('button', { name: 'Agents', exact: true })
    .click()
  await page.getByRole('button', { name: 'Specialists', exact: true }).click()
  await page.getByText('Builder', { exact: true }).first().waitFor()
  await shot('specialists-dark')
  check('no browser page errors', errors.length === 0)
  fs.writeFileSync(
    path.join(out, 'checks.json'),
    JSON.stringify(
      {
        checks,
        errors,
        boundary:
          'Real React components; Tauri IPC and model outputs mocked. Rust production core tested separately.',
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({ passed: checks.length, checks, errors }, null, 2)
  )
} catch (e) {
  await shot('failure')
  console.error(e)
  console.error(await page.locator('body').innerText())
  process.exitCode = 1
} finally {
  await browser.close()
  process.exit(process.exitCode || 0)
}
