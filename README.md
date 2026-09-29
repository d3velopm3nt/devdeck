<div align="center">

# ❯_ DevDeck

**A local-first development command center for Windows.**

Start your whole stack, watch every service, and jump into any terminal.
Then hand the work itself to a team that keeps going while you sleep.

[![CI](https://github.com/d3velopm3nt/devdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/d3velopm3nt/devdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)
[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/d3velopm3nt)

</div>

---

## What it is

If you work in a monorepo or juggle several apps at once, starting your day
means opening six terminals and remembering six commands. DevDeck turns that
into one click.

It has since grown a second half. A **manager** holds a goal, wakes on a
rhythm, reads the space, decides the next piece of work and hands it to a
**worker**, which builds it on a branch with its tests. You read what happened
on one page and say yes or no. Nothing is merged without you.

It's a desktop app: a Rust/Tauri backend with a React frontend. Your work lives
in plain files on your disk and an SQLite database beside them.

**DevDeck has no backend of its own and reports nothing about you.** It reaches
the network only where you connect it — your mail server, your model provider,
GitHub — and the AI half runs with no API key at all on a built-in mock
provider, which refuses to answer where it cannot answer honestly.

## Running your stack

- **Spaces** — organize work as `Workspace → Project → Folder`. A project is an
  app/repo root with a base path; folders are locations inside it. Commands,
  services, and terminals all run in the right directory automatically.
- **Services** — define long-running processes (dev servers, workers) once, then
  start / stop / restart them with live status, CPU, memory, uptime and ports.
  Give one a port and DevDeck adds one-click **open in browser**.
- **Interactive terminals** — real PTYs (ConPTY) rendered with xterm.js, docked
  as tabs. Sessions live in the backend, so they survive UI reloads.
- **Command Widget** — an always-on-top floating window (global hotkey) that
  collapses to a small icon. Run anything without leaving your editor.
- **Dockable layout** — drag, split, tab, float and resize any panel; layouts
  autosave and restore.
- **Launch profiles** — boot a whole stack (services + terminals + layout) in
  one action.
- **Git, at a glance** — branch, ahead/behind, changes and fetch per project.
- **Machine** — what is installed, via winget and scoop, and what is missing.

## Getting work done

- **Goals** — a goal is a page, not a chat: the standing instruction at the top
  is the sentence a manager actually reads when it wakes, so editing it is how
  you steer. Under it sit the features it owns, their work items, and every
  question anybody is waiting on — each one a button on the thing it is about.
- **Managers** — a manager holds a goal, wakes on a rhythm, reads the space and
  keeps the plan. It proposes work; nothing starts until you agree.
- **Workers** — yours, not a space's: a name, a brief, the skills it may use,
  where it may write, and what it must never do. A worker gets its own git
  worktree and branch, and **never pushes and never merges**.
- **Built, then done** — a worker gets an item to **built**: the files exist, on
  a branch, with its tests, and it stops there. **done** means the work is on
  the main line, which is a merge, which is you pressing a button.
- **Permission you can give in advance** — narrowly. A worker's file may name
  the commands it can run unasked inside its own worktree, with a date the
  permission runs out. Everything else still stops and asks, in the room, with
  ninety seconds to answer.
- **Work items, features and decisions** live as Markdown in the space's own
  `.devdeck` folder. Readable, diffable, and yours if you ever delete the app.
- **Mail, Calendar, Contacts** — IMAP/SMTP with Windows Credential Manager,
  never a password in the database.
- **Stash** — clipboard capture with a classifier that flags secret-shaped
  clips and refuses to write their values to disk.
- **Connections** — run queries against Postgres / SQLite / SQL Server through
  the CLIs you already have, with history.
- **Knowledge** — what a space knows, indexed and searchable, and given to an
  agent as context rather than left for it to guess.

## What changed

DevDeck started as a launcher for services and terminals. Everything in
*Getting work done* above came after, and the last of it is recent:

- **A goal is a page, and the chat is gone.** Goals, Features and Work were
  three lists that all opened the same feature thread, and almost nothing in
  that thread was conversation — a worker's question, a wake report, a receipt,
  each *about a work item* and flattened into prose with the subject lost. Every
  one of those now renders on the thing it belongs to, as something you can
  press.
- **`built` and `done` are two different words.** They used to be one, and a
  plan could read "done" over a repository that had none of the work: the item
  was on a branch nobody had merged. A worker cannot reach `done` any more —
  though an agent session and a manager's own `work.done` still can, which is
  half a job and is written down as one.
- **One branch per goal, not per work item.** Work accumulates on it, so the
  second item starts from the first one's commits instead of re-creating the
  same files from the main line and conflicting with its own siblings.
- **A manager takes the space's feature** instead of inventing a container
  named after itself, so it works *on* the product rather than beside it.
- **A manager woken by a clock arrives as itself** — its goal, its standing
  instructions and its worker travel into the session, which they did not before.
- **A review point reads the act, not the sentence about it.** `stop_at: before
  any push` no longer fires on a message that merely contains the word "push".
- **Speed.** Most of the shell stopped re-rendering on every store write, and
  most commands came off the UI thread. Both are held by a ratchet in
  `npm run lint` so the numbers only come down.

## Install

Grab the latest `DevDeck_x.y.z_x64-setup.exe` from
[Releases](https://github.com/d3velopm3nt/devdeck/releases), or build it yourself.

## Build from source

Requires [Rust](https://rustup.rs) (1.77.2+) and Node.js 20+.

```bash
git clone https://github.com/d3velopm3nt/devdeck.git
cd devdeck
npm install
npm run tauri dev      # run in development
npm run tauri build    # release exe + installer in src-tauri/target/release
```

Checks, all of which CI runs:

```bash
npx tsc -b                                   # typecheck (never `tsc -p`)
npm run lint                                 # oxlint + the performance ratchets
cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings
cd src-tauri && cargo test --workspace
```

## Usage

| Action | How |
|---|---|
| Summon the floating widget | `Ctrl+Shift+Space` (configurable in Settings) |
| Add a project | Explorer → right-click a workspace → **New project**, pick its repo root |
| Add a service | Right-click a project → **New service** (e.g. `pnpm dev:web`, port `3000`) |
| Start everything | Dashboard → click a space → **▶ Start all** |
| Open a running app | Click its port, or the 🌐 button, anywhere it appears |
| Open a terminal there | Right-click any project/folder → **Open terminal here** |
| Steer a manager | Team → Goals → pick one → edit the instruction at the top |
| Agree to proposed work | The violet banner on a goal, or per item |
| Ship what a worker built | **Merge** on the goal — it puts the branch on the main line |

## Where things live

Three places, and the split is deliberate:

| | |
|---|---|
| `%APPDATA%\devdeck\devdeck.sqlite` | the index — spaces, commands, services, profiles, settings |
| `<your vault>/<space>/.devdeck/` | what a space knows: features, work items, decisions, managers. Kept **beside** a repository, never inside it |
| `%APPDATA%\devdeck\assistant\` | what is *yours*: conversations, memory, workers, run receipts. Refuses to be created inside a git repository at all |

Credentials are never in any of them — they go to Windows Credential Manager.

Back up the vault and the personal store; the SQLite file is an index and can
be rebuilt from the tree.

## Shared DevDeck state skill

The portable [`devdeck-state` skill](.claude/skills/devdeck-state/SKILL.md) tells an
assistant how to read and update a vault in a GitHub repo **you choose**. Each
person can create their own private state repo and point the skill to its
`owner/repo`. The skill is an instruction file, not a sync service or a copy of
the vault. No credentials or private vault contents belong in this public source
repo.

- **Claude Code:** the project skill loads when working in this `devdeck` repo;
  invoke `/devdeck-state` explicitly if needed. Set `DEVDECK_STATE_REPO` to
  `owner/repo` in your local environment, or provide that repo in your request.
  For use from other repositories, install a copy in your personal
  `~/.claude/skills/devdeck-state/` folder.
- **ChatGPT:** install the skill folder as a personal skill in each ChatGPT
  account that needs it, with the chosen repo configured in that private copy
  or supplied in the request. A skill installed in one account is not
  automatically shared with another. Connect each account to GitHub with access
  to its state repo; the skill alone does not grant repository access.

Keep this file as the canonical version when changing the workflow, and update
installed copies where applicable. The vault remains useful through GitHub even
without DevDeck desktop or either assistant skill.

## Architecture

```
src/              React 19 + TypeScript (Vite, Tailwind 4, Zustand, dockview)
  components/     panels & pages
  shell/          the rail, top bar, bottom bar — fixed chrome, not dock panels
  widget/         the always-on-top Command Widget window
  lib/            typed IPC, dock controller, tree/space helpers
src-tauri/src/    Rust backend
  db.rs           SQLite (rusqlite) — nodes, commands, services, profiles
  pty.rs          interactive terminals (portable-pty / ConPTY)
  services.rs     service lifecycle & log capture
  monitor.rs      CPU / memory / port sampling (sysinfo + GetExtendedTcpTable)
  git.rs          branch, ahead/behind, fetch, ff-only pull
  mail.rs         IMAP sync, MIME parsing, SMTP send
  creds.rs        Windows Credential Manager — the only place a password exists
  bots.rs         managers: goal, rhythm, plan, who they hand work to
  workers.rs      one worker doing one job is one run, in its own worktree
  schedule.rs     the clock: reminders, routines, wakes
  team.rs         the board — every goal in every space, in one read
  aiw/            the AI Workspace
src-tauri/ask/    devdeck-ask — a tiny separate binary a sealed worker asks
                  through, so a live run never locks the app's own executable
```

The frontend never spawns a process or touches the filesystem directly —
everything goes through typed Tauri commands. Agents reach the machine only
through a permission matrix that fails closed, and an approval genuinely asks a
person rather than quietly refusing.

## Platform support

Windows only, for now. The Windows-specific bits are isolated (ConPTY,
`cmd.exe`, `taskkill`, `explorer.exe`, Credential Manager, WinRT OCR), and a
macOS/Linux port is a very welcome contribution.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
project layout, and the data model. [ROADMAP.md](ROADMAP.md) is what is shipped,
designed and next.

## Support

DevDeck is free and MIT-licensed. If it saves you time, you can
[buy me a coffee](https://www.buymeacoffee.com/d3velopm3nt) ☕ — appreciated, never
expected.

## License

[MIT](LICENSE) © Develtech
