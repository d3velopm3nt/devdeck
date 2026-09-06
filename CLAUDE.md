# DevDeck — working notes for Claude

A local-first development command center for Windows. Run every service, watch
what's live, track each repo's git state, and jump into any terminal — from one
window or a floating widget.

**Read `ROADMAP.md` first** for what's shipped / designed / next. Design mocks
live in `design/*.html` — open them in a browser, they're clickable.

## Stack

| | |
|---|---|
| Shell | Tauri 2 (Rust backend, WebView2 frontend) |
| Frontend | React 19 · TypeScript · Tailwind **v4** · Vite · zustand · dockview · xterm.js |
| Storage | SQLite (`%APPDATA%\devdeck\devdeck.sqlite`) — no cloud, no telemetry |
| Icons | `lucide-react` via a central registry |

## Architecture

```
src-tauri/src/
  lib.rs       command registration, self-update, window setup
  db.rs        schema + migrations (nodes/commands/services/profiles/settings…)
  pty.rs       ConPTY terminal sessions (persistent, survive UI reloads)
  services.rs  supervised processes + the log bus
  monitor.rs   process/port stats sampling
  git.rs       branch, ahead/behind, fetch, ff-only pull
  machine.rs   winget/scoop package management
  setup.rs     project setup, tool detection, repo clone
  stash.rs     clipboard capture (message-only window), classifier, clip vault
  shots.rs     screenshot watching, Windows OCR, thumbnails
  conn.rs      Connections: runs psql/sqlite3/sqlcmd, parses CSV, query history
  mail.rs      Mail: IMAP sync (rustls), MIME parsing, SMTP send, contacts
  creds.rs     Windows Credential Manager — the only place a password exists
src/
  App.tsx           shell: top bar → rail → sidebar → surface → bottom bar
  shell/Rail.tsx    primary navigation
  store.ts          one zustand store, sliced by concern
  Dock.tsx          dockview — DOCUMENTS ONLY
  lib/icons.tsx     icon registry
  lib/dock.ts       openSpace / openService / openEditor / openTerminalPanel
  components/       views and panels
```

### The shell (do not regress this)

Navigation is **fixed chrome**, not dock panels — this removed a whole class of
layout-corruption bugs:

- **Rail** — Home · Projects · Mail · Stash · Connections · Machine · Settings
- **Sidebar** — contextual; the Explorer tree on Projects, filters on Stash. No tab chrome.
- **Surface** — dockview, hosting **only real documents**: terminals, space pages,
  service pages, project setup, welcome
- **Bottom bar** — Logs / Processes, global across views
- **Sheet** — command/service/profile editors slide over from the right (Esc closes)

`openSpace` / `openService` / `openNodeSetup` all switch `railView` to `projects`
first, so links from Home land somewhere visible.

## Conventions that matter

**Colors — always tokens, never raw.** Everything themes off CSS variables in
`src/index.css` mapped through `@theme inline`. A hardcoded `slate-*` or `#hex`
breaks light mode.

```
surfaces  bg-app · bg-page · bg-panel · bg-raise · bg-menu · bg-hover · bg-soft
borders   border-line · border-line2 · border-line3
text      text-ink · text-body · text-dim · text-muted · text-faint
status    text-ok · text-warn · text-err · text-info · text-viol
```
Alpha-tinted colors (`bg-emerald-500/10`), solid status dots, indigo accents and
solid CTAs are fine as-is — they read on both themes.

**Icons — registry only, no emoji.** `<Icon name="service" size={13} />` from
`src/lib/icons.tsx`. Names are semantic (`service`, `delete`, `update`), so an
icon swap is one line. Note: **lucide-react has no brand icons** — `Github`
doesn't exist, we use `GitBranch`.

**Logs.** Everything streams through the log bus: `services::push_log(app, id,
name, stream, line)`. System streams use negative ids (setup `-300_000`, git
`-400_000`, update `-200_000`).

**Failure honesty.** Never let a failed check look like a success. The update
checker once mapped "couldn't reach the server" to "up to date" and silently hid
releases — an explicit `ok` flag fixed it. Same rule everywhere.

**Secrets.** Credentials belong in Windows Credential Manager / DPAPI, never
plaintext in SQLite. Stash must flag secret-shaped clips and never write their
values to disk.

## Commands

```bash
npm run tauri dev                      # dev app (Vite on 5173 + cargo)
npx tsc -b                             # typecheck — run before committing
cd src-tauri && cargo check            # Rust check
npm run tauri build                    # release build (kill any running devdeck first)
```

## Release process

1. Bump **four** files: `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.lock`
2. Commit `Release vX.Y.Z`, tag `vX.Y.Z`, push both — CI (`release.yml`) builds,
   minisign-signs, generates `latest.json`, publishes
3. Once assets are live: download the installer, SHA256 it, bump
   `bucket/devdeck.json` (version + url + hash), push

The updater reads `releases/latest/download/latest.json` (a CDN URL, not the
rate-limited REST API). `src-tauri/tauri.conf.updater.json` enables signing
artifacts for release builds only, so CI/PR builds don't need the key.
**Never commit `.keys/`** — it holds the private signing key.

## Environment gotchas

- PowerShell 5.1: use `-UseBasicParsing` on `Invoke-WebRequest` or it errors
  non-interactively. No `&&`/`??`/ternary.
- Port **5173** must be free before `tauri dev` — a stale Vite blocks the relaunch.
- **Typecheck with `npx tsc -b`, never `tsc -p tsconfig.json`.** The root
  tsconfig is references-only (`"files": []`), so `-p tsconfig.json` compiles
  nothing and exits 0 no matter what is broken — a green tick that means
  nothing. `tsc -b` (or `-p tsconfig.app.json`) is the real check.
- WinRT (`Windows.Media.Ocr`) needs an MTA in the process and a **plain**
  absolute path — `canonicalize()` returns a `\\?\`-prefixed one that the storage
  APIs reject. Both failures look identical to "this image has no text".
- Adding a Tauri **window** means adding its label to
  `capabilities/default.json`. Until you do, every `invoke`/`listen` from that
  window is silently denied and the window just sits there doing nothing.
- A running `devdeck.exe` locks the binary and fails a release build.
- Screenshotting the app: per-window `PrintWindow` with flag `2`
  (`PW_RENDERFULLCONTENT`) for WebView2; force the window topmost first or
  WebView2 suspends rendering and you capture black.
- This session has no interactive desktop — synthetic clicks/keystrokes don't
  reach the app, and full-screen capture fails. Verify UI by reloading into a
  known state rather than driving it.

## Product context

Goal is a paid product: repo public for discovery, **source-available licence**
(free personal, paid commercial) on future versions, with team-shareable machine
manifests as the paid wedge. Distribution (auto-update, scoop, website download
links) all depend on the GitHub repo being **public** — while it's private, every
install silently loses updates.
