# Folder workflows and issue intake

This implements folder workflows, issue intake, and direct Dev-to-worker orchestration for issue #24. These are DevDeck workflows, not GitHub Actions workflows.

## Use

Open **Work → Team workflows**, choose a folder, and select or create a named workflow. A folder dashboard also has a **Workflows** button. No Workflow label is required. IDs use lowercase letters, digits, hyphens and underscores.

Existing `WORKFLOW.md` is the default workflow. Additional workflows are stored at `<folder>/.devdeck/workflows/<id>.md`. Each is Markdown with a YAML header describing steps, worker handles, target folder IDs and dependencies. Existing receipts remain on their original workflow.

In the workflow editor, expand **Technical team template**, assign the lead, developer, tester and reviewer workers, and use the template. This creates the reusable process **plan → implement → test → review**. Save the definition before routing a ticket.

**Route GitHub issue** selects an open issue from a connected project and instantiates the selected workflow. The resulting file has a stable ID based on repository and issue number. Routing the same ticket in the same folder opens the existing run, preserving progress. Each new ticket begins with pending steps and no copied run receipts. Routing alone starts no worker.

Steps use the existing worker runtime: preview the worker, start the step, inspect its result, and record review evidence before accepting. Acceptance unlocks dependent steps. It does not merge or publish code. Accepted code must be made available to the next step; separate worker worktrees do not automatically share unmerged changes.

## Automatic issue monitor

Connect repositories through the existing Activity project settings. Expand **GitHub issue monitor** and enable monitoring. While the desktop app is running, each repository is eligible for a refresh every 60 seconds; startup resumes from saved attempt timestamps. An in-progress refresh is serialized against manual refreshes.

The monitor writes human-readable configuration to the vault's `.devdeck/issue-monitor.json` and issue snapshots under `.devdeck/issues/`. Stable issue numbers deduplicate intake per repository; pull requests are excluded. A failed fetch preserves the previous successful snapshot and records the error. Bounded or partial history is labelled. Pausing monitoring stops subsequent scheduled fetches; a request already in flight may finish.

Monitoring alone remains read-only. To opt into dispatch, assign a workflow folder for each repository using **Enable dispatch here**, enable monitoring, and grant Dev **Full** permission for the `workflow` tool in agent permissions. Existing open issues are included. Approval-only permission blocks unattended starts and shows why; it never silently grants authority.

Dev selects from reusable templates in the assigned folder using its configured model, with no executable tools during selection. The host validates that choice, creates the issue workflow, and starts ready pending steps through the same runtime as manual starts. Independent steps and issues can run concurrently. Dedicated lead sessions are deferred. A worker finishing moves to review; only human acceptance unlocks its dependencies. Failed steps are not automatically retried.

Dispatch records persist in `.devdeck/issue-dispatches.json`. A claim is saved before model selection. Interrupted or failed selections require **Retry selection**; an existing issue workflow is reused on retry. Pausing monitoring or disabling a repository's dispatch prevents new starts, while already-running workers continue. Revoking Full workflow permission also stops new automatic starts. Changing an assignment preserves previously routed work rather than duplicating it.

Monitor rows show selection, running, review, blocked and done states with errors. Workflow files remain the detailed source of step receipts. Automatic dispatch does not modify GitHub issues, merge or publish code. It is active only while DevDeck desktop is open, using its existing GitHub connection. The underlying reader covers up to the 500 most recently updated issue/PR records, so this is a bounded polling monitor, not a guaranteed historical import or webhook service.

## Mobile

The paired companion's Activity view shows connected GitHub issues and folder workflow steps, workers, recorded evidence and next actions. It receives monitor state through the existing desktop snapshot. It can also refresh a selected project's issues directly. The desktop resolves project IDs to configured repositories; the phone cannot use the endpoint as an arbitrary repository proxy. Saved issues remain visible offline, with freshness and refresh errors. New issue visibility does not imply an agent session exists.

## Remaining stages of issue #24

1. Foundation and monitor implementation: present in this change; full native/Windows verification remains.
2. Direct orchestration is implemented: Dev chooses an existing workflow and the host starts eligible workers. Dedicated per-issue lead sessions are deferred by agreement.
3. Generic nested delegation and scoped authority: subagents may delegate further without expanding their parent's authority. Routine agent reviews and user-required approvals remain distinct.
4. One shared communication system, with a team conversation per workflow run visible on desktop and mobile. A manager is a coordinating agent, not a separate messaging architecture. Preserve existing manager communication while integrating it.
5. Testing, review, rework, evidence and authorized GitHub progress/result updates.
6. Exercise issue #23 through the full flow, including the actual phone HTTPS/microphone test, and record usability gaps.

## Verification

- Production frontend build and TypeScript check.
- Existing lint checks; existing warnings retained.
- Core Rust suite includes workflow path isolation, traversal/symlink rejection, fresh ticket receipts, dependency/review gates, duplicate issue intake, persisted poll timing, selection boundaries, backward-compatible opt-in, and durable selection claims.
- Desktop browser harness covers manual worker starts, stale-edit rejection, named workflow isolation, the technical template, duplicate-safe routing, monitor enable/pause, and independent per-repository dispatch controls.
- Mobile browser harness covers issue visibility, linked workflow status, refresh-error retention, existing voice/chat behavior, offline reconnect and unpairing.
- Full native app compilation is not verified in this container: its Linux GTK/pkg-config development dependencies are unavailable. Live GitHub polling from the desktop, worker execution, Windows packaging and real phone microphone behavior still require native/device verification.

## Voice verification boundary

The transcript normalizer preserves recognition restart boundaries and intentional single prefix pairs. It only folds repeated growing hypotheses within one recognition generation. Three or more deliberately repeated growing phrases can still be indistinguishable from cumulative Android recognition output; verify real speech on the phone before claiming the duplication issue fully resolved. Spoken acceptance has a one-time chime fallback on synthesis failure, suppressed when cancelled or the user changes conversation/starts listening.

## Shared library, agents and reusable teams

Agents now has Configured agents, Library and Reusable teams. Community is an
optional entry point into the same Library: import a catalogue text definition
with its source/licence metadata, or use Add from GitHub for supported agent
briefs and SKILL.md files. Custom creation is available directly in Library.
Dev can also propose `library.create` from chat or voice; the exact definition
is reviewed before it is saved. A saved definition is text, not a running agent.

Configure an agent from an agent template, choose its shared skill IDs and set
its existing runtime/space limits. Skills remain shared library references;
several agents can use the same skill without copying its definition. Merely
having a skill or tool installed does not attach it to every agent. Imported
IDs from different sources cannot silently replace one another. Custom edits
use the last-read text as a revision check; imported originals retain provenance.

Reusable teams map unique named roles to saved worker handles. Saving a team
validates missing agents and referenced skills/templates, grants no authority
and starts no work. In a workflow editor, open Reusable team and step roles,
read the draft, choose a team, map each step, apply, then save. Direct worker
assignments remain supported. The saved workflow records `team`, each step's
`role`, and the resolved `worker`. New issue routes resolve the latest saved
team; existing issue workflows retain their assigned workers and receipts.
Changing a saved worker's profile affects future executions, not an already
running process. Dependencies, human review and runtime permissions still gate
starts. Dev remains the direct coordinator; no dedicated lead session is created.

The initial Community catalogue import is idempotent and does not update a
previously imported definition silently. GitHub imports can explicitly update
the same source/path; changing source requires a distinct identity or deliberate
removal. This is source identity protection, not semantic deduplication.
