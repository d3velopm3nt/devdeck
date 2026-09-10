// Deciding whether a code span in the chat is a file you could open.
//
// Same shape of judgement as `runnable.ts`, and the same asymmetry: a path we
// fail to recognise costs a click in the Explorer, while underlining something
// that is not a path — a class name, a flag, a git ref — puts a link in front
// of someone that cannot go anywhere.
//
// So this only decides whether something is *shaped* like a path. Whether the
// file exists is settled separately, by looking, because the shape of a path
// and the existence of a file are different questions and only one of them can
// be answered by a regular expression.

/// Extensions we are prepared to call a file. Not exhaustive on purpose —
/// this is a chat, and the paths that come up in one are source, config and
/// docs.
const EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'rs', 'go', 'py', 'rb', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'json', 'toml', 'yml', 'yaml', 'xml', 'ini', 'cfg', 'conf', 'properties', 'lock',
  'md', 'mdx', 'txt', 'csv', 'sql',
  'html', 'css', 'scss', 'sass',
  'sh', 'bash', 'ps1', 'bat', 'cmd',
  'gradle', 'env', 'example', 'sample', 'template',
  'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico',
])

/// Dotfiles that are files rather than extensions of something.
const DOTFILES = new Set([
  '.gitignore', '.gitattributes', '.gitmodules', '.env', '.npmrc', '.nvmrc',
  '.editorconfig', '.prettierrc', '.eslintrc', '.dockerignore', '.oxlintrc.json',
])

/**
 * Whether `s` is shaped like a path to a file in a repository.
 *
 * Rejects, deliberately: URLs, flags, anything with whitespace, absolute
 * paths and anything climbing out of the tree (`..`), and directories written
 * with a trailing slash — `.idea/` is a folder, and there is nothing to open.
 */
export function looksLikePath(s: string): boolean {
  const t = s.trim()
  if (t === '' || t.length > 200) return false
  if (/\s/.test(t)) return false
  if (t.includes('://') || t.startsWith('-')) return false
  // Absolute paths and escapes are out of the node's tree, and `openFile`
  // takes a path relative to it.
  if (t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t) || t.split(/[\\/]/).includes('..')) {
    return false
  }
  if (t.endsWith('/') || t.endsWith('\\')) return false

  const name = t.split(/[\\/]/).pop() ?? ''
  if (name === '') return false
  if (DOTFILES.has(name)) return true

  // `.env.example` — a dotfile with something after it. The last piece has to
  // still look like an extension, or `.well-known` becomes a file.
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return EXTS.has(ext)
}

/**
 * Strip a `:42` or `:42:7` line/column suffix, which is how a path gets
 * written when it is a location rather than a file.
 *
 * The line number is dropped rather than used: the file viewer takes a path,
 * not a position, and opening the right file at the wrong line beats not
 * opening it.
 */
export function stripLocation(s: string): string {
  return s.trim().replace(/:\d+(?::\d+)?$/, '')
}

/** The directory part of a relative path — `''` for a file at the root. */
export function dirOf(rel: string): string {
  const i = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
  return i < 0 ? '' : rel.slice(0, i)
}

/** The filename part. */
export function nameOf(rel: string): string {
  const i = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
  return i < 0 ? rel : rel.slice(i + 1)
}

/** Backslashes to forward slashes — what the file commands expect. */
export function normalise(rel: string): string {
  return rel.replace(/\\/g, '/')
}
