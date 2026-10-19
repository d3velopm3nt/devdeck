# Software Factory

A repository-based team package for DevDeck: five agent briefs, five self-contained skills and a team definition. Creating or importing definitions starts no work.

## Contents and discovery

- `agents/*.md`: reusable role briefs, discovered by DevDeck's repository Library importer.
- `skills/*/SKILL.md`: reusable skill definitions, discovered by that importer.
- `team.json`: DevDeck Team/Role schema with reporting lines and handoffs. Worker IDs map to brief filenames in this reusable template.

Factory Manager is the lead; Builder, Verifier, Reviewer and PR Manager report to it. PR Manager is a manager role but has no direct reports in this first team. DevDeck coordinates requested handoffs; links alone do not enable autonomous delegation.

## First discovery test

Open Workforce → Library → Import team package. Use Choose folder to select the local repository root, or this package folder. A repository root with exactly one `factories/*/team.json` resolves to that package; multiple packages require selecting a specific folder. Inspect the five agents, five skills, reporting lines, handoffs and imported instructions, then choose Import into Library.

The package remains a folder under the personal Library's team-templates directory. Library → Teams lists the reusable template; Agents and Skills also list its contents, with a source-team label and a team filter. No configured agents or working team are created. Similarity analysis is deferred.

Confirm reporting lines, handoffs and skills survive reopening. Retrying the same package returns the saved template; conflicting content is not overwritten. Missing dependencies block import. This first team importer supports self-contained skills and retains the README with the package. Skills with supporting resources are rejected rather than imported incompletely.

The separate GitHub Import action still discovers briefs and skills on the remote default branch. It does not assemble remote team manifests, and unpublished local files are not visible to it.

Library import selects no model or provider and grants no execution permissions. Creating configured agents from a template is a separate action. No grants, schedules or unattended runs are included.

## Handoff contract

Include this contract in launch briefs when this template is later configured for actual work.

Every handoff identifies the goal/work item, acceptance criteria, owner, repository, worktree, branch, base and current HEAD commits, dependencies, changed paths, actual checks and outcomes, evidence locations, unresolved findings and requested next role. Record missing fields explicitly rather than guessing. Evidence and reviews belong to an exact revision.

The normal path is Factory Manager → Builder → Verifier and Reviewer → PR Manager → human merge decision. Verification and review may run independently on the same immutable revision. Failures return to the builder; affected checks repeat after fixes. Default limit: three repair cycles per item, followed by a blocker report. The manager may revise the plan with the human when the scope changes.

Builders own separate worktrees/branches when concurrent. The PR Manager owns integration; use one PR per goal initially. Build and verification do not imply publishing permission. Push/PR actions require task authorization; merge requires explicit human authorization. Built means verified on a branch; done requires confirmed merge.

## Pilot acceptance

Use a small DevDeck change with observable behavior after discovery/configuration succeeds. Confirm role-specific briefs and skills reach actual runs, ownership survives handoffs, the verifier can reject a broken result, the reviewer can route a finding, and the PR Manager reports current-commit readiness. Preserve blocked and unverified outcomes rather than turning them into success.

## Provenance

Original role briefs and skills for DevDeck, informed by the isolation, evidence and bounded review approach discussed in [michaelshimeles/skills](https://github.com/michaelshimeles/skills). No upstream skill text or scripts are vendored. Greptile is optional and no external uploader is required. These files inherit the DevDeck repository license.
