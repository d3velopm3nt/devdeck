# CLI installation and subscription sign-in

In Core setup or Settings → Providers, the Subscriptions section offers Claude Code and Codex CLI setup.

1. Select **Install Claude Code** or **Install Codex CLI**. DevDeck opens its terminal and sends the provider's official Windows installer command.
2. Follow the installer output. DevDeck checks the executable's version before showing installation as verified.
3. Select **Sign in with Claude** or **Sign in with ChatGPT**. Complete the official CLI/browser account flow yourself.
4. DevDeck checks the CLI's active authentication mode. Subscription access, API billing, signed-out state and unrecognized responses are displayed separately.

Use **View setup terminal** to inspect output and **Check status** to retry detection. **Stop monitoring** only stops DevDeck's automatic checks; it does not cancel the installer or sign-in. Use Ctrl+C in the setup terminal to interrupt the active command. Automatic checks stop after ten minutes without confirmation.

After subscription sign-in, select **Claude subscription** or **ChatGPT subscription** in Default assistant provider, choose a model, then **Verify & use as default**. Verification makes a small real CLI request and consumes plan usage. The main assistant and agents using the default inherit it; explicit agent overrides are preserved. Subscription providers are available on agent cards too. Claude offers CLI aliases; ChatGPT starts with the CLI default and accepts an account-supported model ID through the picker.

Subscription turns receive conversation history, scoped context, allowed tool schemas and previous tool results. The CLI returns structured proposals; DevDeck executes them through its existing permission and approval handling. Native CLI tools and customizations are disabled for these inference calls. Each call runs in a temporary directory, with bounded output and a two-minute deadline. Claude Code's separate coding-worker runtime remains available. Codex tasks use the DevDeck agent runtime; a separate native Codex coding-worker engine is not included.

The official CLI keeps its account credentials. DevDeck returns only version, installation status and a normalized authentication mode to the setup card. It does not display the raw account response. The subscription login subprocess removes environment API credentials only for that subprocess; it does not change system environment variables. Existing API credentials or CLI configuration can still select API billing in other processes; inspect the reported mode before running work.

## Sources

- Claude installation: https://code.claude.com/docs/en/setup
- Claude authentication commands: https://code.claude.com/docs/en/cli-reference
- Codex standalone Windows installer: https://learn.chatgpt.com/docs/config-file/environment-variables
- Codex authentication: https://learn.chatgpt.com/docs/auth
- Codex inference/structured output: https://learn.chatgpt.com/docs/cli/reference

## Verification

- Production React components with mocked native IPC: missing CLI, verified install and sign-in, API billing distinction, failed setup retry, stopped monitoring and unsupported OS.
- Fresh Core setup and Settings: connect a provider, refresh default choices without restarting, no horizontal overflow at 540, 900 and 1280 pixels.
- Rust production parsing tests: unknown tool/action rejection, PowerShell literal quoting, successful subscription/API mode parsing and failed/unrecognized responses.
- Subscription protocol and real subprocess fixtures: both output formats carry scoped context/history and a tool result across turns; invalid calls, incomplete/error output, process failure, timeouts and cancellation are checked. Desktop/native boundaries and vendor accounts are stubbed.
- 2026-10-10 sandbox verification: 34 Rust tests passed; TypeScript, frontend production build, lint and browser setup/selector checks passed. An intermediate browser rerun timed out waiting for the ChatGPT sign-in message; the isolated flow and complete rerun passed, and the timeout was not reproduced. Native sign-in timing still needs Windows acceptance.
- Full desktop Rust check is blocked by missing Linux GTK/WebKit/pkg-config dependencies in the sandbox; Windows CI must pass before release.
- Real Windows installation, browser authorization and subsequent worker execution must be tested separately. Browser fixtures do not execute the vendor installers or authenticate an account.

## Windows acceptance

1. Install/sign in from DevDeck, confirm **Subscription signed in**.
2. Verify each subscription as default, send a normal assistant message.
3. Ask it to read a project file, then perform an action that requires approval; verify the tool result returns to the assistant and permission is enforced.
4. Run a manager using the default; confirm an explicitly overridden agent keeps its provider.
5. Check a signed-out/API-mode account is refused rather than silently using API billing.

Real account inference cannot be tested in a sandbox without those CLI accounts. The installer and browser authorization still require Windows acceptance before a release.
