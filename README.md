# DevDeck

A local-first Windows workspace for services, terminals, conversations and reviewable agent work.

[![CI](https://github.com/d3velopm3nt/devdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/d3velopm3nt/devdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Start here

**Development documentation:** this checkout includes the unmerged work in [PR #25](https://github.com/d3velopm3nt/devdeck/pull/25), based on the mobile-companion branch. Library creation, reusable teams and automatic issue dispatch described here are implemented on that branch; this is not a claim that the latest installer includes them.

- [User guide: agents → teams → workflows → review](docs/USER-GUIDE.md)
- [Windows setup and checks](CONTRIBUTING.md)
- [CLI and subscription setup](docs/CLI-SUBSCRIPTION-SETUP.md)
- [Phone pairing, HTTPS and voice](mobile/README.md)
- [Documentation index and current scope](docs/README.md)

## What you can do

- Organize spaces and repositories, run services and commands, and use persistent terminal sessions.
- Talk to **Dev** through Chat, or use the paired phone companion while the desktop is running.
- Open **Agents** to configure workers and specialists, create or import shared skills and agent templates, and assemble reusable teams.
- Open **Work → Team workflows** to define steps, map team roles to configured agents, route an issue and review results.
- Opt into the GitHub issue monitor and dispatch. Dev chooses an existing workflow; the host starts eligible workers using their existing permissions and limits.
- Follow local work, linked GitHub issues and explicit session checkpoints in Activity. A recorded status is not proof that an external assistant is still running.
- Use Mail, Calendar, Stash, Connections and Machine tools with their own configured accounts and prerequisites.

Dev coordinates workers directly. Independent work can run concurrently; dependent steps wait for human acceptance. Saving a library definition or team starts nothing. Workflow acceptance does not merge code, publish changes or update a GitHub issue automatically. Separate worker worktrees do not automatically receive one another's unmerged output.

The app has a Rust/Tauri backend and a React frontend. Files and local stores hold its state; connected providers, GitHub, mail and imported sources use the network when invoked. The mobile bridge is hosted by your desktop, not an always-on cloud service.

## Install or build

Published installers are on [Releases](https://github.com/d3velopm3nt/devdeck/releases). Check their release notes for included features. To test PR #25, check out its source branch explicitly:

```bash
git clone https://github.com/d3velopm3nt/devdeck.git
cd devdeck
git switch feature/folder-workflow-routing
npm ci
npm run tauri dev
```

Use Windows, Node.js 22 (the CI version), current stable Rust, the MSVC build tools/Windows SDK and WebView2. The manifest declares Rust 1.77.2, but CI tests current stable rather than that minimum. See [contributing](CONTRIBUTING.md) for verification commands and build output.

Pull-request CI validates the app with `--no-bundle`; it does **not** package or upload a Windows installer. Main-branch and manual CI can package installers. Release publication is a separate workflow.

## Data and permission boundaries

| Store | Purpose |
|---|---|
| `%APPDATA%\devdeck\devdeck.sqlite` | Local application database, including settings and configured services |
| Selected vault and its `.devdeck` folders | Shared work, workflows, issue snapshots and external session checkpoints |
| `%APPDATA%\devdeck\assistant\` | Personal conversations, configured workers, shared library and run receipts |
| Windows Credential Manager / protected credential storage | Secrets used by connected services |

Vault files and a linked source repository serve different purposes. DevDeck reads the local vault; another assistant's GitHub edits require normal sync before they appear locally. Back up the database, vault and personal store. Do not assume the database can be recreated without losing settings.

Imported and generated definitions are text. Review them before selecting them for an agent; importing does not grant tool access. The same shared skill ID can serve several agents, while each profile explicitly chooses its own skills and tools. External CLI runtimes may also discover their own global or project instructions; this library is not a sandbox for that discovery.

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

## Current limits and next work

Windows is the native target; the mobile companion is a paired web interface. Live desktop worker execution, restart recovery and real phone microphone behavior still require end-to-end acceptance on those devices. Passing mocked browser fixtures and native CI builds does not complete that acceptance.

Proactive briefings, notification sounds/spoken hints and phone push are tracked in [issue #26](https://github.com/d3velopm3nt/devdeck/issues/26). Schedule/routine triggers for this issue-workflow dispatcher, dedicated lead sessions and generic nested team delegation are not delivered by PR #25. Existing manager schedules are a separate path.

See [current scope and historical design notes](ROADMAP.md), [architecture](docs/ARCHITECTURE.md) and [contributing](CONTRIBUTING.md).

## License and support

[MIT](LICENSE) © Develtech. Contributions and focused bug reports are welcome. If DevDeck helps your work, you can [buy me a coffee](https://www.buymeacoffee.com/d3velopm3nt).
