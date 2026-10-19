# Design System Library

Open **Workforce → Library → Design systems**, preview the bundled Supabase-inspired design in light or dark mode, select a project, and assign it. Clear assignment explicitly opts that scope out of inherited design guidance.

## Source of truth

- `supabase.json`: versioned design tokens and agent guidelines, bundled into the desktop binary.
- `supabase-design-system.html`: standalone visual reference rendered directly in the Library preview. Its own controls manage light/dark mode.
- `src/components/design-systems/`: HTML preview host and raw-source viewer; no duplicate specimen layout.
- `src-tauri/src/design_system_model.rs`: portable assignment persistence and briefing.
- `src-tauri/src/design_systems.rs`: desktop commands and nearest-ancestor lookup.

Assignments live in the selected node's **vault folder** at `.devdeck/design-system.json`, not in its linked source repository. Each assignment stores the design ID, design version, and a revision. Saves check the prior revision and use a temporary file before replacement. A failed save is surfaced in the UI, which requires reloading before retrying.

New CLI worker and native workflow launches receive the nearest assigned design's tokens and guidelines. Existing runs are not rewritten. An explicit cleared assignment stops inheritance; corrupt or unavailable versions fail with an actionable error rather than silently choosing another design. The design does not grant permissions or alter workflow constraints.

This first milestone provides project assignments only. Applying a theme to DevDeck itself, importing arbitrary designs, editing tokens, and building a new sample project are subsequent work. No Supabase database is required: Supabase here names the visual inspiration.

## Evidence

See [verification report](../test-results/design-systems/README.md) for checks, screenshots, limitations, and the Windows acceptance steps.

## HTML previews

Each catalog `<name>.json` is paired with its own `<name>-design-system.html` file.
The catalog ID selects that pair (for example `supabase.json` / `supabase-design-system.html`).
The Library loads that file unchanged, including its CSS and interactive theme controls,
in a sandboxed iframe. **Open raw HTML** reveals the exact source used by the preview.
Editing the HTML updates the preview through Vite during development; packaged desktop
builds need rebuilding to include changed files. This is not a runtime HTML editor/importer.
JSON still supplies the existing agent tokens/guidelines and assignment metadata.
