# Activity board and Sessions

GitHub owns product development issues and pull requests. Activity board combines
those with DevDeck tasks for Life and Personal. Sessions connects each individual
external conversation or local agent to its folder and work. Use product, space,
assistant and session filters, then select a card to read checkpoints and next actions.

## Connect a product

Open **Activity board → Product connections**. Add a stable ID, product name,
space, vault-relative folder, `owner/repository`, and optionally the GitHub Project
URL. Save, then Refresh. GitHub uses the account connected in Settings. Errors
remain visible and do not hide local work. The last successful read is dated.
The overview reads up to 500 recently updated issues/PRs per repository and marks
truncated results. GitHub Project custom status fields are not imported in this
version: closed items appear in Done; a recent linked session determines reported
activity for an open ticket, otherwise issues appear in Queued and PRs in Review.
These activity columns do not modify the GitHub Project status. GitHub assignees
and linked sessions are shown separately. Clicking the project link
opens the authoritative product backlog.

## Record an external session

Each conversation owns `.devdeck/sessions/<unique-session-id>.json` at the vault
root. The record contains `id`, `assistant`, `product_id`, `space`, `folder`,
`title`, `status`, `started_at`, `updated_at`, `ticket_url`, `conversation_url`,
`step`, `blocker`, `next_action`, and `checkpoints` (timestamp, summary, evidence).
Use RFC3339 timestamps. `ticket_url` must exactly match the GitHub issue or PR URL.

Pull the state vault before starting. Create an input JSON with the fields above
(except timestamps and checkpoint history, which the helper supplies), plus
`summary` and optional `evidence`. Run:

```sh
node scripts/session-checkpoint.mjs /path/to/state-vault /path/to/input.json
```

The command prints the file path and its SHA256 revision. For another checkpoint,
pass the previous revision as a third argument. Changed records are rejected;
read and reconcile before retrying. Another assistant uses a new session ID and
links the same ticket. Commit and push the record normally; never force-push.
GitHub's revision-aware file tools can also update these records directly.

Record the start, milestones, blockers, handoff and completion. Do not save raw
private transcripts or credentials. A new conversation reads the latest ticket,
linked session checkpoints and workflow files before continuing. The record is
evidence of reported activity, not permission or an instruction to run a worker.

## Refresh and activity limits

DevDeck reads the local vault clone every 30 seconds and reloads on agent events.
Use Git pull/sync to receive remote external-session updates; this page does not
silently push or pull. Refresh reads GitHub issues. External ChatGPT and Claude
sessions must explicitly write checkpoints; the app cannot observe those chats
or install hooks into them. A 15-minute-old update is labelled stale, not live.
Completed sessions stay completed. Native agent sessions come from the existing
runtime; their last known transcript/checkpoint timestamp is displayed.
