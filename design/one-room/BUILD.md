# One room

A design note, written 24 Sep 2026, after a trial run that worked well enough
to show exactly where it stops.

Nothing here is built. It is written down so it can be argued with before any
of it is code.

---

## What the trial actually measured

A manager (`DevDeck engineering`) was woken by hand. It handed a splash-screen
item to a worker (`Mason`, a sealed Claude Code session). 88 seconds, $2.01.

**Worked, and is now proven rather than assumed:**

| | evidence |
|---|---|
| Events survive a restart | two sessions in the `events` table; the 353 from the earlier run were still there |
| The event write no longer deadlocks | `work.claimed` published from inside a held database lock without freezing |
| The worktree seal holds | a watch on the live repo saw **zero** writes for the whole run |
| The worker does the job | three correct files: `tauri.conf.json`, `lib.rs`, a new `public/splash.html` |
| The receipt is honest | Mason said plainly it had verified nothing |

**Stopped, and this note is about why:**

- Mason could not run a single check and could not commit. `Bash` was on its
  wall and denied at every call.
- The work item never moved. All three splash items are still `unclaimed`. The
  worker did the work and the plan has no idea.
- The run is recorded `done`, `ok = true`, with nothing verified, nothing
  committed and the plan unchanged.
- The thread received one line — *"DevDeck engineering handed … to Mason"* —
  and then went quiet. Mason never spoke in it.
- That one line was written **twice**, into two conversation files, under two
  spellings of the same manager's name.

Every one of those is the same failure: one side does something, the other
side is looking somewhere else, and nothing complains.

---

## 1. The room is the feature's thread

**Decided.** One room per feature. The manager talks in it, the worker talks
in it, you talk in it, and a run started from it reports back into it.

The manager's own thread stays, for things that are not about one feature —
its wake report, its questions about the space as a whole.

This is not a new idea; `FeatureThread.tsx` already says *"the feature **is**
the room"*. The code stopped short of it: receipts go to the manager's thread
instead, which is why the feature thread you open is empty.

**What settling this deletes**

- The duplicate conversation records (`bot:<handle>` and `<Name>` writing the
  same line into two files at the same second).
- The question "which thread does this receipt belong in", which currently has
  two answers and no rule.
- The manager-standing-next-to-itself pill, which was a symptom of the above
  rather than a rendering bug.

---

## 2. Three channels, and the CLI already has all of them

Measured against the installed CLI, version **2.1.278**, rather than
remembered. This matters: the last time these were assumed, a worker was given
a shell it could never use.

### Asking, when it is blocked

```
--permission-prompts host  --permission-prompt-tool <devdeck's tool>
```

`--permission-prompt-tool` is not printed in `--help` any more but still
parses. With it, the CLI calls a tool **we** implement whenever a call needs
permission. That tool posts the question into the room, blocks, and returns
allow or deny once a person answers.

This replaces the plan recorded earlier in this session, which was to give
branch workers `bypassPermissions`. That was wrong, and it was wrong because
the choice was framed as "bypass, or never commit" when a third option was
sitting in the flag list. Mason should not have been denied `Bash`. It should
have asked, in the room, and waited.

### Speaking, when it is not blocked

```
--brief
```

*"Enable SendUserMessage tool for agent-to-user communication."* The worker
choosing to say something mid-run, unprompted — progress, doubt, a decision it
made and wants noticed. This is the channel the "updates" level below reads.

### Being answered

```
--input-format stream-json  --output-format stream-json
```

*"realtime streaming input."* The session becomes two-way: an answer typed in
the room is pushed into the running process. Without this, a question can be
asked and never resolved, which is worse than not asking.

### Also worth taking

`--restricted` removes `Bash`, `PowerShell` and `REPL` outright. That is a
truer expression of `writes: folder` than hand-listing the tools we allow, and
it fails closed rather than by omission.

---

## 3. How much of a run you see

**Decided.** A toggle on the thread, three levels, collapsed by default. Each
level has a different source, which is why this is cheap rather than a new
pipeline:

| level | where it comes from |
|---|---|
| **Milestone** | started · file written · check run · finished — DevDeck's own events |
| **Updates** | `SendUserMessage`, via `--brief` — the worker choosing to speak |
| **Full** | the raw `stream-json`, already captured by the log bus |

Full is a link into the existing log stream, not a second copy of it. A
transcript stored twice is a transcript that will disagree with itself.

---

## 4. One roster

**Proposed.** Agents and workers stop being two lists.

They are already one idea in the code. `aiw_providers` puts the CLI runners in
the same dropdown as the model providers, with this comment:

> the question the list answers — *what can this agent be pointed at?* — has
> one answer, even though a runner is a different kind of engine from a model
> provider.

And `runtime.rs` branches on it: an agent whose provider is `claude-code` runs
the CLI instead of calling an API. **An agent with provider = Claude Code is a
worker.** That path exists and works.

`workers.rs` was then built as a second store — its own files, its own roster,
its own editor, with `runner` hardcoded to `claude-code`.

What a worker genuinely adds is five fields, and they only mean anything for a
CLI runner, because only a CLI session has a filesystem and a bill:

`kit` / `skills` · `writes` · `minutes` / `usd` · `spaces` · `unattended`

So: **one roster, and the provider dropdown is the switch.** Pick an API
provider and it is a voice — talks in rooms, permissioned, no shell. Pick
Claude Code and the five sealing fields appear — it is a pair of hands.

This also settles the manager's configuration without an argument. `agent:`
and `worker:` are two fields for one slot — *who does the work when I wake* —
and a manager with both set silently ignores the second, because
`schedule.rs` checks the worker first and breaks out. One slot, one roster.

---

## 5. The AI Workspace stops being a place

**Proposed.** It is a rail view with no rail button: reachable only from a link
in Inbox, Explorer, Home or Settings. Inside it are its own sidebar, its own
chat, its own feature list, its own git panel, the agent editor, the provider
cards and the model picker.

Everything there except the provider and model configuration already exists
somewhere you actually look. Spaces has features and git. Threads have chat.
Workers has a roster.

So it becomes two things and ceases to be a third:

- **the roster** → Rail → Workers, where you already go
- **the plumbing** (providers, endpoints, keys, model defaults) → Settings,
  where configuration belongs
- **Chat, Features, Git, ContextInspector** → deleted, because Spaces does all
  four

---

## The bugs this replaces

Named here so none of them is quietly lost in a redesign.

| what | where |
|---|---|
| Live event feed drops any event from another project, so the global panel only updates on remount | `aiwStore.ts` `pushEvent` |
| An interrupted run never releases its worktree, so its item is poisoned for ever | `close_orphans` never calls `release_worktree` |
| `writes: branch` puts `Bash` on the wall that `acceptEdits` + `--permission-prompts none` guarantees it can never use | `workers.rs` `tools_for`, `cli_agent.rs` `args` |
| `has_shell()` returns true for a worker that cannot reach a shell unattended | `workers.rs` |
| The prompt tells the worker to write in the **main repo**; its cwd is the worktree | `run.folder` vs the shadowed `cwd` |
| A run that verified nothing and committed nothing is recorded `done`, `ok = true` | `workers.rs` |
| A wake publishes an event only when it proposes — a handoff, a quiet wake, and *"I want to start this but have no standing yes"* all publish nothing | `schedule.rs` |
| Worker events carry no `feature_id`, so they cannot be filtered to the room they belong in | `workers.rs` `in_space(node, None, …)` |

The wake one is worth saying twice. The moment a manager is **waiting on you**
is the moment that produces no event, which is exactly why Today cannot show
you what needs you.

---

## Still open

1. **What a question costs while it waits.** A worker blocked on a permission
   prompt is a live process holding a worktree. Does it hold its minute budget
   open, or pause the leash until answered? Unanswered questions at 3am are the
   normal case, not the exception.
2. **Who may answer.** A permission prompt from an unattended run is a standing
   grant question. `unattended: true` currently means "never ask" — it should
   probably mean "ask in the room and wait", with a separate setting for what
   may proceed without asking.
3. **Whether the old aiw agents survive at all.** One ran 13 turns, touched
   zero files, and was refused at the one moment it tried to act. They may be
   worth keeping as voices; they are not currently worth keeping as hands.
4. **Where Mason's uncommitted splash work goes.** Three files in worktree
   `run_1a0d14f21b7`, no commits, one `git worktree remove` from gone.
