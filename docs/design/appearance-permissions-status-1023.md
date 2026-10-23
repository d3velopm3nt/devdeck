# Appearance, tool permissions and connection states

Local work on codex/integrate-connectors-tabs-1023. No main merge or push.

## Changes

- Top-bar Appearance shows labelled background, surface, accent and text swatches for every saved theme, with current selection, keyboard arrows/Home/End, Escape and trigger focus restoration. The menu scrolls within short viewports. Save failures remain visible.
- ChatGPT and GitHub are unofficial dark palettes in the existing theme model. Each defines the complete semantic token set. ChatGPT uses neutral charcoal with mint; GitHub uses cool dark surfaces and blue. Existing six themes and saved identifiers remain supported. This is visual inspiration, not an exact reproduction or official affiliation.
- Installed Community tool cards have Manage permissions. It opens the existing Installed grant controls scoped to that tool; browsing filters/tab/scroll remain mounted, Back/Escape restores origin focus. No agent is granted access by navigation. Empty agent and removed tool states explain the next step. Existing grant/revoke ownership and approval defaults are unchanged.
- Cards and connection details share labelled static status indicators. Configured is explicitly unverified; authenticated is unchecked; verified is last recorded success, not continuous monitoring. Degraded is error-colored, reconnect/dependency warning-colored, paused hollow and disconnected square. The same labels and explanatory titles convey meaning without color.

## Verification

Browser fixtures use mocked IPC only. No real sign-in, permission grant, service probe or model call.

- check-appearance: all eight theme palettes match actual tokens; selection/save/reload, focus, keyboard, outside/Escape, 320px and save failure pass.
- check-community-permissions: two correct tool identities; keyboard entry/Escape/Back; origin focus/filter restoration; empty agents; narrow/light; zero grant calls during navigation pass.
- check-connection-states: all eight states in all eight themes; configured/authenticated/verified distinction; static indicators with reduced motion; new-theme status text contrast at least 4.5:1; 360px pass. Complete new-theme token sets checked.
- check-theme-accents: eight-theme focused inputs, checkboxes and menu hover pass.
- Existing check-connectors: all 13 visual/lifecycle groups pass. Existing check-connector-controls: lifecycle, restriction persistence, reconnect preservation, mocked owner check, dependencies and reopening pass. Assertions now target the new visible status labels. Chrome path and server URL can be supplied by environment, retaining prior defaults.
- TypeScript build, production Vite build, scoped oxlint and git diff --check pass. No Rust source changed; Rust tests were not rerun.

Native verification was unavailable: no DevDeck process or WebView debugging listener was found at the final check. No app was restarted, and no native preferences were changed. All screenshots show actual components rendered with fixture data, not live account states. Whole-repo lint was not rerun; previously documented selector-ratchet failures remain outside this change.

Public references consulted: https://openai.com/brand/ and https://chatgpt.com/. Primer documentation requests were inaccessible; no exact official GitHub brand-token claim is made.
