# DevDeck desktop design decisions

Decision date: 17 October 2026. Source: user review in this task.
Status: direction approved; implementation and visual verification pending. This record does not claim the mockups are shipped or that their sample data reflects live state.

## Approved direction

- Use the **first desktop mockup** as the layout and visual direction: [reference](desktop-approved-direction.png).
- Use **Link**, concept 06 at the bottom right of the [logo exploration](logo-exploration.png), as the DevDeck logo direction. Recreate as a scalable vector; do not use the entire raster sheet as an app asset.
- Apply the new design, not just a logo replacement. Start with dashboard, navigation/actions and matching desktop notifications.
- Keep Dev central: briefing first, with visibility into GitHub activity, DevDeck tasks and email. Preserve real data and existing actionable approvals.
- Prefer compact, icon-driven controls with meaningful hierarchy. Avoid oversized buttons and giving every action identical boxed styling.
- Use subtle theme accents and consistent state icons/colors for approval, failure, blocked and complete. Never rely on color alone.
- Keep labels for important or unfamiliar actions; icon-only actions need accessible names, tooltips and visible keyboard focus.
- Use fine separators, typography and restrained surfaces. Secondary actions may appear on hover or keyboard focus. Reserve filled styling for the main action when needed.
- Alerts appear at the display edge in their own desktop window, outside DevDeck. Use a state icon, short message, source, one clear action and dismiss control; support stacked alerts.
- Give notification categories distinct sounds, with independent sound controls, alert levels, mutes and quiet hours. Saved history remains available when alerts are suppressed.
- Move notification controls from **Settings > Deck** into a dedicated **Settings > Notifications** menu entry/page. Keep Deck focused on widget behavior. Reuse the existing saved preference model.

## Supporting exploration

The [second mockup](icon-driven-exploration.png) explores quieter icon actions and status treatments. It does not supersede the user's preference for the first layout. All mockups were generated with the built-in image-generation tool and contain fictional sample data. Generated logos are concepts requiring vector refinement and small-size checks.

## Verification and boundaries

- User confirmed seeing an alert and hearing a sound. Full minimized delivery and sound-category end-to-end verification was deferred at the user's request while design is addressed.
- Keep notification persistence, filtering and approval controls working through the redesign.
- Verify desktop and narrow layouts, theme adaptation, keyboard navigation, empty/error states, and functional actions against real or explicitly labeled fixture data.
- Do not copy fictitious progress percentages, connection health, conversations or activity from mockups into the running app.
- Main-chat consolidation and background phone push are separate unfinished functionality; the mockup is not evidence they exist.
- No merge or deployment authorized. Record actual implementation and test results separately from this approval record.

## Change log

- 17 October: user preferred first desktop concept.
- 17 October: user selected Link (06) logo.
- 17 October: user authorized implementation of both logo and new design.
- 17 October: user requested a dedicated notification settings page/menu.
- 17 October: decision record and reference images added to repository; not committed yet.

## Implementation update

- Dashboard, notification cards and dedicated Notifications settings page implemented and browser-checked. See [verification report](../test-reports/design-2026-10-17/report.html).
- Link vector added to the app; Windows icon generated and embedded in the rebuilt development executable.
- User requested polished settings UX: section hierarchy, concise descriptions, visible selected/saved state, toggles and preview. Applied to Notifications; other settings categories are not claimed to be redesigned.
- Full notification E2E testing remains deferred. Changes are not committed, pushed, merged or deployed.
