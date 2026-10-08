# DevDeck docs app

Standalone React + Vite documentation, using React Markdown and remark-gfm.
It shares the root dependencies and does not require the Tauri desktop runtime.

- `npm run docs:dev` — localhost:5174
- `npm run docs:build` — type-check and generate `dist-docs/`
- `npm run docs:preview` — preview the production output

Deploy `dist-docs/` to any static host. Relative assets and hash navigation support
subdirectory hosting without server rewrite rules. No hosting is configured yet.

Edit guides in `content/` and navigation in `navigation.json`. Folder workflows
use `../../docs/FOLDER-WORKFLOWS.md` directly as the canonical guide. Search runs
locally over guide titles and text. No external search service is required.

This is an initial documentation edition. Review each guide against a released
Windows build before removing its qualification. Keep proposed capabilities
separate from available behaviour.
