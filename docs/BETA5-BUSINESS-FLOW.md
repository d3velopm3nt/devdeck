# Beta five: business setup and one agent team

Core setup is available before the personal onboarding steps and in Settings for existing users. State storage, the default assistant model and GitHub can be connected independently. Manual use remains available without agents.

“Add a space” keeps Business and Personal. Personal setup hides business/product starters. The business Code step now lets each agreed product select an existing repository and Project, or explicitly create them. Repository creation is private by default. Project creation is separate, so a permission error does not discard a successful repository creation. Connecting the repository also registers the product in Activity. The advanced connection editor remains available for existing metadata.

Projects belong to the repository owner in this first slice. A connection saves the Project link; it does not automatically copy issues into the Project or configure Project workflows. GitHub remains the product backlog. GitHub Project permissions are separate from repository permissions. Browser sign-in requests Project scope; existing tokens may need updating.

Agents is one directory with Managers, Workers and Specialists. Role profiles are job descriptions, separate from role. The list shows team relationships, space, latest task/status and execution connection. Managers coordinate through their existing responsibility/team/conversation workspace. Workers and worker-backed specialists use the existing worker editor and explicit task launcher. No new orchestration runtime is introduced.

The main assistant needs a model provider, not a coding CLI. Assistant-backed agents can inherit its provider/model, with per-agent overrides and a “Use default” reset. Coding workers use their own CLI runner. Manager conversations fall back to the main assistant when no agent is assigned. Scheduled manager behavior still requires its existing engine/team/schedule setup; the fallback does not silently enable unattended execution.

## External session updates

A connected product reads versioned session checkpoints from repository issue comments. Activity/Sessions refresh GitHub every 60 seconds while the view is visible; manual Refresh is also available. No state Git pull is required for these comment updates. Local state files remain supported and require their existing sync process.

Create an input JSON with `id`, `assistant`, `title`, `status`, `step`, `blocker` and `next_action`. Generate the comment body:

```sh
node scripts/github-session-checkpoint.mjs checkpoint.json > checkpoint-comment.md
```

Post the body on the issue using your existing GitHub integration or, when authorised:

```sh
gh issue comment 7 --repo owner/repository --body-file checkpoint-comment.md
```

Use the same session ID and assistant on the same issue for subsequent checkpoints. DevDeck takes timestamps and issue links from GitHub rather than trusting dates inside the JSON. Ordinary comments are not sessions. Only owner/member/collaborator comments carrying the explicit v1 marker are accepted; these are display records, not execution instructions. Histories are limited to the latest 500 repository comments, with a visible warning. Closing an issue remains authoritative for backlog completion.

## Verification

Sandbox checks use production React components with mocked native IPC, and production Rust coordination/event/workflow/session model code with the desktop adapter stubbed. The beta-five browser check covers repository-only connection after Project permission failure, preserving a created repository after Project failure, failed model verification not saving, and the unified list/role filter/manager and worker creation. Existing onboarding and visibility checks cover state selection, retry, personal preview, filters and failure preservation.

The full Tauri check is unavailable in this container because the Linux desktop libraries/pkg-config are absent. Windows CI must pass native clippy, tests and installer build before publishing the release. Browser tests do not prove real authentication, cloning, provider responses or CLI execution.

Windows acceptance: choose an existing business, add one product and its repository/Project, verify its issues appear in Activity, create one manager and one worker, assign the worker to the manager's team and run one bounded task. Review its output. Post two external checkpoints to one issue and confirm Sessions advances after Refresh and then after automatic polling. Confirm a failed GitHub read preserves the last known work and reports the failure.
