# Current architecture: orchestration and shared definitions

This describes PR #25 at `f016757`, not a released-version guarantee. See the
[user guide](USER-GUIDE.md) for controls and the [workflow reference](folder-workflow-routing.md)
for recovery and acceptance boundaries.

## Ownership and persistence

| Concern | Source | Persistent owner |
|---|---|---|
| Agent directory and library UI | `src/components/agents/AgentDirectory.tsx`, `workers/LibraryPanel.tsx` | Personal store; existing worker/library commands |
| Custom and conversational definitions | `personal_library.rs`, `aiw/tools.rs`, `aiw/assistant.rs` | Existing library index/text, revision-aware writes |
| GitHub / Community text import | `library.rs`, `community.rs`, `installed.rs` | Same library with source identity/licence metadata |
| Saved agents and execution | `workers.rs` | Personal worker definitions and run receipts |
| Reusable teams | `team_library_model.rs`, `personal_library.rs` | Personal library `teams.json`, revision checks |
| Workflow definitions and receipts | `workflow_model.rs`, `folder_workflows.rs` | Selected vault folder's workflow Markdown |
| Repository intake and dispatch | `issue_monitor_model.rs`, `issue_monitor.rs` | Vault `.devdeck/issue-monitor.json`, `issues/`, `issue-dispatches.json` |
| Conversational workflow commands | `aiw/tools.rs`, `aiw/assistant.rs`, `aiw/state.rs` | Host callback to existing workflow commands |
| Mobile presentation and voice | `mobile/companion.js`, `mobile/voice-client.js`, `src/lib/voice-input.js` | Desktop-owned conversations and snapshots |

File names without a prefix above are under `src-tauri/src/`. The frontend uses
`src/lib/ipc.ts`; it does not launch workers or write files directly.

## Definitions, assignments and executions

A library skill or agent template is text. A configured worker references a
brief and explicit shared skill IDs plus runtime limits. A team maps role names
to worker handles. A workflow step selects a team role or a direct worker and
records the resolved handle. A worker run is one execution with its own receipt.
These are distinct lifetimes; saving one does not launch another.

Team resolution validates missing roles, agents and referenced definitions before
save/start. New issue routes resolve the current team; existing runs preserve
assignments and progress. Changes to a worker's configuration affect future
execution, not an already running process. Shared skill references avoid copying
definitions across agents; source identity protection is not semantic deduplication.

## Dispatch and gates

The monitor polls while the desktop process runs, independently of the selected
page. Monitoring is read-only until explicit repository/folder dispatch bindings
and Full `workflow` permission allow execution. Fresh successful snapshots feed
selection; failed retrieval retains prior data without treating it as new work.

A durable claim precedes model selection. The model sees existing templates and
no executable selection tools. The host validates its choice, routes once per
issue/folder, then launches eligible pending steps using the existing worker
launcher. Independent work can run in parallel; permissions, targets, budgets,
dependency acceptance and run claims still apply. A receipt becomes review,
not automatically accepted. Interrupted selection needs explicit retry.

Pause or revoke prevents future dispatch; it does not cancel existing workers.
The receipt reconciler updates workflow state; the monitor can subsequently
launch newly eligible pending work. There is no per-issue lead session or new
nested delegation runtime.

## Permissions and imported text

`library.list/read/create` uses Dev's permission matrix and an explicit host
callback. Create always reviews exact text interactively, even at Full; an
unattended context cannot approve it. Save grants no tool permission and activates
no agent. Imported source/licence metadata is preserved. Custom edits reject
stale content; imports cannot silently overwrite a different source's identity.

This does not sandbox every instruction an external CLI may load from its
project/global configuration. Existing MCP installation and permissions are a
separate path from importing skill/agent text.

## State and runtime boundaries

Vault data is distinct from linked execution repositories and the personal
store. Local revision/claim serialization protects one desktop process, not
distributed writers on multiple PCs. Git vault synchronization is explicit.
Worker worktrees do not automatically exchange unmerged output; acceptance
must include making needed output available to the next step.

The mobile web companion uses the running desktop bridge, pairing and existing
authority. It is not a background cloud host. External assistant checkpoints
are reported activity, not measured heartbeats. Proactive cross-device
notifications and a schedule-to-workflow bridge remain outside this change.
