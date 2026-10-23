# DevDeck interface foundations

Use the theme tokens in `src/index.css` for surfaces, borders, typography colors and state colors. Reuse the primitives in `src/components/ui/DesignSystem.tsx`; their styles live in `design-system.css`. The shared stylesheet loads globally. GitHub, Today, Inbox, Activity, mail, calendar, analytics, workforce, workspace/bot details, setup and utility panels consume these foundations.

## State vocabulary

| Meaning | Tone | Existing theme token | Examples |
| --- | --- | --- | --- |
| Open or successful | success | --c-ok | Open issues, passed checks, completed work |
| Needs review | warning | --c-warn | Review requested, assessment unavailable |
| Failed or blocked | danger | --c-err | Failed checks, blocked workflows |
| Active or new | info | --c-info | Running work, new briefings |
| Merged or committed | purple | --c-viol | Merged PRs, commits |
| Inactive or unspecified | neutral | --c-dim | Draft, closed, paused, unknown |

StateBadge always pairs color with an icon and a readable label. Pass a label when domain meaning differs (for example, a failed refresh versus failed PR checks). Unknown states remain neutral; never infer success from missing data. Closed PRs do not display stale check failures as their lifecycle state. Supporting check details remain visible.

## Typography

The current application font stack is `Segoe UI`, `system-ui`, `sans-serif` in `src/index.css`. Code and paths use the existing `font-mono` utility. Font sizes and weights are currently defined in individual component styles rather than a complete central type-token scale. The gallery shows representative existing styles; it must not imply that every screen already follows a standardized hierarchy.

| Existing use | Size | Weight / line height |
| --- | --- | --- |
| Workforce page title | 20px | 600 / 1.3 |
| Workforce card heading | 16px | 600 |
| Thread / Markdown body | 12.5px | 400 / 1.65 |
| Shared tabs and controls | 12px | 400–500 |
| State badge | 11px | 550 / 1.3 |
| Count / small metadata | 10px | 400 |
| Markdown inline code | 11.5px | System monospace |

Reuse the relevant existing component style and theme text tokens. Do not introduce a new font or type hierarchy per feature. Consolidating the remaining typography inconsistencies is a shared-system improvement, not an implied global restyle in the Chat integration.

## Controls and layout

Use FilterTabs for in-place filtering: icon, label, optional count, and aria-pressed buttons inside a named group. Counts describe the relevant screen scope; GitHub counts describe the selected repository before text search. Use compact underlined TabStrip for true tabbed panels: supply a unique panelId, give the panel role="tabpanel" and aria-labelledby="<panelId>-tab-<selectedId>". It provides roving focus and ArrowLeft/ArrowRight/Home/End activation. FilterTabs uses normal Tab/Enter/Space navigation. Use StateIcon for dense lists, retaining an accessible name and tooltip.

Controls have a 36px minimum height, raised to 44px for coarse pointers. Preserve visible focus outlines and labels; icon-only actions require an accessible name and tooltip. Selection uses an accent border and fill, distinct from state colors. Theme changes resolve semantic colors through existing theme tokens, without component-level hex values.

Use 4/8/12/16/24px spacing and 6/8px radii for badges/controls. Responsive pages should adapt to their container width because dock panels can be narrower than the application window. Preserve useful reading space, wrap long repository names, and avoid shrinking content cards to fit the viewport.

## Tab families and isolation

| Family | Use | Component |
| --- | --- | --- |
| Underlined view tabs | Switch between views of the same subject | `TabStrip` (default `appearance="underline"`) |
| Folder / editor tabs | Open artifacts, team builders and documents in a side panel | `TabStrip appearance="editor"` |
| Content filters | Narrow the items shown | `FilterTabs` |
| Window / workspace / dock tabs | Application windows, project workspaces and docked editors | Existing shell and Dockview components |

Both content-tab appearances retain the same accessible panel relationships and arrow/Home/End keyboard behavior. Each variant uses a specific CSS class; do not use global tab selectors or apply one family's structural styles to another. Changing content-tab appearance must not change window/workspace/Dockview tab layout or behavior. Shared theme colors continue to resolve through the existing tokens.

## Adoption and maintenance

- Navigation: Rail and WorkspaceTabs use ds-navigation-item; settings use ds-navigation. Use aria-current for page navigation and aria-pressed for view switches.
- View/filter controls: Today, Inbox, mail reader and list, calendar, analytics, Activity, work, workspace/bot pages, AI settings, machine setup, Community, repository discovery, workforce teams/library and bottom panels use the shared primitives.
- States: shared badges or named icons cover GitHub, Today activity, Inbox requests, notifications, schedules, processes, workflows, worker runs, team work items, decisions, feature lists, connection health and installation results. Existing compact session/bot helpers use the same semantic theme colors.
- User-selected avatar colors, brand marks, calendar categories, charts and the orb artwork are identity/content, not operational status. Keep those meanings separate.
- A running process is blue; a separately verified healthy connection is green. Enabled schedules are blue with a calendar icon and an Enabled label; they are not marked Running until the backend reports it. Built work needs review and stays amber until completed.
- Normalize known status aliases centrally in states.ts. Unknown values remain neutral. Add new states there instead of creating page-local red/green mappings.
- Use the existing Lucide Icon registry for semantic icons; direct Lucide imports are acceptable for domain-specific artwork. Keep labels on unfamiliar controls. Avoid emoji or font glyphs as UI controls.
- Badge text mixes the semantic color with theme ink to meet 4.5:1 contrast on its tinted background in all six themes.

## Verification

The fixture gallery at /harness/design-system.html demonstrates the shared vocabulary. Run harness/check-design-system.mjs with PLAYWRIGHT_MODULE and CHROMIUM_PATH as needed; it verifies all six theme contrasts, keyboard tabs and representative app interactions. The workforce and GitHub harness checks cover their filters, view switches and actions. These tests use mock IPC and do not prove live service availability.

Dense section navigation (Workforce and utility panels) uses `ds-compact-tabs`, or `FilterTabs appearance="compact"`: 32px desktop height, 14px icons, short labels and an underline for selection. Keep descriptive copy in tooltips, avoid pill backgrounds and wrapping tab rows, and preserve 44px touch targets. Content filters retain the pill style.
