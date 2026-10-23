# Optional setup and real agent verification

Related: #31. Built on `feature/visual-team-builder`.

After choosing local state storage, the shell opens without requiring the personal onboarding wizard, GitHub, or AI. Local spaces/projects, stash, connection management and terminals remain available; individual tools still need their own local dependencies or credentials.

A top banner offers Setup, Not now (this mounted app session), and Don't show again (persisted in app settings). Settings → Setup always remains available. GitHub and AI are independent optional sections. GitHub is for issues/PRs; AI is for chat and agent execution.

## First chat

1. Open Setup or Settings → AI → Providers.
2. Connect a subscription, API or local provider.
3. Select the provider and model; for ChatGPT subscription select CLI default.
4. Verify & use as default makes a real model call before saving. A failed call does not save. Successful verification exposes Start chatting.
5. Configure individual overrides under Agents; Verify & save checks those before saving.

Old mock-backed agents display an unconfigured state instead of a scripted model choice. New agent templates start without a provider/model. Production no longer registers the mock provider; chat and agent execution reject unconfigured/mock-backed agents. Test fixtures keep the mock implementation. Existing history is not deleted. The selected default still applies to previously unconfigured specialist definitions, consistent with the existing default-provider flow; this does not start any agents.

## Verification

- TypeScript build and frontend production bundle passed.
- Lint passed with existing warnings.
- Browser harness passed: temporary/permanent banner dismissal, subscription default selection, verification-before-save, chat navigation, absence of mock model choices, failed verification does not save.
- Browser harness substitutes native IPC and does not prove authentication, CLI inference or native persistence on Windows.
- Native cargo check attempted; compilation failed while building the syn dependency with an LLVM archive error. Native build and actual Windows subscription sign-in → verification → chat remain pending.

Run browser checks using `vite --config vite.harness.config.ts --port 5199`, then `node harness/check-capability-setup.mjs` (PLAYWRIGHT_MODULE and CHROMIUM_PATH overrides supported).
