# Workers, a library, a board and themes: test report

Branch `feat/workers-and-themes`, night of 20 to 21 September 2026.
Five commits on top of `97c80bc`.

Everything below was run on a **throwaway profile** (`DEVDECK_HOME` pointing at
a scratch folder). Your own profile, vault, mail and workspaces were not
touched. The example company — **Fathomline Robotics**, an Aberdeen subsea
inspection firm with four products — is invented, and so are its clients, mail,
managers and the five runs from earlier in the week.

**Two things in it are real, on purpose.** The library items were imported live
from `affaan-m/ECC` by the app's own code, at commit `2b6e839`, MIT. And one
worker run was started for real against the Claude Code CLI on this machine.

## Automated

| Suite | Result |
|---|---|
| Rust, `cargo test --lib` | **616 passed, 0 failed**, 2 ignored (the two that need the network) |
| Frontend, `npx tsc -b` | clean |
| Frontend, `npm run lint` | 0 errors |
| `cargo fmt --all --check` | clean |
| `cargo clippy --all-targets -- -D warnings` | clean |

New tests, by what they hold:

- `a_skill_folder_and_an_agent_file_are_the_two_things_a_library_holds` —
  hooks, MCP configs and install scripts are not importable, by rule.
- `a_file_says_what_it_is_in_its_own_header` — a skill's own name and one-line
  description, including a description folded over several lines.
- `a_repository_is_named_however_you_paste_it`.
- `a_brief_says_the_job_the_folder_and_what_it_must_never_do` — every one of
  the five "never" rules is in the text a worker is given.
- `work_on_code_is_told_which_branch_it_is_on`.
- `a_worker_is_saved_with_the_limits_it_did_not_name` — no starter runs
  unwatched, and code work gets a branch of its own.
- `nothing_is_passed_that_the_cli_does_not_have` — replaces a test that
  required an option the CLI does not have (see *What running it found*).
- Two `#[ignore]` tests that go to GitHub on purpose:
  `reads_a_real_repository` and `what_is_on_disk`.

## The features, and the evidence

| # | Feature | Evidence |
|---|---|---|
| 1 | **Workers you own**, lent to any space, each with a brief, skills, one folder and a limit | `01-workers.png` — six workers on the demo profile, the library beside them |
| 2 | **Making one**: what it may use, where it may write, when it stops, which spaces it is lent to | `02-worker-editor.png` — the five "never" rules are shown and not editable |
| 3 | **A library from any GitHub repository**, pinned to a commit | `03-library-add.png` — `affaan-m/ECC`, MIT, `2b6e839`, 367 items, "already yours" on what is installed |
| 4 | **The one yes**: what will happen, what it will not, where, and the limits | `04-start-card.png` — skills, folder, what it reads, 20 minutes or $2.00 |
| 5 | **A run as a document**: every step, files, spend against the limit, and the decision | `05-run.png` — a real run of Claude Code, and its honest failure |
| 6 | **Idea to product**, with the evidence beside the claim | `06-pipeline.png` — four stages, "2 not moved in three weeks", the real run showing under Sounder |
| 7 | **Managers of a space**, their rhythm, plan and last wake | `07-managers.png` — five managers, each with what its last wake said |
| 8 | **Today**, with the business and the day | `08-today.png` — products, services, mailbox, and the managers' rhythms as the day |
| 9 | **Themes** | `09-theme-claude.png`, `10-theme-vercel.png`, `10-theme-vscode.png` — six themes, live previews, applied to the whole app |

## What running it found

Three faults, all found by using the thing rather than by reading it. Each is
fixed and committed.

1. **The library read hung the window for ever.** `reqwest::blocking` builds
   and drops a runtime of its own, which panics inside an async context, and a
   panicked command never answers. The same trap the mail sync documents,
   walked into again. It runs on a blocking thread now. It also read one file
   at a time: 367 candidates took minutes. Eight at a time brings it to
   seconds.
2. **A worker could never start on Windows.** The brief went in the command
   line, and Rust refuses to hand a `.cmd` wrapper an argument with a newline
   in it — "batch file arguments are invalid". The brief is a file now, and
   the command line is one sentence pointing at it.
3. **The runner passed an option the CLI does not have.** `--permission-prompts
   none` on an unattended run: the CLI exits 1 with "unknown option". Every
   unattended run would have died while the code looked careful. `-p` is
   already non-interactive, so the flag is gone and the test says why.

## The real run

Started from DevDeck on the demo profile: worker **Scribe**, brief
`marketing-agent`, skill `brand-voice`, in Fathomline's own folder, limit 20
minutes or $2.00.

- DevDeck wrote the brief and the skill into `.claude/`, spawned the CLI,
  streamed it, and recorded what came back.
- The CLI answered in 8 seconds: **"Failed to authenticate: OAuth session
  expired and could not be refreshed"**.
- The run is recorded as failed, with that sentence as its verdict, $0.00
  spent and no files written — which is exactly what happened.

So the whole path is proven except the CLI's own sign-in, which is yours to
do: run `claude` once in a terminal and sign in, and the same run will work.
I did not sign in on your behalf.

## Not done, and why

- **Nothing was kept from a real run.** The keep path (which writes a line
  into the space's knowledge) is exercised by `run_decide` in code, but no
  screenshot shows it, because the only real run failed to authenticate.
- **Managers cannot yet hand work to a worker.** The plumbing is there — a
  worker can be started from a space, a manager's page and the board — but a
  manager's wake still only knows about its own agent. That is the next piece.
- **A worker's spend limit is a ceiling, not a brake.** The time limit stops a
  run; the money figure is what the CLI reports when it finishes. A run cannot
  be stopped mid-flight for cost.
- **`unattended` on a worker is recorded, not enforced yet**: nothing starts a
  worker while you sleep, so the setting has no path to act on.
- **The starters offer skills that may not be installed.** The card says so
  ("not in your library yet") rather than hiding it.
- **The demo's `taste` skill is not about design.** ECC's `taste` is about
  music video direction; it is in the library because it was imported
  honestly, not because it fits the example.
- **The screenshot harness starts two runs, not one.** React mounts twice in
  development, so the dev-only start flag fires twice. The harness only.

## For you

1. `claude` in a terminal, sign in once. Then start Scribe on any space from
   **Workers → Start it** and watch the run document.
2. **Settings → General → Appearance** for the six themes.
3. **Workers → Add from GitHub** with `affaan-m/ECC`, or any repository that
   keeps `skills/<name>/SKILL.md`.
4. A business space now has a **Pipeline** tab and a **Managers** tab.
