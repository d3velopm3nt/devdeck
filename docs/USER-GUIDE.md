# DevDeck user guide

This guide describes source in **PR #25**, including its mobile-companion base.
These changes are unmerged and may not be in your installed release. The guide
was checked against source at `f016757` and its passing Windows/browser CI;
real desktop-worker and phone acceptance are still outstanding.

## Find your work

| Area | Use it for |
|---|---|
| Today | Day-oriented views and existing calendar/routine features |
| Work | Goals and work items; **Team workflows** opens folder workflows |
| Chat | Conversation with Dev and other configured conversations |
| Agents | **Configured agents**, **Library**, **Reusable teams**, and **AI & permissions** |
| Spaces | Your folder tree, vault folders and linked source repositories |
| Activity / Sessions | Local work, connected GitHub issues, recorded checkpoints and freshness |
| Settings | Core setup, connections, voice and mobile companion configuration |

Dev is the coordinator you talk to. For issue workflows it chooses a reusable
workflow and delegates eligible steps to configured workers directly. It does
not create a dedicated lead conversation for each ticket.

## Before starting

Run the Windows desktop from the intended branch; see [setup](../CONTRIBUTING.md).
Choose a vault and create/select the space and folder that will hold workflow
state. Link a source repository to an execution target when coding is required.
The vault folder and execution repository can be different locations.

Configure Dev's model connection and, for coding workers, a supported worker CLI.
[Subscription sign-in](CLI-SUBSCRIPTION-SETUP.md) makes inference available; it
does not by itself install or authenticate every worker runtime. Verify the
runtime shown in each worker preview. Connect GitHub before issue routing and
monitoring. Leave automatic dispatch off while setting up the example below.

## Example: a small documentation ticket

Use a non-production documentation task first. The example creates two agents
sharing one skill, a team, and a two-step workflow. Choose actual names, handles
and target IDs from your own app; the example does not create them automatically.

### 1. Create or import reusable text

Open **Agents → Library → Create custom**. Choose **Skill**, ID
`review-checklist`, name `Review checklist`, purpose `Report evidence and gaps`,
and instructions such as:

> Compare the result with the requested acceptance criteria. Record the files
> inspected, commands run, their results, and anything you could not verify.
> Do not report a check as passed if it was not run.

Choose **Save definition**. Repeat with type **Agent template**, ID
`documentation-helper`, and instructions describing the writing task. A template
is a starting definition, not a configured agent or a running session.

Other entry points feed the same library:

- **Add from GitHub** inspects supported `skills/<name>/SKILL.md` and
  `agents/<name>.md` text definitions and lets you select what to import.
- **Community** is optional. Inspect the selected skill/agent definition and
  its source/licence, then **Import text to library**. Continue under **Agents → Library**.
  Importing text does not install an MCP server or grant its tools.
- Ask Dev in Chat, for example: “Create a shared library skill named Review
  checklist, ID review-checklist, with these instructions …”. Dev can propose
  `library.create`; review the exact definition before approving its save. The
  same path works through a paired voice conversation. This creates text only;
  finish runtime and permission configuration in the agent editor. Use a new ID
  if the definition already exists; conversational creation does not overwrite it.

**Read** shows the stored instructions and provenance. Custom definitions can
be edited with revision checks. Imported originals are not silently rewritten
by the custom editor. Catalogue imports are idempotent; GitHub imports can
explicitly update the same source/path. Similar content from another source
requires a distinct identity or deliberate removal/replacement, not automatic
semantic deduplication.

### 2. Configure two agents

On `documentation-helper`, choose **Configure agent**. Name it `Docs writer`,
choose the appropriate role/profile, select the shared `review-checklist` skill,
and configure its runtime, allowed spaces, tools, budgets and review limits.
Save it. Configure a second agent named `Docs reviewer`, using the same shared
skill and a suitable review brief. Alternatively use **Agents → Add agent**
with Worker/Specialist and the existing editor.

Library availability is not activation: only selected library skills and tools
are attached by the profile. A skill is shared by ID, not copied for each agent.
Editing shared text affects future uses; it does not change a running process.
External CLI runtimes can have their own project/global instruction discovery.
Inspect those separately when evaluating the effective worker environment.

### 3. Assemble a reusable team

Open **Agents → Reusable teams → Create team**. Name it `Documentation`, ID
`documentation`, and add roles `writer` → Docs writer and `reviewer` → Docs
reviewer. Choose **Save team**. Missing agents or library references must be
repaired before saving/starting; a saved team grants no new authority.

### 4. Define and map a workflow

Open **Work → Team workflows**, select a vault folder, enter a new workflow ID
such as `documentation`, and choose **New workflow → Create workflow**. No
Workflow label on the folder is required. The editor lists available workers
and target nodes.

Start with the following YAML/Markdown structure. **Replace both `target: 123`
values with a real target node ID before saving.** It is a schema example, not a
ready-to-run configuration. The saved team must already exist.

```yaml
---
title: Documentation ticket
team: documentation
steps:
  - id: draft
    title: Draft the documentation
    role: writer
    target: 123
    needs: []
    instructions: "Make the requested documentation change and record validation evidence. Return a reviewable result."
  - id: verify
    title: Verify the documentation
    role: reviewer
    target: 123
    needs: [draft]
    instructions: "Inspect the accepted draft against the ticket. Check links and commands. Report evidence and remaining gaps."
---

# Shared context

Describe the repository, documentation audience and acceptance criteria here.
Ensure the reviewer can access the accepted draft before starting its step.
```

In **Reusable team and step roles**, choose **Read draft steps**, select the
Documentation team, map Draft to `writer` and Verify to `reviewer`, and **Apply
team to draft**. Check the resolved agent names, then **Save workflow**. Apply
only changes the draft; Save persists it. Direct agent assignments also work.
The **Technical team template** is an optional four-step starter; its planning
role is an ordinary worker assignment, not a dedicated lead session.

### 5. Route one issue manually first

In Activity, use **Add business / product** to add a product repository through
the existing company setup. If no repository is connected, **GitHub issues →
Connect repository** opens the Product connections form: save the product ID,
name, space, vault-relative folder and `owner/repository`; the GitHub Project
URL is optional. Refresh and check the repository and issue are visible.

Return to the workflow and choose **Route GitHub issue**. Pick the open ticket
and choose **Route issue to workflow**. DevDeck creates a separate issue run
from the selected template. Routing again in the same folder opens that run
with its progress intact; it does not start a duplicate. Routing alone starts
nothing. Existing runs retain their resolved assignments when a saved team
changes; new routes use the latest team.

Select Draft, choose **Start workflow**, inspect the worker plan, then **Start
this step**. A successful worker receipt moves to review. Read the actual output,
record review evidence, and **Accept step**, or **Request changes**. Acceptance
unlocks Verify, but does not merge or publish the draft. Make the accepted
output available to Verify's execution target first: independent worktrees do
not automatically share unmerged changes. Then preview/start Verify and review
its result in the same way.

### 6. Opt into automatic dispatch

Once the template and worker permissions are correct, expand **GitHub issue
monitor** on the workflow page. Monitoring and execution are separate controls:

1. **Enable monitoring** polls connected repositories while the desktop runs.
2. Expand a repository, choose its workflow folder and **Enable dispatch here**.
   This includes existing open issues, not only issues created after enabling it.
3. Under **Agents → AI & permissions**, give Dev **Full** permission for the
   `workflow` tool only if you want unattended workflow mutation/start. Approval
   permission cannot approve an unattended dispatch and shows a blocked reason.

Dev selects from existing templates in the assigned folder. The host validates
that selection and starts ready pending steps through the normal worker runtime.
Independent steps/issues can run concurrently within runtime limits; dependencies
still require acceptance. A failed step is not automatically retried. Claims and
receipts survive restart; an interrupted selection needs **Retry selection**.

**Pause monitoring** or **Disable dispatch** prevents subsequent starts; running
workers continue. Use their run controls to manage active work. Revoking Full
workflow permission prevents new automatic starts. Monitor status/error text
explains blocked work; assigning a folder alone is not proof a worker started.

## Follow progress and recover

| What you see | What it means / next action |
|---|---|
| Pending | Has not started; inspect dependencies, assignment and permission |
| Starting / running | A launch claim or run is recorded; open its receipt and timestamp |
| Review | Inspect output and record acceptance or requested changes |
| Blocked | Read the error; repair prerequisites and explicitly review/retry |
| Completed / all steps accepted | Workflow acceptance finished; this does not prove a merge or deployment |
| Old external session checkpoint | Reported activity may be stale; it is not a live heartbeat |

Mobile Activity includes counts and active steps, timestamps and run references.
Parallel work is not reduced to the first pending step. Refresh errors retain
previous issues with a visible warning. The issue reader is bounded to recently
updated records (up to 500 issues/PRs); it is not a complete historical import.

Workflow edits and reviews reject stale revisions. Refresh, inspect changed
progress and reconcile before saving again. Do not overwrite another assistant's
work. [Session checkpoints](session-visibility.md) explain how external assistants
record evidence; sync the vault normally before switching devices or assistants.

## Phone and voice

Follow [mobile setup](../mobile/README.md) for pairing and HTTP/HTTPS limitations.
The current bridge does not configure a supported TLS endpoint. The PC
must remain running. The phone reuses desktop conversations and permissions;
accept protected actions on the desktop. Voice submits on a pause, acknowledges
accepted input once, then delivers the reply. The duplication fix normalizes
recognition updates; it is not a request to lengthen every pause. Real Android
speech remains a required test, especially repeated growing phrases.

## What this guide does not promise

Issue workflows have no schedule/routine trigger in this increment. Existing
manager schedules do not automatically feed this dispatcher. Notifications,
morning briefings, category sounds, spoken hints and incoming-call behavior
are [planned in #26](https://github.com/d3velopm3nt/devdeck/issues/26), not mobile
push features you can enable here. Generic nested delegation and a unified team
conversation for every workflow run also remain follow-up work.
