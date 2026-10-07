# Folder workflows — first feature branch

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
