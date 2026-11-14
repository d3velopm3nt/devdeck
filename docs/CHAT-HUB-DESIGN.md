# Chat hub design

Status: agreed design, not yet implemented. The dedicated Chat page is the next implementation stage. The Activity timeline cleanup is separate and preserves the existing manager chat until the replacement is available.

## Conversation identity

Chat brings DevDeck's existing conversations together. Starting a conversation at a space, project or feature creates or opens its own thread. Opening that thread from Chat or Activity uses the same conversation ID, messages, participants and original context. It must not copy a transcript into a second conversation or silently merge unrelated subjects.

Existing foundations: `src/components/thread/Thread.tsx`, node threads in `src-tauri/src/threads.rs`, `aiw.conversations()` and `aiw.conversation(id)`. The present manager timeline uses a separate manager conversation API; its mapping must be verified before migration. Keep existing history and identify its source.

## Layout

- Global Chat navigation beside Activity.
- Left: search, space/project filters, New conversation, and subject threads with last-message previews and unread state when recorded.
- Center: selected subject, participants, messages and composer. The same thread remains available inside its originating space/project/feature.
- Right: Linked work, origin/context and assigned agent. GitHub issues, PRs and workflow runs appear as readable cards.
- Activity: progress, checkpoints and handoffs, with navigation to the relevant conversation. Move conversation composition to Chat and contextual thread surfaces once the shared route exists.

Use existing theme tokens and Lucide actions, plus brand identification marks for GitHub and ChatGPT. Neutral surfaces, clear selected/focus states, compact controls and small meaningful status accents. Context labels are plain metadata, not pills.

## Human and agent messages

Humans and DevDeck agents can participate in the same subject thread. Agent-to-agent messages identify sender and recipient. Preserve actual exchanged messages, replies and handoffs. Record a conversation/task link at message creation; old unlinked mailbox messages remain explicitly unlinked. Do not attribute them to a product solely from a manager's home folder.

Do not display private reasoning as chat. Tool actions remain expandable execution records. Summary pills count recorded actions and distinct linked issues, PRs or runs; failed actions are identified. A mention of an action in prose is not an execution record. A logo is identification, not proof of live connectivity.

## First implementation acceptance

- Open one existing contextual conversation through both its origin and Chat; history and subsequent replies agree after reopening.
- Separate subjects retain separate conversation IDs and context.
- A real agent-to-agent message appears once in its linked thread, identifies both parties and accepts a human reply through existing permissions.
- Activity opens the linked conversation; old unlinked records show an explicit empty-link state.
- Summary pills open the exact recorded actions/references in Linked work. Counts deduplicate URLs; failures remain visible.
- New/empty, loading, failed send with retained draft, unavailable engine, and stale/disconnected states have clear UI.
- Verify light/dark themes, keyboard operation and constrained window widths.

External ChatGPT/Claude conversation connections are deferred by user direction. No such connection is implied by this design.
