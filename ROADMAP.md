# DevDeck roadmap

Living document — what's shipped, what's designed, what's next. Update it as
things land so we never have to reconstruct state from memory.

**Current version:** 0.2.9 tagged · 0.2.8 last publicly released
**Current branch:** `main` (`shell-redesign` merged and can be deleted)

> ⚠️ **Blocker:** the GitHub repo is currently **private**. That silently breaks
> auto-update for every install, `scoop install/update devdeck`, and the website's
> download links — v0.2.9 is tagged but cannot publish, and the scoop bucket is
> stuck at 0.2.8. Building is unaffected; only distribution is blocked.

---

## Shipped

### Core (earlier)
- [x] Workspace → Project → Folder tree, per-node commands / services / profiles
- [x] Real ConPTY terminals (xterm.js), persistent across UI reloads
- [x] Managed services: start / stop / restart, live status, CPU, memory, ports
- [x] Auto-detect servers started outside DevDeck; adopt them into a space
- [x] Logs & Processes in a collapsible, resizable bottom bar
- [x] Floating Command Widget on a global hotkey
- [x] Machine Setup — winget & scoop, catalog in DB, bundles, manifest export/import
- [x] Project Setup — detect missing tools, install, bootstrap, refresh PATH
- [x] GitHub import — paste a URL, clone, scan, ready to run
- [x] Self-update: scoop path + signed Tauri updater, `latest.json` manifest

### This cycle
- [x] **Lucide icon system** — central registry, semantic names, zero emoji in the app
- [x] **Git branch display** — every project row shows its current branch
- [x] **Git monitoring** — ahead/behind counts, background fetch on a timer,
      one-click `pull --ff-only`, interval + toggle in Settings
- [x] **Shell redesign** — icon rail (Home / Projects / Machine / Settings),
      fixed Explorer sidebar, dockview reduced to documents only
- [x] **Dark + light themes** — CSS-variable tokens, dockview and xterm re-skin live
- [x] **Editor sheets** — command/service/profile editors slide over, Esc closes
- [x] **Home dashboard** — space cards, counters, active sessions, errors,
      recent activity, master log
- [x] **Service page** — live status, config, run history, per-service log tail
- [x] **Update-check honesty** — a failed check no longer reports "up to date";
      re-checks hourly and on window focus
- [x] **Website** — redesign, real screenshots, animated walkthrough

---

## Next up — build order

**Stash before Connections.** Stash is the daily habit-former (you copy things
hundreds of times a day; you open a SQL client occasionally), it's the real
differentiator, it's smaller, and it has no dependency on Connections. The reverse
isn't true — Connections benefits from Stash existing, since SQL clips flow into
it. Build order:

1. **Stash Phase 1** — capture + vault (below)
2. **Stash Phase 2** — widget paste surface + type actions
3. **Connections** — the SQL layer
4. **Stash Phase 3** — screenshots + OCR

### Stash Phase 1 — capture + vault (start here)
- [ ] `stash_items` table + FTS5 virtual table, migration in `db.rs`
- [ ] `stash.rs`: message-only window + `AddClipboardFormatListener`, handle
      `WM_CLIPBOARDUPDATE` on a dedicated thread (event-driven, never poll)
- [ ] Honour password-manager exclusions — skip clips carrying
      `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory`
- [ ] Classifier: json · sql · url · path · jwt · uuid · hex · stacktrace · text
- [ ] Secret heuristic → flag it, persist **metadata only, never the value**
- [ ] Tag each item with the workspace/project active at capture
- [ ] Dedupe consecutive identical clips; skip oversized payloads
- [ ] Rail item + Stash view: sidebar filters, list, detail pane, FTS search

### Stash Phase 2 — make it fast
- [ ] Widget paste surface: `⏎` copy · `⇧⏎` paste · `esc` dismiss
- [ ] Type-driven actions: prettify/minify, decode JWT, save SQL as query,
      search logs for a stacktrace, reveal path, run command, open URL
- [ ] Pin / delete / retention pruning + Settings section

### Stash Phase 3 — screenshots
- [ ] Watch the screenshot folder, store links not copies, thumbnails
- [ ] OCR text into FTS (Windows has built-in OCR)

---

## Designed, not built

Mocks live in `design/`. Open them in a browser; they're clickable.

### Connections — the SQL layer · `design/shell-mock.html#connections`
Rail item. Connections are first-class entities scoped to a workspace/project.

- [ ] Connection entity: engine (Postgres / SQLite / SQL Server), host, database
- [ ] Credentials in Windows Credential Manager / DPAPI — never plaintext in SQLite
- [ ] Live reachable/unreachable status, like services
- [ ] Saved queries nested under their connection + query history
- [ ] Query execution by wrapping the CLIs (`psql`, `sqlite3`, `sqlcmd`) through
      the existing runner; structured results via `--csv`/`--json` output
- [ ] Results grid as a dockview document (sortable, export CSV, copy)
- [ ] Machine Setup offers to install a missing client
- [ ] Query runs emit activity events

### Stash — the context-aware vault · `design/stash-mock.html`
Rail item. One item vault; the clipboard is just a capture source.

- [ ] `stash_items` table + **SQLite FTS5** index over all content
- [ ] **Clipboard capture** via `AddClipboardFormatListener` (event-driven, no polling)
- [ ] **Auto project tag** — every item records the workspace/project active at
      capture time. This is the differentiator; no other clipboard manager has it.
- [ ] **Smart type detection**: json · sql · url · path · jwt · uuid · hex · stacktrace · text
- [ ] **Type-driven actions**: prettify/minify JSON, decode JWT, save SQL as a query,
      search logs for a stacktrace, reveal a path, run a command, open a URL
- [ ] **Secrets guardrail** — key/token/password shapes are flagged and their value
      is *never written to disk*; clipboard content excluded by password managers
      is skipped entirely
- [ ] **Retention** — pinned forever, unpinned pruned after 30 days (configurable)
- [ ] **Widget paste surface** — summon → type → `⏎` copy, `⇧⏎` paste, `esc` dismiss
- [ ] Screenshots: watch the screenshot folder, store *links* not copies, thumbnail
- [ ] Later: OCR screenshot text into FTS (Windows has built-in OCR)

### Widget peek
- [ ] Anything started in the app makes the widget peek — **without stealing focus**
- [ ] Auto-collapse back to the icon once healthy; always pop on a crash
- [ ] Settings toggle for people who want it quiet

### Activity stream
- [ ] One `activity` event stream (service started, query ran, repo pulled, clip
      captured) feeding: Home's feed, the widget, and usage ranking
- [ ] Durable per-run service history (start/stop, duration, exit code) surviving
      restarts — the service page is already shaped to display it

---

## Business / distribution

Decisions from the monetisation conversation.

- [ ] **Repo back to public** — blocks auto-update, scoop, and the website download
      links while private
- [ ] **Licence swap** — MIT → source-available (PolyForm Noncommercial or FSL)
      on future versions. Free for personal use, paid for commercial.
- [ ] **Pricing page** on the website
- [ ] **Licence flow in-app** — Settings → Licence, key validation via Lemon Squeezy
      or Paddle (Merchant of Record handles global VAT), 30-day offline grace
- [ ] **Early-bird lifetime** — $49, first 100 buyers, then standard pricing
- [ ] **v0.3.0 release** — shell + themes + service page + dashboard
- [ ] **Launch**: demo GIF in the README → Show HN → Reddit → winget submission →
      awesome-* list PRs → Product Hunt → dev.to writeup
- [ ] **Team wedge** (the actual revenue bet): shareable machine manifests —
      "onboard a new developer's machine in one click, reproducibly"

---

## Open questions

- Stash paste behaviour: copy-to-clipboard (safe) vs auto-paste into the previous
  app (magical, fiddly on Windows). Recommendation: copy by default, auto-paste
  as an opt-in setting.
- Connections: how much of a SQL editor do we want before it competes with a real
  client? Recommendation: stay a *runner*, not an IDE.
- Widget theming: it's a separate window with bespoke inline CSS, still dark-only.

---

## Known gaps

- Command Widget hasn't been migrated to the icon registry or the theme tokens
- Terminal commands: an old report that commands don't type into the terminal —
  deprioritised, needs reproduction
- No durable run history yet (see Activity stream)
