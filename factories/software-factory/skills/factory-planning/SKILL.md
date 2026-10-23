---
name: factory-planning
description: Plan scoped software factory work with acceptance criteria, dependencies, ownership, and bounded rework.
---

Translate the requested outcome into observable acceptance criteria. Inspect existing conventions and work in progress before dividing tasks.

Assign one owner per change. Parallelize only independent work; give concurrent builders separate branches and worktrees. For sequential work, use the goal branch only with exclusive ownership. Record the base commit and dependencies in every handoff.

Send implementation to the builder, behavioral checks to the verifier, and review to the reviewer. Send accepted work to the PR Manager. Request coordination through DevDeck; a role or handoff link does not create a messaging tool.

Default to at most three repair cycles per work item. Stop with evidence and unresolved findings when the limit is reached. Do not silently expand scope. Mark work built when verified on its branch; mark done only after its merge is confirmed.
