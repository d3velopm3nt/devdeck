# The loop queue

Working state for a `/loop` session that builds and verifies DevDeck one item at
a time. **Read this file at the top of every iteration and update it at the
bottom.** Nothing about progress is kept in the model's head: a loop running for
hours gets compacted, and a queue remembered rather than written down is a queue
that silently restarts.

---

## The gate

One command. An item is not done until this is green, and an iteration that
leaves it red has failed — it is not a new item to add to the list.

```bash
cd src-tauri && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && cd .. && npx tsc -b && npm run lint
```

Baseline at the time of writing: **651 tests pass**, clippy/fmt/tsc clean, lint
warnings unchanged. The count only goes up.

## Rules

1. **One item per iteration.** A debug link is four to five minutes on this
   machine; a full `cargo test --workspace` is another minute. Trying to do three
   things per iteration means finishing none of them.
2. **Leave the app stopped.** A running `devdeck.exe` blocks a rebuild, and
   editing `src-tauri` restarts a running app and orphans any worker. Start it
   only to verify something that needs the real app, then stop it again.
3. **Each item carries its own check.** A number that must move, a command that
   must pass, or a test that must exist. An item with no check does not get
   worked — it gets marked `ask`.
4. **Verify against evidence, not against intent.** Re-measure the number after
   the change. "Should be fixed now" is not a verification.
5. **Never** touch `.keys/`, cut a release, change repository visibility, or
   commit to `main`.

## Stopping

Stop and report, rather than continuing, when any of these is true:

- the queue has no `open` item left
- the gate is red at the end of an iteration and one attempt to fix it failed
- **two iterations in a row close nothing** — that is the "going in circles"
  detector and it matters more than an empty queue
- every remaining item is `ask`, meaning the rest needs a decision that is not
  the loop's to make

---

## Queue

Status: `open` · `doing` · `done` · `ask` (needs a human decision) · `parked`

| # | item | check that decides it | status |
|---|---|---|---|
| 1 | **L3** — bare `useApp()` subscriptions re-render the whole shell | `grep -roE "useApp\(\)" src/ \| wc -l` is **62** → 0, and a lint rule bans the bare call so it cannot come back | open |
| 2 | **L2** — `Home` and `ServiceDetailPage` subscribe to the entire log array to show a few lines | neither file reads the whole array; a derived last-N slice per service instead | open |
| 3 | **L4** — sync commands run on the UI thread | **308 of 386** commands are sync. Convert the DB-touching ones in batches, keep `pty_write` sync and ordered, and record the count each iteration | open |
| 4 | **L7** — a bot wake runs `wake_agent` on the scheduler thread (`schedule.rs:631`), so a 20-minute run stops every reminder and deadline | a wake goes to a pool; a test asserts a long wake does not stall a due reminder | open |
| 5 | **L8** — Explorer, Stash and Mail render full lists | each holds a bounded row count under a long list, measured the way the Logs panel was (`rowsInDom`) | open |
| 6 | **L9b** — the release bundle does not carry `devdeck-ask` beside the app, so an installed build has no asker | a built bundle contains `devdeck-ask.exe` next to `devdeck.exe`, and `asks::asker()` finds it | open |
| 7 | **Editing `src-tauri` kills a running worker** — `tauri dev` restarts the app and orphans the run | a guard: either the watcher is held while a run is live, or the restart salvages first and says so | open |
| 8 | **A repo with no git author identity is found the expensive way** — after the code is written and the tests pass | a branch handoff is refused up front, naming the repository, before anything is spent | open |
| 9 | **`dev-a` names `scripted` on disk** — refused rather than run, which is the safe half; the file is still wrong | the agent file names a provider that exists, or the agent is removed | open |
| 10 | **Two incompatible work-item editors** | one editor, one shape | ask |
| 11 | **`botSetWorker` has more than one door** | one path in | ask |

## Log

Append one line per iteration: what was attempted, the number before and after,
and the gate's verdict. This is what the "two iterations closed nothing" rule
reads.

| iteration | item | before → after | gate | note |
|---|---|---|---|---|
| — | — | — | — | queue created, nothing attempted yet |
