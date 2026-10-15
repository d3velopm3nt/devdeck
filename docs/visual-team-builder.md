# Visual team builder

![Desktop team builder with selected frontend specialist](screenshots/visual-team/desktop.png)

Screenshots use representative browser-harness data, not live customer activity.

Open **Agents → Library** to browse separate **Agents** and **Skills** tabs. You can search, create custom text definitions, import from GitHub, or reuse Community imports. Configure an agent template before assigning it to a team; skills remain explicit shared references.

Open **Agents → Reusable teams → Create team**. The team starts with a lead manager. In **Settings**, name the team, give it a stable lowercase ID, and select a configured workflow agent for the lead.

Use the **+** on a manager's card to add a direct report. Select **Manager**, **Specialist**, or **Worker** in Settings. Managers can have their own reports. Change **Reports to** to move a role; descendants cannot become their own managers. Choose handoff targets and add team-specific instructions. Save the team to persist it. Saving starts no work and grants no permissions.

Select any card to inspect its configured instructions, assigned skills, reporting manager, and handoff targets. **Activity** shows actual runs for that configured agent, including runs from other teams. It refreshes every five seconds. Select a run to inspect recorded activity and its saved launch instructions. Older runs have no retroactive prompt snapshot.

The canvas supports horizontal scrolling, zoom, and **Fit**. On narrower screens, the inspector sits below the diagram. Drafts remain while switching between Agents sections or opening the agent editor; use Save before leaving the Agents page or closing the app. Back to teams asks before discarding edits.

## Workflows and execution

Choose the saved team in a folder workflow and map step roles as before. Saved role IDs stay fixed to avoid breaking workflow references. Team role instructions and reporting/handoff context are resolved into the workflow definition and included in worker launch instructions. Re-save an unstarted workflow to pick up changed team configuration; running workflows retain their existing context. The actual launch brief, including the selected template text, is copied into the run receipt at start.

The graph is a coordination structure, not a new autonomous delegation runtime. Dev and the existing workflow runner still start eligible workers and enforce dependency/review gates. Manager roles use configured workflow agents; separate legacy manager bots and AI workspace agents are not selectable in this builder. Reporting and handoff targets request coordination through Dev; drawing a link does not enable direct messaging or grant a tool.

Existing flat teams open as a draft hierarchy with their first role as lead. Their role names and worker assignments are preserved. Review that proposed structure before saving. Missing agents, invalid IDs, cycles, invalid handoffs, and stale team revisions are rejected.

## Verification

- TypeScript and production frontend bundle verified.
- Core Rust suite: 58 passing tests, including hierarchy validation and legacy/team-context compatibility.
- Browser harness exercises hierarchy edits, save/reopen, manager restrictions, prompt receipts, mobile layout and parent renaming.
- Browser fixtures substitute the Tauri IPC boundary. Actual Windows native launch/persistence and Android device behavior require device testing. The browser harness does not execute real worker processes.
