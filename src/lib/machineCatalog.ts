// Seed catalog for the "Machine Setup" feature: a curated set of dev software
// (winget-first, scoop for CLIs) plus one-click bundles so a fresh Windows
// install is a couple of clicks instead of picking 60 packages by hand.
//
// IDs are the seed — at runtime the catalog verifies each against
// `winget show <id>` / `scoop info <id>`, so drift self-corrects.

export type PkgSource = 'winget' | 'scoop'

export type PkgCategory =
  | 'editors'
  | 'languages'
  | 'git'
  | 'terminals'
  | 'cloud'
  | 'databases'
  | 'api'
  | 'cli'
  | 'browsers'
  | 'productivity'
  | 'ai'

export interface CatalogPackage {
  /** Exact winget/scoop package id. */
  id: string
  /** Human-facing name. */
  name: string
  source: PkgSource
  category: PkgCategory
  /** One-line description shown under the name. */
  blurb?: string
  /** Needs admin — installed in the elevated batch (one UAC prompt). */
  elevate?: boolean
}

/** A post-install command; `after` waits for that package id to be installed. */
export interface CatalogStep {
  run: string
  after?: string
  label?: string
}

/** A one-click grouping of packages (+ optional steps) for a role. */
export interface Bundle {
  id: string
  name: string
  description: string
  icon: string
  packages: string[] // package ids
  steps?: CatalogStep[]
}

export const CATEGORY_LABELS: Record<PkgCategory, string> = {
  editors: 'Editors & IDEs',
  languages: 'Languages & runtimes',
  git: 'Git & version control',
  terminals: 'Terminals & shells',
  cloud: 'Containers, cloud & infra',
  databases: 'Databases & clients',
  api: 'API & testing',
  cli: 'CLI utilities',
  browsers: 'Browsers',
  productivity: 'Dev-adjacent & productivity',
  ai: 'AI / local models',
}

export const PACKAGES: CatalogPackage[] = [
  // --- editors ---
  { id: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code', source: 'winget', category: 'editors', blurb: 'The default editor for most stacks' },
  { id: 'Anysphere.Cursor', name: 'Cursor', source: 'winget', category: 'editors', blurb: 'AI-first VS Code fork' },
  { id: 'JetBrains.Toolbox', name: 'JetBrains Toolbox', source: 'winget', category: 'editors', blurb: 'Installs & manages IntelliJ, WebStorm, etc.' },
  { id: 'Microsoft.VisualStudio.2022.Community', name: 'Visual Studio 2022', source: 'winget', category: 'editors', blurb: '.NET / C++ IDE', elevate: true },
  { id: 'Neovim.Neovim', name: 'Neovim', source: 'winget', category: 'editors' },
  { id: 'Notepad++.Notepad++', name: 'Notepad++', source: 'winget', category: 'editors' },

  // --- languages & runtimes ---
  { id: 'OpenJS.NodeJS.LTS', name: 'Node.js (LTS)', source: 'winget', category: 'languages', blurb: 'JavaScript runtime, LTS line' },
  { id: 'CoreyButler.NVMforWindows', name: 'nvm for Windows', source: 'winget', category: 'languages', blurb: 'Switch Node versions' },
  { id: 'Oven-sh.Bun', name: 'Bun', source: 'winget', category: 'languages', blurb: 'Fast JS runtime + package manager' },
  { id: 'DenoLand.Deno', name: 'Deno', source: 'winget', category: 'languages' },
  { id: 'Python.Python.3.12', name: 'Python 3.12', source: 'winget', category: 'languages' },
  { id: 'GoLang.Go', name: 'Go', source: 'winget', category: 'languages' },
  { id: 'Rustlang.Rustup', name: 'Rust (rustup)', source: 'winget', category: 'languages', blurb: 'Rust toolchain installer' },
  { id: 'Microsoft.DotNet.SDK.8', name: '.NET SDK 8', source: 'winget', category: 'languages' },
  { id: 'EclipseAdoptium.Temurin.21.JDK', name: 'Java (Temurin 21)', source: 'winget', category: 'languages' },
  { id: 'RubyInstallerTeam.Ruby.3.3', name: 'Ruby 3.3', source: 'winget', category: 'languages' },

  // --- git ---
  { id: 'Git.Git', name: 'Git', source: 'winget', category: 'git' },
  { id: 'GitHub.GitLFS', name: 'Git LFS', source: 'winget', category: 'git', blurb: 'Large file storage' },
  { id: 'GitHub.cli', name: 'GitHub CLI', source: 'winget', category: 'git', blurb: 'gh — PRs, issues, auth' },
  { id: 'GitHub.GitHubDesktop', name: 'GitHub Desktop', source: 'winget', category: 'git' },
  { id: 'lazygit', name: 'lazygit', source: 'scoop', category: 'git', blurb: 'Terminal UI for git' },
  { id: 'dandavison.delta', name: 'delta', source: 'winget', category: 'git', blurb: 'Better git diffs' },

  // --- terminals & shells ---
  { id: 'Microsoft.WindowsTerminal', name: 'Windows Terminal', source: 'winget', category: 'terminals' },
  { id: 'Microsoft.PowerShell', name: 'PowerShell 7', source: 'winget', category: 'terminals' },
  { id: 'JanDeDobbeleer.OhMyPosh', name: 'Oh My Posh', source: 'winget', category: 'terminals', blurb: 'Prompt themer' },
  { id: 'wez.wezterm', name: 'WezTerm', source: 'winget', category: 'terminals' },

  // --- containers, cloud & infra ---
  { id: 'Docker.DockerDesktop', name: 'Docker Desktop', source: 'winget', category: 'cloud', elevate: true },
  { id: 'RedHat.Podman-Desktop', name: 'Podman Desktop', source: 'winget', category: 'cloud' },
  { id: 'Kubernetes.kubectl', name: 'kubectl', source: 'winget', category: 'cloud' },
  { id: 'Helm.Helm', name: 'Helm', source: 'winget', category: 'cloud' },
  { id: 'k9s', name: 'k9s', source: 'scoop', category: 'cloud', blurb: 'Kubernetes TUI' },
  { id: 'Hashicorp.Terraform', name: 'Terraform', source: 'winget', category: 'cloud' },
  { id: 'Amazon.AWSCLI', name: 'AWS CLI', source: 'winget', category: 'cloud' },
  { id: 'Microsoft.AzureCLI', name: 'Azure CLI', source: 'winget', category: 'cloud' },
  { id: 'Google.CloudSDK', name: 'Google Cloud SDK', source: 'winget', category: 'cloud' },
  { id: 'Microsoft.WSL', name: 'WSL', source: 'winget', category: 'cloud', blurb: 'Windows Subsystem for Linux', elevate: true },

  // --- databases & clients ---
  { id: 'PostgreSQL.PostgreSQL.16', name: 'PostgreSQL 16', source: 'winget', category: 'databases', elevate: true },
  { id: 'PostgreSQL.pgAdmin', name: 'pgAdmin 4', source: 'winget', category: 'databases' },
  { id: 'Oracle.MySQL', name: 'MySQL', source: 'winget', category: 'databases', elevate: true },
  { id: 'MongoDB.Compass.Full', name: 'MongoDB Compass', source: 'winget', category: 'databases' },
  { id: 'dbeaver.dbeaver', name: 'DBeaver', source: 'winget', category: 'databases', blurb: 'Universal DB client' },
  { id: 'TablePlus.TablePlus', name: 'TablePlus', source: 'winget', category: 'databases' },
  { id: 'Redis.RedisInsight', name: 'RedisInsight', source: 'winget', category: 'databases' },

  // --- api & testing ---
  { id: 'Postman.Postman', name: 'Postman', source: 'winget', category: 'api' },
  { id: 'Insomnia.Insomnia', name: 'Insomnia', source: 'winget', category: 'api' },
  { id: 'Bruno.Bruno', name: 'Bruno', source: 'winget', category: 'api', blurb: 'Git-friendly API client' },
  { id: 'HTTPie.HTTPie', name: 'HTTPie', source: 'winget', category: 'api' },

  // --- cli utilities ---
  { id: 'ripgrep', name: 'ripgrep (rg)', source: 'scoop', category: 'cli', blurb: 'Fast recursive search' },
  { id: 'fd', name: 'fd', source: 'scoop', category: 'cli', blurb: 'Friendly find' },
  { id: 'fzf', name: 'fzf', source: 'scoop', category: 'cli', blurb: 'Fuzzy finder' },
  { id: 'bat', name: 'bat', source: 'scoop', category: 'cli', blurb: 'cat with wings' },
  { id: 'jqlang.jq', name: 'jq', source: 'winget', category: 'cli', blurb: 'JSON processor' },
  { id: 'MikeFarah.yq', name: 'yq', source: 'winget', category: 'cli', blurb: 'YAML processor' },
  { id: 'eza', name: 'eza', source: 'scoop', category: 'cli', blurb: 'Modern ls' },
  { id: 'ajeetdsouza.zoxide', name: 'zoxide', source: 'winget', category: 'cli', blurb: 'Smarter cd' },
  { id: '7zip.7zip', name: '7-Zip', source: 'winget', category: 'cli' },

  // --- browsers ---
  { id: 'Google.Chrome', name: 'Google Chrome', source: 'winget', category: 'browsers' },
  { id: 'Mozilla.Firefox.DeveloperEdition', name: 'Firefox Developer Edition', source: 'winget', category: 'browsers' },
  { id: 'Brave.Brave', name: 'Brave', source: 'winget', category: 'browsers' },

  // --- dev-adjacent & productivity ---
  { id: 'Microsoft.PowerToys', name: 'PowerToys', source: 'winget', category: 'productivity' },
  { id: 'voidtools.Everything', name: 'Everything', source: 'winget', category: 'productivity', blurb: 'Instant file search' },
  { id: 'Obsidian.Obsidian', name: 'Obsidian', source: 'winget', category: 'productivity' },
  { id: 'Figma.Figma', name: 'Figma', source: 'winget', category: 'productivity' },
  { id: 'SlackTechnologies.Slack', name: 'Slack', source: 'winget', category: 'productivity' },
  { id: 'Discord.Discord', name: 'Discord', source: 'winget', category: 'productivity' },
  { id: 'WinSCP.WinSCP', name: 'WinSCP', source: 'winget', category: 'productivity' },
  { id: 'PuTTY.PuTTY', name: 'PuTTY', source: 'winget', category: 'productivity' },

  // --- ai / local models ---
  { id: 'Ollama.Ollama', name: 'Ollama', source: 'winget', category: 'ai', blurb: 'Run local LLMs' },
]

// One-click bundles. They overlap (VS Code appears in several); the manifest
// de-dupes on install.
export const BUNDLES: Bundle[] = [
  {
    id: 'base',
    name: 'Base essentials',
    description: 'The stuff every dev machine needs, whatever the stack.',
    icon: '🧱',
    packages: [
      'Git.Git', 'Microsoft.WindowsTerminal', 'Microsoft.PowerShell',
      'Microsoft.VisualStudioCode', '7zip.7zip', 'Microsoft.PowerToys',
      'Google.Chrome', 'GitHub.cli',
    ],
    steps: [{ run: 'git config --global init.defaultBranch main', after: 'Git.Git' }],
  },
  {
    id: 'web',
    name: 'Node / Web dev',
    description: 'Front-end & full-stack JavaScript/TypeScript.',
    icon: '🟩',
    packages: [
      'OpenJS.NodeJS.LTS', 'CoreyButler.NVMforWindows', 'Oven-sh.Bun',
      'Microsoft.VisualStudioCode', 'Google.Chrome',
      'Mozilla.Firefox.DeveloperEdition', 'Bruno.Bruno',
    ],
    steps: [{ run: 'npm i -g pnpm turbo', after: 'OpenJS.NodeJS.LTS', label: 'Global pnpm + turbo' }],
  },
  {
    id: 'python',
    name: 'Python / Data',
    description: 'Python, notebooks and data tooling.',
    icon: '🐍',
    packages: ['Python.Python.3.12', 'Microsoft.VisualStudioCode', 'dbeaver.dbeaver'],
    steps: [{ run: 'python -m pip install --upgrade pip uv', after: 'Python.Python.3.12' }],
  },
  {
    id: 'dotnet',
    name: 'Backend / .NET',
    description: '.NET services and tooling.',
    icon: '🟦',
    packages: ['Microsoft.DotNet.SDK.8', 'Microsoft.VisualStudio.2022.Community', 'Postman.Postman'],
  },
  {
    id: 'systems',
    name: 'Go / Rust (systems)',
    description: 'Compiled, systems-level toolchains.',
    icon: '🦀',
    packages: ['GoLang.Go', 'Rustlang.Rustup', 'Microsoft.VisualStudioCode'],
  },
  {
    id: 'devops',
    name: 'DevOps / Cloud',
    description: 'Containers, Kubernetes, IaC and cloud CLIs.',
    icon: '☁️',
    packages: [
      'Docker.DockerDesktop', 'Kubernetes.kubectl', 'Helm.Helm', 'k9s',
      'Hashicorp.Terraform', 'Amazon.AWSCLI', 'Microsoft.AzureCLI', 'Microsoft.WSL',
    ],
  },
  {
    id: 'databases',
    name: 'Databases',
    description: 'Engines and clients for local data work.',
    icon: '🗄️',
    packages: ['PostgreSQL.PostgreSQL.16', 'PostgreSQL.pgAdmin', 'dbeaver.dbeaver', 'Redis.RedisInsight'],
  },
  {
    id: 'cli',
    name: 'CLI power-tools',
    description: 'Faster search, nav and inspection at the terminal.',
    icon: '⌨️',
    packages: ['ripgrep', 'fd', 'fzf', 'bat', 'jqlang.jq', 'ajeetdsouza.zoxide', 'lazygit', 'dandavison.delta'],
  },
  {
    id: 'ai',
    name: 'AI / local',
    description: 'Run and build with local models.',
    icon: '🤖',
    packages: ['Ollama.Ollama', 'Microsoft.VisualStudioCode'],
  },
  {
    id: 'collab',
    name: 'Design & collab',
    description: 'The apps a team lives in.',
    icon: '🎨',
    packages: ['Figma.Figma', 'Obsidian.Obsidian', 'SlackTechnologies.Slack', 'Discord.Discord'],
  },
]
