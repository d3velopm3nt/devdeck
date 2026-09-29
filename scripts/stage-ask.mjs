// Build `devdeck-ask` and stage it where Tauri's bundler expects a sidecar.
//
// The asker is the process a worker's CLI spawns to ask whether it may do
// something. In development `cargo` puts it next to `devdeck.exe` in
// `target/debug`, which is where `asks::asker()` looks — but a *bundle* gets
// only what Tauri is told to carry, so an installed copy had no asker at all
// and every run silently fell back to "nobody to ask". That is the half of L9
// this closes.
//
// Tauri sidecars are named with the host target triple and stripped of it on
// install, so the file has to be copied to
// `src-tauri/binaries/devdeck-ask-<triple>.exe` before `tauri build` runs.
//
//   node scripts/stage-ask.mjs            # debug
//   node scripts/stage-ask.mjs --release
//
// It is wired into `npm run ask` and `npm run ask:release`, so both `tauri dev`
// and `tauri build` get it without anybody remembering to.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauri = path.join(root, 'src-tauri')
const release = process.argv.includes('--release')

// The triple has to come from the toolchain rather than be assumed: a machine
// on `-gnu` instead of `-msvc` would otherwise get a file Tauri never finds,
// and the failure would be a missing asker at run time rather than a build
// error anyone could read.
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  .split('\n')
  .find((l) => l.startsWith('host:'))
  ?.slice('host:'.length)
  .trim()

if (!triple) {
  console.error('stage-ask: could not read the host triple from `rustc -vV`')
  process.exit(1)
}

const args = ['build', '-p', 'devdeck-ask', '--manifest-path', path.join(tauri, 'Cargo.toml')]
if (release) args.push('--release')
execFileSync('cargo', args, { stdio: 'inherit' })

const exe = process.platform === 'win32' ? '.exe' : ''
const built = path.join(tauri, 'target', release ? 'release' : 'debug', `devdeck-ask${exe}`)
if (!fs.existsSync(built)) {
  console.error(`stage-ask: cargo said it built, but ${built} is not there`)
  process.exit(1)
}

const dest = path.join(tauri, 'binaries', `devdeck-ask-${triple}${exe}`)
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.copyFileSync(built, dest)
console.log(`stage-ask: ${path.relative(root, dest)}`)
