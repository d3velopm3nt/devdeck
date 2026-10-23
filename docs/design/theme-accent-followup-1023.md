# Theme accent follow-up

This pass fixes generic fixed-indigo controls reported while Vercel theme was selected. It changes presentation only.

- Shared input focus and menu hover use the active accent.
- Settings checkboxes use the theme accent instead of indigo.
- Chat assistant accents/caret/setup links, Settings help icons, provider secret icon, agent skill selections and Community active controls use semantic theme colors.
- Custom connector controls/icon use the accent; provider marks, MCP identity, semantic purple states and category colors retain their separate meaning.

The default DevDeck palettes intentionally have an indigo accent. Vercel uses blue and Claude uses clay. An accent following those palettes is different from a fixed provider logo or a semantic merged/category color. Other specialized editors/wizards still need individual review; this is not a global removal of purple.

## Verification

check-theme-accents.mjs passes input focus, checkbox accent and exact browser-resolved 12% active-accent menu hover in all six themes. Early test probes used the wrong menu class and compared uncomposited sRGB values against an Oklab/alpha tint; these test-measurement issues were corrected without changing the required active-theme behavior.

Existing Chat workspace, CLI setup, Settings consistency and five-group shared-design-system fixtures pass. CLI install/login actions in those tests are mocked commands, not real installation or account sign-in. TypeScript and production build pass. Scoped lint has the existing Chat hook-dependency warning. The previously recorded Activity/Work timeouts and repository lint ratchets remain outside this presentation-only change.

## Claude subscription diagnosis (no implementation change)

Existing setup is Settings > AI > Providers > Subscriptions > Claude (Claude Code), implemented by aiw/CliConnections.tsx. Anthropic API-key setup is separate. Verify & use as default explicitly performs a small model call and was not invoked.

connectors_provider_bindings in src-tauri/src/connectors.rs only returns provider handles with direct runtime-agent consumers. The frontend inventory adds those references alongside saved API setups. It does not independently enumerate signed-in CLI accounts or explicit personal defaults. The observed native inventory contained ChatGPT subscription only, which does not establish Claude authentication state. The AI owner link opens Settings without explicitly selecting its AI subsection.

A future subscription inventory change should reuse the existing CLI credential/status owner, distinguish configuration from authentication and keep grants unchanged. This pass does not implement that architecture, sign in, inspect credentials or probe a paid model.

Native focus verification passed on the running Vercel theme: the focused shared input border is rgb(59, 158, 255), matching its blue accent. The initial background-WebView attempt did not obtain focus; repeating with DevDeck briefly foregrounded verified the style. Original page, Settings selection and theme were restored and verified; the previous foreground window was then requested again.

