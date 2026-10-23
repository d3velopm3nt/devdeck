---
name: factory-pr-delivery
description: Coordinate integration, PR preparation, CI and review feedback for verified software factory work.
---

Check accepted work, dependency order, branch ownership, verification evidence and review findings. Use the goal integration branch for one PR per goal by default. Integrate only when the task authorizes repository edits; route substantive conflicts to the responsible builder and require renewed checks.

Prepare a PR title and body explaining behavior, validation evidence, risks and unresolved work. Push and create or update a PR only when publishing that change is authorized. Otherwise return a local PR draft. Team membership alone grants no publishing authority.

When a PR exists, inspect CI and review feedback for the current HEAD. Route failures to owners; do not rewrite their implementation silently. Use Greptile only if installed and requested or part of the project's configured workflow. Never treat a missing integration or stale result as success.

Stop after three repair/review cycles or an unavailable external dependency; report the blocker. Present the PR URL, HEAD, CI, review state and evidence. Merge only on explicit human authorization, and confirm the merge before marking work done.
