# The loop queue — the night of 27/28 September

Working state for an unattended run. **Read this file at the top of every
iteration and update it at the bottom.** Nothing about progress is kept in the
model's head: a long session gets compacted, and a queue remembered rather than
written down is a queue that silently restarts.

The owner gave permission to run all of this unattended on the night of
27 September, and to spend tokens doing it.

---

## The gate

An item is not done until this is green, and an iteration that leaves it red has
failed — that is not a new item, it is the same item, unfinished.

```bash
cd src-tauri && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && cd .. && npx tsc -b && npm run lint
```

Baseline: **651 Rust tests**, tsc clean, **24** lint warnings. None of those
numbers may get worse.

## Rules

1. **One item per iteration**, commit when it is green, push.
2. **Frontend edits hot-reload; `src-tauri` edits restart the app.** Stop the app
   before Rust work rather than letting the watcher kill something mid-run.
   `git stash` touches `src-tauri/Cargo.toml` and restarts the app too — learned
   the hard way tonight.
3. **Re-measure, never assume.** The number in the check column has to move.
4. **Never** touch `.keys/`, cut a release, change repo visibility, commit to
   `main`, or publish anything to a public issue tracker.
5. Anything needing a human decision gets marked `ask` and skipped.

## Stopping

- the queue has no `open` item left
- the gate is red and one attempt to fix it failed
- **two iterations in a row close nothing**
- everything left is `ask`

---

## Queue

Status: `open` · `doing` · `done` · `ask`

### Make the app make sense (the owner's priority)

| # | item | check that decides it | status |
|---|---|---|---|
| 1 | **Stale docs.** `ROADMAP.md` still leads with "⚠️ Blocker: the repo is private", says 0.2.9 tagged / 0.2.8 released, and `CLAUDE.md` repeats it. Measured tonight: repo is **PUBLIC**, **v0.3.1** released, `latest.json` → **HTTP 200**, scoop bucket at **0.3.1**. `CLAUDE.md` also still says the app cannot be driven in this session, which stopped being true today. | no false claim left in either file | done |
| 2 | **Bot → manager, one name.** `CLAUDE.md` says "a bot is a manager"; the code says `bots.rs`, `bots_list`, `bot_thread`, a `bots/` folder, while the vault says `team/` and the UI says both. | no user-facing "bot" left; the gate green | done |
| 3 | **Delete `bot_thread`.** A manager has a conversation of its own, separate from the space it works on — the same duplication as the page deleted in `3f8bdba`. `design/one-room/BUILD.md` says the room is the thread and the manager hands over *in it*. | a manager's messages land in the space's room; no separate bot conversation | done |
| 4 | **A manager plans from its goal, not from its template.** Studio's first wake proposed "list the repositories the business depends on" for a goal-tracker space — boilerplate from `template: role:engineering`. | a wake on the goal tracker proposes goal-tracker work | done |
| 5 | **The rail is 15 views.** `WHAT-WE-WANT.md` §2: four groups — the work (Today · Items · Rooms), what this space has, what is yours (Mail · Calendar · Team · Workers), Tools folded away. | the rail matches §2 | open |
| 6 | **Today absorbs Dashboard and Inbox** (§2). All three are in the rail today. | one entry, not three | open |

### Speed (the review's L-list)

| # | item | check | status |
|---|---|---|---|
| 7 | **L3** — bare `useApp()` re-renders the whole shell | `grep -roE "useApp\(\)" src/ \| wc -l` is **62** → 0, plus a lint rule | open |
| 8 | **L2** — Home and the service page subscribe to the whole log array | a derived last-N slice per service | open |
| 9 | **L8** — Explorer, Stash and Mail render full lists | bounded rows under a long list | open |
| 10 | **L4** — **308 of 386** commands are sync on the UI thread | the count falls; `pty_write` stays sync | open |
| 11 | **L7** — a wake runs on the scheduler thread (`schedule.rs:631`) | a long wake does not stall a due reminder | open |
| 12 | **L9b** — the release bundle carries no `devdeck-ask` | a bundle has it beside `devdeck.exe` | done |

### Needs the owner

| # | item | why | status |
|---|---|---|---|
| 13 | Two incompatible work-item editors | which one survives is a product call | ask |
| 14 | `botSetWorker` has two doors | same | ask |
| 15 | Seeding GitHub issues | the repo is public; publishing internal notes is a disclosure decision | ask |

## Log

| # | item | before → after | gate | note |
|---|---|---|---|---|
| 1 | Stale docs | 3 false claims → 0 | n/a | `8d141a3`. The repo had been public for weeks and the roadmap still led with the blocker. |
| 2 | Bot → manager (what you read) | both words → one | green | `6241298`. Identifiers and `_bot.md` left on purpose: they need a migration. |
| 3 | Manager speaks in the space's room | 2 rooms → 1 | green | `dce286d`, then corrected — see below. |
| 4 | Plan from the goal, not the template | 3 irrelevant → 0 | green | `dce286d`. Proved by a real wake. |
| 5 | Rail in four groups | — | — | **ask**: Tools and Team already fold. The only delta is Dashboard, which the rail deliberately promoted *out* of Tools while §2 wants it absorbed. Conflicting written intents — the owner's call. |
| 6 | Today absorbs Dashboard + Inbox | — | — | **ask**, same reason. |
| 7 | L3 whole-store subscriptions | 62 → 62, ratcheted | green | `68a0e83`. ~45 files, one call each; careful per-file work that wants review. The ratchet stops new ones. |
| 8 | L2 log-array subscriptions | already done | — | `liveStore` derives the counts and tails at flush time (`8997b40`). §2's table is stale about L2 as it was about L1. |
| 12 | L9b asker in the bundle | absent → sidecar | green | `68a0e83`. Verified `tauri dev` still starts with it declared. |

## What the trial found

Studio woke on the real key and read the repository rather than a template. It
got the next piece of work exactly right — *"the README promises `goals.js` …
neither file exists, so `npm test` currently has nothing to run"* — then stopped
and asked rather than guessing. Three things came out of it:

1. **Two rooms, not one.** The first version of the room fix preferred the
   *manager's* room over the space's and stamped the handle without stamping the
   node, so the goal tracker kept "Goal tracker" (11 messages) and "Studio" side
   by side. Corrected: the space's room wins, and a manager's room becomes the
   space's when the space has none.
2. **A manager cannot see its own worker.** Studio's file says `worker: smith`;
   Studio reported *"there's no Smith anywhere I can see — no agent roster"*.
   The roster lives in the personal store and is not in the manager's context.
   **done**, `23931c3`, but only after a wrong fix and a second wake — see
   "The third wake" below. The roster paragraph went into `bots::persona`,
   which only a *room* builds; a clock-woken session never touches it. A
   manager now travels into its own wake as `StartAgentCommand.on_behalf_of`.
3. **`work` and `delegate` bounced.** Studio: *"the work/delegate tools are
   bouncing my calls back in this project."* Its room has `project_id: '61'` and
   project 61 resolves, so the refusal is past that check. Second-hand evidence
   only — needs a run that captures the actual refusal. **open**, and it is the
   same pair `design/devdeck-mcp/BUILD.md` singles out as the
   assistant-dispatched half of the registry.

### The second wake, after the worker fix

Different failure, and a better one. Studio read the repository again — *"the
tracker's an empty shell right now — README promises `goals.js` and
`goals.test.js`, and neither exists"* — **made a claim** (`clm_1a0e4e47dd55`, so
`work`/`delegate` answered this time), and then hit this:

    {"tool":"terminal","action":"run","denied":true,
     "error":"'terminal' needed approval and this was started by a clock,
              so there was nobody to ask. Give it a standing grant…"}

for `ls -la .devdeck; find .devdeck -type f | head -50`.

**A manager woken by the clock has no ask channel.** That is the exact problem
`devdeck-ask` solved for workers this week — a sealed session reaching for a
shell with nobody to ask — and managers never got it. A worker in this position
now gets a question in the room and ninety seconds; a manager gets a denial and
a suggestion that the owner go and write a standing grant. **open**, and it is
the obvious next piece: the room already exists, the waiting already exists, and
the manager already speaks there.

Until then the trial stops here on purpose rather than on a fault: it refused to
act unattended without permission, which is the design working. Granting that
permission is the owner's to do, not a thing to be arranged around.

### The third wake, after the ask channel

The ask channel was never exercised — Studio hit a different wall first, and
answered the two questions that were still second-hand:

1. **The refusal text, first-hand at last.** *"The work and delegate tools both
   bounce back with `handled by the assistant, not by a project's tools` — I
   can't create the item or start a session from here."* That is exactly the
   split `design/devdeck-mcp/BUILD.md` describes: `is_assistant_tool` routes six
   of the twelve tools away from `ToolService`, and `work` and `delegate` are
   both in that half, so they are unreachable from a project-scoped wake.
   **open**, and it is now the only thing standing between a manager and a
   finished job.
2. **The worker fix had not reached this path at all.** *"I can't confirm who
   Smith is… there's no roster I can see."* `StartAgentCommand` carried no
   persona and `runtime.rs` never mentioned one — the wake ran the *agent's*
   prompt, so `85eb20f` reached the room and nothing else. Fixed in `23931c3`.
3. Studio reported a defect against itself: *"my hand slipped on the way in — I
   fired a pile of duplicate calls at those refused tools instead of stopping at
   the first error."* Noise rather than harm, and worth a look once (1) is done.

The lesson is worth keeping: **a fix written into a persona is a fix to one of
two paths.** A manager has a voice in its room and had none on its clock, and
the second is the path that runs when nobody is watching.

### The fourth wake, after the voice fix — `ses_1a0e7cc4cc21`

13 turns, 0 files, 3 refused. **The voice arrives.** Studio stopped saying it
could not see a roster and called `delegate.start` for Smith — it now treats
Smith as somebody it can dispatch rather than a name inside a sentence. Its
report is the best one yet: it read the repository, wrote the item down
(`goals.js` add/list/complete plus `goals.test.js`, four named cases), said
*"Nothing was built and nothing was checked"*, and listed exactly what it needed.

Four findings, all first-hand:

1. **`work`/`delegate` still bounce**, third confirmation, same words:
   *"handled by the assistant, not by a project's tools."* Studio: *"the item
   above isn't written into any plan — it exists only in this report."*
   **done**, `0d7200b` — and it turned out `work` was the whole of it. See
   "The loop closes" below.
2. **A review point fires on the word, not the act.** `stop_at: [before any
   push]` reduces to the single word `push` in `review_point`
   (`runtime.rs:107`), which is matched against `tool.action + the whole args
   JSON`. Studio's item text ends *"npm test green on a branch, **no push**"* —
   so `delegate.start` carrying that text, and `memory.save` quoting it, were
   both stopped by a rule about pushing, on calls that said they would not push.
   A review point the model cannot phrase its way past without avoiding the word
   is not a review point. **done**, `771c646`: it now matches the tool, the
   action and the *structured* arguments — a path, a branch, an id, and above
   all `command`, which is itself an act. Prose arguments are left out by name.
3. **The ask channel fired.** `terminal.run` waited and timed out at ninety
   seconds (11:36:21 → 11:38:00) instead of being refused outright, which is the
   new behaviour working. Nobody was at the keyboard to press it, so whether the
   question *rendered* is still unwitnessed — it wants a wake watched live.
4. **The knowledge index and the disk disagree.** Studio: the index lists
   `.devdeck/features/studio/*` and `.devdeck/features/goal-store/*`, *"but
   `.devdeck` is empty on disk and every read of those paths fails."* That is the
   `node_dir` / `node_deck_dir` split in CLAUDE.md showing up in a third place:
   the index was built against the vault, the agent reads against the repository.
   **open**, and still said out loud by the fifth wake: *"I can list `.devdeck`
   paths through search but can't read the feature docs themselves… I was
   working without the feature brief."* Less urgent now that `work` reads the
   deck for it, but a manager still cannot read its own feature.md.

## The night of 28/29 September

A second unattended run, on the owner's goal prompt. The order was theirs:
the worker grant first, because without it a night produces blocked runs.

| # | item | before → after | gate | note |
|---|---|---|---|---|
| A | **A worker may be given permission in advance.** Narrow standing grants existed for *agents* all along — a tool, one action, a scope, an expiry, checked on every use — and the worker asker consulted them **zero** times. So a worker could only wake somebody or be denied: Smith wrote two good files on the 28th and stood at `npm test` for ninety seconds, three times, with nobody at the keyboard. | 0 → a grant the asker reads | green | `d7b38cb`. `allow: [npm test, git add, git commit]` + `allow_until:` in the worker's own file, resolved before the run starts and written into its folder. Refuses: any part of a command line that was not granted, `cd` anywhere but its own worktree, a prefix that is not a whole word, and push/merge/`rm -rf`/sudo whatever the file says. No expiry, an unreadable one, or an empty list all mean *ask, as before* — permission must never be acquired by accident. A covered call is still written down. |
| B | **A manager takes the space's feature instead of inventing its own.** "Studio's plan" sat beside "The goal store" as siblings when one holds the other's work. | 2 containers → 1 | green | `b8dc5ec`. `plan_into` adopts when there is no doubt which — exactly one complete feature owned by nobody. Two unowned features are a question and nothing is guessed; every other case is `bot_adopt`, which refuses to take a feature from a manager that still exists. Studio now owns the goal store. |

| C | **A wake by hand froze the window.** L7 said a wake runs on the scheduler thread; both *clock* paths had spawned one for months, so that entry was stale. The **hand** path never had. `schedule_run_now` was a sync `#[tauri::command]`, which Tauri runs on the webview's own thread — pressing Run now on a manager froze everything for as long as the model took, five and a half minutes on the 28th. | froze → off-thread | green | `b8d0c11`. It stays synchronous *to the caller*, because the button wants the outcome; what changes is which thread waits. |
| D | **Nothing was counting.** L4 had no measure, which is why "308 of 386" could sit in this file being wrong. | no measure → a ratchet | green | `b8d0c11`. `check-sync-commands.mjs`, wired into `npm run lint`. The real count was **254**. `pty_write` is named as deliberately sync — what it writes has to arrive in the order it was typed. |
| E | **L4, ground down.** | 254 → **69** | green | `a50f735`, `891b5ff`, `21252ba`. Connections and Machine spawn CLIs; Mail opens sockets; Stash walks the disk and does OCR; then Vault, Community, GitHub, Setup, Files, Seed, Spaces, Activity, Focus, Inbox, Calls, Bots, the database, Services, Threads, Schedule, Calendar, Git, Team, Events. Each checked for window use first — a window is the one thing that genuinely wants the main thread. What is left is almost all `aiw/commands.rs`, which wants reading rather than a bulk edit, and `pty.rs`, which stays. |
| F | **L3, ground down.** | 62 → **25** | green | `ca3471f`. 133 fields across 34 files, all of the `const { a, b } = useApp()` shape, which converts to one selector per field and is exactly equivalent. The 25 left hold the whole store in a variable and read it later; those need reading, not transforming. |

### Checked at runtime, not just compiled

185 commands changed attribute in one night, and `cargo test` does not
exercise Tauri's dispatch at all. So the app was started and one command per
converted module was called through the real boundary: bots, team, schedule,
services, activity, vault, workers, runs, stash, mail, conn, machine, inbox,
focus, git, calendar, db. Every one answered. The only failures were wrong
argument types in the probe itself.

### Which branch survives — measured, so you do not have to

All four extracted and run:

| branch | tests | what is in it |
|---|---|---|
| `give-a-goal-a-due-date-…-0925` (w2, Mason) | **10 of 11 — one fails** | the store **and** due dates. A superset of the other three. |
| `add-a-goal-store-…-0925` (w1, Mason) | 7 of 7 | the store: `add`, `listOpen`, `complete` |
| `goals-js-add-list-complete-…-0928` (w04, Smith) | 6 of 6 | the same again, but `list` where the others say `listOpen` |
| `build-the-goal-store-…-0928` | 6 of 6 | the same again. Started by hand off no plan — mine, not the system's. |

**Take w2's and fix one line.** It already contains w1's work, so merging it
makes the other three redundant. The one failure is real and small:

    ✖ add rejects a due date that is not a real YYYY-MM-DD day
      The input did not match /due date/. Input: 'RangeError: Invalid time value'

`isDay('2026-13-01')` passes the `YYYY-MM-DD` regex, then
`new Date(…).toISOString()` throws `RangeError` before the store can raise its
own error. Guarding the invalid date is a one-line fix — and a good first job
for Smith now that a worker can be granted `npm test`.

Worth noticing: the plan said w2 was **done**. It was on a branch, unmerged,
with a failing test. That is the second independent confirmation of the same
lie, and `built` is exactly the right word for it.

### Open and unexplained: one stack overflow

02:38 on 29 September, after the app had been up fourteen minutes:

    thread 'main' (2308) has overflowed its stack
    error: process didn't exit successfully: `target\debug\devdeck.exe`
           (exit code: 0xc0000006, STATUS_IN_PAGE_ERROR)

A genuine overflow — that message comes from Rust's guard-page handler, and
the `STATUS_IN_PAGE_ERROR` is the handler itself faulting afterwards. It is the
only occurrence anywhere in the session's logs.

**Ruled out, by looking rather than by hoping:**

- *The binary being replaced underneath it.* The first and most likely
  explanation, and wrong: `devdeck.exe` was timestamped 02:24 and the crash was
  at 02:38, so the file sat untouched for fourteen minutes beforehand.
- *A recursive `Drop`.* `DomainEvent` holds `causation_id` as a `String`, not a
  boxed parent, and the bus stops at `MAX_CAUSATION_DEPTH`.
- *The event sink recursing on the publishing thread.* It spawns a thread for
  `schedule::on_event`; `eventlog::post` only sends down a channel.
- *`vault::walk`*, which is bounded at depth 8.
- *Anything written that night.* `the_one_unowned_feature`, `branch_for`,
  `work_merge`, `waiting_on_you`, `frontmatter_lines` and the new `managing`
  all iterate.

**Not reproduced.** Five rounds of opening both goal pages and touring all nine
rail views: alive every round. Then the one thing that had not been repeated —
`capture-window.ps1`, which forces the window topmost and drives `PrintWindow`
with `PW_RENDERFULLCONTENT` synchronously through the app's *main* thread, and
which ran about a minute before the crash.

**If it happens again, this is what to do.** Start with
`RUST_BACKTRACE=full`, note whether a screenshot or a topmost change happened
just before, and keep the dev log — the timestamp against `devdeck.exe`'s mtime
is what ruled out the easy answer last time. Do not raise the main thread's
stack size to make it go away: that hides a recursion rather than finding it.

**Nothing has been merged.** The one action that writes to a repository is the
goal page's Merge, and it should wait until this is accounted for.

### Half of `done` is still a lie

Found while updating the README, by checking a sentence before writing it
rather than after.

`built` vs `done` was fixed for **workers**: `where_the_item_goes` can only
reach `built`, and `work_merge` is what writes `done`. Two other paths were
missed and still write `done` with nothing merged:

- `aiw/runtime.rs:1203` — an **agent session** that ends without failing marks
  its work item done. This is the path a manager's wake runs through, so it is
  not a corner.
- `aiw/tools.rs:409` — the `work.done` tool a manager may call on itself.

Both are the same mistake the worker path had: *I stopped* read as *it is
finished*. The fix is the same shape — neither may write more than `built`, and
`work_merge` stays the only door to `done` — but it touches the agent runtime,
so it is written down rather than done at the end of a night.

Until then the README says so out loud rather than claiming a guarantee the
code does not make. **open**

### Still the owner's to decide

- The three template proposals on Studio's plan. Studio asked about them itself.
- Which of the four `goals.js` branches survives. They all cut from `03680ae` and conflict with each other four ways; merging one works and the second will be refused. Worth keeping the one Mason verified at 7 of 7 and deleting the rest.
- Whether to grant Smith anything. The mechanism exists now; `smith.md` still carries no `allow:`, deliberately — a grant is given, never assumed.

## The loop closes — 28 September, wakes five and six

Two wakes, no code between them, and the whole chain ran for the first time.

**Wake five.** Studio read the repository, decided the item, and *wrote it
down*: `w04-goals-js-add-list-complete-with-tests-under-node-test`, status
`unclaimed`, on `.devdeck/features/studio/work.md`. It also noticed the three
template proposals on its own plan — *"they look like they drifted in from
another context… I've left them alone rather than dropping them, because I
can't tell from here whether they came from you"* — which is the right instinct
and the right refusal. And it ended: *"Nothing is done yet; w04 is open."*

**Wake six**, thirty seconds later and before the agent ran at all:

    Studio handed "goals.js: add, list, complete — with tests under node --test" to Smith.

`w04` is now `in-progress`, assignee Smith, and `run_1a0e81f89b3` is building it
on `devdeck/goals-js-add-list-complete-…-0928`.

That is the design working as written: a wake reads the plan first
(`workers::handoff` → `next_open_item`), hands over the first unclaimed item,
and only falls through to a paid agent session when there is nothing to hand
over. The manager thinks on one wake and its worker builds on the next. Nothing
about that chain was new — the only broken link was that the thinking had
nowhere to be written down.

**`delegate` was never the missing piece.** Studio reaching for `delegate.start`
on Smith was improvisation after `work.add` failed, and it could not have
worked: Smith is a worker in the personal store, not an agent the delegate tool
can start. It is no longer offered in a session.

Not a bug, checked: the `sessions/…md` "cannot find the path" in the same run is
the model reading a session record before it was written.
