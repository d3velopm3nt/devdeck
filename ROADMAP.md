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
- [x] **Stash Phase 1** — event-driven clipboard capture, classifier, secret
      guardrail, auto project tag, and the vault view (rail → sidebar → list +
      detail, FTS5 search)

---

## Next up — build order

**Stash before Connections.** Stash is the daily habit-former (you copy things
hundreds of times a day; you open a SQL client occasionally), it's the real
differentiator, it's smaller, and it has no dependency on Connections. The reverse
isn't true — Connections benefits from Stash existing, since SQL clips flow into
it. Build order:

1. ~~**Stash Phase 1** — capture + vault~~ ✅
2. ~~**Stash Phase 2** — widget paste surface + type actions~~ ✅
3. ~~**Connections** — the SQL layer~~ ✅
4. ~~**Stash Phase 3** — screenshots + OCR~~ ✅

Remaining: Widget peek · Activity stream · business/distribution.

### Stash Phase 1 — capture + vault ✅ built
- [x] `stash_items` table + FTS5 virtual table, migration in `db.rs`
- [x] `stash.rs`: message-only window + `AddClipboardFormatListener`, handle
      `WM_CLIPBOARDUPDATE` on a dedicated thread (event-driven, never poll)
- [x] Honour password-manager exclusions — skip clips carrying
      `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory`
- [x] Classifier: json · sql · url · path · jwt · uuid · hex · stacktrace · text
- [x] Secret heuristic → flag it, persist **metadata only, never the value**
- [x] Tag each item with the workspace/project active at capture
- [x] Dedupe consecutive identical clips; skip oversized payloads
- [x] Rail item + Stash view: sidebar filters, list, detail pane, FTS search
- [x] Edit a clip's name and text; a note field on every item, indexed for search
- [x] Standalone notes (`kind = 'note'`) — items you write, that never touched
      the clipboard
- [x] User tags: many per item, created as you type, comma-separates several at
      once, sidebar filter, pruned when the last item drops them. Search matches
      tag names too.

Notes for whoever picks up Phase 2:
- Search says which search it is — `full-text · FTS5` vs `substring search` — so a
  SQLite without FTS5 can never masquerade as full-text that found nothing.
- Copy arms an echo guard (`stash_mark_used`) *before* writing the clipboard, so
  copying a clip back out doesn't stash it again.
- The capture pill in the search bar pauses/resumes capture (`stash_capture`).
- The frontend pushes the active project via `stash_set_context` from `App.tsx`
  only — the widget window runs its own store and would otherwise fight it.
- The secret guardrail applies to **hand-edits too**: `stash_update` and
  `stash_create_note` reject secret-shaped content and return the reason for the
  UI to show. "Never writes a secret to disk" has no exceptions, or it isn't a
  promise. A false positive is recoverable — edit the clip and save a value that
  doesn't trip the heuristic, which clears the flag.
- `STASH_FTS_VERSION` in `db.rs` gates a drop-and-rebuild of the FTS index.
  Bump it whenever the indexed columns change; `CREATE VIRTUAL TABLE IF NOT
  EXISTS` will not reshape an existing one, and a stale index returns wrong
  results rather than erroring.

### Stash Phase 2 — make it fast
- [x] Widget paste surface: a `stash` filter in the widget's search — `↑↓`
      navigate · `⏎` copy · `⇧⏎` paste · `esc` dismiss
- [x] **Capture toast** — a third window (`toast`) that appears bottom-right
      when a clip lands, with *Configure* for name / tags / note. Shown via
      `SW_SHOWNOACTIVATE` so it never steals focus mid-keystroke.
- [x] Clipboard writes moved to Rust (`stash_copy`) — the webview's clipboard
      API needs a focused document, and the widget deliberately has none
- [x] Auto-paste as an opt-in setting; `⇧⏎` forces it for one paste
- [x] Settings → Stash: capture · toast · auto-paste
- [x] Pin / delete — landed with Phase 1 (the sidebar needs the Pinned filter)
- [x] Type-driven actions, in the detail pane, only ever shown for types they
      apply to: **json** prettify / minify · **jwt** decode (header, claims,
      expiry — displayed only) · **url** open · **path** reveal in Explorer ·
      **stacktrace** search the logs · **text** send to terminal
- [ ] **SQL → save as query** — deferred on purpose: saved queries belong to
      Connections, and there's no `queries` table yet. Building one here would
      front-run that design. Pick it up with Connections.
- [x] Retention pruning + its Settings row — a day count (0 = forever), an
      *Apply* that prunes immediately and reports how many went, and a
      *Prune now*. Runs at startup and, for an app left open, at most hourly
      off the capture path (no timer thread for one DELETE).

**Retention exempts anything you signalled you care about** — pinned, tagged,
carrying a note, or written as a note — regardless of age. A vault that quietly
eats something you tagged is worse than one that keeps too much, so the
exemptions are the point, not a detail. Two tests pin it in both directions.

More notes:
- *Send to terminal* types the command in but does **not** press Enter. A stash
  is full of text copied from places you didn't write; one click should not run
  it. The tooltip says so.
- *Prettify / minify* rewrite the clip through `stash_update`, so they re-derive
  preview/size/hash and pass the same secret guardrail as any other edit.
- Decoding a JWT is display-only. It's still a bearer credential — we store the
  token because the roadmap calls for it, but nothing decoded is persisted.
- **The JWT type and the secret guardrail collided.** The entropy fallback in
  `secret_reason` was swallowing every JWT before `classify` ever saw one, so
  `item_type` was `text`, no value was stored, and the decode action could
  never appear — a feature that was dead on arrival. `!is_jwt(t)` now exempts
  recognisable JWTs from *that one rule*; vendor prefixes and every other
  heuristic still apply, and anything merely random-looking is still flagged.
  This is a real trade-off (a JWT on disk is a credential on disk) and it is
  one line to reverse — see the comment in `secret_reason`.
- The stacktrace search picks the *last* line for a Python traceback (the
  exception) and the *first* for everything else, because
  "Traceback (most recent call last):" is the one line guaranteed to be useless.

Hard-won notes from building the toast:
- **A new window needs a capability entry.** `capabilities/default.json` lists
  windows explicitly; until `toast` was added there every `invoke` and `listen`
  from it was silently denied, so the window existed and did nothing.
- **Rust raises the toast, not the toast's own JS.** It lives in a window
  that's hidden until the moment it's needed, and a hidden webview is not
  something to depend on for "did you see the event?". `record()` calls
  `place_and_show_toast` directly; the JS only renders.
- **Show and hide must both be raw Win32.** We show with `SW_SHOWNOACTIVATE`
  to avoid stealing focus, which leaves Tauri's own visibility state stale —
  so `hide()` can decide the window is already hidden and no-op, stranding the
  toast on screen. `hide_raw` (`SW_HIDE`) keeps the pair symmetric.
- **Auto-dismiss is a polled deadline, not a `setTimeout`.** The toast window
  never has focus, and browsers throttle timers hard in unfocused windows — a
  single 6s timeout may simply never fire.
- **The clipboard is held for as little as possible.** Resolving the source
  app (`OpenProcess` + `QueryFullProcessImageName`) takes far longer than the
  read, and doing it with the clipboard still open is enough to make another
  app's copy fail.

### Stash Phase 2 — what's left
Nothing, except **SQL → save as query**, which is parked with Connections
(see above). Phase 2 is otherwise done.

### Stash Phase 3 — screenshots ✅ mostly built
- [x] Watch the screenshot folder, store links not copies, thumbnails
- [x] OCR text into FTS (Windows has built-in OCR)
- [ ] **Win+Shift+S snips** — not captured. Windows saves a snip *nowhere*;
      it exists only on the clipboard, so "links not copies" cannot apply and
      we'd have to write the bytes ourselves. Deliberately unresolved: writing
      every ephemeral snip into your Pictures folder would mean retention
      later deleting files from Pictures, which shouldn't happen silently.
      Decide where the bytes live before building this.
- [x] **Everything already in the folder is imported**, newest first, dated by
      the file rather than by when we noticed it — so old screenshots slot into
      the timeline instead of all landing at the top as "just now".

How it works:
- **It points at the folder; it is not a two-way mirror.** Deleting a picture
  doesn't reach in and delete rows, and nothing is ever written into your
  Pictures folder. The folder is where the images live; the vault is an index
  over them.
- **Screenshots are exempt from retention.** They link to files that still
  exist, and most are older than any sane window — pruning would import your
  history and then quietly delete it again a moment later.
- `shots.rs` watches the Screenshots known folder (read from the registry, so
  a relocated folder still works) with `FindFirstChangeNotification` — asleep
  in the kernel until the directory changes, same principle as the clipboard.
- The row stores `file_path` (a link — **Stash never copies or deletes your
  images**, retention removes only the row), a small JPEG `thumb` data URI for
  the card, and the **OCR text in `content`**, which means the existing FTS
  triggers index it for free. Searching a word that only appears inside an
  image just works.
- OCR that *fails* and an image with *no text* say different things, in the
  preview and in the Logs. They are not the same event and must never look it.

---

## Designed, not built

Mocks live in `design/`. Open them in a browser; they're clickable.

### Connections — the SQL layer ✅ built · `design/shell-mock.html#connections`
Rail item. Connections are first-class entities scoped to a workspace/project.

- [x] Connection entity: engine (Postgres / SQLite / SQL Server), host, database
- [x] Credentials in Windows Credential Manager — never plaintext in SQLite
- [x] Live reachable/unreachable status, like services
- [x] Saved queries nested under their connection + durable query history
- [x] Query execution by wrapping the CLIs (`psql`, `sqlite3`, `sqlcmd`);
      structured results via `--csv`
- [x] Results grid, sortable, copy as CSV
- [x] Machine Setup offers to install a missing client
- [x] Query runs emit an activity event (`conn:run`)

**The open question is settled: it's a runner, not an IDE.** No schema tree, no
autocomplete, no transaction management. You write SQL, you get a grid.
Everything your database can do stays reachable precisely because DevDeck is
not standing in front of it — the moment this grows a query planner it starts
losing to a real client.

Decisions worth keeping:
- **There is no password column, and no command that reads a password back.**
  Secrets live in Credential Manager under `devdeck:connection:<id>`, are read
  only to build one command line, and are deleted with their connection.
  `has_password` tells the UI a secret *exists*; that is all it may know.
- **Postgres gets its password via `PGPASSWORD`, not a flag** — an argument
  would put it in every process listing on the machine. There's a test.
- **Results are capped at 5000 rows and say so.** A runner is not a
  spreadsheet, and a silent truncation is a lie about your data.
- **A missing client is named, not swallowed**: "`psql` isn't on your PATH…"
  with a one-click install, because that's the single most likely failure.

### Stash — the context-aware vault · `design/stash-mock.html`
Rail item. One item vault; the clipboard is just a capture source.

- [x] `stash_items` table + **SQLite FTS5** index over all content
- [x] **Clipboard capture** via `AddClipboardFormatListener` (event-driven, no polling)
- [x] **Auto project tag** — every item records the workspace/project active at
      capture time. This is the differentiator; no other clipboard manager has it.
- [x] **Smart type detection**: json · sql · url · path · jwt · uuid · hex · stacktrace · text
- [ ] **Type-driven actions**: prettify/minify JSON, decode JWT, save SQL as a query,
      search logs for a stacktrace, reveal a path, run a command, open a URL
- [x] **Secrets guardrail** — key/token/password shapes are flagged and their value
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

### Accounts / password manager — idea, not designed yet
Raised: it'd be useful to store and manage accounts (username / email, password)
in DevDeck. Real need — Connections already has to solve credentials, and the
Machine manifest wedge implies onboarding a machine's logins too.

The fork in the road, to settle **before** any code:

- **Integrate** an existing manager — `bw` (Bitwarden CLI) or `keepassxc-cli`,
  shelled through the existing runner the way `machine.rs` drives winget/scoop.
  DevDeck stores a *reference* to an entry; the secret is fetched on demand,
  used, and dropped. Machine Setup already knows how to install the client.
- **Build** a vault of our own — master password, Argon2id, an authenticated
  cipher, memory hygiene, lock timeout, clipboard clearing, backup/restore, and
  a written threat model. A different product with a much higher bar, and a
  breach here costs users their accounts, not their afternoon.

Recommendation: **integrate, don't build.** It composes with Connections and
Stash instead of contradicting them — Stash's whole trust story is *"a secret's
value never reaches our disk"*, and a homegrown vault in the same app inverts
that on day one. If we ever do store something ourselves, it goes in Windows
Credential Manager / DPAPI, per the rule already in `CLAUDE.md`.

- [ ] Decide integrate vs build (see above)
- [ ] If integrating: detect `bw` / `keepassxc-cli`, unlock flow, entry picker,
      "fill from vault" on a Connection, never persist the fetched secret
- [ ] Accounts as first-class items scoped to a workspace/project (the
      *reference*, plus username/URL/notes — which are not secrets)
- [ ] Stash ties in: a flagged clip could offer "save this to your vault"
      instead of being dropped on the floor

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
- Machine Setup used to re-probe winget/scoop on every remount with no visible
  loading state; its catalog + installed list now live in the store (loaded
  once per session, `Refresh` forces a re-probe) and a first load says what
  it's waiting on. Other slow pages should follow the same shape.
