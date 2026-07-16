<div align="center">

# ❯_ DevDeck

**A local-first development command center for Windows.**

Start your whole stack, watch every service, and jump into any terminal —
from one window, or a floating widget you summon with a hotkey.

[![CI](https://github.com/__OWNER__/__REPO__/actions/workflows/ci.yml/badge.svg)](https://github.com/__OWNER__/__REPO__/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)
[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/__BMC__)

</div>

---

## What it is

If you work in a monorepo or juggle several apps at once, starting your day
means opening six terminals and remembering six commands. DevDeck turns that
into one click.

It's a small desktop app: a Rust/Tauri backend with a React frontend, and
everything lives in a local SQLite file. **No accounts, no server, no
telemetry** — it never phones home.

## Features

- **Spaces** — organize work as `Workspace → Project → Folder`. A project is an
  app/repo root with a base path; folders are locations inside it. Commands,
  services, and terminals all run in the right directory automatically.
- **Services** — define long-running processes (dev servers, workers) once, then
  start / stop / restart them with live status, CPU, memory, uptime and ports.
  Give one a port and DevDeck adds one-click **open in browser**.
- **Interactive terminals** — real PTYs (ConPTY) rendered with xterm.js, docked
  as tabs. Sessions live in the backend, so they survive UI reloads.
- **Dashboard** — your workspaces and most-used spaces as a launcher, plus
  summary counters, active sessions, and a live errors/warnings feed.
- **Command Widget** — an always-on-top floating window (global hotkey) that
  collapses to a small icon. Run anything without leaving your editor.
- **Dockable layout** — drag, split, tab, float and resize any panel; layouts
  autosave and restore.
- **Launch profiles** — boot a whole stack (services + terminals + layout) in
  one action.

## Install

Grab the latest `DevDeck_x.y.z_x64-setup.exe` from
[Releases](https://github.com/__OWNER__/__REPO__/releases), or build it yourself.

## Build from source

Requires [Rust](https://rustup.rs) (1.77.2+) and Node.js 20+.

```bash
git clone https://github.com/__OWNER__/__REPO__.git
cd __REPO__
npm install
npx tauri dev      # run in development
npx tauri build    # release exe + installer in src-tauri/target/release
```

## Usage

| Action | How |
|---|---|
| Summon the floating widget | `Ctrl+Shift+Space` (configurable in Settings) |
| Add a project | Explorer → right-click a workspace → **New project**, pick its repo root |
| Add a service | Right-click a project → **New service** (e.g. `pnpm dev:web`, port `3000`) |
| Start everything | Dashboard → click a space → **▶ Start all** |
| Open a running app | Click its port, or the 🌐 button, anywhere it appears |
| Open a terminal there | Right-click any project/folder → **Open terminal here** |

Your data lives in `%APPDATA%\devdeck\devdeck.sqlite`. Back it up, or delete it
to start fresh.

## Architecture

```
src/              React 19 + TypeScript (Vite, Tailwind 4, Zustand, dockview)
  components/     panels & pages
  widget/         the always-on-top Command Widget window
  lib/            typed IPC, dock controller, tree/space helpers
src-tauri/src/    Rust backend
  db.rs           SQLite (rusqlite) — nodes, commands, services, profiles
  pty.rs          interactive terminals (portable-pty / ConPTY)
  services.rs     service lifecycle & log capture
  monitor.rs      CPU / memory / port sampling (sysinfo + netstat)
```

The frontend never spawns a process or touches the filesystem directly —
everything goes through typed Tauri commands. The `nodes` table is a
self-referencing tree, so new node kinds need no schema migration.

## Platform support

Windows only, for now. The Windows-specific bits are isolated (ConPTY,
`cmd.exe`, `taskkill`, `explorer.exe`), and a macOS/Linux port is a very welcome
contribution.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
project layout, and the data model.

## Support

DevDeck is free and MIT-licensed. If it saves you time, you can
[buy me a coffee](https://www.buymeacoffee.com/__BMC__) ☕ — appreciated, never
expected.

## License

[MIT](LICENSE) © Develtech
