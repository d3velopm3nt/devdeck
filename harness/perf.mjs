// Log-burst performance check.
//
// Pushes a chatty service's output through the production listeners — one
// batch of 50 lines every 50 ms (1,000 lines/s) plus stats samples — and
// reports frame rate and main-thread long-task time. This is the check that
// found the lag: every line used to re-render the whole shell.
//
//   npx vite --config vite.harness.config.ts &          (serves on 5199)
//   node harness/perf.mjs [--view home|projects] [--batches 80] [--closed]
//                         [--perline] [--port 5199]
//
// --closed keeps the Logs panel collapsed (the cost of the panel itself is the
// difference between the two). --perline sends one `svc:log` event per line,
// the shape the backend emitted before batching, for comparison.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)
const port = arg('port', '5199')
const view = arg('view', 'home')
const batches = Number(arg('batches', '80'))
const closed = flag('closed')
const mode = flag('perline') ? 'perline' : 'batched'

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`http://127.0.0.1:${port}/harness/index.html?view=${view}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const r = await page.evaluate(
  async ({ mode, batches, closed }) => {
    const st = window.__app.getState()
    if (!closed) {
      st.setBottomCollapsed(false)
      st.setBottomTab('logs')
    }
    await new Promise((r) => setTimeout(r, 500))
    let longMs = 0
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longMs += e.duration
    })
    po.observe({ type: 'longtask', buffered: false })
    let frames = 0
    let run = true
    const tick = () => {
      frames++
      if (run) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    let seq = 0
    const line = () => ({
      seq: seq++,
      ts: Date.now(),
      service_id: 1,
      service: 'api',
      stream: 'stdout',
      level: seq % 17 ? 'info' : 'warn',
      line: `GET /api/items/${seq} 200 in ${seq % 90}ms`,
    })
    const stats = [{ kind: 'service', id: 1, pid: 42, cpu: 1.5, mem_mb: 100, ports: [3000] }]
    const t0 = performance.now()
    for (let i = 0; i < batches; i++) {
      const batch = Array.from({ length: 50 }, line)
      if (mode === 'perline') for (const e of batch) await window.__emit('svc:log', e)
      else await window.__emit('svc:logs', batch)
      if (i % 40 === 0) await window.__emit('stats:update', stats.map((s) => ({ ...s })))
      await new Promise((r) => setTimeout(r, 50))
    }
    await new Promise((r) => setTimeout(r, 300))
    run = false
    po.disconnect()
    const secs = (performance.now() - t0) / 1000
    return {
      lines: batches * 50,
      secs: +secs.toFixed(2),
      fps: +(frames / secs).toFixed(1),
      longTaskMs: Math.round(longMs),
      rowsInDom: document.querySelectorAll('[data-index]').length,
    }
  },
  { mode, batches, closed },
)
console.log(JSON.stringify({ mode, view, logsPanel: closed ? 'closed' : 'open', ...r, errors: errors.slice(0, 3) }))
await browser.close()
