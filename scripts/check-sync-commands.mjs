// A ratchet on commands that run on the UI thread.
//
// A plain `#[tauri::command]` over a sync `fn` is executed on the webview's
// own thread. Anything it does — spawning a process, walking the disk, waiting
// on the database lock, calling a model — is time the window cannot paint,
// answer a click, or run a timer. `#[tauri::command(async)]` over the same
// sync function costs one word and moves it to a worker thread.
//
// This was measured, not assumed. `schedule_run_now` was sync, so pressing
// **Run now** on a manager froze the whole window for as long as the model
// took: five and a half minutes on the night of 28 September. Both *clock*
// paths had spawned a thread for months — the comment beside them says why —
// and the hand path had simply never been given the same treatment. Nothing
// caught it because nothing was counting.
//
// Order-sensitive commands stay sync on purpose and are named below: `pty_write`
// must arrive in the order it was typed, and a thread pool does not promise
// that.
//
// The rest are careful one-at-a-time work — you have to know that a command
// really is safe off-thread — so this does not attempt it. What it does is
// stop the number going back up.
//
//   node scripts/check-sync-commands.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/// Lower this as commands move off the UI thread. Never raise it.
const BASELINE = 254

/// Sync because being in order matters more than being off-thread.
const ON_PURPOSE = new Set(['pty_write'])

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'src')

/** Every .rs under src-tauri/src, so a new module cannot slip past. */
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.rs')) out.push(p)
  }
  return out
}

const hits = []
for (const file of walk(src)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    // The bare attribute only. `#[tauri::command(async)]` is the shape we want.
    if (line.trim() !== '#[tauri::command]') return
    // The function it belongs to, past any attributes in between.
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const m = lines[j].match(/^\s*pub (?:async )?fn (\w+)/)
      if (!m) continue
      // `pub async fn` under a bare attribute is already off-thread.
      if (/\basync fn\b/.test(lines[j])) return
      if (ON_PURPOSE.has(m[1])) return
      hits.push(`${path.relative(process.cwd(), file)}:${j + 1} ${m[1]}`)
      return
    }
  })
}

if (hits.length > BASELINE) {
  console.error(
    `Commands on the UI thread went up: ${hits.length}, baseline ${BASELINE}.\n\n` +
      `A sync \`#[tauri::command]\` runs on the webview's thread, so the window\n` +
      `cannot paint while it works. Use \`#[tauri::command(async)]\` unless the\n` +
      `order of calls matters.\n\n` +
      `New ones:`,
  )
  for (const h of hits.slice(BASELINE)) console.error(`  ${h}`)
  process.exit(1)
}

if (hits.length < BASELINE) {
  console.error(
    `${hits.length} commands on the UI thread, baseline ${BASELINE}. ` +
      `Some were moved off it — lower BASELINE in this file to ${hits.length} so they cannot come back.`,
  )
  process.exit(1)
}

console.log(`${hits.length} commands on the UI thread, at the baseline.`)
