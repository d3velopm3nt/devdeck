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
| 1 | **Stale docs.** `ROADMAP.md` still leads with "⚠️ Blocker: the repo is private", says 0.2.9 tagged / 0.2.8 released, and `CLAUDE.md` repeats it. Measured tonight: repo is **PUBLIC**, **v0.3.1** released, `latest.json` → **HTTP 200**, scoop bucket at **0.3.1**. `CLAUDE.md` also still says the app cannot be driven in this session, which stopped being true today. | no false claim left in either file | open |
| 2 | **Bot → manager, one name.** `CLAUDE.md` says "a bot is a manager"; the code says `bots.rs`, `bots_list`, `bot_thread`, a `bots/` folder, while the vault says `team/` and the UI says both. | no user-facing "bot" left; the gate green | open |
| 3 | **Delete `bot_thread`.** A manager has a conversation of its own, separate from the space it works on — the same duplication as the page deleted in `3f8bdba`. `design/one-room/BUILD.md` says the room is the thread and the manager hands over *in it*. | a manager's messages land in the space's room; no separate bot conversation | open |
| 4 | **A manager plans from its goal, not from its template.** Studio's first wake proposed "list the repositories the business depends on" for a goal-tracker space — boilerplate from `template: role:engineering`. | a wake on the goal tracker proposes goal-tracker work | open |
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
| 12 | **L9b** — the release bundle carries no `devdeck-ask` | a bundle has it beside `devdeck.exe` | open |

### Needs the owner

| # | item | why | status |
|---|---|---|---|
| 13 | Two incompatible work-item editors | which one survives is a product call | ask |
| 14 | `botSetWorker` has two doors | same | ask |
| 15 | Seeding GitHub issues | the repo is public; publishing internal notes is a disclosure decision | ask |

## Log

| # | item | before → after | gate | note |
|---|---|---|---|---|
| 0 | — | — | — | queue rewritten for the night run |
