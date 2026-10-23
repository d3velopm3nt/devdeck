# Work Runs and History consolidation

The existing isolated integration checkout owns this change. No backend records, APIs, permissions, credentials or palettes changed.

## Navigation and ownership

Work retains Goals, Work Items and Messages, with Runs and History added. Runs reuses the existing native/external session index, including unlinked records and checkpoint evidence. History reuses the team/checkpoint timeline and manager conversation API. Their filters, selected records and drafts remain mounted when switching Work views; inactive readers stop automatic refresh. Browser back/forward works between Work subviews without introducing a global URL router.

The standalone Activity History and Sessions rail entries are removed. Saved legacy rail selections and setRailView calls resolve to team/history or team/runs. Direct restored old identifiers have a compatibility component. The old route types remain valid. Work tab changes now persist the canonical rail destination as well as the tab.

The Activity issue board/list presentations are removed. GitHub management remains on GitHub, execution/intake on Work. Checkpoint enrichment and linked GitHub evidence remain available. Product-link editing, manager history and messages remain accessible. Chat contextual activity and the run inspector/review/stop/approval components are unchanged.

## Source isolation

A stalled manager mailbox previously held the global refresh lock until its 20-second timeout. Mailbox completion no longer holds snapshot/checkpoint refresh. Generation guards prevent an older mailbox response overwriting a newer refresh. The strict five-second enrichment assertion is retained, and the later mailbox error must still appear. This fixes the previously documented slow-inbox failure rather than relaxing its timing.

## Verification

All browser interaction tests use mocked IPC and fixture data. No native account probe, manager/model turn, approval or permission change was performed.

Passed: check-work-history (saved Sessions/Activity aliases, native/external/unlinked records, stale checkpoints, source/status/project/search filters, empty results, partial-source errors with retained history, manager histories/draft retention and mocked turns, keyboard entry, repeated switches, browser back/forward, GitHub handoff, canonical reload, empty agents and 390px layout); retained check-visibility and check-activity-toolbar (including strict slow-inbox isolation and late error); Chat tab-close, Chat workflow and Chat run-panel checks; GitHub design and failure/recovery checks. The latter unchanged scripts were run with local-only runtime/port substitutions. Chat fixtures now provide folder/workflow-list inputs required by the existing shared Work reader.

TypeScript, production Vite build, scoped oxlint and git diff --check pass. Rust was not rerun because no Rust changed. Production build retains its size/chunk warnings.

Known inherited failure: check-work-page reaches the missing Workflow for this work item selector (now line 29 after adding the approved Runs/History assertions). WorkItemDetail and its attachment UI are unchanged; the test already timed out on the same selector before this task. The assertion was not removed or weakened. Later assertions in that suite remain unverified. Whole-repository lint was not rerun; its previously documented selector-ratchet baseline remains outside scope.

Native read-only inspection confirmed the app remains open, spaces render and old rail entries are absent. The user's active project view was preserved; interactive Runs/History checks and screenshots used fixtures rather than navigating a live page that can enrich GitHub data. No further restart was performed.
