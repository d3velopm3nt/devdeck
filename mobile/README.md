# Mobile companion: trusted-LAN first cut

This branch adds an opt-in bridge to the running Windows desktop app. It is not a cloud-hosted mobile app or a finished WhatsApp-style sync service.

## Try it

1. Build/run `feature/mobile-companion` on Windows with the normal DevDeck prerequisites.
2. Open **Settings → Deck settings → Mobile companion**. Enter the PC's private IPv4 address from `ipconfig`. Use `127.0.0.1` for a same-PC browser test.
3. Press **Start companion** and scan the QR code within two minutes. Keep both devices on the same trusted private Wi-Fi. Windows may require allowing the app on private networks.
4. Recent conversations and spaces load first. Choose an existing chat or open a space/folder to enter its desktop thread. Older messages load on demand. Text messages use the existing assistant/persona and permissions; approve actions on the desktop.
5. **Stop & revoke all devices** ends access. A normal restart requires pairing again. The PC must stay running; full exit stops this bridge.

## Implemented

- Single-use, cryptographically random pairing codes, two-minute expiry, attempt limit, 12-hour in-memory sessions, and revocation.
- Same-origin session cookie (HttpOnly/SameSite), exact Host/Origin validation, bounded requests and connections; no generic remote tool RPC.
- Recent transcript snapshot, paginated older history, live chat events with bounded cursor history, persisted request IDs during the running bridge session, and retry receipts.
- Chat-first mobile interface with an animated orb, spaces/folders, conversations, recorded activity and optional local Kokoro read-aloud.
- Approved-design alignment: a cyan/purple canvas particle orb, Dev above it, compact transcript and icon controls; five bottom entries place Dev in the centre of Spaces, Folders, Team and Activity. The header chat button opens older conversations. Team displays configured profiles rather than inventing live activity.
- Local browser cache and explicit retry for offline drafts. Pairing codes are removed from the URL. Unpair clears the cache.

## Boundaries

The preview uses HTTP on a selected loopback/private IPv4 address. Use only a trusted LAN: the traffic is not encrypted and this is **not** WhatsApp's end-to-end security. Do not expose this port publicly. Sessions and deduplication are in memory, so a desktop restart is a new pairing/session boundary. Review any unconfirmed request before retrying across that boundary.

Voice input, installable PWA/offline shell, encrypted remote relay, durable offline command queue, device roster, full background state mirroring and native Android packaging remain follow-up work. Cached data may be read offline while the page remains open; a cold offline load of the page is not supported yet. Dev's orb is an original canvas implementation inspired by the approved concept. Idle, thinking and browser read-aloud states use actual UI/runtime signals; listening is not claimed until voice input is connected. Reduced-motion preferences are respected.

## Verification

- `npx tsc -b` and `npm run lint`.
- `cargo test --manifest-path harness/rust-core/Cargo.toml --locked` includes production pairing/replay tests.
- `node harness/check-mobile.mjs` uses Playwright and deterministic API fixtures against the real mobile HTML. Fixtures test client behavior, not native Windows integration.
- Windows CI checks the complete native adapter and produces an installer artifact. A physical Android + Windows end-to-end check remains required.

## Offline voice preview

Builds now stage the Kokoro browser runtime with `npm run mobile:voice` (also included in `npm run dev` and `npm run build`). Run it before direct Cargo checks, as the native bridge embeds its generated worker and ONNX runtime assets.

On the phone, press **Download voice**. This downloads the q8 Kokoro model and Heart voice from Hugging Face and saves them in IndexedDB; reply text stays on the phone. The button reports per-file download progress and only says ready after synthesising a test phrase. Then press the read button for the latest reply; Stop silences playback. Speech runs in a worker using single-threaded WebAssembly, including on the current LAN HTTP origin. No microphone feature is added.

The model download needs internet and storage initially. Generation can run without internet after a successful download. This does not make the AI itself offline or provide a cold offline page launch. Files belong to the PC URL's browser origin: changing IP/port, clearing site data, private browsing or browser eviction may require downloading again. A reload currently requires pressing Download voice to load the saved model; cached files are reused. Device latency, naturalness and memory use still need physical-phone validation.

Verification for this change: the normal mobile harness checks download/read/stop UI transitions with a deterministic voice worker. `VOICE_MODEL_DIR=<model-fixture-directory> node harness/check-mobile-voice.mjs` tests actual Kokoro WASM synthesis with upstream model files, then recreates the worker and blocks external downloads to verify IndexedDB reuse and complete multi-sentence output. Neither check measures physical Android performance.
