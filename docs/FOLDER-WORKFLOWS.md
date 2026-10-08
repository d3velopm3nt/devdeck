# Folder workflows — user and agent guide

Use the existing Explorer: right-click a vault folder, choose **Workflow** from
its labels, then click the folder. The workflow page opens in the existing space
panel. **Folder dashboard** returns to its services and commands. No parallel
folder hierarchy is created.

The current node metadata supports one label. Choosing Workflow replaces that
label; it does not replace the folder, repository link, contents or children.
Business/Personal workspace tags keep their existing meaning. Multiple labels,
label-to-worker routing and automatic triggers are later work.

## First run

1. Create or select workers in Team with appropriate skills, targets and limits.
2. Label an existing folder Workflow and choose **Create workflow**.
3. Edit the template. Give each step a stable ID, worker handle, target node ID,
   dependencies (`needs`) and instructions. Available handles and IDs are shown.
   Markdown beneath the YAML header supplies shared context.
4. Save. Select a ready step, choose **Start workflow**, inspect the worker plan,
   then **Start this step**. Subsequent steps also require an explicit start.
5. Open the worker receipt when it finishes. Review and apply its output where
   needed, then record evidence and **Accept step**, or **Request changes**.
   Acceptance unlocks dependencies; it never merges or publishes anything.

`WORKFLOW.md` lives directly in the selected **vault** folder, separate from any
linked source repository. It holds the definition, Markdown context, claims,
worker receipt IDs, previous attempts and review evidence. Git can version it
with the rest of the workspace. DevDeck does not auto-commit this file.

The target is an existing node, so the normal worker policy still chooses its
vault folder or an isolated repository worktree. Selected skills, permission
checks, budgets, execution claims and worker receipts are reused.

## Example: development → docs → website

Use **Create workflow**, replace the template with the example below, and replace
`developer`, `writer` and target `42` with the actual handles and folder IDs shown
in the editor. The target is where the worker does its work; it can differ from
the folder containing this workflow. Configure the workers in Team first.

```markdown
---
title: Release a feature
steps:
  - id: development
    title: Implement the feature
    worker: developer
    target: 42
    needs: []
    instructions: |
      Read the feature brief linked below. Implement the agreed scope.
      Run relevant checks. Report changed files, results and remaining issues.
      Leave the implementation available for review; do not publish.
  - id: docs
    title: Document the accepted implementation
    worker: writer
    target: 42
    needs: [development]
    instructions: |
      Read the accepted development output identified in the review evidence.
      Write setup steps, a worked example and known limitations.
      Check instructions against the implementation. Report output paths.
  - id: website
    title: Prepare website copy
    worker: writer
    target: 42
    needs: [docs]
    instructions: |
      Use the accepted implementation and guide to draft accurate feature copy.
      Save a draft and report its location. Do not deploy or publish it.
---

# Shared context

Goal: release the feature described in the agreed brief.
Before starting, replace this paragraph with the brief's actual path and links
or paths to relevant code, design decisions and supporting documents.
Success: reviewed implementation, usable guide and reviewed website draft.
```

Steps are defined in the YAML header; supporting files may live in existing
subfolders. A subfolder alone does not become an executable step. The Markdown
body is shared with every worker. For a roadmap or marketing campaign, change
the goal and step instructions while keeping the same format.

### Run the example

1. Save the definition before starting any steps.
2. Select **Implement the feature**, click **Start workflow**, and check the
   target folder, skills, time limit and budget. Click **Start this step**.
3. When it says **Needs review**, open **Open worker receipt**. Inspect the
   actual output and checks. Make the accepted files accessible to the next
   worker, including applying or merging reviewed code yourself where needed.
4. Enter **Review evidence**, for example: “Verified the setup flow and passing
   checks. Accepted code is at [actual branch/commit or path]; the guide should
   describe that version.” Replace placeholders with real references.
5. Click **Accept step**. Select the docs step and click **Start step**, then
   **Start this step** after checking its preview. Repeat for the website draft.

Acceptance records your review and unlocks dependencies. It does not copy files
between worktrees, merge branches, publish output or launch the next worker.
Steps without dependencies can be started separately; use separate targets or
non-overlapping output files if workers will run concurrently.

## Asking an agent to prepare a workflow

You can give an agent this request, together with this guide and access to the
relevant folder:

> Prepare a WORKFLOW.md for this folder using DevDeck's folder workflow format.
> Read the existing brief and supporting files. Propose clear steps, dependencies,
> output paths and verification criteria. Use the worker handles and target node
> IDs I provide; ask for missing ones instead of inventing them. Keep existing
> folders and files. Do not start workers or change saved execution state. Return
> the definition for me to review and save before I start it in DevDeck.

Supply the actual worker handles and target IDs from the editor. An ordinary
chat agent is not automatically connected to DevDeck's controls. It can prepare
the definition when it has enough context; you still save and start it in the UI.
Do not overwrite an already-started workflow with a new definition.

## Instructions for the agent executing a step

DevDeck supplies the workflow source path, shared Markdown, the selected step's
instructions, previous review notes and accepted dependency evidence/receipt IDs.
Supporting documents are not all embedded automatically: read the referenced
files you need, and report missing or inaccessible inputs rather than guessing.

- Work within the assigned target, skills, permissions and budget.
- Read accepted dependency evidence and locate the accepted outputs before using
  them. A receipt ID alone is not a guarantee that another worktree has the files.
- Produce the requested artifacts and perform the relevant verification.
- Report a concise handoff: what changed, exact output paths or branch/commit,
  checks performed and their results, limitations and any next action needed.
- Do not edit workflow status, claims, receipt IDs or review evidence yourself.
  DevDeck records execution state; the user accepts or requests changes.
- Do not publish as part of this workflow. Leave the result ready for review.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Waiting for dependencies to be accepted | Review and accept every prerequisite first; a finished worker is not yet accepted. |
| Needs review | Open the receipt, inspect output, then enter evidence and accept or request changes. |
| Blocked or an interrupted run | Inspect the receipt and target for partial work. Resolve the cause, then use **Review retry** and check the preview. |
| Missing worker or a plan that is not ready | Check Team, the worker handle, target, runner setup and the message in the preview. |
| Workflow changed / stale edit | Keep a copy of your draft, refresh and re-open the editor or start preview against the latest version. |
| External file edits are not visible | Use **Refresh**. |
| Need a different definition after work has started | Create another workflow folder for the new run; do not reset state by hand. |

## State and events

Pending steps become ready only when every dependency is accepted. Starting
persists a unique claim before calling the existing worker launcher. A running
step cannot start twice. A successful receipt moves it to **review**, not done.
Failure, interruption or a missing receipt blocks it. A rejected step can be
retried and keeps links to previous attempts.

The existing typed event bus carries worker completion notifications. A subscriber
reconciles the owning workflow and emits FileChanged, which updates the open
view. It does no automatic launching. On reopening/refresh, receipts are read
again; DevDeck's existing orphan recovery marks runs interrupted after restart.
A crash between launch and attaching the receipt is recovered using its claim.
A missing receipt requires inspection before retry, never an automatic rerun.

Transitions are serialized inside one DevDeck process; saves, starts and reviews
reject stale document snapshots. Whole-file replacement protects against partial
writes. These are local coordination rules, not distributed locks across separate
machines sharing a Git repository. External edits require Refresh. The Markdown
editor preserves its original revision so background updates cannot silently
turn a stale draft into a valid overwrite.

Definitions can be edited in the UI before their first run. Started definitions
are retained as receipts; create another workflow folder for a different run.
There is no scheduler, generic plugin system, unattended label trigger or workflow
reset in this first version.

## Verification

- `npx tsc -b`
- `npm run lint`
- `npx vite build` (frontend bundle; not a Windows installer)
- `cargo test --manifest-path harness/rust-core/Cargo.toml` checks the actual
  dependency/state module without the Windows shell.
- Windows CI runs the native module tests, clippy, formatting and installer build.
- The existing browser CI job also runs `harness/check-folder-workflows.mjs` against
  production UI with mocked native IPC: manual start/preview, flattened bus events,
  review evidence, dependency gates and stale editor revisions.

Before release, test a real worker on Windows, stop/restart during work, accept a
reviewed result and start its dependent step. Browser fixtures do not establish
that a live Claude/other runner is installed or that a real agent succeeds.
