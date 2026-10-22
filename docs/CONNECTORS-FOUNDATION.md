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
There is no scope inheritance or default grant. The `feeds_read` agent tool
reads cached titles through the existing ToolService permission and approval
gate. It then checks the current saved agent or project binding under the DB
mutex. Revoke, pause and disconnect affect the next read immediately. A tool
grant alone does not grant a connection, and a connection binding alone does
not grant the tool. No existing agent receives the new tool automatically.

The runtime supplies the executing agent identifier and the ToolService's
registered project identifier. Tool arguments accept only `connection_id`.
Forged identities in arguments or EventScope cannot select another binding.
Space bindings remain stored but inactive because this runtime path does not
provide a trusted space identity. They do not grant access by matching project
identifiers. The consumer returns cached state and last-check time, performs
no network requests and cannot add feeds, mutate bindings or delete data.
Tool activity records the connection identifier and a fixed success message,
without feed titles. A human refreshes titles using **Test / read feed**.

To use it, add and manually test a public feed, then save an exact agent or
project binding in Connectors. Separately grant that agent **Feed cache** read
permission, or approval permission, in the existing tool-permission screen.
The agent can call `feeds_read` with `{"connection_id":1}`, using the saved
feed identifier shown by the connection record. It receives JSON containing
the connection name, state, last-check time and cached text titles. Neither
setup step supplies or changes credentials.

## Code and migration boundary

- `src/lib/connectors/index.ts` separates service definitions, connection
  observations, capabilities and the narrow feed reader interface.
- `src/components/connectors/ConnectorsCatalogue.tsx` owns the card catalogue.
  `ConnectorDetails.tsx` retains administration controls in a native modal drawer.
- `src-tauri/src/connector_model.rs` owns additive persistence, feed state,
  policy and parsing. The only new table is `connector_feeds`, created
  idempotently. No existing table is modified.
- `src-tauri/src/feed_reader.rs` owns public feed transport without Tauri or credentials.
- `src-tauri/src/connectors.rs` orchestrates desktop administration commands.
  Network I/O runs outside the database mutex. A result arriving after pause
  or disconnect is discarded.
- `src-tauri/src/aiw/tools.rs` registers the read-only `feeds_read` operation.
  `aiw/state.rs` preserves its injected consumer when rebuilding project tool
  services; app setup supplies access to the current connector store.

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
- Seven Rust core tests passed with `cargo test --manifest-path harness/connector-core/Cargo.toml --offline`.
  They cover additive migration, saved records, grants, lifecycle/cache isolation,
  RSS/Atom text parsing, URL restrictions and public-address filtering.
- Two native ToolService tests passed with
  `cargo test --manifest-path src-tauri/Cargo.toml --lib connector_feed --offline`.
  Production ToolService and the production cache policy read a fixture parsed
  into in-memory SQLite. Checks cover both gates, successful title consumption,
  revocation, pause/disconnect, identity spoofing, approval denial, unsupported
  writes, unchanged default grants and redacted activity. The other 799 native
  tests were filtered out, not run.
- Desktop `cargo check --manifest-path src-tauri/Cargo.toml --offline` passed
  after running the existing ask-sidecar and mobile-voice staging scripts.
  An existing unused personal-store method and imap-proto future compatibility
  warning remain.
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

## Functional scope versus remaining work

| Requirement | Current implementation |
| --- | --- |
| Catalogue, search, categories, existing accounts first | Functional |
| Service/account/capability separation and credential references | Functional catalogue and feed model; legacy stores remain authoritative |
| Feed add, test, pause, reconnect, disconnect, separate cache deletion | Functional native commands; regression checks use fixtures, not live HTTP |
| Agent feed consumption | Functional cached-title operation through tool permission/approval plus a current agent/project binding |
| Space access | Saved binding only; no effective consumer access yet |
| Legacy provider agent/space/project connector ACLs | Not added; original tool/provider permissions remain authoritative |
| Legacy used-by | Inventory projection only: AI agent provider IDs, MCP reported reach, database project IDs, Mail space hint; GitHub points to project repository configuration |
| Complete dependency enforcement | Deferred; used-by rows do not block legacy disconnect or resolve every transitive consumer |
| Legacy test/reconnect/pause/disconnect | Existing owner screens; no common central lifecycle enforcement yet |
| State honesty | Observed configuration, Mail historical sync and errors, reported MCP blockers, feed check results; no fabricated authentication |
| Redacted activity | Feed lifecycle actions and agent feed tool events; no new consolidated legacy activity stream |
| Custom MCP | Link to existing Community configuration workflow; no new custom-server editor or arbitrary executor |
| Subscription adapters | Existing Settings workflow; no new inventory of live CLI sessions |

The agent consumer proves a narrow cached-read path. It does not establish
live HTTP intake or every legacy provider as an end-to-end connector flow.

## Visual correction, 22 October 2026

The content layout follows the inspected reference image
`libfile_a761324142d88191950f26d72f44d762`. It has a full-width search field,
All integrations/Connected/Explore views, category chips, three-column branded
cards, saved accounts followed by the proposed catalogue, and a custom-MCP
footer. Detailed capability, state, credential-reference and lifecycle controls
remain available in a keyboard-accessible modal drawer. Narrow screens use one
column and a full-width drawer. Existing DevDeck shell and theme tokens remain
in place. No backend or policy file changed in this visual pass.

The reference contains example Connected states. The implementation displays
observed configuration and check states instead. Gmail identifies IMAP/SMTP
mail only, not Google Calendar or Drive. Planned entries show preview details
without connection or execution controls. The footer uses the existing MCP
workflow rather than advertising an unimplemented arbitrary API connector.
The catalogue has additional real database, MCP and feed entries, so the number
of rows follows saved configuration. Local geometric brand marks approximate
the reference; existing GitHub, Google and OpenAI artwork is reused.

Verification uses the actual React components with fixture IPC and synthetic
accounts, not live integrations or credentials. `node harness/check-connectors.mjs`
now runs the visual/lifecycle suite in `check-connectors-visual.mjs`.
All 13 checks passed, including grid layout, filters, truthful states, planned
previews, keyboard tabs, existing management controls, cache/grant lifecycle,
persisted feed configuration, inventory failure, narrow layout and browser
errors. TypeScript, scoped oxlint and the frontend Vite build passed.

Captures in `.artifacts/connectors-visual/` include the 1338 px desktop content
area, 390 px narrow layout, viewport-sized management drawers and light theme.
`capture-connectors-comparison.mjs` creates a side-by-side reference/content/
narrow comparison from the downloaded reference PNG. The reference's left shell
is cropped only in that comparison; DevDeck's actual shell is unchanged.
The screenshots were inspected after correcting font/mark proportions, card
ordering and a narrow-footer wrap. Modal screenshots use viewport capture so
the fixed drawer is not misrepresented in a full-page image.

Broader legacy-adapter consolidation remains pending. The uncertain offline
`connector_policy.rs` creation was checked and the file was absent; it was not
replayed as part of this visual task.
