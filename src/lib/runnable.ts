// Deciding whether a code block is a command you could run.
//
// The Run button is an offer to execute something on the machine, so the rule
// behind it has to be one a person could predict. Two ways in, both explicit:
//
//   1. The fence says it is a shell — ```bash, ```powershell, ```console.
//   2. The fence says nothing, and EVERY line is a comment or starts with a
//      command from a whitelist below.
//
// A whitelist rather than a heuristic, because the failure is asymmetric.
// Refusing to offer Run on something runnable costs a copy and a paste.
// Offering it on a JSON blob or a Python file gets a shell to try to execute
// it, and the person clicked a button that said Run.
//
// This never decides whether a command is *safe* — only whether it is a
// command at all. `rm -rf` is exactly as runnable as `ls`, and the button
// shows the whole block so what is about to run is what is on screen.

/// Fence languages that mean "a shell".
const SHELL_LANGS = new Set([
  'sh',
  'bash',
  'zsh',
  'shell',
  'console',
  'terminal',
  'powershell',
  'pwsh',
  'ps1',
  'cmd',
  'bat',
  'batch',
])

/// First words we are prepared to call a command in an unlabelled block.
/// Deliberately short: things a developer runs, not everything that exists.
const KNOWN = new Set([
  'git',
  'gh',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'node',
  'cargo',
  'rustup',
  'python',
  'python3',
  'pip',
  'pip3',
  'poetry',
  'uv',
  'docker',
  'kubectl',
  'terraform',
  'dotnet',
  'go',
  'java',
  'mvn',
  'gradle',
  './gradlew',
  'gradlew',
  'make',
  'cmake',
  'cd',
  'ls',
  'dir',
  'pwd',
  'mkdir',
  'rmdir',
  'rm',
  'del',
  'cp',
  'copy',
  'mv',
  'move',
  'cat',
  'type',
  'echo',
  'touch',
  'curl',
  'wget',
  'winget',
  'scoop',
  'choco',
  'code',
  'ssh',
  'scp',
  'tar',
  'zip',
  'unzip',
  'grep',
  'find',
  'which',
  'where',
  'set',
  'export',
  'sudo',
  'powershell',
  'pwsh',
  'Get-ChildItem',
  'Set-Location',
  'New-Item',
  'Remove-Item',
])

/** A shell prompt someone pasted along with the command: `$ `, `> `, `PS> `. */
const PROMPT = /^\s*(?:PS[^>]*>|[$#>])\s+/

/** Strip a pasted prompt so the line we run is the command, not the prompt. */
export function stripPrompt(line: string): string {
  return line.replace(PROMPT, '')
}

/**
 * Whether a fenced block should offer a Run button.
 *
 * `lang` is the fence's language (may be empty), `body` its contents.
 */
export function looksRunnable(lang: string, body: string): boolean {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return false

  if (SHELL_LANGS.has(lang.trim().toLowerCase())) return true
  // A language we were told and did not recognise is an answer, not a gap:
  // ```json is not a shell, and we should not go looking for reasons it is.
  if (lang.trim() !== '') return false

  return lines.every((raw) => {
    const line = stripPrompt(raw)
    if (line.startsWith('#') || line.startsWith('//')) return true
    const first = line.split(/\s+/)[0] ?? ''
    return KNOWN.has(first)
  })
}

/**
 * Remove a trailing `# explanation` from a command line.
 *
 * `git stash apply       # apply, not pop` is how an assistant annotates a
 * block, and `#` starts a comment in bash and PowerShell but NOT in cmd.exe,
 * where the whole thing arrives as arguments to git. Since we do not know
 * which shell the terminal will be, the annotation is stripped rather than
 * gambled on.
 *
 * Quote-aware, because a `#` inside quotes is content — an anchor in a URL,
 * a colour, a commit message with a hash in it. Only a `#` that starts a word
 * outside quotes is a comment.
 */
export function stripTrailingComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    // Only when it begins a word: `foo#bar` is one token, not a comment.
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd()
    }
  }
  return line
}

/**
 * The lines to send to a shell: prompts stripped, blank lines and comments
 * dropped, trailing annotations removed.
 */
export function commandLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => stripPrompt(l.trim()))
    .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('//'))
    .map((l) => stripTrailingComment(l))
    .filter((l) => l !== '')
}
