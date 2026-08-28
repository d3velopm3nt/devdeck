# DevDeck AI Workspace — implementation

Humans and AI agents working on the same project, coordinated through events
and a small, Git-versioned, per-feature context.

The claim this design has to earn: **the LLM is replaceable.** Everything below
the provider layer — context, tools, work, conflicts, sessions, Git — has no
idea which model is answering, and the mock agents prove it by going through
exactly the machinery a real one will.

See [`test-results/ai-workspace/REPORT.md`](test-results/ai-workspace/REPORT.md)
for what was tested, what was found, and what was not verified.

---

## Architecture

```
Workspace → Project → Feature → Work Item → Session
```

The **Feature** is the collaboration boundary: it owns a context, requirements,
decisions, work items and sessions, and it is the unit agents are scoped to.

```
src-tauri/src/aiw/
  commands.rs   Tauri entry points — the only surface the UI can reach
  runtime.rs    AgentRuntime: the session lifecycle every agent goes through
  provider.rs   LLMProvider trait + Mock / Anthropic / OpenAI-compatible
  tools.rs      ToolRegistry + ToolService — agents reach the machine only here
  context.rs    Assembly, checkpoints, deltas, reconciliation
  conflict.rs   Watches the bus, decides when two pieces of work disagree
  deck.rs       `.devdeck` on disk — the durable source of truth
  state.rs      Live workspace state (sessions, claims, test runs)
  events.rs     The bus everything else talks through
src/
  lib/aiw.ts        types + IPC, mirroring the Rust contract
  lib/aiwStore.ts   UI state; holds what the backend said, never a derived copy
  components/aiw/   AiwSidebar + AiWorkspace (the screens)
```

The dependency arrow points one way, down. `deck` knows nothing about agents;
`provider` knows nothing about `.devdeck`; `events` knows nothing about Tauri.
That last one is load-bearing — see *A note on linking*.

---

## Durable state: `.devdeck`

Markdown with typed YAML frontmatter, versioned by Git. It diffs, reviews and
merges like code, and is readable without DevDeck running.

```
project/
└── .devdeck/
    ├── project.md            identity + rules
    ├── context.md            project-level context
    ├── knowledge/            architecture, domain, standards
    ├── decisions/            project-wide ADRs
    ├── agents/
    ├── config/app.yaml       dev / build / test commands
    └── features/<slug>/
        ├── feature.md        status, areas, goal
        ├── context.md        the feature's own context (+ the commit it reflects)
        ├── requirements.md   requirements, each with optional `forbids`
        ├── work.md           work items and who holds them
        ├── decisions/
        └── sessions/         one record per agent run
```

**Markdown + Git = durable. Database = derived.** SQLite holds only the list of
which directories this install has been pointed at, plus DevDeck's existing
concerns. Delete the runtime state and everything comes back off disk — that is
asserted by `durable_state_survives_wiping_everything_in_memory`.

Parsing is typed per document (`FeatureMeta`, `ContextMeta`, `DecisionMeta`,
`WorkMeta`, `RequirementsMeta`, `SessionMeta`) and roundtrip-tested. A file with
no frontmatter is a body with defaults, not an error — humans write these by
hand. An *unterminated* frontmatter is a loud error, because that is a typo, not
a style.

---

## Event-driven design

Services subscribe rather than calling each other. A typed in-process
`EventBus`; no external infrastructure.

**Commands vs events.** A command asks for something and is a plain function
returning `Result`. An event says something already happened, is past tense, and
is fire-and-forget. Events are never used as disguised commands.

Every event carries an envelope: id, seq, type, category, timestamp, the scope
it belongs to (workspace/project/feature/work item/session/agent),
`correlation_id`, `causation_id`, and a depth.

### The defining chain

```
tool.executed
  → file.changed
    → context.reconciliation.requested
      → context.reconciled
        → context.delta.detected
          → context.stale          (whoever's checkpoint is now behind)
            → conflict.detected
```

Two properties make this real rather than decorative:

- **Derived events carry their cause.** A handler emitting in response to an
  event sets `causation_id` and inherits `correlation_id`, so one agent
  operation is one filter away.
- **The chain is asserted inside a single correlation id**, not across the run.
  Asserting "the first `file.changed` precedes the first `context.reconciled`"
  globally would pass on coincidence — the architect reconciles a decision long
  before any developer writes a file.

A depth guard (`MAX_CAUSATION_DEPTH`) stops a cyclic handler rather than hanging,
and a panicking handler cannot take the bus down. Both are tested.

### Event types

`workspace.*`, `project.*`, `feature.*`, `agent.started/status.changed/
completed/failed`, `session.started/checkpointed/completed`,
`work.claimed/updated/released/completed`,
`tool.requested/executed/failed`,
`process.start.requested/started/ready/stopped/failed`, `file.changed`,
`git.changed/commit.created`,
`context.changed/reconciliation.requested/reconciled/delta.detected/stale`,
`decision.created/updated/superseded`,
`conflict.detected/updated/resolved`, `test.started/completed/failed`.

The in-memory log is **operational history** — it powers the Activity screen and
debugging. It is not the canonical knowledge store; `.devdeck` is.

---

## Context

### Assembly is a narrowing operation

The interesting part is what it leaves out. For one agent on one feature:

- project rules (**inherited**)
- the feature's own context (**manual**)
- requirements (**manual**)
- live decisions, superseded ones excluded (**manual**)
- the current work item only (**manual**)
- what everyone else is doing (**generated**)
- recent commits (**generated**)

Sibling features, other projects and superseded reasoning are **excluded and
named**, with a reason and what they would have cost. That is what makes
"minimum sufficient context" a visible claim rather than an assertion in a doc —
the Context Inspector shows the exclusions as prominently as the inclusions.

Token counts are a deliberate estimate (~4 chars/token) and labelled as such.

### Checkpoints and deltas

A session records the commit it started from. "What changed since my
checkpoint?" diffs that commit against HEAD, including uncommitted work.

Deltas are semantic — `added` / `changed` / `removed` / `superseded` /
`conflicting` — not a text diff, because an agent needs to know *what it now
believes wrongly*.

### Reconciliation

```rust
pub trait ContextReconciler: Send + Sync {
    fn reconcile(&self, current: &AssembledContext, change: &ChangeSet,
                 active: &ActiveWorkView) -> ReconciliationResult;
    fn name(&self) -> &'static str;
}
```

`DeterministicReconciler` is rule-based, so the scenario can assert exact
output. An LLM implementation slots in behind the same interface with nothing
above it changing.

An agent is stale when its checkpoint is behind **and** the change touches its
areas or a symbol it depends on — and it is never stale from its own change,
which took a regression test to get right.

---

## Git as the version layer

Commits *are* context versions. `git.rs` gained `head_commit`, `log_entries`,
`changed_between`, `dirty_files`, `file_at`, `commit_trailers`, `ensure_repo`
and `commit_with_metadata`, all on the existing `run_git` so there is one place
that knows how to invoke git safely.

Agent commits carry trailers, parsed back for the Git History screen:

```
DevDeck-Agent: dev-a
DevDeck-Feature: offline-synchronisation
DevDeck-Work-Item: wi-conflict
DevDeck-Session: ses_…
```

**Why the runtime commits:** without it the repo never moves, every checkpoint
equals HEAD, and no agent can ever be behind — staleness is unreachable. This
was found by the E2E test failing, not by reading the code.

---

## Agent runtime

Provider-independent. The runtime owns the loop; the provider only answers
"what next?".

```
start session → assemble context → checkpoint → claim work
  → invoke provider → execute permitted tools → react to changes
  → checkpoint → complete → session summary
```

Split into `begin` and `drive` so a session can be **started and left live**.
Agents genuinely overlap: Developer B is still working when Developer A changes
the interface underneath it. A runtime that could only run a session
start-to-finish could never represent that, and "who went stale?" would be
unanswerable — the only live session would always be the one doing the changing.

`MAX_TURNS` bounds a provider that never says "done".

---

## Providers

```rust
pub trait LLMProvider: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn list_models(&self) -> Vec<ModelInfo>;
    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String>;
    fn health(&self) -> ProviderHealth;
}
```

A provider receives assembled context, a goal and the tools it may ask for, and
returns **requests to act** — never actions. The runtime decides whether to
honour them; `ToolService` decides whether they are permitted. A provider is
untrusted: it proposes, DevDeck disposes. Swapping in a real model therefore
cannot widen what an agent can do.

- **MockProvider** — deterministic scripts for Architect, Developer, QA and
  Reviewer. Not a bypass: same runtime, tools, permissions and bus. It also
  *reads* its request and refuses to start with no context, so a bug in context
  assembly surfaces here too.
- **AnthropicProvider** — key + model.
- **OpenAICompatibleProvider** — name, base URL, key, model, custom headers,
  timeout. Covers OpenRouter, NVIDIA-hosted endpoints, llama.cpp, vLLM, LM
  Studio, corporate gateways.

Both real adapters report themselves **unconfigured** without credentials and
return an explicit error rather than a plausible empty response. An
unconfigured provider that looks healthy is the failure mode that wastes an
afternoon.

---

## Tools

The only path from an agent to the machine: Terminal, Git, Files,
Process/App Runner, Tests, Knowledge.

Permissions are `Full` / `Read` / `Approval` / `None`, per agent per tool, and
**fail closed**: an unknown agent gets nothing, read-only refuses writes,
`Approval` is not silently granted, and a path escaping the project is refused.
Every call emits `tool.requested` then `tool.executed` or `tool.failed`, so a
denial is observable rather than invisible.

The built-in agents are deliberately *not* uniformly Full — QA is read-only on
files, the Architect has no terminal — so the matrix is exercised rather than
decorative.

---

## Conflicts

Event-driven, never called directly. Kinds: **File**, **Component** (a changed
symbol something depends on), **Decision**, **Requirement**, **StaleContext**.
Severity: Info / Warning / High / Blocking.

Every conflict carries **both sides** — a conflict with one side is an
assertion, not evidence. Detection is heuristic and says so; it errs towards
silence, because a conflict centre that cries wolf gets ignored.

---

## Running the mock demo

**In the app:** rail → AI Workspace → **Run mock demo**. Creates TyreX and
AssetX under `%APPDATA%\devdeck\demo`, then runs:

```
Architect  reads context → records "Server-authoritative conflict resolution"
Developer B begins, checkpoints, and stays live
Developer A changes SyncResult          → file.changed → commit
                                        → reconciliation → context.changed
Developer B's checkpoint is now behind  → context.stale
                                        → conflict.detected (HIGH)
Developer B finishes on a context that moved under it
QA         starts the app, runs the tests, records the result
AssetX     runs too — proving nothing crosses between projects
```

**Headless:** `cd src-tauri && cargo test --lib aiw::scenario_tests`

No API key is used or required anywhere in this.

---

## Testing

`cd src-tauri && cargo test --lib` — 107 tests covering Markdown roundtrips,
feature creation, project and feature isolation, the event bus, work claims,
checkpoints, deltas, conflicts, tool permissions, the runtime, sessions, QA
execution and the full E2E chain.

Full gates:

```bash
npx tsc -b && npm run lint
cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test --lib
```

Screenshots: `scripts/capture-aiw.ps1` (needs a standalone `npx vite` on 5173
and a built `devdeck.exe`).

---

## Configuring a real provider

Nothing above the provider layer changes.

```jsonc
// Anthropic
{ "kind": "anthropic", "apiKey": "sk-ant-…", "model": "claude-sonnet-4-5" }

// OpenAI-compatible — OpenRouter, NVIDIA, local, gateway
{
  "kind": "openai-compatible",
  "name": "NVIDIA",
  "baseUrl": "https://integrate.api.nvidia.com/v1",
  "apiKey": "nvapi-…",
  "model": "meta/llama-3.1-70b-instruct",
  "headers": [["X-Team", "platform"]]
}
```

via `aiw_configure_provider`. `configuring_a_real_provider_changes_nothing_but_the_provider_layer`
asserts the mock scenario still runs identically afterwards.

**What remains:** each adapter's HTTP transport — mapping `AgentRequest` to the
wire format and the response back to `AgentAction`s. That is the whole
remaining surface for a real LLM.

---

## A note on linking

The event bus originally held a `tauri::AppHandle` to emit to the UI. That
pulled Tauri's dialog machinery into the link, so the **test binary** imported
`TaskDialogIndirect` from `comctl32` — a v6-only export requiring an application
manifest that a `cargo test` binary never gets. Every test failed to load with
`STATUS_ENTRYPOINT_NOT_FOUND` before running a line.

The bus now takes a sink closure and knows nothing about Tauri; `lib.rs`
installs a closure that emits `aiw:event`. Better layering, and it links. Worth
knowing before anyone re-introduces a Tauri type into a low layer.

---

## Known limitations

1. Real provider transports are unimplemented — the seam exists and is
   exercised; the HTTP calls are not written.
2. The process runner executes a configured command and captures its output
   rather than supervising a long-lived server through `services.rs`.
3. Conflict detection is heuristic: substring `forbids` for requirements, a
   small opposite-pair list for decisions.
4. The reconciler is deterministic only.
5. `npm run tauri build` was not run (debug builds and all gates pass).
6. `src/lib/devCapture.ts` is a dev-only capture affordance that ships inert.

## Next steps

1. Implement the two HTTP transports — the single remaining step to real agents.
2. Supervise long-lived apps through `services.rs` so the process runner shares
   DevDeck's existing lifecycle and log bus.
3. An LLM-backed `ContextReconciler` behind the existing trait.
4. Permission **approval prompts** in the UI, so `Approval` becomes a live
   decision rather than a refusal.
5. Team-shareable manifests carrying agents, skills and tool permissions —
   the paid wedge described in `CLAUDE.md`, now with something to carry.
