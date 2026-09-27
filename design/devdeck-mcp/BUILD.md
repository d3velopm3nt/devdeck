# The bridge

A design note, written 27 Sep 2026, for the thing `docs/REVIEW-2026-09.md` §9
calls *"a DevDeck MCP server that adds item/approval/service/git tools next to
the existing ask tool"* — Phase 3.

Nothing here is built beyond the asker, which shipped today as `6b997fd`. The
rest is written down so it can be argued with before any of it is code.

---

## What set this off

While verifying L5 I drove the running app from outside it: the app was launched
with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`,
WebView2 opened a Chromium debugging port, and a script called
`window.__TAURI_INTERNALS__.invoke(...)` to start services, click the Logs tab
and read a live `stats:update`. It worked, and it was the right instrument for
the job.

**It is also exactly the wrong shape to keep.** A debugging port is arbitrary
JavaScript in a webview with no identity, no audit trail, and no authorisation —
reachable by any process on the machine, in an app that holds a mail password in
Credential Manager. It proved the appetite for a programmatic surface. It is not
that surface.

The important discovery was in the codebase, not in the trick.

---

## Most of this already exists

`aiw/tools.rs` holds a registry of **twelve tools**, each with actions and **a
JSON Schema per action**. The schemas are not decoration; the file says why:

> a real provider must be handed a parameter schema per callable or it cannot
> emit a valid call at all

| tool | actions |
|---|---|
| `files` | read · list · write |
| `git` | status · log · diff · commit |
| `terminal` | run |
| `process` | start · status · logs · stop |
| `tests` | run |
| `knowledge` | search |
| `delegate` | start · status |
| `bots`, `routine`, `skill`, `memory`, `work` | plan, rhythm, kit and memory operations |

Every tool appears in one permission matrix, with four levels and a safe
default:

    Full · Read · Approval · None   (#[default] None)

So an MCP server is **largely a translation layer, not a new capability**:

    MCP tools/list   ←  registry(), filtered by the caller's matrix row
    MCP tools/call   →  the dispatcher for that tool

Authorisation, audit, schemas and the human-in-the-loop path all come for free.
Two things genuinely do not exist, and they are the whole of the work — but
first, a wrinkle that sits in the middle of them.

### There is not one dispatcher. There are two.

`is_assistant_tool` says so plainly: **half the registry never reaches
`ToolService`.**

| dispatched by | tools |
|---|---|
| `ToolService::execute(bus, agent_id, scope, call, cause)` | `files` `git` `terminal` `process` `tests` `knowledge` |
| the assistant (`assistant.rs:1974`) | `delegate` `memory` `bots` `routine` `skill` `work` |

The reason is in the comment above it, and it is a good one:

> They are in the registry so they appear in the permission matrix like
> everything else — you should be able to see and revoke the orchestrator's
> right to spawn agents. They are not *dispatched* here because one needs the
> whole workspace and the other writes to the personal store, and a
> project-scoped tool service has no business reaching either.

This matters more than it looks, because **the two tools Phase 3 most wants are
both on the assistant side**: `work` (the plan) and `delegate`. So the bridge
cannot simply forward to `ToolService` and be done. It has to route per tool, and
for the assistant half it has to answer a question that has not come up before:
what runs an assistant tool when there is no conversation? Today those calls
happen inside a turn the assistant is taking. A worker calling `work.done` is not
in anybody's turn.

The gate is also not uniform. `ToolService::execute` publishes `ToolRequested`,
then `ToolExecuted` or `ToolFailed`, with `ToolApprovalRequested` /
`ToolApprovalResolved` around a human decision. The assistant half has its own
path — and `work.*` is deliberately usable by a bot **with no row in the matrix
at all**, because a plan is files in the deck rather than the machine. Whatever
the bridge does must preserve that asymmetry rather than flatten it.

---

## 1. The bridge, because the gate is in-process

`ToolService` holds `root`, `deck_root`, `project_id`, the matrix and the
approval broker. It lives in the app process, beside the database, the event bus
and the service manager. An MCP server must be a **separate process on stdio**,
because that is how a CLI spawns one. So there is an IPC hop, and it has to be
chosen rather than inherited.

`asks.rs` does its hop with **files**, and that is right for what it carries:
one question, human-paced, answered minutes later, and it must survive the app
being replaced by a newer build mid-run. Tool calls are none of those things —
frequent, latency-sensitive, ordered, and some of them stream. Files are the
wrong shape twice over.

**Proposal: a Windows named pipe with an ACL, named per run, closed with the
run.** Not a localhost TCP port: a port is reachable by any local process, which
is the same objection as the debug port and worse here, because this channel is
authorised. The pipe's name is written into the MCP config beside the worktree,
exactly as the ask config already is.

## 2. Identity, which decides the shape of everything else

The matrix keys on `agent_id` and fails closed — an unknown agent gets nothing.
So every client needs an identity, and the three candidates are not the same
problem:

| client | identity today | verdict |
|---|---|---|
| a worker DevDeck spawned | run id, worker, node, feature — all of it | **v1** |
| an outside agent you point at DevDeck | none | needs a minted, revocable token |
| the phone (`WHAT-WE-WANT.md` §3) | none | same as above |

**v1 is workers only, and that is the point.** A run already has an identity and
a scope; the config is written per run; the pipe dies with it. No new trust model
is introduced, and nothing has to be revoked because nothing outlives the run.
Every hard security question belongs to the outside-agent case, and that case can
wait until there is something worth pointing at DevDeck.

It also happens to be what Phase 3 actually asked for: tools *next to the
existing ask tool*, for the worker that already has the ask tool.

---

## 3. One bridge binary, two modes

`devdeck-ask` is already "a stdio MCP server that forwards to the app and waits".
The tools server is the same shape with more tools and a live channel instead of
a folder. Making them one binary — `devdeck-mcp --ask` / `--tools`, or one
server offering both sets — buys three things:

- **one thing to ship.** L9's unfinished half is the release bundle carrying the
  asker beside the app. That work is identical for one binary and for two, so
  doing it once is strictly cheaper.
- **one config writer.** `asks::write_config` becomes the only place that tells
  a CLI how to reach us.
- **one relink boundary.** Measured today: a bin target is relinked whenever its
  package's lib changes, *even one that never mentions the lib*, and a running
  copy fails the build with `Access is denied`. That is why the asker is its own
  crate. The bridge must stay in that crate or get its own — never a `[[bin]]`
  bolted onto `devdeck`.

The cost of folding them: a change to the tools protocol relinks the asker, so a
worker sitting at a question blocks that build. Today the asker is quiet enough
that this never happens; a tools protocol under active development would not be.
**That is the one argument for keeping them separate, and it is a real one.**

---

## 4. What is exposed, and what never is

The registry omits mail, Credential Manager and the stash's clip values. It does
**not** omit the personal store — `memory` writes there on purpose, and it is in
the registry precisely so it shows up in the matrix and can be revoked. That is
the pattern to copy, and it should become a written rule:

> The bridge exposes the tool registry and nothing else. A capability reaches an
> agent by being added to `tools.rs` with an access level and a schema, where the
> matrix can see it — never by being added to the bridge.

Two consequences worth stating. The bridge exposes **twelve tools, not the
three-hundred-odd Tauri commands** — far less than the debug port, and that is
the feature. And a capability that should be human-only stays that way by being
absent from the registry, which is checkable and reviewable, rather than by being
absent from a match arm in the bridge, which is neither.

---

## 5. The gaps

Ordered by how expensive they are to discover late.

**Two dispatchers, and one of them expects a conversation.** Set out above: six
tools go through `ToolService`, six through the assistant, and the two Phase 3
cares about most (`work`, `delegate`) are on the assistant side. An assistant
tool runs inside a turn today. Deciding what runs one for a caller that is not in
a turn is the first real design question, not an implementation detail.

**Recursion and spend.** `delegate.start` starts work. A worker holding
`delegate` can start workers, which can start workers. There is a per-worker
minutes-and-dollars cap today and it is per run, so a tree of runs multiplies the
bill rather than sharing it. Needs a depth limit and a budget that belongs to the
tree. *This is the one that costs money if we miss it.*

**Concurrency and atomicity.** Two callers claiming one work item. Already a
known gap — §9 lists *"atomic item checkout tied to a run"* as missing — but a
server turns it from theoretical into likely, because `work.add/done/drop`
becomes reachable by anything holding the pipe.

**Streaming.** `terminal.run`, `tests.run` and `process.logs` produce output over
time; an MCP tool call returns once. Either a tail/poll action, or MCP
notifications, or the client is told to read the log bus. Unsolved, and the first
thing a worker will want.

**Long calls.** An `Approval` tool blocks while a person decides. The asker's
ninety seconds was chosen and then *measured* against CLI 2.1.278; the tools path
must be measured too, not assumed to behave the same.

**Ambient scope.** `ToolService` is constructed per project. A worker run knows
its node and feature; an outside client knows neither, so it would have to pass
them on every call — a different API. Decide before the schemas are public,
because afterwards it is a breaking change.

**The schemas become a contract.** Rename an action once something outside the
repo depends on it and you have broken it. Needs a version on `tools/list`.

**The matrix is per server, not per tool** for MCP rows (`commands.rs:610`) —
granting a server grants everything it exposes. That is a listed known gap for
servers DevDeck *calls*; the same coarseness would apply to the one it *offers*.

**Revocation.** Pulling a client's access mid-run, and what the worker is told
when it happens.

**Failure honesty.** If the bridge cannot reach the app, a tool must refuse and
say so. A silent degrade here is the same species as the monitor bug found this
morning — the refresh never asked for the two fields the loop read, and nothing
complained for months.

**Testing.** `mcp.rs` already set the precedent: `Client` speaks to a
`Transport`, `StdioTransport` is one, and the tests use a scripted transport that
answers from memory — *"nothing about the protocol is mocked; only the pipe is."*
The server side needs the same, or these tests will spawn processes and be slow
and flaky.

---

## 6. Build order

1. **The pipe, with one tool.** `git.status` over a named pipe, per run, refusing
   loudly when the app is not there. A read, on the `ToolService` side, so it
   proves the transport and the identity without writing anything and without
   waiting on the assistant question.
2. **`tools/list` from `registry()`**, filtered by the caller's matrix row, so a
   worker sees exactly what it may call and no more.
3. **`tools/call` into `ToolService::execute`** for the six project-scoped tools,
   with `ToolRequested` / `ToolExecuted` checked in the events table afterwards
   rather than assumed.
4. **The assistant half**, once §5's first gap is settled — `work` before
   anything else, because a worker that can move its own item is most of what
   Phase 3 is for.
5. **Approval through the room**, reusing the asker's path, with the client's
   tolerance for a blocking call measured rather than inherited.
6. **Streaming**, whichever way §5 settles.
7. **The bundle** — the asker and the bridge shipped beside the app. L9's
   remaining half, done once.

Delegate stays out until the depth limit and the shared budget exist.

---

## 7. Why this is load-bearing

It is not one plan item. **The phone, GitHub-issues-as-the-roadmap, and triggers
from services, git and CI all need a programmatic surface**, and this is it.
Building it once for workers makes those three cheaper. Skipping it makes each of
them invent its own hole in the side of the app.

---

## Still open

Three calls, all yours:

1. **Workers only for v1**, or is an outside agent — this conversation, a phone —
   wanted early enough to justify designing the token now?
2. **Named pipe**, or something else?
3. **One binary or two.** Folding saves a bundle, a config writer and a crate;
   keeping them apart means a tools-protocol change never blocks a worker who is
   waiting at a question.
