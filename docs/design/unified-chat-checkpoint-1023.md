# Unified conversation checkpoint — 2026-10-23

Chat is the shared conversation home. Space/project/folder launchers open existing scoped histories on demand rather than creating managers on mount. Work History retains its specialized global timeline and uses the same composer for manager replies. Voice uses the same send contract and conversation persona. Existing runtime/tool permissions, participation and manager orchestration remain in place.

## Implemented

- Shared ConversationComposer and ConversationModel controls, with effective pinned/overridden next-message configuration also shown in the inspector.
- Conversation-specific provider/model revisions preserve old snapshots, history and agent defaults. A change affects subsequent turns, not the configuration already captured by a running turn. Guest agents keep their own configuration and permissions.
- Explicit context contract for user-selected text files, bounded folder files, URL references and actual installed skill bodies. File/skill content travels separately from user mention/handoff text into AgentRequest.context. Context selection does not grant filesystem or tool access.
- @agent selection preserves existing participation semantics. @skill selection resolves an installed skill by name; unavailable skills fail before a turn starts.
- Memory-only per-conversation context drafts, failed-send retention, conversation isolation and duplicate typed/voice turn rejection.

## Deliberate limits

Images are visible but block sending: current conversational adapters do not serialize image content. URLs are references, not fetched pages. Folder intake is explicit browser selection, limited to four nested levels, 16 files, 64 KiB each and 128 KiB total context. Common private filenames/key markers are excluded; this is not an exhaustive secret scanner. Unsent file bodies are intentionally not persisted across reloads. Team planning-mode messages reject rich context instead of silently dropping it; their existing orchestration remains separate. Legacy unused thread widgets remain for compatibility. No claim that every historical composer implementation has been deleted.

## Verification

- TypeScript project build: pass.
- Vite production frontend build: pass (existing bundle/plugin timing warnings).
- Scoped oxlint: exit 0; three warnings in visibility fixture/Chat effect, not suppressed.
- Unified Chat browser fixture: 7 groups pass; model controls, file/skill payload, image deny, link label, failed drafts, repeated switching, scoped launcher, keyboard cancellation/focus and narrow layout.
- Work Runs/History browser fixture: 8 groups pass, including manager reply/draft, old redirects, source errors and external/unlinked records.
- Rust chat_contract tests: 6 pass; assistant tests: 10 pass; agent_library tests: 3 pass.
- git diff --check: pass.

Browser IPC/provider responses are mocked. Rust tests above use their existing temporary conversation/snapshot stores and pure contract checks. No live inference, account probes, credential edits or permission grants were performed. Full provider serialization/streaming, folder picker OS integration and voice capture are not yet verified. Native new-command wiring was subsequently verified below. Earlier unrelated Work-page regression and repository-wide lint baselines are not claimed fixed.

## Native follow-up after explicit restart approval

The user approved one bounded rebuild/restart after the prior denial. The supported graceful close succeeded without a visible draft/dialog. `cargo build --manifest-path src-tauri/Cargo.toml --bin devdeck` passed (existing unused agent_md and imap-proto future compatibility warnings). The rebuilt app is running as PID 30376, version 0.4.0-beta.5, from the integration source at 9bc355e.

Native verification passed:

- Spaces tree refresh returns seven nodes; the actual Spaces explorer shows the existing project tree, with no loading error.
- The new chat_settings command returns effective provider/model and supported context capabilities.
- Actual Chat navigation renders the shared composer, resolved next-message model control, file input and voice entry point, with no Vite overlay.
- A deliberately unsupported image request is rejected by chat_send_input before runtime; conversation messages are byte-for-byte unchanged.
- The original Stash page was restored through actual navigation and its visible sidebar confirmed. The app remains open.

An initial UI probe imported a separate development-store module instance and did not drive the real rendered navigation. That result was not accepted as UI evidence; subsequent checks clicked the actual native navigation controls and verified visible elements. No account settings, model selections, grants or records were changed; no message generation or voice capture was run. The previously reported restart blocker is resolved. No design-system changes, push, main merge or deployment occurred.

## Compact composer refinement

The composer now groups the effective model, draft, selected-context chips and labelled icon toolbar in one bordered panel. Link entry is a toggle and closes after adding a reference. Context/privacy guidance expands on demand. Send uses a labelled arrow control. Model settings keep the existing conversation-specific semantics. Context summary uses semantic accent color, and the local-storage location is available in a tooltip rather than a permanent filesystem-path paragraph. No backend, permissions, credentials, history or design-system architecture changed.

Verification: TypeScript and Vite build pass. Scoped oxlint exits zero with one existing Chat effect dependency warning. Seven unified-chat fixture groups pass. Four additional combinations cover dark/light at 1200/390px, repeated link/model/help toggles, keyboard cancellation/focus, draft retention, no send and no page overflow. The existing narrow conversation list/details overlays were closed through their normal controls before testing the composer. Screenshots were visually inspected, including narrow dark/light and expanded model settings. React review checked labelled icon actions, focus targets, disabled states, effect cleanup and existing store subscriptions. Rust was not rerun for this frontend-only pass.

Native: the real app received the frontend update without a restart. The shared composer rendered and was captured without sending a message or changing model preferences. The original route at capture time was Chat and was restored. Native screenshot saved to Library as libfile_c7b713a698f88191b4feec362eaf1595, version 0. Fixture captures remain under .artifacts/chat-composer-design. No live inference or account action occurred.

Reference limitation: the supplied Library image libfile_4f87d3dd3d948191bc05194430984e73 resolved, but supported local materialization could not run because the executor has no working Python runtime for the required Library transfer helper. Its pixels were not viewed. Refinement was based on independently viewed actual rendered Chat and native composer pixels. The screenshot upload itself succeeded; applying local Library extended-attribute metadata was also blocked by the unavailable Python helper, so local xattr persistence is not claimed. No transfer workaround, dependency installation, push or deployment was used.

## Slim footer and provider/model popout follow-up

The bottom helper row has shorter shortcut text, 2px top spacing and a labelled Privacy disclosure. Its 24px target remains keyboard-accessible. Disclosures open above the footer without increasing its height and close with Escape, returning focus. Limits, permission boundaries and memory-only context notices remain available. Tests assert the collapsed footer is at most 26px high and the existing composer body remains 165px high.

The conversation model popout now opens above the input with a title, existing provider identification marks, a Current configuration row and a This chat/Inherited badge. Labelled provider/model fields, catalogue warnings and failed-save errors remain explicit. Conversation Apply/Cancel actions are separated from agent-default reset/edit actions. Escape and outside pointer dismissal preserve drafts. Keying the reused ModelPicker by provider isolates late catalogue responses during rapid switches. ModelPicker gained an optional accessible field label; existing callers are otherwise unchanged. No backend or account logic changed.

Verification: TypeScript and production frontend build pass; scoped lint passes. Five new mocked popout test groups cover light/dark at 1200px/390px, keyboard focus/Escape/outside dismissal, unchanged composer geometry/drafts/agent defaults, delayed catalogue races, model loading/error states, bounds and failed-save retention. Four footer/design groups and seven unified-chat regression groups pass. Native popup and footer were visually inspected without applying a model selection or running inference. Original Chat route and popup open state were restored; no restart was required. Existing probe buttons were not invoked. No Rust tests were rerun for these frontend-only changes.

Native screenshot: libfile_32da833911dc8191a805ddd23fc79332, version 0. It shows the actual running app's theme, provider popout and slim footer. The latest supplied reference libfile_20c92a7838d08191bfb27ff82643980b still could not be materialized through the supported route because no working Python transfer runtime is available; its pixels were not viewed. Library screenshot creation succeeded, while local metadata-helper application remains unavailable. No download workaround or dependency installation was used.

Scoped lint's sole warning is the existing ModelPicker priceOf export / Fast Refresh warning. It was not suppressed. The final build also retains existing bundle-size warnings.

## Single helper-line cleanup

Removed the visible Stored locally / outside your repositories notice and its row. Its presentation-only personalRoot lookup is no longer needed; storage APIs and data are unchanged. The chat dock now has zero bottom padding, and the single helper row is 24px high with no wrapping or gap above it. Existing warnings and expandable privacy disclosures remain available. The accepted popout, input and toolbar geometry are unchanged.

Typecheck, production build and scoped lint pass, with the existing Chat effect warning. Four light/dark desktop/narrow groups verify exactly one 24px footer, no storage notice, no reserved bottom padding/row, unchanged 165px composer body, keyboard privacy disclosure, viewport bounds and no overflow. Seven unified-chat regression groups pass. Actual native bottom-area pixels were inspected; the app and original Chat selection remain available without restart, inference or settings changes.

Updated native screenshot: libfile_493ec13413ac8191bb9bb06d81a94770, version 0. The new reference libfile_73f015e5aea481918bdb75b5c2be203b was not viewed: the known unavailable transfer-helper route was not retried. Screenshot upload succeeded. Returned identity was retained in an artifact manifest; local xattrs are not claimed applied because the unavailable helper was not retried. No push or backend changes.
