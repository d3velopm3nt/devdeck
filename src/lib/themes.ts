// The themes you can pick in Settings.
//
// A theme is *only* a name plus a `data-theme` value: every colour it actually
// paints lives in `src/index.css`, where each id gets a block redefining the
// whole `--c-*` token set. Nothing here is read by a component for layout —
// the `swatch` exists so a card in Settings can show you what a theme looks
// like without mounting the app in it, and those four hexes are the one place
// in the codebase where a raw colour outside `index.css` is allowed.
//
// `scheme` is the honest dark/light answer for anything that cannot read our
// tokens and needs to be told which family it is in — Monaco, xterm — so a
// warm paper theme does not hand the editor a "dark" it never asked for.

export type ThemeId = 'dark' | 'light' | 'claude' | 'vercel' | 'vercel-light' | 'vscode'

/// What a theme *is* underneath the palette, for consumers that only speak
/// dark or light.
export type ThemeScheme = 'dark' | 'light'

/// The four colours a preview needs: the ground, a surface on it, the accent,
/// and the text colour. Kept deliberately small — a preview that tried to be
/// exact would be a second copy of the theme, drifting from the real one.
export type ThemeSwatch = {
  app: string
  panel: string
  accent: string
  ink: string
}

export type ThemeDef = {
  id: ThemeId
  label: string
  blurb: string
  scheme: ThemeScheme
  swatch: ThemeSwatch
}

/// What an unknown or missing setting falls back to.
export const DEFAULT_THEME_ID: ThemeId = 'dark'

export const THEMES: ThemeDef[] = [
  {
    id: 'dark',
    label: 'DevDeck',
    blurb: 'The original night palette — slate surfaces, indigo accent.',
    scheme: 'dark',
    swatch: { app: '#0b0e14', panel: '#11141c', accent: '#818cf8', ink: '#e2e8f0' },
  },
  {
    id: 'light',
    label: 'DevDeck light',
    blurb: 'The same deck, lit for daylight.',
    scheme: 'light',
    swatch: { app: '#e9ebf0', panel: '#fdfdfe', accent: '#4f46e5', ink: '#16181d' },
  },
  {
    id: 'claude',
    label: 'Claude',
    blurb: 'Warm paper and clay — the look of Claude’s apps.',
    scheme: 'light',
    swatch: { app: '#f0eee6', panel: '#faf9f5', accent: '#c96442', ink: '#1f1e1c' },
  },
  {
    id: 'vercel',
    label: 'Vercel',
    blurb: 'Pure black, neutral greys, one blue.',
    scheme: 'dark',
    swatch: { app: '#000000', panel: '#111111', accent: '#0070f3', ink: '#ededed' },
  },
  {
    id: 'vercel-light',
    label: 'Vercel light',
    blurb: 'The same hard edges, on white.',
    scheme: 'light',
    swatch: { app: '#f2f2f2', panel: '#ffffff', accent: '#0070f3', ink: '#000000' },
  },
  {
    id: 'vscode',
    label: 'VS Code',
    blurb: 'Dark+ — the editor you already live in.',
    scheme: 'dark',
    swatch: { app: '#1e1e1e', panel: '#252526', accent: '#007acc', ink: '#d4d4d4' },
  },
]

/// The theme for an id, falling back to the default rather than throwing — a
/// settings row written by an older build must never leave the app unpainted.
export function themeById(id: string | null | undefined): ThemeDef {
  return (
    THEMES.find((t) => t.id === id) ??
    THEMES.find((t) => t.id === DEFAULT_THEME_ID) ??
    THEMES[0]
  )
}
