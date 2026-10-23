# Settings consistency pass

Local changes on top of the integrated desktop/Connectors baseline c41a1d5.

## Implemented

- Provider tiles use panel and border tokens in every theme. Selection retains the provider tint, composited over the panel; provider artwork and configuration logic are unchanged. Selection now exposes aria-pressed.
- Mail attachment folder preferences appear only in General. Existing values and callbacks are preserved; no settings storage or account behavior changes.
- Muted text tokens are strengthened for page, panel and raised surfaces in all six existing palettes. Claude keeps a clay accent with sufficient contrast for small accent text and primary-button text. Its Settings swatch uses the same accent.

## Validation

The fixture suite harness/check-settings-consistency.mjs checks attachment section ownership across all 11 Settings sections, every provider selection in all six themes, title/helper text contrast, muted text on page/panel/raised surfaces, primary-button contrast and accent text. It requires at least 4.5:1 for these specific pairs. This is not a full accessibility certification of every surface, hover state or disabled control.

The recovered chat-tab regression, existing shared design-system suite, TypeScript and frontend production build are also checked. Tests use mock IPC, with no account connections, credential edits or paid probes. Existing repository-wide selector and synchronous-command ratchets remain failing; their baselines are not changed. Rust code is unchanged by this pass.

## Proposed shared primitives: not implemented

Extend the existing components/ui/DesignSystem.tsx and design-system.css rather than introducing another UI family:

1. PageHeader with explicit page/panel density, a title, optional description/scope and an actions slot. Pilot in General and GitHub Settings before migrating other surfaces. Agree the catalogue title variant before changing the accepted Connectors layout.
2. Reuse btn-primary/btn-ghost and add consistent small/default size roles, with shared focus, disabled and loading treatment. Pilot the affected Settings forms; preserve domain behavior.
3. Reuse TabStrip for mutually exclusive content views and FilterTabs for filters. Pilot AI Providers/Agents/Tools; preserve saved selected views and keyboard navigation.
4. Centralize a small type and spacing scale (4/8/12/16/24/32), with separate page and panel padding. Migrate one representative page and inspect all themes before broad replacement.

## Proposed navigation ownership: awaiting agreement

| Destination | Owns | Scope |
| --- | --- | --- |
| Today | Attention summary and next actions, linking to owners | Selected space or explicit all spaces |
| Inbox | Human decisions, approvals and requests | Explicit request/space scope |
| Spaces | Durable folders, projects, repositories and project design assignment | Space > project > folder |
| Work | Goals, work items, workflow progress and review evidence | Explicit space/project/team filters |
| Chat | Conversations and optional context/run/review inspector | Conversation project shown explicitly; no inferred grant |
| Library | Reusable agents, skills, teams and project design references | Shared definitions with explicit assignments |
| Connectors | Account lifecycle, capabilities and bindings | Account plus explicit resource bindings |
| GitHub / Mail / Calendar | Domain work, rather than duplicate account forms | Their explicit repository/account/calendar context |
| Tools | Activity, sessions, SQL connections, machine and diagnostics | Operational scope shown in each view |
| Settings | Appearance, vault, notifications and app preferences | User/app preferences |

Team shortcuts should open scoped Work or the canonical Library team page. Setup should link to existing owners instead of presenting another independent configuration journey. Existing deep links and saved selections need migration tests before navigation changes. SQL Connections should be named distinctly from Connectors.

Project Library designs remain separate from shell themes. No design import, theme adapter, account/grant migration or major navigation change is included in this pass. Main publication, release, deployment and artifact export require separate approval.
