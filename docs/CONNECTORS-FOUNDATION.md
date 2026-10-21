# Connectors foundation

This first slice adds a shared Connectors catalogue and a public RSS/Atom adapter.
Open **Connectors** from the shared navigation. Existing connections appear first;
search and categories filter the catalogue.

## Existing connections

The catalogue reads existing stores and links to their existing controls. It does
not migrate, duplicate, delete or rewrite their credentials, account identifiers,
project mappings or permissions.

| Service | Evidence shown | Configuration owner |
| --- | --- | --- |
| GitHub | App credential presence, not authentication | GitHub |
| AI | Saved provider configurations and matching agent dependencies | Settings |
| Mail | Account configuration, last sync and error presence | Mail |
| Databases | Saved connections and project identifiers | SQL Connections |
| MCP | Installed MCP entries, reported blockers and agent reach | Community |

Credential references identify the existing owner. Secret values and provider
headers are never copied into connector records. Inventory failures remain
visible and do not become an empty or connected account list. Merely opening
Connectors does not authenticate with external services or start MCP servers.

The GitHub app credential is still global. `gh` and `git` readiness are separate.
Projects keep repository selection; agents keep model selection. Subscription
CLI setup and health remain in the existing Settings workflow. This slice does
not enumerate subscription CLI sessions or replace provider-specific controls.

Google OAuth here is for IMAP/SMTP Mail. Sending reaches external recipients;
read/archive/delete flags remain local. Calendar retains local schedules and
deadlines. Mail folder destinations do not authenticate Drive, Dropbox or
OneDrive. There are no new Google API, social or marketplace adapters.

## Managed public feeds

Adding a feed saves an explicit URL without fetching it. **Test / read feed**
performs the first network request. Supported input is UTF-8 RSS or Atom at a
public HTTPS URL on port 443, without credentials, query strings or fragments.
Redirects require adding the final URL explicitly. The transport rejects
nonpublic resolved addresses, pins the vetted addresses, disables proxies and
redirects, and uses a 15-second request timeout and a 1 MiB response limit.

The parser retains at most 100 titles of 500 characters each. React renders them
as text. The adapter does not follow links, load images, render HTML, download
enclosures or execute content. No background polling is introduced.

| Operation | Effect |
| --- | --- |
| Add | Save `configured`, no grants, no network |
| Test | Read feed; save `verified` or `degraded` and last-check time |
| Pause | Block further reads and retain bindings/cache |
| Reconnect | Return to `configured`; do not authenticate or restore revoked grants |
| Disconnect | Block reads, revoke feed bindings, retain cached titles |
| Delete cached titles | Clear titles separately from connection state |

Bindings name an exact agent, space or project identifier and `feed.read`.
There is no scope inheritance or default grant. They are stored for future
consumers; this slice deliberately registers no agent feed tool. The policy
helper fails closed for unknown states, wrong scopes and absent grants. A future
runtime bridge must derive the caller identity from the trusted runtime, enforce
this policy, and preserve the existing tool approval gate. It must not accept a
caller-supplied agent identity as authorization.

## Code and migration boundary

- `src/lib/connectors/index.ts` separates service definitions, connection
  observations, capabilities and the narrow feed reader interface.
- `src/components/connectors/ConnectorsPage.tsx` owns catalogue and administration UI.
- `src-tauri/src/connector_model.rs` owns additive persistence, feed state,
  policy and parsing. The only new table is `connector_feeds`, created
  idempotently. No existing table is modified.
- `src-tauri/src/feed_reader.rs` owns public feed transport without Tauri or credentials.
- `src-tauri/src/connectors.rs` orchestrates desktop administration commands.
  Network I/O runs outside the database mutex. A result arriving after pause
  or disconnect is discarded.

Further adapters should define narrow operations such as repository reads or
mail sending with their own result and permission types. Do not add a generic
`execute` method that makes all services interchangeable. Legacy lifecycle
controls stay in their original owners until each backend can enforce them.

## Verification on JayJay-Laptop, 21 October 2026

Branch `codex/connectors-foundation-1021` starts at local merge `96d8d3b`.
A fresh fetch and `ls-remote` confirmed desktop `9fb0f80`, work-completion
`13b795b` and main `c679dc7`. Both reviewed remote tips are ancestors of the
chosen baseline. The original checkout's uncommitted chat work was preserved.

- TypeScript build check passed with `node node_modules/typescript/bin/tsc -b --pretty false`.
- Six Rust core tests passed with `cargo test --manifest-path harness/connector-core/Cargo.toml --offline`.
  They cover additive migration, saved records, grants, lifecycle/cache isolation,
  RSS/Atom text parsing, URL restrictions and public-address filtering.
- Desktop `cargo check --manifest-path src-tauri/Cargo.toml --offline` passed
  after running the existing ask-sidecar and mobile-voice staging scripts.
  Warnings include the future-consumer policy helper being unused, an existing
  unused personal-store method, and imap-proto future compatibility.
- The fixture browser suite `harness/check-connectors.mjs` passed 11 checks.
  It covers catalogue filters, truthful configuration state, inert titles,
  lifecycle controls, persistence, cache deletion, degraded checks, GitHub
  readiness wording, failed inventory, narrow layout and browser errors.
- Local frontend bundling passed with `node node_modules/vite/bin/vite.js build`. Existing large-chunk and build-plugin timing warnings remain.
- Repository lint remains blocked by existing policy baselines. A clean archive
  of `96d8d3b` reproduces both failures: 24 whole-store subscriptions versus 25,
  and 75 synchronous commands versus 68. The baselines were not changed.

Browser IPC, accounts and feed responses are mocked. Rust tests use an in-memory
SQLite database, one temporary file-backed reopen test, and local XML inputs. Native commands compile, but the desktop
app was not launched against a personal database, and no live account or public
feed was contacted in tests. No release, deployment, account linking, push or
merge occurred.

Screenshots and machine-readable results are in `.artifacts/connectors/` in this
worktree. They are intentionally ignored by Git. The repeatable UI fixture is
`harness/connectors.html`; serve it with `vite.harness.config.ts` on port 5217.
