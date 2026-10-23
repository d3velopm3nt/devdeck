# Final bounded page-consistency pass

This group covers the remaining requested page inventory without changing navigation, feature ownership, bindings or business actions.

| Surface | Adopted | Deliberate exception |
| --- | --- | --- |
| GitHub main | Shared 24px header, description and action controls | Repository rail, activity feed, review states and inspector remain specialized. |
| Machine | Shared header/actions; theme-aware selected-source labels and pressed states | Package search, manifests, installers and dialogs retain their existing flow. No real install or probe was tested. |
| Community / Discover | Shared Community page header; Discover inherits the previously migrated Agent Directory header | Item details, imports, permissions and install prompts remain unchanged. |
| Spaces | Shared 24px title and neutral action buttons | User-chosen space colors, hero/avatar, service Start/Stop controls, paths and Dockview layout retain their identity and behavior. |
| SQL Connections | Shared 14px compact title and 28px compact action controls | Selected connection metadata, SQL editor and result grid retain their operational layout. No live database action. |
| Calendar | Shared compact title and date-navigation controls | The date remains the title. Day/week/month/year grids, event colors and scheduling editor stay specialized. |
| Mail / Contacts | Shared compact search/action toolbar; semantic selection accents | List/reader split, account context, sender colors, messages, contact groups and reader tabs retain their dense layout. |

Shared compact controls keep keyboard focus rings and become 44px on coarse-pointer devices. Branded artwork and the six shell themes remain.

## Verification

check-final-pages.mjs passes for all eight surfaces in all six themes, with light/dark local captures, 1000px bounds, keyboard-focus rings, compact control height, Machine source pressed state, SQL history preserving query text and Calendar view switching. The test boundary is mocked; it connects no account, database or external service. Machine fixture loading is explicitly stubbed to prevent tool probes or manifest writes.

Existing GitHub flow and visual suites pass: refresh failure/recovery, repository validation, direct review, selection/filter states, search, briefing acknowledgement and narrow layout. The existing five-group design-system suite also passes, including Mail/Contacts switching and calendar/schedule states. TypeScript, frontend build and scoped lint pass; scoped lint retains the existing GitHubPage Fast Refresh export warning.

The new test initially targeted GitHub's briefing fixture before its details entry and attempted focus-visible after mouse interaction. Those test setup assumptions were corrected to follow the existing details entry and keyboard modality; the assertions remain. No product workflow was changed to make a test pass.

Inherited failures remain from earlier passes: Activity slow-inbox timeout at line 47, Work workflow-selector timeout at line 28, 24 whole-store subscriptions versus baseline 25, and 75 synchronous commands versus baseline 68. No test or baseline has been weakened.

## Whole-app coverage boundary

Together with c21a697 and d15fb43, overview/section headers and selected page controls now cover the requested Inbox, Work, Connectors, Today, Teams/Library, Activity/Sessions, Settings and final eight page groups. This is not a claim that every component or state has been restyled.

Deliberately retained: Chat/workspace tabs, Dockview, run/team/workflow editors, Mail/SQL/Calendar operational content, Library project design assets, terminal and Monaco rendering, Floating Deck and branded artwork. Standalone Stash, Analytics charts, legacy Home, onboarding/business wizards and nested resource dialogs retain their existing specialized components; they were not comprehensively reverified in this final group. Native checks and their skips are recorded separately. No layout migration, new functionality, account changes, push, main merge, release or deployment.

Native smoke passed for GitHub, Community, Calendar, SQL Connections, Mail and Contacts. Original view, Mail pane and theme were restored and verified. Machine native navigation was skipped to avoid first-load probe/manifest seeding; no Spaces Dockview panel was created or changed, so both remain fixture-only evidence.

