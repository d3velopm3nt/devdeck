# Activity board: timeline and issue views

Source behavior documented for unmerged PR #25. See the [user guide](USER-GUIDE.md) for the complete workflow.

The Activity board now opens on Timeline, with DevDeck issues and GitHub issues beside it. Shared space, project, assistant and status filters stay selected across tabs. The existing Sessions page remains available.

## Reused foundations

- Local peer messages use `manager_team`, `manager_messages` and the existing event bus; direct chat reuses `manager_conversation` and `manager_turn`. No new message store, agent runtime or permission bypass.
- Sessions and checkpoint history use the existing visibility snapshots and native session records.
- Local work and GitHub cards keep their existing backing records and status interpretation.

## Local acceptance

1. Launch the desktop from this branch: `npm ci`, then `npm run tauri dev` on Windows.
2. Open Activity. Confirm Timeline, DevDeck issues and GitHub issues, shared filters, message cards and the linked-work sidebar.
3. In Timeline, choose a manager, type a plain message and Send. Confirm the reply appears; no subject or sender form is required. Switch managers and return to confirm the saved conversation loads. Reopen DevDeck and confirm persistence. Model calls and any tools still use existing manager context and permissions.
4. Select a connected project and inspect checkpoint history. Confirm DevDeck issues shows local tasks; GitHub issues shows repository items. Switch tabs while filters are selected.
5. Open a linked GitHub item. Create GitHub issue opens a prefilled draft in the browser; submission happens on GitHub. No automatic issue is posted by this button.
6. Test an unavailable repository: the previous snapshot should remain visible with an error. Confirm light/dark layouts and keyboard access.

## Verification boundaries

TypeScript and lint pass. The existing browser harness was extended to verify source separation, peer-message deduplication, filtering, direct-chat replies/restoration, failure preserves the draft, readable GitHub link labels, draft URL construction and existing session/error/revision behavior. It uses fictional IPC fixtures; it does not prove Windows filesystem persistence or live GitHub/CLI access.

Manager peer messages currently do not carry explicit project/issue IDs. The view reports their manager home as a scope hint and shows Project not linked; it excludes them from a selected project rather than inventing attribution. Explicit message-to-task linkage and automatic GitHub publishing are follow-up work. This Activity slice does not itself dispatch work. PR #25 adds a separate opt-in [issue monitor and dispatcher](folder-workflow-routing.md); recorded external sessions still are not live runner heartbeats.

## Windows subscription setup and onboarding

This branch also includes the existing Windows Claude/ChatGPT subscription setup and its provider-list production build fix. Core setup now uses the same onboarding Frame and stepper as Voice and later steps; you can go forward to Voice and return to Core. The Settings view still reuses Core setup without the onboarding stepper. Linux-specific setup is excluded.

The 34 production core tests passed, along with TypeScript, lint and the Vite production bundle. Browser checks cover the subscription UI and Core/Voice return flow using mocked CLI/account calls. Actual installation and subscription sign-in remain device acceptance checks. PR #25 Windows CI186 passed native compilation/tests for `f016757`; it does not establish a live account connection.

## Compact conversation layout

Timeline uses compact message bubbles, source badges and a simple direct-chat composer. GitHub evidence renders readable repository/issue labels. Recorded working states are explicitly marked as recorded, not a live heartbeat. This change does not implement new runner heartbeats or an external live connection. Replies arrive through the existing manager request API; token streaming is not added here.
