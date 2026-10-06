# Space manager teams: implementation and verification

Branch: `feature/space-manager-teams`

Draft PR: https://github.com/d3velopm3nt/devdeck/pull/3

Base: `feature/deck-widget` (preserves the earlier widget work). This is not a release.

## What changed

- The sidebar has a persistent space switcher. Today, Work and the manager roster share its scope, including descendants. Shared Inbox, Calendar and Mail remain available below that group.
- The top-right palette icon switches among the existing six themes. Theme tokens remain the source of colors.
- Agents has Managers, Specialists, and Engines & permissions. Managers have an explicit Life/Personal/Business role, responsibilities, boundaries, trusted communication peers, and a preferred specialist plus fallback pool.
- Managers can converse through their configured engine on non-repository spaces. Incoming messages are included in their next conversation or scheduled agent turn.
- Explicit manager requests, replies and acknowledgements persist in the personal store. Roles stay beside manager definitions in the vault. Message delivery emits `manager.message.delivered`; role edits emit `manager.profile.changed`. The UI subscribes to the existing event bus.
- Connections require mutual agreement. Sending a message does not grant tools, start another agent, or complete a task. One outgoing envelope is allowed per turn; a conversation stops after eight replies; inboxes are bounded at 100 pending messages. Exact retries are idempotent.
- Community is removed from primary navigation and retained under advanced settings. Operations and diagnostics are secondary. The specialist library is an optional panel.

## Important execution corrections

The audit found that a successful session could be treated as accepted work. Successful API-agent outcomes now await review; worker branches remain built until reviewed and merged; failures stay blocked, including partial output. Successful non-branch work also awaits review.

Worker lending follows space ancestry. Scheduled handoff scans the manager's portfolio and prefers its nominated specialist, then an available member of its pool, while checking scope and unattended permission. This is ordered fallback, not intelligent skill matching or a dependency scheduler.

A process-local permit bounds worker/merge operations at four and holds task/write-target locks for their full lifetime. A fifth launch asks for a retry rather than entering a durable queue. External processes and API-agent sessions are not covered by that worker permit.

Keeping a code run requires a human review note and records the reviewed commit. Merge requires that same commit and an explicitly confirmed checked-out target. Non-code acceptance requires human evidence. These are human review gates, not a claim that automated tests or an independent reviewer proved correctness.

## Sandbox evidence

| Check | Result | Boundary |
|---|---|---|
| TypeScript project build | Passed | `npx tsc -b` |
| Frontend lint | Passed | Existing advisory store/IPC warnings remain |
| Production frontend bundle | Passed | `npx vite build`; existing large-chunk warning remains |
| Production Rust core | 16 tests passed | Actual coordination, execution-policy and event-bus modules; only the Tauri event adapter is stubbed |
| Core Clippy | Passed | `--all-targets -- -D warnings` |
| Browser interaction checks | 11 passed, no page errors | Real React/store/event subscriptions; native IPC and model responses mocked |
| Desktop-sized layout | Captured at 1440×1000 and 1100×800 | No document horizontal overflow at laptop size |
| Full Linux Tauri build | Blocked | Sandbox lacks GTK/GLib development dependencies |
| Native Windows verification | Full Clippy passed at `66bc46c`; test/build status on PR | CI performs full Clippy, Rust tests and installer build |

The browser scenario uses fictional Life, Personal and Business spaces, a Builder, a Reviewer, and synthetic manager messages. It exercises role editing, request → model reply → acknowledgement, creating a personal manager, scope filtering, scope persistence, Work scope, theme switching and navigation. No real agent, mail account, personal vault, purchase or external communication is exercised.

Run the browser harness with Vite at port 5199 and then `node harness/check-managers.mjs`. It accepts `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, and `CHROMIUM_ARGS_MODULE` for a sandbox browser. The Rust core suite is `cargo test --manifest-path harness/rust-core/Cargo.toml`.

## Screenshots

- [Managers, dark](screenshots/manager-teams/agents-overview-dark.png)
- [Responsibilities and specialist pool](screenshots/manager-teams/manager-responsibilities-dark.png)
- [Communication inbox](screenshots/manager-teams/manager-communication-dark.png)
- [Mock manager conversation](screenshots/manager-teams/manager-conversation-dark.png)
- [Business-scoped navigation](screenshots/manager-teams/business-scope-dark.png)
- [Managers, light](screenshots/manager-teams/agents-light.png)
- [Laptop layout](screenshots/manager-teams/agents-laptop-light.png)
- [Today, light](screenshots/manager-teams/today-light.png)
- [Work in the selected space](screenshots/manager-teams/work-space-dark.png)
- [Specialists](screenshots/manager-teams/specialists-dark.png)
- [Machine-readable browser checks](screenshots/manager-teams/checks.json)

## Real-agent Windows handoff

1. Start with disposable Life/Personal/Business spaces. Switch between them and restart the app; confirm the selection, roster and Work scope agree.
2. Create one manager in each area. Review responsibilities, then assign an engine under **Plan, engine & schedule**. A new manager starts without an engine or schedule.
3. Connect Life and Business mutually. Send a timing-only request; run **Review inbox → Ask manager** for the recipient. Verify a real reply and its delivery receipt. Reopen the app and verify the inbox remains.
4. Give Builder and Reviewer narrow Business scope and small budgets. Keep unattended execution off initially. Add two small tasks and inspect each run's output and status before accepting or merging.
5. Review and keep a code run, then try an incorrect merge target and a changed-after-review branch. Both must refuse. Re-review the correct commit and merge into the explicitly named target.
6. Check a failed run with partial files remains blocked, a non-code result waits for acceptance, and no manager message triggers an autonomous reply loop.

Still deferred: semantic specialist matching, durable cross-process queues, dependency scheduling, automated reviewer/test gates, and live-provider behavior. Real-agent permission prompts, CLI binaries, Windows paths, tray/widget behavior and native window controls need the Windows session.
