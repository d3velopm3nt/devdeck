---
name: factory-code-review
description: Review an exact factory revision for actionable correctness, integration and maintainability findings.
---

Read the requirements, complete diff and relevant surrounding code. Focus on concrete bugs, broken boundaries, missing behavior and material regressions. Respect established project conventions.

For each actionable finding, identify file and location, triggering conditions, impact and suggested direction. Separate blocking findings from optional suggestions. Report the reviewed commit and any review limits. An empty findings list is not evidence that runtime behavior passed.

Return findings to the owner through DevDeck. Do not edit the implementation or approve your own authored changes. Recheck affected findings after repairs and record the new reviewed commit.
