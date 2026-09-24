# What we want, as of 25 September 2026

Two days of conversation in one place: what is built, what is agreed and not
built, what is still an argument, and what is broken. Written so the next
session does not have to reconstruct it from a transcript.

---

## 1. Built and pushed

On `feat/knowledge-base`, then `feat/a-real-provider`.

| what | why it mattered |
|---|---|
| Events kept in SQLite, with a session filter and a readable table | the bus lost everything on restart; you could not ask what happened on Tuesday |
| The sink moved off the publisher's thread | pressing Agree deadlocked the app outright |
| The live feed stopped filtering by the selected project | the Events panel only updated when you switched tabs |
| An interrupted run salvages its work and releases its branch | an interrupted run poisoned its item for ever |
| A worker reports into the feature's room, and the item moves | Mason did the job and the plan never heard |
| The brief names the worktree, not the repository | it told a worker to write into the live working tree |
| A run that verified nothing stopped calling itself `done` | and, later, a run that *did* finish stopped calling itself `blocked` |
| **A worker can ask, and you answer in the room** | `writes: branch` was a promise the wall could not keep |
| The mock is not a choice; a bad provider refuses a wake | three of six agents produced nothing real, one named a provider that does not exist |
| Git works in a worktree; orphans release their item; the first step names the right folder | all three found by one real run on the goal tracker |

The ask channel is the important one. The contract was measured against CLI
2.1.278 in three probe runs rather than remembered, because the last time these
flags were assumed a worker was given a shell it could never use.

---

## 2. Agreed, designed, not built

These are settled in conversation and drawn in the canvases. Nothing is in
code.

**One room per feature.** The manager hands over in it, the worker reports into
it, you answer in it. The manager's own thread keeps what is not about one
feature. Settling this deletes the duplicate conversation records and the
"which thread does this receipt belong in" ambiguity.

**How much of a run you see** — Milestones / Updates / Everything, collapsed by
default. Each level has a real source: DevDeck's own events, the worker
speaking through `--brief`'s `SendUserMessage`, and the raw stream already in
the log bus.

**One roster.** Agents and workers stop being two lists; the provider dropdown
is the switch. An API provider is a voice that talks in rooms; `claude-code` is
a pair of hands with a kit, a seal, caps and a loan list. A manager's work slot
may only point at hands.

**The AI Workspace stops being a place.** Its roster goes to Workers, its
provider and key configuration goes to Settings, and its Chat, Features, Git
and ContextInspector are deleted because Spaces already does all four.

**The rail, in four groups.** The work (Today · Items · Rooms) never moves;
what this space has is read from its folders; what is yours across every space
(Mail · Calendar · Team · Workers) never moves; Tools stays folded away.

**A company is a space; a product is a folder inside it.** Develtech has one
product, Innotrack has four, and neither is a special case.

**Managers sit above the spaces** and are answerable in as many as you give
them — which is why the team view is a list of full-width bands and not a
board. The code already allows this: a manager carries a list of businesses.

**Mail belongs to you and is filed to spaces.** Support inside a business is
that same list, narrowed. Nothing is copied.

**Today absorbs Dashboard and Inbox**, and gains what it cannot currently see:
runs in progress, proposals waiting on you, and managers that could not act.

---

## 3. Discussed, not yet decided

- **A phone.** Mirror the spaces, see state and progress, approve from bed,
  give it a voice. The vault stays on the PC. Events are the transport.
- **Connectors**, configured the way a harness does it: GitHub, Google Drive,
  Gmail.
- **GitHub issues as the roadmap**, so a promoted request is readable anywhere.
- **Community installs skills and MCP servers for workers**, next to Machine
  which installs tools for you.
- **The product lifecycle with gates you write** — idea, design, build, test,
  market, deploy, support — and nothing is promoted because a date passed.
- **The website looked after daily**: uptime, speed, dead links, headers,
  errors, what Google has indexed, and whether the copy still matches the
  product. It may draft a change on a branch; publishing stays yours.
- **Support answered with you as the approver.** It drafts, you send.
- **Requests and defects gathered from the mail, the support thread and the
  error log**, where "asked twice" is the line between noise and a roadmap.
- **Open-source tools a worker can carry** — design, pentesting, computer-use.
- Bitwarden, the YouTube channels, browser bookmarks. Not scoped.
- Validation: an unknown key in a file is reported, never ignored.
- Mail syncing on a schedule rather than only when you press it.
- Ports and local services a worker starts, picked up and shown.

---

## 4. Open questions that block work

1. **Does `Engineering lead` become one manager across Develtech and
   Innotrack, or stay two?** The vault has two today. Merging is what
   "managers work across businesses" implies, but it changes your team.
2. **Where do Analytics and Connections belong?** Parked in Tools; a database
   is usually *a product's* database, and analytics may belong to a product
   too. Least settled part of the rail.
3. **What a blocked worker costs while it waits.** Implemented as ninety
   seconds and then park, on the reasoning that holding a worktree, a leash
   and a bill open all night for someone asleep is the expensive way to be
   patient. Worth confirming.

---

## 5. Known faults, still open

- ~~Events are not being kept for recent runs.~~ **Found and fixed.** The
  event id was a process-local counter starting at 1 every launch, so
  `ev_00000007` named one event today and a different one tomorrow; the log
  stores by id with `INSERT OR IGNORE`, so every event of a later run whose
  number an earlier run had used was discarded without a word. Three silences
  in a row hid it — the sink dropped quietly, `keep` swallowed its error, and
  `IGNORE` is quiet by design. Ids now carry the run's start time.
- **A live run blocks a rebuild.** The asker is `devdeck.exe --ask-server`, so
  while a worker runs, the binary is held open.
- **Editing `src-tauri` kills a running worker**, because `tauri dev` restarts
  the app. It deserves a guard.
- **A repository with no git author identity is found the expensive way** —
  after a worker has written the code, run the tests, and failed to commit.
- **`dev-a` still names `scripted` on disk.** Refused rather than run now,
  which is the safe half; the file is not corrected.
- The two incompatible work-item editors, and `botSetWorker` having more than
  one door, both still there.

---

## 6. The rest of the current goal

From `design/a-real-provider/GOAL.md`, not yet done:

- **One reusable modal that sets a provider up** and checks the credentials
  before it closes, used everywhere a provider is chosen.
- **The sweep for dead links** and controls that cannot do what they say.
