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
