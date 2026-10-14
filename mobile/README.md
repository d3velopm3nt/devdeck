# Mobile companion · operations home and Dev

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
- Home-first mobile interface with an animated orb, spaces/folders, conversations, recorded activity and optional local Kokoro read-aloud.
- Approved-design alignment: a flowing cyan/violet light-ribbon orb, Dev above it, compact transcript and icon controls; five bottom entries place Dev in the centre of Home, Folders, Teams and Activity. Home links to Spaces. The header chat button opens older conversations. Teams displays configured profiles with recorded session/checkpoint and approval states. Activity supports project/status filters, real session details, claims, files and recent checkpoints.
- Persisted phone outbox and a bounded desktop FIFO. Several messages can be accepted while Dev delegates work to background agents. Saved messages automatically send on reconnect to the same running bridge; a changed bridge ID requires review and explicit retry. Request IDs prevent duplicate execution within the bridge session. Pairing codes are removed from the URL. Unpair clears the cache.

## Boundaries

The preview uses HTTP on a selected loopback/private IPv4 address. Use only a trusted LAN: the traffic is not encrypted and this is **not** WhatsApp's end-to-end security. Do not expose this port publicly. Sessions and deduplication are in memory, so a desktop restart is a new pairing/session boundary. Review any unconfirmed request before retrying across that boundary.

Installable PWA/offline shell, encrypted remote relay, disk-persisted desktop commands, device roster, full background state mirroring and native Android packaging remain follow-up work. Browser voice input uses the browser speech service when SpeechRecognition is exposed. The client allows an attempt on LAN HTTP rather than assuming support from HTTPS alone. Actual browser microphone and speech-service permissions still apply; a denied attempt explains whether site permissions or a browser-trusted HTTPS connection is needed. Keyboard dictation remains an alternative. Cached data may be read offline while the page remains open; a cold offline load of the page is not supported yet. Dev's orb is an original canvas implementation inspired by the approved concept. Idle, thinking, preparing speech, listening and speaking states follow their actual runtime signals. Speaking starts on audio playback, with an audio-reactive orb. An acceptance chime sounds once per accepted message after audio is unlocked by a gesture; sound may be suppressed by phone/browser policy. Stop silences playback and clears its active state. Reduced-motion preferences are respected.

## Verification

- `npx tsc -b` and `npm run lint`.
- `cargo test --manifest-path harness/rust-core/Cargo.toml --locked` includes production pairing/replay tests.
- `node harness/check-mobile.mjs` uses Playwright and deterministic API fixtures against the real mobile HTML. Fixtures test client behavior, not native Windows integration.
- Windows CI checks the complete native adapter and produces an installer artifact. A physical Android + Windows end-to-end check remains required.

## Offline voice preview

Builds now stage the Kokoro browser runtime with `npm run mobile:voice` (also included in `npm run dev` and `npm run build`). Run it before direct Cargo checks, as the native bridge embeds its generated worker and ONNX runtime assets.

On the phone, press **Download voice**. This downloads the q8 Kokoro model and Heart voice from Hugging Face and saves them in IndexedDB; reply text stays on the phone. The button reports per-file download progress and only says ready after synthesising a test phrase. Then press the read button for the latest reply; Stop silences playback. Speech runs in a worker using single-threaded WebAssembly, including on the current LAN HTTP origin. Browser microphone input is separate from offline read-aloud and is capability-gated.

The model download needs internet and storage initially. Generation can run without internet after a successful download. This does not make the AI itself offline or provide a cold offline page launch. Files belong to the PC URL's browser origin: changing IP/port, clearing site data, private browsing or browser eviction may require downloading again. A reload currently requires pressing Download voice to load the saved model; cached files are reused. Device latency, naturalness and memory use still need physical-phone validation.

Verification for this change: the normal mobile harness checks download/read/stop UI transitions with a deterministic voice worker. `VOICE_MODEL_DIR=<model-fixture-directory> node harness/check-mobile-voice.mjs` tests actual Kokoro WASM synthesis with upstream model files, then recreates the worker and blocks external downloads to verify IndexedDB reuse and complete multi-sentence output. Neither check measures physical Android performance.

## Test this build

- Restart the rebuilt desktop companion and scan its new QR. Home should open first.
- Tap **Talk to Dev** or the middle **Dev** button. Back returns Home; the keyboard button toggles the conversation.
- Download voice, read a reply, and stop. Preparing, Speaking and Idle must be visibly distinct.
- Send a task, then another message while work runs. Check Teams and Activity; filter by project/status and open a session for its checkpoints and touched files. Approval decisions stay on the desktop.
- Disconnect Wi-Fi, write a message in an existing conversation, then reconnect to the same desktop bridge. It should send once. If the bridge restarts, review the conversation and explicitly retry.
- This remains the PC-served web companion, with the PC running and both devices on the trusted LAN. Physical Android latency and Windows integration need device testing.

## Voice regression correction

The orb and centre microphone now start/finish listening. Connecting, Listening, Thinking, Preparing voice and Speaking follow recognition, desktop work and playback events. Cancelling startup discards callbacks; errors reset the state and remain retryable. Unsupported recognition and a disconnected desktop disable input. Download voice enables read-aloud separately. The renderer uses continuous luminous ribbons, depth and a bounded playback envelope; listening animation indicates recognition state rather than measured microphone volume. Reduced motion freezes ambient motion.

The deterministic browser harness includes an insecure-origin recognition fixture, denied-permission recovery and startup cancellation. It does not prove speech recognition works on an actual HTTP Android browser.
