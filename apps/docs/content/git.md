# Git and reviewing changes

## Project status

DevDeck exposes branch information, changes and fetch controls for linked projects. Use these to confirm the repository and branch before reviewing work.

## Worker isolation

Code workers can use branches and worktrees. The output may therefore be outside your ordinary checkout. Read the worker receipt for the actual output location.

## Review before integration

Inspect the diff, check the reported verification, and confirm that the change meets the task. A worker finishing does not establish that its changes are on your main branch.

## Workflow acceptance

Accepting a workflow step records review and unlocks dependencies. It does not merge a branch, transfer files between worktrees or publish a release. Make accepted outputs accessible to the next worker and record their paths or commits in the review evidence.
