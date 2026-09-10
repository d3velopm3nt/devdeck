// Monaco, bundled and offline.
//
// The usual way to load Monaco pulls it from a CDN at runtime. This app is
// local-first and expected to work on a plane, so it is bundled instead — the
// editor and its workers ship inside the binary, and nothing here reaches the
// network. That is the whole reason for this file: `MonacoEnvironment` has to
// hand back workers built by Vite rather than fetched from somewhere.
//
// Two themes, defined from `index.css`'s tokens rather than from Monaco's
// stock light and dark. An editor that keeps its own idea of "dark" is the one
// panel in the app that does not follow the theme switch, and it looks like a
// bug every time.

import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

// Colouring, not language services.
//
// `basic-languages` is every grammar Monaco knows — markdown, YAML, Rust,
// TypeScript, shell, SQL and the rest — each loaded lazily the first time a
// file needs it. That is all a *reader* wants.
//
// The four rich languages (json, typescript, css, html) are deliberately left
// out. They add diagnostics and completion, and each one ships a worker: the
// TypeScript one alone is 6.8 MB, which is four times this whole application
// for a feature nobody can use in a read-only pane. If editing lands later,
// they come back with it.
import 'monaco-editor/basic-languages/monaco.contribution.js'

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

window.MonacoEnvironment = {
  // One worker: tokenising and diffing. Everything else is a language service
  // this pane does not offer.
  getWorker: () => new EditorWorker(),
}

/// The app's tokens, as a Monaco theme.
///
/// Read from the live CSS variables rather than duplicated here, so a change
/// to `index.css` moves the editor with everything else and the two cannot
/// drift into two slightly different greys.
function palette(): Record<string, string> {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => (s.getPropertyValue(name).trim() || fallback)
  return {
    page: v('--c-page', '#0d1017'),
    ink: v('--c-ink', '#e2e8f0'),
    body: v('--c-body', '#cbd5e1'),
    dim: v('--c-dim', '#94a3b8'),
    muted: v('--c-muted', '#64748b'),
    faint: v('--c-faint', '#475569'),
    line: v('--c-line', '#1e293b'),
    hover: v('--c-hover', '#232b3b'),
    accent: v('--c-accent', '#818cf8'),
    ok: v('--c-ok', '#4ade80'),
    warn: v('--c-warn', '#fbbf24'),
    viol: v('--c-viol', '#a78bfa'),
  }
}

/// Monaco wants six-digit hex with no alpha; a token that resolves to
/// something else would silently make the whole theme fail to register.
const hex = (c: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback)

let defined = ''

/// Define (or redefine) the theme for the current app theme and return its
/// name. Cheap enough to call on every mount and on every theme change.
export function useAppTheme(mode: 'dark' | 'light'): string {
  const name = `devdeck-${mode}`
  const p = palette()
  const bg = hex(p.page, mode === 'dark' ? '#0d1017' : '#f6f7f9')
  const fg = hex(p.body, mode === 'dark' ? '#cbd5e1' : '#333a45')

  monaco.editor.defineTheme(name, {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: fg.slice(1) },
      { token: 'comment', foreground: hex(p.faint, '#475569').slice(1), fontStyle: 'italic' },
      { token: 'string', foreground: hex(p.ok, '#4ade80').slice(1) },
      { token: 'number', foreground: hex(p.warn, '#fbbf24').slice(1) },
      { token: 'keyword', foreground: hex(p.accent, '#818cf8').slice(1) },
      { token: 'type', foreground: hex(p.viol, '#a78bfa').slice(1) },
      // YAML and JSON keys — the bulk of what a vault holds.
      { token: 'key', foreground: hex(p.accent, '#818cf8').slice(1) },
      { token: 'attribute.name', foreground: hex(p.accent, '#818cf8').slice(1) },
      { token: 'delimiter', foreground: hex(p.dim, '#94a3b8').slice(1) },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': hex(p.faint, '#475569'),
      'editorLineNumber.activeForeground': hex(p.dim, '#94a3b8'),
      'editor.lineHighlightBackground': hex(p.hover, '#232b3b'),
      'editorIndentGuide.background1': hex(p.line, '#1e293b'),
      'editorGutter.background': bg,
      'editorWidget.background': hex(p.page, '#0d1017'),
      'editorWidget.border': hex(p.line, '#1e293b'),
      'scrollbarSlider.background': `${hex(p.line, '#1e293b')}aa`,
      'editorOverviewRuler.border': bg,
    },
  })
  defined = name
  return defined
}

/// What language a file is, by its name.
///
/// Extension only, deliberately: sniffing content guesses, and a wrong guess
/// paints a file in a syntax it does not have. A name that says nothing gets
/// plain text, which is honest and still readable.
export function languageOf(name: string): string {
  const n = name.toLowerCase()
  const dot = n.lastIndexOf('.')
  const ext = dot < 0 ? '' : n.slice(dot + 1)
  const byName: Record<string, string> = {
    dockerfile: 'shell',
    makefile: 'shell',
    '.gitignore': 'plaintext',
  }
  if (byName[n]) return byName[n]
  const byExt: Record<string, string> = {
    md: 'markdown',
    markdown: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    jsonc: 'json',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    rs: 'rust',
    css: 'css',
    html: 'html',
    sql: 'sql',
    py: 'python',
    sh: 'shell',
    bash: 'shell',
    ps1: 'powershell',
  }
  return byExt[ext] ?? 'plaintext'
}

export { monaco }
