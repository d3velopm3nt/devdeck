# Contributing to DevDeck

Thanks for taking the time to help out. DevDeck is a local-first desktop app —
no mandatory hosted DevDeck account or cloud backend. Optional connected services
and the desktop-hosted mobile bridge have their own prerequisites and boundaries.

## Getting set up

You'll need:

- **Rust** (current stable; the manifest declares 1.77.2, but that minimum is not the CI toolchain) — <https://rustup.rs>
- **Node.js** 22 and npm (matching CI)
- **Windows** — DevDeck currently targets Windows only (it uses ConPTY for
  terminals and `explorer.exe` for reveal/open actions). Ports to macOS/Linux
  are very welcome; see *Platform support* below.

Also install the MSVC C++ build tools, Windows SDK and WebView2 runtime.
For PR #25 behavior use `feature/folder-workflow-routing`; release installers may differ.

```bash
npm ci
npx tauri dev      # run the app with hot-reloaded frontend
npx tauri build    # produce a release exe + installer
```

Useful checks before opening a PR (from the repository root):

```bash
npx tsc -b
npm run lint
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo test --manifest-path harness/rust-core/Cargo.toml --locked
node --test scripts/voice-input.test.mjs
```

On Windows, stage generated assets and the asker sidecar before native checks:

```bash
npm run mobile:voice
npm run ask
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace --all-targets
npm run tauri build -- --no-bundle
```

`tsc --noEmit` against the root references-only configuration does not check the
app; use `tsc -b`. The pure Rust harness exercises selected production modules
without the native Windows shell. Browser fixtures in `harness/` mock native IPC;
see `.github/workflows/ci.yml` for the complete browser sequence.

`npm run tauri build` also packages the installer under
`src-tauri/target/release/bundle/nsis/`. PR CI builds without packaging; main and
manual CI can upload an installer. Do not equate an artifact with a release.

For documentation changes, follow [the documentation index](docs/README.md),
check relative links and compare navigation/examples against the current source.
Historical reports are evidence for their named revisions, not current setup guides.

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
