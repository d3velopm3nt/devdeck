# Background monitoring requirements

Status: agreed product direction, not implemented as an app-wide service. The current Activity refresh preference controls checks only while that page is mounted and visible. It does not run with DevDeck exited.

## Sources

- GitHub: connected repositories' issues, PRs, comments/checkpoints, and selected workflow/check events. Use event/cursor-based incremental reads where supported and periodic reconciliation.
- Mail: configured accounts and chosen folders, incoming messages and connection failures. Reuse mail sync; monitoring does not authorize sending email.
- DevDeck state: local file changes plus remote Git revisions. Treat local edits, remote changes and conflicts separately; never overwrite unsynced edits or force-push.
- Execution: agent/worker runs, progress, heartbeat, failures, handoffs and human approval requests.
- Scheduling: due jobs, missed or failed checks and next-run times.
- Connection health: GitHub, mail, AI/CLI and state-sync availability, with last successful check.

## Runtime

A dedicated monitoring project inside the DevDeck repository shares settings, credential access and event definitions. One native monitoring coordinator owns independent source jobs and publishes through DevDeck's existing event bus. Jobs have persisted checkpoints, deduplication, bounded request budgets, cancellation, backoff and rate-limit handling. One failed source must not block the others. Views subscribe to the resulting local snapshot and events rather than starting their own pollers.

Keep credentials in the existing credential stores. Persist only necessary source state and diagnostic metadata; avoid exposing tokens or raw private transcripts. Separate retrieval permission from AI processing and execution permissions.

First runtime target: continues while the desktop process is running, including minimized/tray operation, independently of selected page. Running after the app fully exits requires a separate Windows service or an explicitly configured always-on host; do not imply that app timers provide it.

## Controls and status

The DevDeck window exposes a service control panel: running/stopped/paused/unreachable status, start/stop/restart, pause/resume, check now, enabled sources, account/repository scope, cadence, notification preferences and recent diagnostic events. The service owns scheduling; the UI is a client, not the lifetime of a job. Require authenticated local IPC and a versioned status/command contract for a separate host. Stop cancels or drains monitoring checks explicitly; stopping monitoring must not silently cancel unrelated agent or worker runs. Prevent duplicate hosts and concurrent checks for the same source. Show last heartbeat, last successful check, current check, next check, error/backoff and stale state. A restart resumes durable checkpoints and deduplicates events; preserve recent diagnostics so the reason for a restart remains reviewable. “No updates” is valid only after a successful check. Monitoring itself must not claim an agent is running.

## Acceptance

- Update another view without keeping Activity open.
- Failed mail retrieval does not stall GitHub or worker events.
- Restart resumes cursors and does not duplicate messages/events.
- Timeouts do not discard issues already fetched because optional comment enrichment failed.
- Offline/rate-limited checks recover without rapid retries.
- State conflicts preserve both local and remote work for review.
- Agent/worker heartbeats distinguish running, paused, stale and finished.
- Show the exact runtime boundary when the app is closed.

GitHub fetch implementation now uses one 15-second operation budget below the UI deadline, bounded CLI reads, and optional comment enrichment that preserves issues. Core and mocked browser checks cover failure recovery; actual Windows account/repository reads still need acceptance before relying on background monitoring.
