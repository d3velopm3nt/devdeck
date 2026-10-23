# Design consistency coverage

The rollout extends the existing DesignSystem.tsx primitives. It does not move features, change routes, migrate grants or turn Library design assets into shell themes.

| View or group | Status | Scope and limits |
| --- | --- | --- |
| Inbox, Work, Connectors | Migrated in c21a697 | Shared page headers and selected action controls; Connectors shared keyboard tabs; Work/connector card corner token. Domain content remains specialized. |
| Today | Header migrated | Shared 24px title and description. Briefing, attention groups, scope filters and dashboard actions retain their existing design. |
| Teams / Agent Library | Overview headings migrated | Shared page heading, section headings and create/import actions. Team editor, template picker and agent editors retain their layouts. |
| Activity / Sessions | Header and toolbar migrated | Shared title/description, refresh button and toolbar spacing. Existing filters, timeline, issue layouts and inspectors remain. |
| General, Vault, Development, Stash, Data Settings | Migrated in c21a697 | Shared 18px section headers; General setup action uses shared control style. Forms and storage behavior are unchanged. |
| Notifications, Deck, Routines, Setup, AI and GitHub Settings | Page headers migrated | Shared 24px headings; Notifications save uses the theme-aware primary control. Notification previews, schedules, AI providers/permissions and onboarding frames retain their domain layouts. Setup keeps smaller section density when embedded in onboarding. |
| Chat, workspace tabs, Dockview, run/team/workflow editors | Deliberately specialized | Dense conversation and editor layouts are preserved. No blanket CSS migration. |
| Library project design systems | Deliberately separate | Project assets and shell themes retain their existing boundaries. No import adapter. |
| GitHub main, Mail/Contacts, Calendar, Spaces, SQL Connections, Machine, Community/Discover | Covered in the final bounded pass | Shared header/title or compact toolbar adopted where appropriate. See final-page-consistency-1023.md for specialist exceptions and verification. |
| Legacy Home, standalone Stash, Analytics charts, onboarding/business wizards | Retained / not comprehensively reverified | Existing specialized components remain. No whole-app completion claim for these surfaces. |
| Floating Deck, terminal and Monaco palettes | Deferred / specialized | Independent window and editor requirements need separate visual checks. |

## Verification for this group

- check-page-rollout.mjs passes: Today, Teams, Library, Activity, Sessions and six remaining Settings views, each in all six themes; header bounds at a 1000px desktop viewport; Activity keyboard tabs; local light/dark captures.
- Existing Notifications regression passes: dismissal/history retention, mark-read, reload, disabled alerts retaining history and narrow layout.
- Existing design-system suite passes all five groups: six-theme state contrast/keyboard tabs, Inbox/schedules, Activity filters/layout, Today filters/Settings navigation, Mail/Contacts.
- Existing Settings suite passes all eleven sections and all seven provider selections across six themes. It uses mock IPC; no credentials or paid model probes.
- TypeScript, production build, diff check and scoped lint pass. Scoped lint reports the existing LibraryPanel Fast Refresh export warning.
- Activity toolbar test still times out at line 47 waiting for Read succeeded / 2 items in its slow-inbox scenario. The identical timeout is reproduced against committed pre-rollout components; served module inspection confirms the baseline has no PageHeader while the migrated component does. Its assertions and behavior remain unchanged.
- Earlier Work workflow-selector timeout and repository lint ratchets remain unresolved; they are not hidden or rebaselined.

Captures and diagnostic logs stay under ignored .artifacts. The four completed c21a697 screenshots were uploaded separately with explicit user approval and fixture-data captions. No new screenshot export is needed for this group. No native restart, push, merge to main, release, deployment, account mutation or data deletion is included.

Native smoke also passed for Today, Teams, Activity, Sessions and the six remaining Settings page headers. Original view, saved Settings selection and theme were restored and verified. Library interaction and six-theme measurements are fixture evidence.

