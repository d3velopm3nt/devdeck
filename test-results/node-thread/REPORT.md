# Node as conversation — test report

Built 2 September 2026 on `feat/ai-workspace`, against
[`design/node-thread/BUILD.md`](../../design/node-thread/BUILD.md) and the
*Bots as teammates* entry in [`ROADMAP.md`](../../ROADMAP.md).

**Result: the fifteen items are built.** Every screen below is the running app
on this machine, reading the real vault, the real deck and the real provider —
nothing on screen is a mock-up, and no screenshot was staged by writing a
transcript by hand.

| | |
|---|---|
| Rust tests | **325 passed, 0 failed** (`cargo test --lib`), four consecutive clean runs |
| Typecheck | clean (`npx tsc -b`) |
| Commits | six, each one slice |
| New tests | 24, covering mentions, handovers, feature threads, bot-to-bot, the write gate, review points and the folder→feature chips |

## How this was tested

This session cannot deliver clicks or keystrokes to a WebView2 window, so the
UI was not driven by hand. Each screen was selected by
[`scripts/capture-team.ps1`](../../scripts/capture-team.ps1), which rewrites a
dev-only harness file and restarts the binary. Where a thread had to *contain*
something, the message was sent through the same commands the composer calls —
real personas, real provider, real transcript on disk. The harness chooses
what gets said; nothing about what comes back is scripted. It ships empty.

The Assistant runs on Anthropic (Opus) here, so its replies are real model
output. The specialist agents (`dev-a`, `qa`) are on the mock provider, which
is why they say so themselves in the transcripts below.

---

## 1. A feature is a room, and two bots talk in it

![Two bots in one room](screenshots/02-two-bots-in-a-room.png)

One message, two answers. **DevDeck bot** manages this goal, so it answers
first; **x-platform bot** was named with `@x-platform`, so it was pulled in and
answered as itself. Both are in one conversation record — the header lists who
is in the room, and every message carries who said it.

This is bot-to-bot with nothing special about it: same loop, same transcript,
different persona. A reply is never re-read for mentions, so two bots naming
each other cannot talk each other into a bill.

## 2. A mention is free; a handover is a claim transfer

![The Offline sync room](screenshots/01-team-goals.png)

The Demo workspace, where an agent may actually write. Reading down the room:

- `@qa the suite went red overnight` → **qa pulled in**, and the assistant
  goes and looks (the folded step row is the evidence, not a claim).
- `@dev-a take "Fix dirty_files path parsing"` → **the claim moves**:
  *"Fix dirty_files path parsing" claimed by @dev-a — was unclaimed.*
- The session that started reports back into the same room:
  *Developer A finished — 3 turns, 1 file touched, 0 refused.*

The gate is real: with `delegate` revoked, the same message refuses and says
why, and nothing moves. That is a test, not a screenshot
(`handing_work_over_is_refused_when_the_speaker_may_not_delegate`).

## 3. Team, opening on Goals

Goals is the first view: every space, grouped *Moving / Waiting on you /
Quiet*, and selecting one opens its thread — see the two screenshots above,
which are both the Goals tab.

### Features

![Features](screenshots/03-team-features.png)

Every feature in every space, with who manages it, who is on it and what was
last said. Filters are the states worth acting on rather than the statuses the
deck happens to store.

### Work

![Work](screenshots/04-team-work.png)

Every open item, grouped by feature. These fifteen are the items of this goal —
the same list as `BUILD.md`. *"nobody yet"* is an unclaimed item; a live claim
shows the agent holding it.

### Bots

![Bots](screenshots/05-team-bots.png)

A contact list: the Assistant first, then bots with what each last said, then
agents with what each is doing. The bot's own thread is on the right. The
folded `2 steps git` row is a run of tool calls collapsed to one line.

## 4. Every node is a conversation

![A project's thread](screenshots/06-node-thread.png)

A repo-backed node: its branch, its bot, its open items and its path as chips;
Context, Git, Dashboard and Settings as buttons — those five rows have left the
tree. The footnote says what this node can do: *it owns a repository, so it can
read the code and the commits under it.*

![A parent's thread](screenshots/07-parent-headlines.png)

The parent of that node, which owns no repository. It answers from its
children's **headlines** and says so outright: *"This node (Innotrack) has no
repository of its own — it's purely organizational. I cannot read code or
commits here directly."* That sentence is the whole point of item 7.

## 5. The tree shows real places

![Spaces](screenshots/08-spaces-tree.png)

Under a project the tree now goes into the repository: real folders and files,
read when you expand and not before. The Assistant / Context / Git rows are
gone; Commands and Services stay, because they are things the node has.

A chip on a folder says which feature it is part of, derived from work items
whose `areas` name that path. No work item in this vault names a path yet, so
no chip appears here — which is the honest rendering, and the derivation is
covered by tests in `src-tauri/src/files.rs`.

## 6. What is left of the old surfaces

![Inbox](screenshots/09-inbox.png)

The Inbox is only what needs you. *"Across every space. What merely happened is
on Home."*

![Home](screenshots/10-home.png)

![Routines](screenshots/11-settings-routines.png)

The Scheduler is Settings → Routines. Four bot heartbeats, including the
DevDeck bot whose `_bot.md` was written by hand — the clock row was reconciled
from the file, which is the rule the vault has always followed.

![Assistant settings](screenshots/12-settings-assistant.png)

The Assistant left the rail: it is a contact on Team → Bots, and what is left of
its old surface is configuration.

## 7. It runs with the harness empty

![Shipped defaults](screenshots/13-shipped-defaults.png)

The same build with every capture knob blank, restoring the layout it was left
in. The parent's chips now read *11 open items* rather than 25, because the
goal's work items were ticked in `work.md` — the deck is the record, and the
app is reading it.

---

## The fifteen items

| # | Item | State |
|---|---|---|
| 1 | Feature threads | **Built** — screenshots 1 and 2 |
| 2 | `@mentions`, and handover as a claim transfer | **Built** — screenshot 2; the gate is tested |
| 3 | Agents post back into the thread | **Built** — screenshot 2, the receipt line |
| 4 | Team surface opening on Goals | **Built** — screenshots 1–2 |
| 5 | Features and Work tabs with bots | **Built** — screenshots 3–4 |
| 6 | Bots tab, contact list plus thread | **Built** — screenshot 5 |
| 7 | A thread at any level of the tree | **Built** — screenshots 6–7 |
| 8 | Spaces tree into the repository | **Built** — screenshot 8; chips tested, none to show yet |
| 9 | Rail: Team · Inbox · Spaces · Home · … | **Built** — every screenshot; four pages deleted |
| 10 | Config as a sentence; approvals at the natural unit | **Built** — no screenshot: needs a live approval prompt |
| 11 | Event-triggered routines | **Built** — no UI of its own; a routine with an event trigger is made by asking |
| 12 | `stop_at` and skills | **Built** — `stop_at: [before any push]` is in the DevDeck bot's file; the runtime stops such a call and says which rule stopped it |
| 13 | Collapse "what happened" | **Partly, deliberately** — see below |
| 14 | Decide the offline path | **Decided** — the forms stay; every thread says when the mock is answering |
| 15 | The bot's team | **Built** — the file's list plus anyone *you* pulled into its thread |

**Item 13 is the one judgement call.** BUILD.md says Home's activity stream
folds into threads. You asked for the opposite in August — *"the activity /
notifications should be on the home page side"* — so Home keeps its stream, and
what was collapsed is the duplication: the Assistant's Activity page is gone,
the Events page is gone, and the Events tab in the bottom bar now says in its
header that it is the raw bus for debugging. Say the word and Home's stream
goes too.

## Bugs found by running it, and fixed

Four, none of which the tests would have found on their own:

1. **A thread could lose messages.** Three things write to one room — your
   turn, an agent's session ending, a bot's wake — each doing
   read-modify-write on the same file. The first end-to-end handover lost the
   assistant's own reply. Turns now append to what is on disk, under one
   process-wide write gate.
2. **Two rooms for one feature.** Find-or-create was read-then-write with no
   lock, so two callers could each make a room. "The feature *is* the room" had
   two of them.
3. **A reply deduped as its own evidence.** The append fix treated same time,
   same words, same speaker as a duplicate — and a tool result and the reply
   reporting it are routinely all three. The transcript stopped at the tool
   call.
4. **A handover with prose after the title found nothing.** `take "Fix
   dirty_files" — the one qa keeps tripping over` read the whole tail as the
   title. A quoted title now ends at its quote. The refusal was honest, which
   is how this was visible at all.

One more, found on the way: a bot page restored from a saved dock layout
re-opened its interview every time, which is exactly what its own comment says
must not happen. The flag is consumed once now.

## Things worth your decision

- **A bot was created on TrackX-mobile.** `DevDeck bot`, managing this goal,
  team `dev-a, qa`, `stop_at: before any push`. It is a real file at
  `~/DevDeck/Innotrack/TrackX-mobile/_bot.md`; delete it and the clock row goes
  with it.
- **A demo feature was seeded** in the Demo workspace
  (`~/DevDeck/Demo/TyreX Platform/TyreX/.devdeck/features/offline-sync/`) so a
  handover could be shown without an agent writing into a real repository.
- **That node is still called TrackX-mobile** while pointing at the DevDeck
  repository. Renaming it is one click and it is your call.
- **Every message in a thread is a model call.** The five exchanges above cost
  real Anthropic calls on your key.
