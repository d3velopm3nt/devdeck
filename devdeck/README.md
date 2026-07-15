# DevDeck — Local Development Command Center

The first app you open each day: manage every local project, terminal,
service, and log from one dockable, IDE-grade desktop workspace.
Entirely local — Rust + Tauri 2 + React 19 + TypeScript + Tailwind 4 +
Zustand + SQLite. No cloud, no accounts, no telemetry.

## Features

- **Workspace hierarchy** — Workspace → Space → Folder → Project. Each
  project maps to a local directory and owns its commands, services,
  profiles, and terminals.
- **Interactive terminals** — real ConPTY sessions (PowerShell 7,
  PowerShell, CMD, Git Bash, WSL, any configured shell) rendered with
  xterm.js. Sessions live in the backend: they survive UI reloads, keep
  scrollback, and re-attach automatically. Open as many as you need;
  dock, split, tab, or float them.
- **Saved commands** — grouped per project (plus globals, including
  everything imported from the original term-widget launcher). Run each
  in a **new terminal**, an **existing terminal**, or as a
  **background process** captured in the log viewer.
- **Service manager** — long-running dev processes (APIs, frontends,
  workers) with start / stop / restart, whole-process-tree termination,
  optional auto-restart on crash, and status events.
- **Process dashboard** — live CPU, memory, PID, uptime, listening
  ports, process count, and health for every managed service and
  terminal (aggregated over the full process tree, refreshed every 2s).
- **Central log viewer** — stdout/stderr from every service and
  background run, with severity detection (error / warn / info /
  debug), source filter, text search, follow mode, clear, and export
  to file.
- **Dockable layouts** — dockview-powered workspace: drag, split, tab,
  float, resize any panel. The layout autosaves and restores; named
  layouts can be saved and recalled.
- **Launch profiles** — one click starts services, runs command
  sequences, opens terminals, and restores a layout: a complete dev
  environment.
- **Global hotkey** — summon/hide DevDeck from anywhere (default
  `ctrl+shift+Space`, carried over from term-widget).

## Development

```
cd devdeck
npm install
npx tauri dev        # dev app with hot reload
npx tauri build      # produces the installer/exe
```

Data lives in `%APPDATA%\devdeck\devdeck.sqlite`.

## Architecture

Modular and event-driven on both sides of the IPC boundary:

```
src-tauri/src/
  lib.rs       assembly: plugins, managed state, command registry
  db.rs        SQLite: nodes tree, commands, services, profiles, layouts, settings
  pty.rs       PTY sessions (ConPTY) → `pty:output`, `pty:exit` events
  services.rs  service lifecycle + log bus → `svc:status`, `svc:log`
  monitor.rs   stats sampler → `stats:update` (CPU/mem/uptime/ports)
  legacy.rs    term-widget import + shell detection

src/
  lib/ipc.ts     typed command + event surface (single source of truth)
  lib/dock.ts    dockview singleton (open/focus panels, layouts)
  lib/runner.ts  execution strategies + profile launcher
  lib/termBus.ts pty output routing (bypasses React re-renders)
  store.ts       Zustand store, sliced by concern
  Dock.tsx       panel registry + default layout
  components/    one panel per file
```

Extending it (plugins, AI, Git tooling, project auto-discovery, Docker,
SSH, workflow automation) means: add a backend module with its own
commands/events, register it in `lib.rs`, add a typed wrapper in
`ipc.ts`, and drop a new panel component into the dock registry —
no existing module changes required.

The `nodes` table is a self-referencing tree, so new node kinds (e.g.
auto-discovered repos, remote hosts) need no schema migration; the
`settings` table is a key-value store for the same reason.
