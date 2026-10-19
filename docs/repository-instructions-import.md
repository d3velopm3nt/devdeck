# Agents and workflow suggestions from repository instructions

In Discover, inspect a public repository and choose **Review imports**. The same panel is available from Library → Import. When the inspected revision contains root `AGENTS.md`, **Build from AGENTS.md** offers two independent actions:

- **Create agent:** copies the original document with its pinned source URL, lets the user select repository skills and model, and creates a new Claude Code agent in the existing personal agent store. Skill identity requires the repository, revision and path to match; missing selected skills must be imported first. The existing collision-safe creation path preserves previously saved agents.
- **Review workflow:** detects a numbered list inside an explicit Workflow, Process or Procedure section. Proposed steps can be edited, reordered, removed or reset. The user selects an existing agent and target folder, chooses a new workflow ID, and reviews the result before saving through the existing folder-workflow API. An existing nonempty file is never silently replaced.

Suggestions are structural extraction, not AI interpretation of arbitrary prose. They are a proposed sequential process, not a faithful conversion of conditional instructions into a graph. The complete original document and pinned source URL remain in shared context. Code fences are opaque to step detection but retained in step instructions. No workflow is inferred when the document lacks a recognizable numbered process. Each saved step uses the existing pending/review/dependency semantics.

Agent creation and workflow saving start no runs. They do not change command grants, schedules or unattended execution. The current importer still copies skill instruction files only; accompanying helper scripts and resources remain a setup dependency.

The implementation separates pure extraction/serialization and pinned source reading in `src/lib/repositoryInstructions.ts` from the review component in `src/components/agents/RepositoryInstructionsImport.tsx`. Persistence stays behind existing typed IPC boundaries. Source loading is abortable, errors are visible, and selected skill provenance is revalidated immediately before agent creation.

## Verification

- `node --test harness/repository-instructions.test.mjs`: structural extraction, code fences, original conditions, dependency serialization, safe agent creation defaults, provenance mismatch and source-read errors.
- `harness/check-repository-instructions.mjs`: headless browser fixture covering skill import, reviewed creation, reorder/removal, overwrite conflict, saving without execution, stale dependencies and narrow layout. Backend persistence is simulated in this fixture.
- A live read of the pinned `michaelshimeles/skills` document produced Isolate, Build, Prove and Ship, retaining its full original conditions.
- TypeScript and focused lint pass, apart from the pre-existing LibraryPanel fast-refresh export warning.

Native persistence uses existing commands; this feature has not yet been exercised through a real desktop save or an actual agent/workflow run.
