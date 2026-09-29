// A ratchet on whole-store subscriptions.
//
// `useApp()` with no selector re-renders its component on *every* write to the
// store. Most of the shell did that, which is why a chatty service used to make
// the whole app feel like it was dying: each log line touched the store and
// about sixty components re-rendered. The high-frequency feeds were moved to
// `liveStore` and the root `App` was given selectors, and that is what took the
// 4,000-line burst from "did not finish in ten minutes" to a fifth of one core.
//
// The rest are still there. Converting them is careful per-file work — you have
// to know which fields a component actually reads — and it wants review rather
// than a bulk edit, so this does not attempt it. What it does is stop the number
// going back up: a new `useApp()` with no selector fails the check, and the
// baseline only ever comes down.
//
// `oxlint` has no `no-restricted-syntax`, so this is a script rather than a
// lint rule. It is the same bargain either way.
//
//   node scripts/check-store-selectors.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/// Lower this when you convert some. Never raise it.
const BASELINE = 25

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** Every .ts/.tsx under src, so a new file cannot slip past. */
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const hits = []
for (const file of walk(src)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    // `useApp()` called with nothing between the brackets. `useApp((s) => …)`
    // is the shape we want and is left alone.
    if (/\buseApp\(\s*\)/.test(line)) {
      hits.push(`${path.relative(process.cwd(), file)}:${i + 1}`)
    }
  })
}

if (hits.length > BASELINE) {
  console.error(
    `Whole-store subscriptions went up: ${hits.length}, baseline ${BASELINE}.\n\n` +
      `\`useApp()\` with no selector re-renders on every write to the store.\n` +
      `Read the fields you need instead: \`useApp((s) => s.field)\`.\n\n` +
      `New ones:`,
  )
  for (const h of hits.slice(BASELINE)) console.error(`  ${h}`)
  process.exit(1)
}

if (hits.length < BASELINE) {
  console.error(
    `${hits.length} whole-store subscriptions, baseline ${BASELINE}. ` +
      `Some were converted — lower BASELINE in this file to ${hits.length} so they cannot come back.`,
  )
  process.exit(1)
}

console.log(`${hits.length} whole-store subscriptions, at the baseline.`)
