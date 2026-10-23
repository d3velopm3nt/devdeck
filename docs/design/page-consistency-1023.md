# Shared page consistency pass

This pass extends the existing DevDeck design-system components. Navigation destinations, Inbox behavior, work-item actions, connector bindings and saved settings retain their existing owners.

## Changes

- Inbox and Work use a shared 24px page heading. Connectors uses a 28px overview variant; Settings sections use an 18px section variant. Each shares 12px description text, semantic colors and responsive action wrapping.
- Measured before/after title sizes: Inbox 15 -> 24px, Work 23 -> 24px, Connectors 40 -> 28px, Settings sections 16 -> 18px. Before captures render the committed pre-change components through a read-only fixture transform.
- Selected page actions share 34px controls, 8px corners, 12px labels and visible focus rings; coarse-pointer controls are at least 44px. Existing callbacks and disabled states are preserved.
- Connectors reuses TabStrip with arrow/Home/End keyboard behavior and the active shell accent. Branded marks, catalogue ordering, management dialog and three-column layout are retained.
- Work and connector cards share a 12px corner token. Work keeps its dense board and domain-specific card content. Header/action/toolbar spacing uses the existing 4/8/12/16/24 rhythm.

## Verification

The new check-page-consistency fixture covers Inbox, Work, Connectors and General Settings across all six themes. It checks heading scales, light/dark screenshots, narrow header bounds, keyboard tab selection, focus outlines, custom MCP dialog close and coarse-pointer target size. Captures remain local under ignored .artifacts/page-consistency; none are exported.

TypeScript, the frontend production build, scoped lint, the existing Settings consistency suite, shared design-system suite and chat-tab regression pass. These use mock IPC and installed Chrome; no live account or paid model checks are performed. Initial test setup failed because the packaged browser binary was absent and the restricted fixture server was unreachable; using installed Chrome and a permitted fixture server resolved both.

Repository lint still fails at 24 whole-store subscriptions versus baseline 25. The separate synchronous-command ratchet remains 75 versus baseline 68. Baselines are unchanged. The broader Work fixture test fails looking for Workflow for this work item after saving a fixture item; the identical timeout at line 28 is reproduced against committed pre-change components, confirming it predates this pass.

## Remaining scope

This is a representative migration, not a complete restyle of every DevDeck view. Other Settings subviews, dense editors, utility panels and custom domain cards still use existing components. No feature moves, navigation changes, Library-to-theme adapter, dependency upgrades, credential changes, push or deployment are included. A native WebView smoke check also confirms the four shared headers at 24/24/28/18px. Original view, saved Settings selection and theme were restored and verified; broader six-theme and workflow checks remain fixture evidence.


