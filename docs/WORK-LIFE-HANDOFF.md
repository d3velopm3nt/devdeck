# Work, Life and assistant handoffs

Current source guidance for unmerged PR #25. See the [user guide](USER-GUIDE.md) for setup and release boundaries.

The Work & Life setup is the last personal onboarding step. It can also be opened from Today. Work opens the existing company wizard for profile, products, repositories, mail and team. Life offers editable Family, Home, Finance, Health, Routines and Knowledge areas, a Life manager and two reminders. Review before creating. Existing spaces are preserved.

Team roles are starter suggestions. Users can add or edit managers and specialists in Agents. When adding a second company, an existing matching functional manager is suggested for reuse rather than creating another. Review this selection before creating the team. Company records remain separate; sharing a manager does not grant its workers new permissions. Engine, scopes, tools and execution permissions still need configuration.

## Continue with ChatGPT or Claude

1. Pull the state repository and read the selected workflow file (`WORKFLOW.md` for default, `.devdeck/workflows/<id>.md` for named workflows), project context and referenced files.
2. Follow the pending step's instructions and accepted dependencies. Keep the history and review evidence.
3. In DevDeck, open **Continue with another assistant** for a selectable handoff packet. It includes the current workflow document and a reminder to sync. Referenced artifacts must also be available to the next assistant.
4. Use **Record work from another assistant** to record the assistant name, evidence, blockers and next action. **Save checkpoint** preserves unfinished work. **Submit for review** records work awaiting review.
5. Review the actual artifacts and record review evidence before accepting. Acceptance unlocks dependencies; it does not merge or publish code. A configured issue dispatcher may subsequently start eligible pending steps; otherwise preview/start them explicitly.
6. Commit and push workflow updates before switching environments. DevDeck reads a local clone; cloud chats and local folders do not automatically synchronize.

The workflow file retains actor, next action, update time and checkpoint history. Writes reject changed revisions, unsatisfied dependencies, completed steps and live worker claims. Existing definitions without the new optional fields still load.

Folder IDs and worker handles are local execution references. Another assistant can read the process and preserve progress from the file, but a different DevDeck installation must review its target IDs and workers before launching local steps. This handoff path does not add automatic Git sync or unattended external-chat execution. Separately, the [opt-in issue dispatcher](folder-workflow-routing.md) can start eligible local workers.

## Verification

- TypeScript project build, frontend lint and production bundle passed.
- 20 production core logic tests passed, including external handoff dependency and running-step protection.
- Browser onboarding checks use actual React components with mocked native IPC. They cover authentication fallback, failed-clone and selection retries, Life draft/review/create, and reuse of an existing manager for a second company.
- Browser workflow checks cover explicit preview/start, event updates, evidence/review/dependency gates, stale definition and editor protection, and external assistant progress submission followed by human acceptance.
- Native Windows CI186 passed for `f016757`; PR packaging is intentionally skipped. Real-agent Windows onboarding and provider execution remain device tests.
