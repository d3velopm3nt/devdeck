# Issue intake smoke test — issue 33

Draft for human review, 16 October 2026. Ticket: https://github.com/d3velopm3nt/devdeck/issues/33

## Evidence and limits

This document records source inspection and existing test artifacts, not a new live smoke test. The working tree already contains unrelated changes; this step adds only this document. No application code or workflow state should be changed.

The existing [live result](test-reports/workforce-2026-10-16/issue-live-result.json) records repository `d3velopm3nt/devdeck`, issue 33, node 3 and workflow `issue-0ded5f2043696299-33`. Dispatch was `blocked`: “`claude` is not on PATH. Install the CLI, or put it somewhere this machine can find it.” Execution was `not started`; review was `not reached`. The artifact records monitoring paused and the temporary permission restored. These are historical observations, not confirmation of current settings.

The supplied vault workflow path could not be read from this repository workspace: `.devdeck/workflows/issue-0ded5f2043696299-33.md` was absent. Its task instructions were supplied in the workflow context.

## Desktop issue monitor

Source inspection of [IssueMonitorPanel.tsx](../src/components/IssueMonitorPanel.tsx) confirms enable/pause and refresh controls, connected repository summaries, open issue counts, last successful refresh timestamps, assignees, refresh errors, warnings and partial-history notices. Dispatch records show status, workflow ID and any blocking message. A blocked selection without a workflow offers an explicit retry.

[issue_monitor.rs](../src-tauri/src/issue_monitor.rs) and [issue_monitor_model.rs](../src-tauri/src/issue_monitor_model.rs) confirm that automatic intake is opt-in, reads connected projects while the desktop is open and limits normal attempts to once per minute per source. Failed refreshes retain previously fetched issues. Manual refresh can fetch while monitoring is paused; dispatch still requires monitoring enabled.

Automatic dispatch requires an explicit repository-to-workflow-folder binding and Dev Full workflow permission. Issue scope can name up to 100 positive numbers; blank means all open issues. Pausing prevents new dispatches and does not stop workers already running. These controls were inspected in source, not operated during this documentation step.

## Mobile Issues view

[mobile/index.html](../mobile/index.html) places **GitHub issues** inside **Activity**, with an issue-project selector and **Refresh issues** button; there is no separate Issues navigation tab in the inspected markup.

[mobile/companion.js](../mobile/companion.js) renders issue number, title, state, assignees, update time and a GitHub link. It shows last-fetched or offline saved-view information, refresh failures, warnings and partial history. Linked workflows show accepted step counts and active step statuses; otherwise the card shows dispatch status and reason, or `Fetched · no workflow assigned`. Issue boards are cached locally.

The existing [mobile harness](../harness/check-issue-mobile.mjs) defines fixture checks for a blocked dispatch reason, a linked review step and no horizontal overflow at 390px width. Existing [blocked](test-reports/workforce-2026-10-16/issue-mobile-blocked-fixture.png) and [review](test-reports/workforce-2026-10-16/issue-mobile-review-fixture.png) screenshot files are listed in the report directory. This step read the harness but did not run it or visually inspect those images; their presence alone does not establish a passing test or a live mobile run.

## State checklist

| Stage | Meaning and evidence required | Verification in this step |
| --- | --- | --- |
| Fetched | A cached GitHub issue and successful-fetch timestamp establish intake. They do not establish that an agent started. Mobile can show `Fetched · no workflow assigned`. | Source behavior inspected; no fresh GitHub fetch performed. |
| Dispatch | A repository/issue dispatch record tracks template selection and routing. `pending` and `selecting` precede a routed workflow; failures can be `blocked`. | Existing live artifact records a routed workflow for #33 and blocked dispatch. Selection was not rerun. |
| Running | A step persists a starting claim before launch, then records the worker run ID and `running` after launch succeeds. Inspect the receipt and current progress to establish actual execution. | Source inspected; the saved live result explicitly says execution did not start. No live running state verified. |
| Review | Successful worker receipts reconcile to `review`, awaiting human acceptance. Mobile displays the linked step status and accepted count. | Source and fixture assertions inspected; live review was not reached in the saved result. |

[folder_workflows.rs](../src-tauri/src/folder_workflows.rs) and [workflow_model.rs](../src-tauri/src/workflow_model.rs) establish that review does not satisfy dependencies. Only accepted `done` steps unlock dependent work. Failed, interrupted or missing receipts block work. Automatic advancement starts fresh ready pending steps; blocked work requires explicit intervention. Human acceptance is separate from merging or publishing.

## Human review checklist

The following live checks remain open. They are review items, not actions performed or authorized by this document.

- [ ] Confirm the desktop displays #33, the connected repository, fetch timestamp and any warnings.
- [ ] Compare desktop dispatch status and workflow identity with the corresponding mobile Activity → GitHub issues card.
- [ ] If a later live run is authorized, verify runner availability, the issue scope and permissions before dispatch.
- [ ] Establish running from a real worker receipt and progress, rather than from a fetched issue or routed workflow alone.
- [ ] Inspect the resulting document and worker evidence when review is reached; verify dependent steps remain gated until human acceptance.
- [ ] Record any separately authorized live test results, including failures and limitations.

No shell commands, tests, application launches, installations, commits, pushes, merges, publication or deployment were performed for this documentation step. No monitor controls or workflow transitions were invoked. Stop here for human review.
