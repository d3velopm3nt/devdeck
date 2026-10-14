# CLI installation and subscription sign-in

This guide describes the current preview source, including unmerged [PR #25](https://github.com/d3velopm3nt/devdeck/pull/25) on `feature/folder-workflow-routing`. Use that branch when testing these changes; an installed release may differ. Account sign-in and actual Windows worker execution still require acceptance testing.

In Core setup or Settings → Providers, the Subscriptions section offers Claude Code and Codex CLI setup.

1. Select **Install Claude Code** or **Install Codex CLI**. DevDeck opens its terminal and sends the provider's official Windows installer command.
2. Follow the installer output. DevDeck checks the executable's version before showing installation as verified.
3. Select **Sign in with Claude** or **Sign in with ChatGPT**. Complete the official CLI/browser account flow yourself.
4. DevDeck checks the CLI's active authentication mode. Subscription access, API billing, signed-out state and unrecognized responses are displayed separately.

Use **View setup terminal** to inspect output and **Check status** to retry detection. **Stop monitoring** only stops DevDeck's automatic checks; it does not cancel the installer or sign-in. Use Ctrl+C in the setup terminal to interrupt the active command. Automatic checks stop after ten minutes without confirmation.

After subscription sign-in, select **Claude subscription** or **ChatGPT subscription** in Default assistant provider, choose a model, then **Verify & use as default**. Verification makes a small real CLI request and consumes plan usage. The main assistant and agents using the default inherit it; explicit agent overrides are preserved. Subscription providers are available on agent cards too. Claude offers CLI aliases; ChatGPT starts with the CLI default and accepts an account-supported model ID through the picker.

Subscription turns receive conversation history, scoped context, allowed tool schemas and previous tool results. The CLI returns structured proposals; DevDeck executes them through its existing permission and approval handling. Native CLI tools and inherited customizations are disabled or constrained by the inference adapter; DevDeck rejects detected native-tool output instead of executing proposed DevDeck actions from it. Each call runs in a temporary directory, with bounded output and a two-minute deadline. These are fresh inference calls, not resumable dedicated lead sessions. Dev coordinates workers directly; independent tasks may run concurrently, while workflow dependencies and review gates still apply. Claude Code's separate coding-worker runtime remains available. Codex tasks use the DevDeck agent runtime; a separate native Codex coding-worker engine is not included.

The official CLI keeps its account credentials. DevDeck returns only version, installation status and a normalized authentication mode to the setup card. It does not display the raw account response. The subscription login subprocess removes environment API credentials only for that subprocess; it does not change system environment variables. Existing API credentials or CLI configuration can still select API billing in other processes; inspect the reported mode before running work.

## Source of setup behavior

The setup commands are defined in [`cli_setup_model.rs`](../src-tauri/src/cli_setup_model.rs), and the setup flow in [`CliConnections.tsx`](../src/components/aiw/CliConnections.tsx). The configured Windows installer endpoints are `https://claude.ai/install.ps1` and `https://chatgpt.com/codex/install.ps1`; authentication uses `claude auth login` or `codex login`. These are the commands this source invokes, not a claim that vendor installation behavior was tested here.

[`subscription_model.rs`](../src-tauri/src/subscription_model.rs) defines the inference command restrictions and response validation. [`subscription.rs`](../src-tauri/src/aiw/subscription.rs) supplies scoped conversation context and the request deadline. Consult the installed CLI's help and vendor documentation if account or installation behavior differs.

## Verification

- Production React components with mocked native IPC: missing CLI, verified install and sign-in, API billing distinction, failed setup retry, stopped monitoring and unsupported OS.
- Fresh Core setup and Settings: connect a provider, refresh default choices without restarting, no horizontal overflow at 540, 900 and 1280 pixels.
- Rust production parsing tests: unknown tool/action rejection, PowerShell literal quoting, successful subscription/API mode parsing and failed/unrecognized responses.
- Subscription protocol and real subprocess fixtures: both output formats carry scoped context/history and a tool result across turns; invalid calls, incomplete/error output, process failure, timeouts and cancellation are checked. Desktop/native boundaries and vendor accounts are stubbed.
- Run `cargo test --manifest-path harness/rust-core/Cargo.toml --locked` for current protocol fixtures. Run `node harness/check-cli-setup.mjs` with the Vite harness server and Playwright installed; `.github/workflows/ci.yml` records the complete setup. Historical test counts are not a release guarantee.
- Full desktop Rust check is blocked by missing Linux GTK/WebKit/pkg-config dependencies in the sandbox; Windows CI186 passed for `f016757`; that does not verify real vendor sign-in.
- Real Windows installation, browser authorization and subsequent worker execution must be tested separately. Browser fixtures do not execute the vendor installers or authenticate an account.

## Windows acceptance

1. Install/sign in from DevDeck, confirm **Subscription signed in**.
2. Verify each subscription as default, send a normal assistant message.
3. Ask it to read a project file, then perform an action that requires approval. Review the proposed action on the desktop, test both deny and allow, and verify the actual tool result returns to the assistant. Signing in does not grant tool permissions; phone message acceptance does not approve execution.
4. Run a manager using the default; confirm an explicitly overridden agent keeps its provider.
5. Check a signed-out/API-mode account is refused rather than silently using API billing.

Real account inference cannot be tested in a sandbox without those CLI accounts. The installer and browser authorization still require Windows acceptance before a release.

PR #25 adds the separate shared Library conversation tool: `library.create` saves an inactive worker skill or agent template only after interactive review, including when its permission is Full. Unattended creation is refused. It does not activate an agent, attach a skill, or grant tools. The existing `skill.save` tool is for AI Workspace persona skills, not that shared worker library. Configure saved templates in the agent editor before assigning them to a team or workflow.
