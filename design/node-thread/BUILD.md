# Build prompt — Node as conversation

You are continuing DevDeck on branch `feat/ai-workspace`. Read `CLAUDE.md`
first, then the *Bots as teammates* entry under *Designed, not built* in
`ROADMAP.md`. The design canvas is
https://claude.ai/code/artifact/536d3183-3086-429a-8645-758ae9d97fcd — page 1
is a clickable prototype of the node thread, page 2 the Team surface, page 3
the direction not chosen. The goal and its fifteen work items are in the
vault, on the node that names this repository (currently called
**TrackX-mobile** under Innotrack; rename it *DevDeck* if you like):
`~/DevDeck/Innotrack/TrackX-mobile/.devdeck/features/node-as-conversation/`.

## The model, in eight lines

A **bot is a manager**: it holds a goal, wakes on a rhythm, and puts agents on
what it finds. You talk to it in a **thread**, not a form. Three threads, one
message model: a **node's** thread at any level of the tree (a parent sees
its children as headlines, never full context — context anchors to a commit
and a parent has none); a **feature's** thread, where bots and agents
collaborate with `@` (the feature *is* the room; nothing new on disk); and
**`@you`**, which is the Inbox. First view is **Team**, opening on **Goals**
(global, grouped by goal), with Features, Work and Bots as tabs. Second is
**Spaces**: the tree, nodes only, reaching into the repository.

## Rules that are not up for interpretation

- **Being in a thread is free; being handed work is a claim transfer**,
  governed by the team list and standing grants like everything else.
- **Permissions fail closed.** An id the matrix has never heard of gets
  nothing. That is how a bot with no agent talks but cannot act. Grants only
  ever *refine* `Approval`; they never widen a level that was not going to ask.
- **Two directories, two questions.** `db::node_dir` is where work runs (the
  repo when named); `db::node_deck_dir` is where what we know lives (the
  vault, always). Never collapse them again.
- **The store split.** Node state in `.devdeck` in the vault folder; anything
  about the user in the personal store, which refuses to live in a git repo.
- **Every bot-to-bot message is a model call.** The mock provider makes
  the plumbing testable, not the words. Item 14 decides the offline path;
  until then the existing forms stay and nothing may *require* a key.
- **Failure honesty.** An empty answer and an unanswerable question must not
  look alike. "Nothing changed" from a folder with no repo, "up to date" from
  an unreachable server, "nothing yet" while still loading — all three have
  bitten this codebase. Say which it is.
- **Keep it simple.** The person you work for is good at over-engineering and
  asked to be stopped. No new rail entries. No new store. No new object when
  an existing one can carry the fact. If a slice widens, stop and say so.

## What exists to build on

- Every vault node is already an AI Workspace project with its own deck
  (`aiw/commands.rs::sync_projects_from_tree`).
- `ConversationMeta` is the one record for a thread; it carries `bot_node`.
  `Conversations::for_bot` finds-or-creates; `post_as_bot` appends a receipt.
- `Assistant::send_as(persona)` runs a turn as the assistant or a bot; the
  assistant is one caller. `bots::persona()` builds a bot's voice from
  `_bot.md` on every turn. `bot_thread` / `bot_thread_send` are the commands;
  `src/components/bot/BotChat.tsx` is the Chat tab, first on the bot page.
- A wake posts into the bot's thread (`schedule.rs`, the `"bot"` arm).
- Claims (`WorkClaim`, status `active`), the conflict detector, the event
  bus (`aiw:chat` for streaming, `activity:new` for the feed), standing
  grants, `activity_for(ref_id)`, `aiw_all_work(project_id?)`.
- The bots tool (`TOOL_BOTS`) — the assistant can create a bot, approval-gated.

## The fifteen items, in order, with what "done" means

1. **Feature threads.** A conversation marked with its feature (`feature:
   Option<String>` beside `bot_node`), found-or-created from the feature,
   opened from a feature row. Done: open any feature, see its thread, say
   something, get an answer from the managing bot's persona (or the
   assistant's if none manages it).
2. **@mentions.** Parse `@agent` / `@bot` in a message. A mention pulls that
   agent or bot into the thread — it reads the thread from there on. A
   mention never hands over work; that is a claim transfer, and it goes
   through the same gate as `delegate.start`. Done: `@qa look at this` makes
   qa a participant; `@dev-a take "Fix dirty_files"` moves the claim only if
   the mentioning party may delegate.
3. **Agents post back.** A session started from a thread reports into it
   when it finishes — one message, the receipt shape (what ran, what
   changed, what it could not do). In the bot's own thread these appear
   under a *Messages from @qa and @dev-a* divider, as a view of the feature
   thread, not a copy. Done: start an agent from a thread, watch its result
   land there.
4. **Team surface, opening on Goals.** Rail entry *Team*. Goals: every
   space, right now, grouped by goal — *Moving / Waiting on you / Quiet* —
   selecting one opens its thread. Done: with two features moving in two
   spaces, both appear, and a `@you` card is what moves one to *Waiting*.
5. **Features and Work tabs with bots.** Features: managed by, on it, last
   said, filters (All / Moving / Waiting on you / Nobody on it / Quiet /
   Done). Work: every open item grouped by feature, *has it* as a live
   claim, *nobody yet* with the bot's suggestion. `@you` rows amber and the
   same rows that are in the Inbox.
6. **Bots tab.** Contact list — bots (Assistant first), then agents with what
   each is doing — and the bot's own thread on the right. Move the existing
   Chat tab here; keep the bot page's other tabs behind it.
7. **Node thread at any level.** Talk to a workspace, a folder, a project.
   A parent rolls its children up as headlines (bot well/badly, open items,
   last failure) and says outright it has no repository up there. Full
   context stays on the node that owns the commit.
8. **Spaces tree.** Nodes only: the Assistant / Context / Git / Commands /
   Services rows leave the tree and become what the node's page has. The
   tree goes into the repository (folders and files). A label says what a
   folder *is*; an item chip says what it is *part of*, derived from which
   feature's work items name files in it. Files inherit the folder's chip.
   Decide with the owner whether pinning by hand is also wanted.
9. **Rail.** Team · Inbox · Spaces · Home · Stash · Machine · Settings.
   Retire the Bots, Work, Events and Scheduler *pages* as rail entries; each
   becomes a tab or a filter. Delete what they replace — do not leave two.
10. **Config by sentence, approvals at the natural unit.** "Do this every
    weekday morning" creates the routine and drops a receipt line; the
    routine is still a clock row and a line in `_bot.md`. Approvals ask one
    question for the natural batch — *Allow once / Allow until morning / No*
    — and "until morning" writes a standing grant and says so.
11. **Event-triggered routines.** A routine whose trigger is a bus event —
    tests failed on master, a push, a file changed under a path — not only a
    time. Narrow matching rules; a broad listener is noise.
12. **`stop_at` and skills.** `stop_at:` in `_bot.md` ("before any push") is
    a review point the runtime honours by stopping and asking. "Save what we
    just did as a skill" from a thread writes a skill the bot's `skills:`
    can name.
13. **Collapse "what happened."** Three places, not six: the thread that did
    it, the Inbox for `@you`, Logs for raw process output. Home's stream and
    the Assistant's Activity page fold into threads; the Events tab may stay
    as the raw bus for debugging, but say so in its header.
14. **Decide the offline path.** Either the forms remain a complete way to
    make spaces, bots and routines with no API key, or the app says plainly,
    in the thread, that bots cannot talk without one. Put the decision in
    `ROADMAP.md` and make the app match it.
15. **The bot's team.** From a static `team:` list to thread membership. Keep
    the rule — handing work is a claim transfer — and drop the list, or make
    the list *derived* from who has been pulled in. Update `vet_team` and
    `wake_agent` to match; both have tests.

## How to work

- One slice per commit, in this order; each commit message says what was
  wrong before and what is true now, in plain words.
- Before every commit: `npx tsc -b` (never `tsc -p tsconfig.json`) and
  `cd src-tauri && cargo test`. 298 pass at the start.
- Run the app with `npm run tauri dev`; port 5173 must be free first. If
  screenshots come back white, the desktop session is gone — say so rather
  than claiming to have seen the screen.
- When a slice needs a decision the owner has not made, stop and ask with
  the options and their costs. Do not widen the slice to avoid the question.
- Update `ROADMAP.md` when a slice ships (move it from *Designed* to
  *Shipped*) and `CLAUDE.md` when a rule changes. Tick the work item in the
  deck — `work.md` is the record; a bot managing this goal reads it.
