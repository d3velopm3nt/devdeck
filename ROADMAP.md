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

See **[docs/TEST-REPORT.md](docs/TEST-REPORT.md)** for how each shipped piece
was actually verified — and what was not.

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

Every engineering item that was on this roadmap when the cycle started is
built. Two things have been added since, both deliberately scoped rather than
rushed: **user-editable scan rules** (below) and the **accounts / password
manager** question. Everything else remaining is business and distribution —
decisions that are the owner's to make rather than things to be implemented
past. See *Business / distribution*.

### AI Workspace ✅ built (this cycle, on `feat/ai-workspace`)

Agents and an orchestrator working on your projects, with `.devdeck` as the
durable, committed source of truth. Built end to end and working against the
mock provider with no API key; the OpenAI-compatible transport is live, so
OpenRouter, OpenCode, a local Meridian and anything else speaking that shape
all work.

- [x] Event bus, `.devdeck` schema, context assembly, checkpoints, staleness
- [x] Conflict detection driven by events, not polling
- [x] Tool registry + permission matrix, failing closed
- [x] Provider seam: Mock, OpenAI-compatible and Anthropic native, all live
- [x] Credentials via Windows Credential Manager, never SQLite
- [x] Provider setup UI, agent→provider assignment, Settings page
- [x] Context export to `CLAUDE.md` / `AGENTS.md`
- [x] **Approvals** — `approval` blocks the agent and prompts a human, denying
      on timeout. Advertised to the model, because it is genuinely callable.
- [x] **The orchestrator** — one assistant you talk to, which delegates to the
      specialists. Chat surface, durable conversations, memory.
- [x] **The store split** — personal state lives outside every repo, enforced
      by refusing to create the store inside one.
- [x] **Anthropic native transport** — Messages API, x-api-key, reconstructed
      tool_use/tool_result turns, and its own SSE accumulator (indexed blocks,
      not OpenAI's delta shape). Test does a real round trip.
- [x] **Blocking commands moved off the main thread** — a plain
      `#[tauri::command] fn` runs on the main thread in Tauri v2, so the
      approval wait froze the window and could never be answered.
- [x] **Streaming** — SSE on the OpenAI-compatible path, deltas and tool
      steps to the UI on their own channel. Providers that cannot stream fall
      back to one late chunk and nothing downstream can tell.

What is left, in the order it matters:

1. **Delegated sessions are fire-and-forget** — started on a thread, visible in
   Activity, but the chat does not learn when one finishes.
2. **The life half** — calendar, mail, notes. Needs no new store; needs new
   tools pointed at the personal one. Deliberately not started: the work half
   had to be real first.

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

### Time — a calendar, a day, and a bot that keeps you to it

Brainstormed 3 September 2026. **The calendar is built** (4 September) — see
`test-results/calendar/REPORT.md`. The day-plan and the life bot are not.

**Built.** Moments as well as rhythms (`every = "once"` with `at_ms` and
`duration_min`); `due:` on a work item, in the vault beside the item;
deadlines that remind themselves on the clock, once per item per day, inside a
48-hour lead; and a Calendar page with day, week, month and year views over a
single `calendar_range` query, across every space.

**Redrawn** (5 September, `design/calendar-day/`, canvas at
https://claude.ai/code/artifact/1999014a-7d04-4eff-9ac2-acb797ff5dde). The day
was a list with times beside it: every item was a chip inside a slot row, so an
hour and ten minutes were the same size, and a bot's two-hour run sat on top of
your lunch. Now a block is as tall as it is long, in one of two lanes — your
day, and the agents' — which also answers the open question below: the primary
lane is *both*, side by side, because the point is seeing them at once.

Colour became the **layer** (events, routine, focus, agent time, commands,
deadlines) and status moved to the left edge: dashed for planned, a live dot
for running, struck through for done, red with the reason for failed, faded for
missed. Two rules fell out of placing things — a block never shrinks below
18px, and keeps a full-strength tick showing its true length when floored; and
a deadline is a *line*, not a block, because drawing it as a box claims it
takes an hour. The sidebar holds what has no duration: the month, the layers
and their counts, the deadlines ahead, today's reminders. Focus sessions are
drawn for the first time — `focus_sessions` always had a start and an end, and
nothing was reading them.

**Step 2 is built** (5 September): `remind_min` on a schedule, so a thing can
warn you ten minutes, an hour or a day before it starts — said once per
occurrence, which `last_remind` is for, because the clock ticks every thirty
seconds; and `feature` / `work_item`, so a schedule can say what it is for and
the calendar can carry that through to the day and the event page. Both columns
live in the database rather than the vault: the teammates here are bots and
agents, not people cloning the repository, and a reminder to look at something
is not part of the project's record of that thing.

**Still to do.** Micro-habits and the free-slot offer — now its own entry
below, because it is a feature rather than a column. Persisting agent sessions,
which has moved to the bots and agents work, since the calendar is only one of
the places that suffers from runs living in memory. Typing your own routine
into the day grid — personal store, never a repository. Editing from the
calendar rather than jumping to the page that owns the thing. And the bot whose
space is you. Deliberately cut: a "meetings" counter, which counted nothing,
since there are no people, invitations or attendance behind it.

**Known rough edge**: the goal link can dangle. Rename or delete a feature in
the vault and the schedule still names the old slug; it shows a name that no
longer resolves rather than saying the feature is gone.

The rest of this entry is the original brainstorm, kept because the reasoning
still applies to what is left.

**What it is.** A calendar in the sidebar with day, week, month and year views,
across every space at once: bot schedules and the wakes that actually
happened, features and work items, and deadlines that remind you before they
land. Under it, a day view on a time grid — 15 minutes by default, settable
down to 5 — for running the day rather than watching it. And a bot whose space
is *you*: it wakes through the day, keeps you to the routine, and asks for the
notes you would not otherwise write down.

**What already exists.** `schedule.rs` runs reminders, commands and bot wakes,
with per-schedule catch-up — a missed reminder is recorded rather than fired
late, on purpose. Bots carry the same rhythm in `_bot.md`. Sessions and wakes
are already in the activity feed, so the past half of a calendar has data
today.

**What has to be built before any view is worth drawing.** Three gaps, in this
order:

1. **The scheduler knows rhythms, not moments.** `every` is
   daily/weekdays/weekly/hourly plus a minute of the day. There is no one-off,
   no date, no duration, no end — a 2pm meeting on the 11th cannot be said at
   all. A calendar needs moments as a first-class kind alongside rhythms.
2. **Work items have no dates.** `id, title, status, assignee, areas` and
   nothing else, so a calendar of work has nothing to plot. A `due:` on a work
   item is a change to the vault format — committed, durable, shared truth —
   and should be decided as one.
3. **Nothing turns a deadline into a reminder.** Reminders exist; "two days
   before" is a rule nobody holds.

**The store split applies, and decides the shape.** Your routine, your day
grid and your notes are *yours*: personal store, never a repository. A work
item's deadline is the project's: `.devdeck`, in the vault, beside the item.
The calendar reads both and shows them together — which is the whole point of
it being one surface.

**Open, and worth deciding before building:** whether the primary lane is your
time or the system's; and whether "add a calendar" ever means syncing a real
one (Google, Outlook, ICS) rather than DevDeck keeping its own. The second
changes the foundation, so it is a decision rather than a detail.

### Managers, roles and the one-to-one — designed, not built

Brainstormed 6 September 2026. This replaces the shape bots have had since
they were built, and the reason is one sentence: **a bot was pinned to a
folder, and a manager is not.**

**The inversion.** A marketing manager covers a DevDeck feature *and* the
TrackX site. That cannot be expressed while a bot is `_bot.md` inside one
node, and it breaks the thing that made the old model tidy — reporting lines
were the directory layout. So:

> The tree is the work. The org is the people. They were only ever conflated
> because a bot lived in a folder.

**A manager owns features, never spaces.** Owning a folder was the trap. One
owner per feature, because "who is accountable for this" must have an answer;
any number of managers pulled in beside them. A space is covered by whoever
owns the features in it, and a space with no owned features shows up as
unmanaged — which is a fact worth seeing rather than a state to hide.

**What a manager is:** a name, a handle, a role, a goal, a rhythm, a team of
agents it may put to work, and a portfolio of features across any number of
spaces. It lives at the vault root — `DevDeck/.devdeck/team/<handle>.md`, one
file per manager. Not in a space, since it belongs to none of them; not in the
personal store, which is for things about *you* and your team is not a
preference. Files stay the truth, the team travels with the vault, and nothing
lands inside a repository.

**No reporting lines yet.** Everyone reports to you. `reports_to` can arrive
when there is a manager who should answer to another manager rather than to
you; the escalation ladder works either way.

**A role carries its skills and its agents.** `botcatalog.rs` already has this
and reasons about it well — a template holds a goal, a rhythm, steps that
become work items, standards, skills, and tool offers on a deliberate ladder
("a skill is words, an agent is words plus permissions, software is a real
install, self-hosted is something that keeps running"). What changes is what
applying one *produces*: a manager with a portfolio, not a bot dropped on a
folder. Hiring a marketing manager brings the marketing skills and its default
agents with it.

**Skills start implying tools**, the way they do for Claude Code: a skill is a
folder with a manifest — name, one-line "when to use", a body, and what it
needs. Two rules keep it honest. *Listing is not loading*: prompts carry names
and one-liners, bodies load on use, or five skills cost context on every wake.
*Installing is not granting*: a skill declares `needs: [files:read, terminal]`
and installing shows you that, but the permission matrix stays the only thing
that grants. This overlaps the Community module by design — they must be one
system, not two.

#### Managers working together

`@` reaches **any** manager, not only those below you in a tree — the tree is
no longer the org, so the old subtree rule in `colleagues()` goes. Pulling
someone in is free; `@name take "item"` moves the claim through the delegate
gate, as it already does.

A manager pulled onto an item **lends its own agents** to it. The item stays
on the owning manager's plan; receipts name both, so accountability does not
blur. And **a manager always hands off to its team** — managers are strictly
hands-off, which makes the org legible and has one sharp consequence: a
manager with no agents can keep a plan and ask questions, and nothing else.
That is a vacancy, and it should read as one.

**Permissions follow the work, not the worker.** Grants are keyed by agent and
tool and know nothing about spaces, so lending an agent across spaces would
quietly carry its powers into another repository. The rule: an agent runs
under the grants of *the item's space*. One rule, no per-space matrix to
maintain, and lending can never widen what an agent may touch.

#### The one-to-one

**One shared page, owned by you**, not one per manager: three managers wanting
fifteen minutes is one meeting.

A question is anchored to a goal, a feature or a work item, and is one of
three things: unblock me, approve this plan change, or a suggestion. It is not
a new object — it is a message in the feature's thread, marked as awaiting an
answer, and the page is an index over those marks. Answering in the thread
answers it. Two inboxes is one too many.

The rules, which are the difference between a manager and a nuisance:

- **No guessing.** If you do not answer, it asks again — it does not start
  work it is unsure about. It re-raises on a backoff, never more than once per
  wake, and meanwhile **carries on with the rest of its plan**. One question
  must not freeze a space.
- **Questions never expire.** They stay until answered, or until the manager
  withdraws one because the work moved on — and withdrawing says so.
- **Three open per manager.** Past that it prioritises or bundles. A manager
  with twelve open questions is not managing.
- **It books a free slot inside your working times**, and if there is none it
  says *"no free time found this week"* and leaves the question untimed rather
  than booking you at ten at night.
- **The event only protects the time.** The page is where you answer; there is
  no live meeting mode.
- **An answer that is a decision becomes a decision** in the deck, so the next
  manager to look does not re-ask. An answer that changes the plan produces a
  receipt saying what changed.

**Working times live in Settings**: seven days, a start and an end for each,
one default applied to the weekdays, weekends set separately. They decide
which gaps are free and when anything may be booked. Managers still wake on
their own rhythm — a machine working at three in the morning is fine — but
nothing is ever *booked* outside your hours.

**The ladder**: question → the one-to-one → blocking and going stale → Needs
you → a deadline at risk → interrupt. And a split that the org model forces:
**safety approvals still come straight to you**, because a permission is not a
decision, while **work blockers go to the manager**, who decides whether it
becomes a question or something they can solve by lending an agent. An agent's
blocker reaching you directly is a manager being skipped.

#### What it costs, honestly

`bots.rs` keys everything off `node_id` — `colleagues()`, the wake report, the
permission personas — and all of it moves to a bot id plus a portfolio lookup.
A manager spanning spaces has no single repository, so context anchors per
item worked on rather than per bot; the precedent exists, since a parent node
already says outright that it has no repository. Migration is mechanical: each
existing bot becomes a manager whose portfolio is that node's features. Copy
changes too — Home currently says "one per space, awake on a rhythm", which
stops being true.

**Open**: whether a manager may create work in a space it covers nothing in
(assumption: no — it asks the owner, or you); what an idle manager does when
its plan is empty; and whether the organogram page is the first thing built or
the last.

### Micro-habits and the free slot — designed, not built · `design/calendar-day/`

Step 3 of the calendar board, and the piece that makes the day view something
you *use* rather than read. The canvas is at
https://claude.ai/code/artifact/1999014a-7d04-4eff-9ac2-acb797ff5dde — the day
artboard's habit strip, and the Habit tab on the "one sheet, five kinds"
composer.

**A habit is the one thing on that board that is not a time.** Everything else
the calendar knows starts at a moment: a reminder, a routine, a focus session,
a bot's wake. A habit has a name, a length, and a target for the week —
"mobility flow, ten minutes, five times" — and no opinion about when. That is
why it needs its own table rather than another `kind` on `schedules`, and why
it cannot be half-built: a habit tracker with a fixed time is a routine, and a
routine you keep missing is a to-do list that nags.

**What it needs.**

1. `habits` — name, minutes, target per week, an optional window (any gap /
   mornings / evenings), enabled. Personal store: your habits are yours, so
   SQLite, never the vault.
2. `habit_ticks` — one row per time you did it, with the day it counted for.
   Banked, not scheduled: the tick is the record, and the streak is derived
   from it rather than stored.
3. **The free-slot finder** — pure arithmetic over items the calendar already
   returns. Find the gaps after now, take the largest, offer the smallest habit
   that fits *and* is behind its target. No storage, no new source.
4. The strip on the day view, the Habit tab in the composer, and the ticks row
   on the week.

**The rules the design commits to**, and they are the whole difference between
this and a nagging app:

- **Offered once.** The largest gap after now, one habit, one button. Offer
  every gap and it is wallpaper by Wednesday.
- **A missed habit fades, it does not go red.** Red is for something that
  broke. Not walking today is not a failure of the machine.
- **Protected time is not free time.** A routine can be marked protected, and
  the finder never offers it — otherwise lunch is a slot.
- **Nothing is scheduled behind your back.** Doing it is a click; the calendar
  never books a habit for you, because a day that fills itself is a day you
  stop trusting.

**Why it is not built yet**: the two columns before it were one migration
each, and this is a feature — two tables, a finder, three surfaces. It earns
its place, but it earns it as a piece of work rather than as a field.

### Bots as teammates — every node is a conversation ✅ built · `design/node-thread/`

Designed 1 September 2026, built 2 September. The canvas is at
https://claude.ai/code/artifact/536d3183-3086-429a-8645-758ae9d97fcd
(page 1 is a clickable prototype).

**A bot is a manager, not a worker:** it holds a goal, wakes on a rhythm, and
puts agents on what it finds. The unit you talk to is a **thread**, and there
are three kinds on one message model:

- **A node's thread.** Click any level of the tree and talk to it. A project
  owns a commit, so it answers from real context; a parent owns none, rolls
  its children up as headlines, and says outright that it has no repository
  up there.
- **A feature's thread — the feature is the room.** No new object: the
  feature already exists in the deck and gains a conversation marked with its
  slug. Bots and agents collaborate there with `@`.
- **`@you` is the Inbox.** A message addressed to a person is the only thing
  that needs attention; everything else is just the thread.

**Being in a thread is free; being handed work is a claim transfer.**
`@qa look at this` adds a participant and nothing else. `@dev-a take "Fix
dirty_files"` moves the claim, and goes through the same gate as
`delegate.start` — refused, with a reason in the thread, when the speaker may
not delegate. That is how a bot with no agent talks in a room without moving
anyone's work: its id is one the permission matrix has never heard of.

**Two views.** **Team** is first, opening on **Goals** — every space, grouped
into Moving / Waiting on you / Quiet — with Features, Work and Bots as tabs of
the same surface. **Spaces** is the tree, which now goes into the repository:
real folders and files, with a chip saying which feature a path is part of,
derived from the work items whose areas name it.

**What this deleted.** The Bots, Work, Events and Scheduler rail entries and
their pages. Bots and Work are tabs of Team; Events is the bottom bar's raw
bus and its header says so; the Scheduler is Settings → Routines. The
Assistant left the rail too: it is the first contact on Team → Bots, and what
is left of its old surface — providers, agents, permissions, grants — is
Settings → Assistant.

**Configuration is a sentence, with a receipt.** "Do this every weekday
morning" goes through the `routine` tool, which asks first and then writes the
same two things the form writes: a clock row and a line in `_bot.md`.
Approvals are asked at the natural unit — *Allow once / Allow until morning /
No* — and "until morning" writes a standing grant for that exact call
expiring at 06:00 rather than a permission that never ends.

**Review points are not permissions.** `stop_at: [before any push]` in
`_bot.md` stops the call and says which rule stopped it. Permissions answer
"may you"; `git` is one tool, so an agent allowed to commit is allowed to
push. This answers "not without me", which is a different question and lives
in words rather than in the matrix.

**Routines can be events.** A routine whose trigger is `test.failed`,
`git.commit.created`, `file.changed` or `conflict.detected` rather than a
time. The trigger list is deliberately short and there is a one-minute
cooldown claimed *before* the run: a wake emits events of its own, and a broad
listener is not a feature, it is a loop with a nice name.

**Decided: the forms stay as the offline path.** Spaces, bots, routines and
schedules are all creatable with no API key, and the mock provider keeps that
true. What needs a provider is *talking* — every message in a thread is a
model call — so every thread says so plainly while the mock is answering
rather than letting a scripted line pass for a conversation.

**Decided: a team is who is in the room.** `team:` in `_bot.md` is still the
written-down half, but the effective team is that list plus any agent *you*
pulled into the bot's thread. Safe in one direction only, and only because
participants are written when a typed message is sent: a person can widen a
team by talking, and a bot cannot widen its own.

**Still open:** whether the folder→item mapping should also be pinnable by
hand rather than only derived from work items.

**Borrowed from Grok bot's docs, on purpose:** the request shape (outcome,
sources, constraints, deliverable, review point); event-triggered routines;
"save what we just did as a skill"; and the line worth keeping verbatim —
*an approval controls the proposed action, it does not reverse work already
completed* — which for us is free, because every action is a commit or a diff
we can show.

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
- [x] **Type-driven actions**: prettify/minify JSON, decode JWT, search logs for
      a stacktrace, reveal a path, send to a terminal, open a URL. *Save SQL as
      a query* is the one exception — parked with Connections.
- [x] **Secrets guardrail** — key/token/password shapes are flagged and their value
      is *never written to disk*; clipboard content excluded by password managers
      is skipped entirely
- [x] **Retention** — configurable, and exempting anything pinned, tagged,
      noted, written by hand, or linking to a screenshot file
- [x] **Widget paste surface** — summon → type → `⏎` copy, `⇧⏎` paste, `esc` dismiss
- [x] Screenshots: watch the folder, store *links* not copies, thumbnails
- [x] OCR screenshot text into FTS — and through the secret guardrail, which it
      was originally bypassing

### Widget peek ✅ built
- [x] Anything started in the app makes the widget peek — **without stealing focus**
- [x] Auto-collapse once healthy; a crash is sticky and stays put
- [x] Settings toggle for people who want it quiet

Hooked to `emit_status`, the one chokepoint every service transition passes
through — rather than each call site remembering to peek, and one of them
eventually forgetting. It won't touch a widget you already have open, and
won't snatch away one you've started interacting with.

### User-editable scan rules — designed, not built

The repo scanner knows twelve ecosystems plus a table of deploy tools, and
adding a thirteenth is a code change. That's the wrong shape for this product:
**Machine Setup already seeds its curated catalog into SQLite and makes every
entry yours to edit, hide or extend.** The scanner should work the same way, so
your in-house toolchain is a first-class citizen rather than a pull request.

The precedent matters — it's the same trade already made once, and it worked:
ship an opinionated default, keep it in the database, let people disagree with
it locally.

**Shape.** A `scan_rules` table, curated rules seeded `INSERT OR IGNORE` on
first run, so new shipped rules arrive on upgrade without overwriting your
edits (exactly how `machine_packages` behaves):

```
id · name · enabled · custom · sort
markers      -- any of these filenames present fires the rule
excludes     -- …unless one of these is also present
commands     -- [{ name, command, service }]
group        -- badge/grouping, e.g. "deploy"
manager      -- badge, e.g. "fly"
```

That covers everything `MARKER_DETECTORS` does today, which is most of the
surface. The dozen logic-bearing detectors — Python's runner detection, .NET's
test-vs-web distinction, Gradle's module rule — stay in Rust, because they read
*inside* files and no reasonable config format expresses "is this csproj a test
project". So it's a hybrid, and the roadmap should say so rather than promising
a plugin system it won't deliver.

**Why it's worth doing**
- An in-house tool (`./scripts/deploy.sh`, a bespoke task runner, a company
  CLI) becomes discoverable without touching DevDeck's source.
- Turning off rules you find noisy is a per-machine preference, not an issue.
- It's the natural home for team-shareable rules later — the same manifest
  wedge as Machine Setup.

**Open questions, worth settling before building**
- **Where does a rule's command run?** Marker rules currently inherit the
  directory the marker was found in. Some rules will want the project root
  instead; that needs to be expressible.
- **How much do we let a rule assert?** A marker list is safe. Letting a rule
  grep file contents starts recreating a config language, and badly.
- **Import/export.** Sharing a ruleset is the obvious follow-on, and it should
  reuse the machine-manifest format rather than inventing a second one.
- **The bar stays the same:** a rule must only fire when a marker proves the
  toolchain is in use. A user-editable list makes it easier to violate that,
  and a scan that offers commands the repo can't run teaches you to ignore the
  whole list.

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

### Activity stream ✅ built
- [x] One `activity` stream — services, queries, pulls, clips, screenshots —
      feeding Home's feed, with the widget and usage ranking reading the same table
- [x] Durable per-run service history (start/stop, duration, exit code)
      surviving restarts

Home's feed was derived from `recents`, which only stores *the last time*
something ran — so two runs looked like one and a crash looked like nothing at
all. Every source now writes one row per occurrence, with its outcome. Open
runs are closed at startup: a run that was "running" when the app was killed
did not survive, and saying otherwise is a lie the history then repeats
forever.

---

## Business / distribution

Decisions from the monetisation conversation. **These are deliberately not
built.** Each one needs a call only the owner can make — a licence choice has
legal consequences, a payment vendor picks a key format, and cutting a release
publishes to other people's machines. Guessing at any of them and writing code
around the guess is worse than leaving them open.

The one with a live cost is the first: while the repo is private, every
existing install silently loses auto-update, `scoop update devdeck` fails, and
the website's download links point at nothing.

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
      "onboard a new developer's machine in one click, reproducibly".
      *The mechanism already ships*: Machine Setup exports and imports a
      manifest today. What's missing is the product around it — sharing,
      versioning, and the licence that makes it the paid tier.

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
- The repo scanner walks 4 levels deep and knows .NET, Python, Rust, Go,
  Android/Gradle, Maven, Flutter, PHP, Ruby, Docker Compose, Make and a table
  of deploy tools. Adding an ecosystem is a row in `MARKER_DETECTORS` (data) or
  one `detect_*` function (logic), plus a fixture test — but either way it's a
  **rebuild**. See *User-editable scan rules* for the fix.
- AI Workspace: a delegated session's completion never reaches the conversation
  (it shows in Activity, but the assistant will not tell you dev-a finished);
  the Anthropic transport is written against the documented wire format but has
  not been run against the live API
- Terminal commands: an old report that commands don't type into the terminal —
  deprioritised, needs reproduction
- Machine Setup used to re-probe winget/scoop on every remount with no visible
  loading state; its catalog + installed list now live in the store (loaded
  once per session, `Refresh` forces a re-probe) and a first load says what
  it's waiting on. Other slow pages should follow the same shape.
