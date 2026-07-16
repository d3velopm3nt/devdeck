# Contributing to DevDeck

Thanks for taking the time to help out. DevDeck is a local-first desktop app —
no server, no accounts, no telemetry — and contributions should keep it that way.

## Getting set up

You'll need:

- **Rust** (stable, 1.77.2+) — <https://rustup.rs>
- **Node.js** 20+ and npm
- **Windows** — DevDeck currently targets Windows only (it uses ConPTY for
  terminals and `explorer.exe` for reveal/open actions). Ports to macOS/Linux
  are very welcome; see *Platform support* below.

```bash
npm install
npx tauri dev      # run the app with hot-reloaded frontend
npx tauri build    # produce a release exe + installer
```

Useful checks before you open a PR:

```bash
npx tsc --noEmit   # typecheck the frontend
npm run lint       # oxlint
cargo fmt --check  # from src-tauri/
cargo clippy       # from src-tauri/
```

## Project layout

```
src/              React 19 + TypeScript frontend (Vite, Tailwind 4, Zustand)
  components/     panels & pages (Explorer, Dashboard, editors, …)
  widget/         the always-on-top Command Widget window
  lib/            ipc wrappers, dock controller, tree/space helpers
src-tauri/src/    Rust backend
  db.rs           SQLite persistence (nodes, commands, services, …)
  pty.rs          interactive terminals (portable-pty / ConPTY)
  services.rs     long-running service lifecycle
  monitor.rs      CPU / memory / port sampling
```

The frontend never touches the filesystem or spawns processes directly —
everything goes through a typed `invoke` wrapper in `src/lib/ipc.ts` to a
`#[tauri::command]` in the backend. Please keep that boundary.

## Data model

`Workspace → Project → Folder`, stored in one self-referencing `nodes` table.
A **Project** (a "space" in the UI) is an app/repo root with a base path; a
**Folder** is a location inside it (a relative subpath, or an absolute
override). Commands and services attach to a project or folder and run in that
resolved directory.

Schema changes go in `migrate()` in `db.rs` and **must be idempotent** — it runs
on every launch, against existing user databases.

## Pull requests

- Keep PRs focused; one concern per PR is much easier to review.
- Match the surrounding style. Comments explain *why*, not *what*.
- If you change behavior, say how you verified it (the app is easy to run).
- New dependencies: please mention why in the PR description.

## Reporting bugs

Open an issue with your OS version, what you did, what you expected, and what
happened. Logs help: DevDeck's Logs panel has an export button, and the
database lives at `%APPDATA%\devdeck\devdeck.sqlite` (it may contain your
project paths and commands — scrub anything sensitive before attaching it).

## Platform support

Windows-specific code is currently in `services.rs` (`cmd.exe`, `taskkill`),
`lib.rs` (`explorer.exe`), and `pty.rs`. A cross-platform port would mean
abstracting those behind `#[cfg(...)]` shims. Happy to review that work.

## Code of Conduct

Be decent to each other. Harassment or personal attacks aren't welcome here,
and maintainers may remove comments, commits, or contributors that don't
follow that.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers this project.
