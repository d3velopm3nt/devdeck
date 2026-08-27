# DevDeck — test report

What was built, how each piece was actually verified, and — just as
importantly — what was **not** verified and why.

Every number below came from running the app and reading its real state
(SQLite queries against the live database, Win32 window measurements, the test
suite), not from inspection. Where something could only be typechecked, it says
so.

**Suite:** 23 Rust tests · `tsc -b` clean · `oxlint` clean on every touched file.

---

## A note on screenshots

There are none, deliberately.

The first capture taken for this report rendered one of the developer's own
screenshots in the Stash detail pane — a live account login and password in
plain text, with the OCR transcription printed underneath. It was deleted
before anything was staged, and it is the reason [the OCR
guardrail](#security-ocr-was-bypassing-the-secret-guardrail) exists.

Capturing the vault means publishing whatever is in it. A synthetic demo
profile was attempted so the screenshots would contain nothing real, but the
harness proved unreliable and was abandoned rather than left half-working or,
worse, pointed back at real data. The evidence below is what the app actually
did; it is stronger than a screenshot anyway.

---

## Stash Phase 1 — capture + vault

Clipboard capture is event-driven: a message-only window registered with
`AddClipboardFormatListener`. Nothing polls.

**Verified live.** Four clips copied to the system clipboard, then read back
out of SQLite:

| copied | stored as | value on disk |
|---|---|---|
| `{ "db": { "host": "db.staging.acme.io" … } }` | `json` | full content |
| `select o.id, c.name from orders o join …` | `sql` | full content |
| `http://localhost:3000/orders?status=failed` | `url` | full content |
| `ghp_A1b2C3d4…` (a fake GitHub token) | flagged secret | **`content` is NULL** |

`source_app` resolved to `powershell.exe` in every case, so owner-process
lookup works. FTS5 was confirmed present in the bundled SQLite (a test asserts
it, rather than assuming), and search was checked against the live index:

- `staging` → found the JSON clip by its body
- `orders` → found both the SQL and the URL
- `customer` → prefix-matched mid-query
- `ghp` → **0 hits**; `github` → 1 hit, matching the flagged clip by its
  *title*. The shape is searchable, the credential is not.

Deleting a clip was verified to remove it from the index too, not just the
table — a stale index returns wrong answers rather than erroring.

**Search states which search it is** (`full-text · FTS5` vs `substring
search`), so a SQLite without FTS5 can never masquerade as full-text that
found nothing.

### Editing, notes and tags

Covered by tests rather than by hand: editing re-derives type/size/preview,
notes are indexed, tags are case-insensitive and pruned when the last item
drops them, and search matches tag names.

One bug found and fixed during this work: adding a tag re-selected the item,
which blanked the detail pane for a beat, unmounted the tag input mid-keystroke
and lost anything typed after a comma.

---

## Stash Phase 2 — make it fast

### The capture toast

**Verified live**, by measuring the real window through Win32 while copying:

```
start hidden        : True
shows on capture    : True
keeps your focus    : True          <- foreground unchanged, toast not focused
parks bottom-right  : 1562,924  size 340x92
auto-dismisses      : True
```

The focus check is the one that matters: the toast appears while you are typing
in another app, so a toast that grabs the keyboard is worse than no toast.

Three real bugs surfaced here:

1. **A new Tauri window needs its label in `capabilities/default.json`.**
   Until `toast` was added, every `invoke` and `listen` from that window was
   silently denied — the window existed and did nothing.
2. **Rust raises the toast, not the toast's own JS.** It lives in a window
   hidden until the moment it is needed, and a hidden webview is not something
   to depend on for "did you see the event?".
3. **Show and hide must both be raw Win32.** Showing with `SW_SHOWNOACTIVATE`
   to avoid stealing focus leaves Tauri's own visibility state stale, so
   `hide()` decided the window was already hidden and no-op'd — that was a
   toast stuck permanently on screen. Auto-dismiss is a polled deadline rather
   than a `setTimeout`, because browsers throttle timers hard in a window that
   never has focus.

Two apparent failures during this testing turned out to be **the test's fault,
not the app's**: it copied the same string each run, and dedupe correctly
suppressed a repeat of the newest clip.

### Type-driven actions

**Verified live** that every action has a clip it will appear on — the actions
are gated on `item_type`, so classification decides whether a button exists:

```
PASS  json        -> Prettify / Minify
PASS  url         -> Open
PASS  path        -> Reveal
PASS  jwt         -> Decode
PASS  stacktrace  -> Search logs
PASS  text        -> Send to terminal
```

The pure transforms have 17 behavioural checks (UTF-8 JWT claims, expiry maths,
malformed tokens, Python-traceback vs JS-stacktrace line selection).

**A conflict worth recording:** the entropy rule in the secret heuristic was
swallowing *every* JWT before the classifier saw one, so `item_type` was
`text`, no value was stored, and the decode action was dead on arrival.
Recognisable JWTs are now exempt from that one rule. This is a real trade-off —
a JWT on disk is a credential on disk — and it is one line to reverse.

**Send to terminal deliberately does not press Enter.** A stash is full of text
copied from places you did not write; one click should not run it.

### Retention

**Verified end-to-end** with a self-cleaning test: a clip backdated 60 days was
gone after the next launch, while recent clips survived.

Pruning exempts anything you signalled you care about — pinned, tagged,
carrying a note, or written as a note — regardless of age. A vault that quietly
eats something you tagged is worse than one that keeps too much.

---

## Stash Phase 3 — screenshots + OCR

Watches the Screenshots folder Windows already uses (resolved from the
registry, so a relocated folder still works) via
`FindFirstChangeNotification` — asleep in the kernel until the directory
changes. It is an **index over that folder, not a mirror**: nothing is written
into Pictures, and deleting a picture does not delete rows.

**Verified live** against a real folder of 81 images:

```
imported        : 81 / 81 files in the folder
  OCR found text: 80        thumbnails: 81        OCR failed: 0
  date range    : 2026-06-13 .. 2026-08-26   (real file dates, not import time)
```

Searching `machine` matched 4 of them, `install` 7, `secrets` 3 — on text that
exists only *inside* the images.

Dates come from the files, not from import time; otherwise every old screenshot
lands at the top stamped "just now" and buries everything else. Screenshots are
exempt from retention, because they link to files that still exist and most are
older than any sane window — pruning would import your history and then quietly
delete it again.

Two failure modes here looked *identical* to "this image has no text" and now
do not: WinRT needs a multithreaded apartment (a plain `std::thread` has none),
and the storage APIs reject the `\\?\`-prefixed path `canonicalize()` returns.
A failed read now says so, in the preview and in the Logs.

---

## Security: OCR was bypassing the secret guardrail

**Found by using the product**, not by reading it.

The vault promises that anything shaped like a key, token or password is
flagged and its value never written to disk. That held for clipboard text and
for hand edits. It did **not** hold for OCR: text lifted out of an image went
straight into `content`, the column the FTS triggers index. A screenshot of a
login screen therefore became a searchable plaintext password in SQLite.

On the machine this was found on, **12 of 80 screenshot rows carried
credential-shaped text and one carried a real account password.**

Why the existing rule missed it: OCR flattens layout, so the `key: value` shape
that rule depends on is destroyed — a login form comes back as one long line
and the careful heuristic sails straight past. The image rule is deliberately
blunter: a credential word *anywhere* in the text withholds it. That trades
false positives for safety on purpose. A wrongly-flagged screenshot is still
findable by name, date, project and tag and is one click from opening; a missed
one is a live password in a searchable database.

A flagged screenshot also stores **no thumbnail** — that would be a second copy
of the same secret, in a database, drawn in a list you scroll past in public.

`redact_stored_ocr` re-runs on every launch, so rows captured under a looser
rule get cleaned by a tighter one. **Verified on the affected vault:**

```
screenshot rows                    : 81
  flagged as possibly-credential   : 9
  still holding credential text    : 0   ✓
  flagged rows keeping a thumbnail : 0   ✓
  leaked password in search index  : 0   ✓
```

---

## Connections — the SQL layer

A **runner, not an IDE**. DevDeck speaks no database wire protocol; it drives
the clients you already have (`psql`, `sqlite3`, `sqlcmd`), asks for CSV, and
shows the grid.

**Verified by test:**

- The CSV parser against what these clients actually emit: commas inside
  quotes, doubled quotes, newlines inside quoted fields, empty fields that must
  survive.
- **A password never reaches a Postgres command line.** `psql` takes it via
  `PGPASSWORD`, because an argument would put it in every process listing on
  the machine. This is a test, not a comment, so it cannot quietly regress.

**Not verified end-to-end:** no database client is installed on this machine,
so no query has been run against a real server from the app. What that means
concretely: command construction, CSV parsing and the missing-client path are
tested; a successful round-trip to Postgres or SQLite is not. That is the first
thing to exercise on a machine with `psql` or `sqlite3` present.

Credentials live in Windows Credential Manager under
`devdeck:connection:<id>`. There is no password column in the schema and **no
command that reads a password back out** — `has_password` lets the UI say a
secret exists, which is all it may know. Deleting a connection deletes its
credential.

---

## Machine Setup — loading state and caching

Two real problems with one root cause: all state was component-local, and
`machine_status` shells out to winget *and* scoop.

- No loading indication — `loading` existed but only disabled the Refresh
  button, so the body rendered empty with no explanation.
- Every visit re-ran the slow probe.

Both fixed: the catalog and installed lists live in the store, loaded once per
session, and a first load says what it is waiting on. Stat counters are
withheld during that first load, because "0 Installed" before you know is a
false claim, not a placeholder.

**Verified by typecheck and lint only.** Confirming "switch away and back is
now instant" needs clicking the rail, which the automation could not do.

---

## Activity stream

One table every source writes to — services, queries, pulls, clips,
screenshots — so Home, the widget and usage ranking read the same stream.

**Verified live.** Copying two things produced two `clip` rows with the right
kind, outcome and detail, within a second, and they appeared in Home's feed.

This replaces a feed derived from `recents`, which only stores *the last time*
something ran: two runs looked like one, and a crash looked like nothing at
all. Service transitions hook `emit_status`, the single chokepoint they all
pass through, rather than each call site remembering to log.

Per-service run history is durable — start, stop, duration, exit code — and
open runs are closed at startup, because a run that was "running" when the app
was killed did not survive and saying otherwise is a lie the history then
repeats forever.

---

## Widget peek

The widget comes into view when a service starts or crashes, **without taking
the keyboard**. A healthy start collapses itself after a few seconds; a crash
is sticky. It leaves a widget you already have open alone, and won't snatch
away one you've started interacting with.

**Verified by typecheck and by reuse**: the show-without-focus primitive is the
same one measured for the capture toast, where foreground-unchanged and
focus-not-taken were confirmed against the real window. The service-triggered
path itself needs a service to start, which is click-driven.

---

## Repo scan — more than Node, more than the root

The scanner had two problems: it only really understood `package.json`, and it
only looked at the repository root. A `backend/` + `android/` + `apps/web`
layout — the normal shape — produced almost nothing.

**Verified live** against a synthetic monorepo, run through the shipped
command. 39 commands across 8 directories, each carrying the folder it must run
in:

```
(root)           npm      cmd      npm run build
(root)           docker   service  docker compose -f docker-compose.yml up
Backend.Api      dotnet   service  dotnet watch run --project "Backend.Api.csproj"
Backend.Tests    dotnet   cmd      dotnet test "Backend.Tests.csproj"
android          gradle   cmd      .\gradlew assembleDebug
android          adb      service  adb logcat
apps/web         pnpm     service  pnpm dev
desktop          cargo    cmd      cargo clippy --all-targets
services/api     python   service  python manage.py runserver
services/billing python   service  poetry run uvicorn main:app --reload
```

And against **this** repository, where it now finds the `src-tauri` cargo
commands the root-only scan missed entirely.

Detectors are conservative — a command is only offered when a marker file says
the toolchain is genuinely in use. Offering `mvn test` for a repo with no
`pom.xml` trains you to ignore the whole list, so there's a test asserting a
Node-only repo gets no Maven, Cargo, .NET or PHP rows.

Three judgement calls worth noting, each with a test:

- **A Gradle module is not a project.** The first version treated
  `android/app/build.gradle` as its own project and produced a duplicate set
  of commands invoking bare `gradle` instead of the project's wrapper. A
  Gradle project is where `gradlew` or `settings.gradle` lives.
- **A .NET test project is not something you `dotnet run`.** Test projects get
  `dotnet test`; web projects additionally get `dotnet watch run`.
- **Python is invoked the way the project expects** — `poetry run …`,
  `uv run …`, `pipenv run …` — rather than assuming a bare `python`.

Commands found in a subfolder are created with that folder as their `cwd`.
Without it, a command from `apps/web` would silently execute at the repo root.

---

## What is not verified

Stated plainly, because a report that only lists successes is not a report.

| Area | Status |
|---|---|
| Auto-paste (`⇧⏎` into the previous app) | **Untested.** Needs an interactive desktop to synthesise Ctrl+V. Off by default; when Windows refuses the focus change the UI says "Copied — press Ctrl+V yourself" rather than claiming a paste. |
| The toast's *Configure* flow | **Untested.** Click-driven. |
| Machine Setup caching / loading pane | **Typecheck only.** Click-driven. |
| Connections: a real query round-trip | **Untested.** No client installed here. |
| The widget's stash paste surface | **Typecheck only.** Needs the widget summoned and driven. |
| Widget peek on a service start | **Typecheck only.** The underlying no-focus show is measured; this trigger is not. |

---

## Still open on the roadmap

**Every engineering item is built.** What remains is business and distribution
— a licence choice with legal consequences, a payment vendor that picks a key
format, and a release that publishes to other people's machines. Those are the
owner's calls; writing code around a guess at them would be worse than leaving
them open.


- **Win+Shift+S snips.** Windows saves them nowhere — they exist only on the
  clipboard — so capturing one means writing the bytes somewhere. Auto-saving
  every ephemeral snip into Pictures would mean retention later deleting files
  from Pictures. Needs a decision before it is built.
- **Widget peek**, **Activity stream**, and the business/distribution items.
- **The repo is private**, which silently breaks auto-update, `scoop update`,
  and the website download links for every install.
