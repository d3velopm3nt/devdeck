# Dev Inbox and schedule visibility

Status: agreed specification, 17 October 2026. Not a claim of completed implementation.

## Purpose

Dev is the coordinator for incoming GitHub work. Inbox is the durable place for decisions the user must make. Notifications draw attention to those requests; they are not the requests themselves.

## Flow

GitHub update -> Dev assessment -> permitted work or request for user input -> tracked outcome.

Dev uses the main agent connection. It assesses scope, available workflows, required checks and team needs. If a team is needed but unavailable, it hands the plan to Team Builder and brings a proposal to the user. A newly discovered issue alone does not imply permission to execute it.

## GitHub mapping

| Situation | Destination | Action |
| --- | --- | --- |
| Enough context and permission | Activity and briefing | View work |
| Unclear requirements | Inbox question with recommendation and suggested answers | Reply |
| Missing workflow or team | Inbox proposed plan | Discuss plan |
| Permission required | Inbox exact action and scope | Approve or reject |
| Blocked or failed | Inbox impact, evidence and recommended recovery | Discuss or retry |
| Ready for human review | Inbox changes, checks and evidence | Review |
| Informational commit or PR update | Activity and briefing | View details |

## Request model and lifecycle

Each request has a stable ID, source repository and issue/PR reference, linked work/run and conversation, request type, title, explanation, recommendation, evidence, allowed actions, creation/update times and resolution evidence.

Views: Needs you, Waiting on Dev, Resolved.

Read/unread and notification delivery are separate from request status. Reading, dismissing an alert, muting or quiet hours never resolve a request. A user's response is recorded and routed back to the originating work. Resolution records the decision or confirmed outcome; an unsuccessful handoff remains visible with retry information.

Repeated updates to the same decision update its existing request. A genuinely new decision gets a new request. Actions must reject stale or already-applied decisions and tolerate retries without duplicate execution. Approval applies only to the action and scope displayed.

## Presentation and delivery

Use compact icon-led rows with subtle semantic accents and labels. Show repository, linked work, what Dev needs, why, recommendation and a primary action. Open the related conversation with context available.

The event bus feeds durable requests and notification delivery. Desktop and paired phone read the same saved request state. Phone background push is a separate capability and must not be implied by phone history access. Preferences control interruption, not retention.

## Schedules bottom panel

Add Schedules beside Logs, Processes, Events and Models. Show schedule name, kind, enabled/paused state, next run, last run/result and links to associated work or Inbox requests. Distinguish configured schedules from active execution. Display Running only when backend execution data confirms it; enabled does not mean running. Include loading, empty and failure states and a route to schedule management.

## Acceptance checks

- One isolated GitHub test issue reaches Dev's assessment and creates an Inbox request when input is required.
- Repository context, recommendation, evidence and actions match the originating work.
- Duplicate events do not create duplicate requests or execute a decision twice.
- Read, dismiss, mute and quiet-hours operations leave pending requests actionable after restart.
- A response reaches the originating work; failed routing remains visible and recoverable.
- Review-ready work stays pending until reviewed; no automatic merge or deployment.
- Desktop and paired phone show consistent request status after refresh.
- Schedule list shows persisted enabled/paused state, next run and last result accurately.
- Running state is backed by execution evidence and clears when execution finishes.
- Record actual results and screenshots, distinguishing fixture checks from live end-to-end checks.

## Current gaps

Existing Inbox handles approvals, conflicts and failures. The full GitHub assessment-to-request-to-response flow is not verified end to end. Unified request lifecycle, context-linked conversation routing and schedules panel still require implementation. Existing notification history is not a substitute for request resolution state.
