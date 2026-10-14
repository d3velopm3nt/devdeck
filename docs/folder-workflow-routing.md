# Folder workflows and issue intake

This is the first two implementation stages of issue #24. These are DevDeck workflows, not GitHub Actions workflows.

## Use

Open **Work → Team workflows**, choose a folder, and select or create a named workflow. A folder dashboard also has a **Workflows** button. No Workflow label is required. IDs use lowercase letters, digits, hyphens and underscores.

Existing `WORKFLOW.md` is the default workflow. Additional workflows are stored at `<folder>/.devdeck/workflows/<id>.md`. Each is Markdown with a YAML header describing steps, worker handles, target folder IDs and dependencies. Existing receipts remain on their original workflow.

In the workflow editor, expand **Technical team template**, assign the lead, developer, tester and reviewer workers, and use the template. This creates the reusable process **plan → implement → test → review**. Save the definition before routing a ticket.

**Route GitHub issue** selects an open issue from a connected project and instantiates the selected workflow. The resulting file has a stable ID based on repository and issue number. Routing the same ticket in the same folder opens the existing run, preserving progress. Each new ticket begins with pending steps and no copied run receipts. Routing alone starts no worker.

Steps use the existing worker runtime: preview the worker, start the step, inspect its result, and record review evidence before accepting. Acceptance unlocks dependent steps. It does not merge or publish code. Accepted code must be made available to the next step; separate worker worktrees do not automatically share unmerged changes.

## Automatic issue monitor

Connect repositories through the existing Activity project settings. Expand **GitHub issue monitor** and enable monitoring. While the desktop app is running, each repository is eligible for a refresh every 60 seconds; startup resumes from saved attempt timestamps. An in-progress refresh is serialized against manual refreshes.

The monitor writes human-readable configuration to the vault's `.devdeck/issue-monitor.json` and issue snapshots under `.devdeck/issues/`. Stable issue numbers deduplicate intake per repository; pull requests are excluded. A failed fetch preserves the previous successful snapshot and records the error. Bounded or partial history is labelled. Pausing monitoring stops subsequent scheduled fetches; a request already in flight may finish.

Intake does not start an agent, choose a workflow, change the GitHub issue, or claim that work is underway. It is active only while DevDeck desktop is open, using its existing GitHub connection. The underlying reader covers up to the 500 most recently updated issue/PR records, so this is a bounded polling monitor, not a guaranteed historical import or webhook service.

## Mobile

The paired companion's Activity view shows connected GitHub issues and folder workflow steps, workers, recorded evidence and next actions. It receives monitor state through the existing desktop snapshot. It can also refresh a selected project's issues directly. The desktop resolves project IDs to configured repositories; the phone cannot use the endpoint as an arbitrary repository proxy. Saved issues remain visible offline, with freshness and refresh errors. New issue visibility does not imply an agent session exists.

## Remaining stages of issue #24

1. Foundation and monitor implementation: present in this change; full native/Windows verification remains.
2. Orchestrator selects an appropriate team/workflow and creates/resumes an independent lead session per issue, allowing concurrent tickets with isolated context and workspaces.
3. Generic nested delegation and scoped authority: subagents may delegate further without expanding their parent's authority. Routine agent reviews and user-required approvals remain distinct.
4. One shared communication system, with a team conversation per workflow run visible on desktop and mobile. A manager is a coordinating agent, not a separate messaging architecture. Preserve existing manager communication while integrating it.
5. Testing, review, rework, evidence and authorized GitHub progress/result updates.
6. Exercise issue #23 through the full flow, including the actual phone HTTPS/microphone test, and record usability gaps.

## Verification

- Production frontend build and TypeScript check.
- Existing lint checks; existing warnings retained.
- Core Rust suite includes workflow path isolation, traversal/symlink rejection, fresh ticket receipts, dependency/review gates, duplicate issue intake and persisted poll timing.
- Desktop browser harness covers manual worker starts, stale-edit rejection, named workflow isolation, the technical template, duplicate-safe routing and monitor enable/pause controls.
- Mobile browser harness covers issue visibility, linked workflow status, refresh-error retention, existing voice/chat behavior, offline reconnect and unpairing.
- Full native app compilation is not verified in this container: its Linux GTK/pkg-config development dependencies are unavailable. Live GitHub polling from the desktop, worker execution, Windows packaging and real phone microphone behavior still require native/device verification.
