# Linux subscription testing

This branch adds Linux CLI setup and a headless test entry point. It does not port the full Windows desktop app.

Requires Rust, a C linker, curl, and network access. From the repository root:

```sh
cargo test --manifest-path harness/rust-core/Cargo.toml --locked
cargo run --manifest-path harness/rust-core/Cargo.toml --locked --example linux_subscription -- install
cargo run --manifest-path harness/rust-core/Cargo.toml --locked --example linux_subscription -- login
cargo run --manifest-path harness/rust-core/Cargo.toml --locked --example linux_subscription -- status
cargo run --manifest-path harness/rust-core/Cargo.toml --locked --example linux_subscription -- smoke
```

Login uses Codex device authentication. Complete the official browser flow on your own device; enable device-code login in your ChatGPT security settings if required. Credentials remain with Codex. `DEVDECK_CODEX_BIN` can select an existing executable. The smoke test makes one real subscription request, subject to account access and plan limits, using the production argument builder, process handling, event parser, and structured-response validation. It does not start a desktop session or populate the activity board.

The Linux install action downloads the official installer to a temporary file and stops on download failure. Sign-in removes API credentials from the child environment. This does not change the parent shell or stored API credentials.

## Activity board verification

```sh
npm ci
npx tsc -b
npx vite --config vite.harness.config.ts
# In another terminal with Playwright and Chromium available:
node harness/check-visibility.mjs
node harness/check-cli-setup.mjs
```

The browser harness renders production components with simulated Tauri events. It verifies working, failed/blocked, and completed session updates, filters, checkpoints, stale sessions, and preserved data on GitHub failure. It is not proof of an authenticated CLI session reaching the live desktop board. That final integration requires the desktop runtime and a signed-in account.
