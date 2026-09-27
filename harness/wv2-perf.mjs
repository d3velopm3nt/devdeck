// The log-burst check, in WebView2 instead of headless Chromium.
//
// `perf.mjs` pushes lines into a mocked Tauri boundary, which measures the
// frontend but not the thing people run. This drives the real app over the
// WebView2 debugging protocol: a real service prints 1,000 lines a second, the
// real backend batches them, the real listeners take them — and the app is
// driven by pressing its own buttons and calling its own commands, never by
// writing to the database behind its back.
//
//   node harness/wv2-perf.mjs [--secs 4] [--closed] [--idle] [--port 9222]
//
// Remote debugging is off by default, so the app has to be started with it:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
//
// **Frames per second is the wrong instrument here.** This window is capped at
// about 31 fps whether anything is running or not, so a frame count cannot see
// the cost at all — the first version of this script reported 31 fps under
// load and 31 fps idle and read as a pass. What can see it is the browser's own
// cumulative main-thread task time (`Performance.getMetrics` → `TaskDuration`),
// sampled either side of the burst. `--idle` runs the same window with nothing
// going on, and that control is what makes the number mean anything.

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const flag = (n) => process.argv.includes(`--${n}`)
const port = arg('port', '9222')
const secs = Number(arg('secs', '4'))
const closed = flag('closed')
const idle = flag('idle')
const script = arg('script', new URL('./chatty.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const connect = async (t) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    const ex = r.result?.exceptionDetails
    if (ex) throw new Error(ex.exception?.description ?? ex.text ?? JSON.stringify(ex))
    return r.result?.result?.value
  }
  await send('Runtime.enable')
  return { ws, send, evaluate }
}

const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page')
let picked = null
for (const t of pages) {
  const c = await connect(t)
  let isShell = false
  try {
    isShell = await c.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Logs'))`, false)
  } catch (e) { isShell = false }
  if (isShell && !picked) picked = c
  else c.ws.close()
}
if (!picked) { console.error('none of the webviews has the shell in it'); process.exit(1) }
const { ws, send, evaluate } = picked

const setup = await evaluate(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke
  const want = 'node ' + ${JSON.stringify(script)}
  let list = await inv('services_list', {})
  let svc = list.find((s) => s.name === 'chatty (perf)')
  if (svc && svc.command !== want) {
    await inv('service_save', { svc: { ...svc, command: want } })
    svc = (await inv('services_list', {})).find((s) => s.id === svc.id)
  }
  if (!svc) {
    const newId = await inv('service_save', { svc: {
      id: 0, project_id: null, name: 'chatty (perf)', command: want,
      cwd: '', env: '{}', auto_restart: false, health_port: null, shell: '',
    }})
    svc = (await inv('services_list', {})).find((s) => s.id === newId)
  }
  await inv('logs_clear', {})
  return { id: svc.id }
})()`)

// Opening the panel is the Logs tab; collapsing it is the chevron beside the
// tabs — pressing Logs again does nothing, which is why the first attempt at a
// "closed" case silently measured an open one.
const panel = await evaluate(`(async () => {
  const open = () => !!document.querySelector('.cursor-ns-resize')
  const logs = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Logs'))
  const chevron = [...document.querySelectorAll('button')].find((b) => /Collapse panel|Expand panel/.test(b.title || ''))
  if (!logs || !chevron) throw new Error('bottom bar controls not found')
  const wantOpen = ${closed ? 'false' : 'true'}
  logs.click()
  await new Promise((r) => setTimeout(r, 250))
  for (let i = 0; i < 4 && open() !== wantOpen; i++) {
    chevron.click()
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 400))
  return open()
})()`)

await send('Performance.enable', { timeDomain: 'timeTicks' })
const metrics = async () => {
  const r = await send('Performance.getMetrics')
  const m = {}
  for (const x of r.result.metrics) m[x.name] = x.value
  return m
}

// Frames are still counted, but only to show the ceiling — see the header.
await evaluate(`(() => {
  window.__frames = 0
  window.__run = true
  const tick = () => { window.__frames++; if (window.__run) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return true
})()`, false)

const before = await metrics()
const t0 = Date.now()
if (!idle) await evaluate(`window.__TAURI_INTERNALS__.invoke('svc_start', { id: ${setup.id} })`)
await new Promise((r) => setTimeout(r, secs * 1000))
const after = await metrics()
const elapsed = (Date.now() - t0) / 1000

const tail = await evaluate(`(async () => {
  window.__run = false
  const inv = window.__TAURI_INTERNALS__.invoke
  let stopped = true
  try { await inv('svc_stop', { id: ${setup.id} }) } catch (e) { stopped = String(e) }
  const recent = await inv('logs_recent', { limit: 200000 })
  return {
    frames: window.__frames,
    linesHeld: recent.length,
    rowsInDom: document.querySelectorAll('[data-index]').length,
    stopped,
  }
})()`)

const d = (k) => +(((after[k] ?? 0) - (before[k] ?? 0))).toFixed(3)
console.log(JSON.stringify({
  where: 'WebView2',
  case: idle ? 'idle (control)' : 'chatty 1,000 lines/s',
  logsPanel: panel ? 'open' : 'closed',
  secs: +elapsed.toFixed(2),
  lines: tail.linesHeld,
  taskSecs: d('TaskDuration'),
  scriptSecs: d('ScriptDuration'),
  layoutSecs: d('LayoutDuration'),
  styleSecs: d('RecalcStyleDuration'),
  busyPct: +((d('TaskDuration') / elapsed) * 100).toFixed(1),
  fps: +(tail.frames / elapsed).toFixed(1),
  rowsInDom: tail.rowsInDom,
}))
ws.close()
