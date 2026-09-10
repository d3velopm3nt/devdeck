# Community — install for your bots, then decide who may use it

**DevDeck · branch `feat/community` · 10 September 2026**

Open-source skills, agents and tools installed from inside the app, landing
where bots and agents actually read them. Built against the design at
`design/community/` and the roadmap entry that goes with it.

| | |
|---|---|
| **Rust suite** | 400 passing, 10 new |
| **Kinds installable** | 3 — skill, agent, tool |
| **Fully usable after granting** | skill, agent |
| **Bugs found by checking** | 1, mine — a tool grant that did not survive a restart |

---

## The claim being tested

> Install open-source agents, skills and tools from the app, and have it land
> on the bots and agents to use.

Four screenshots, in order, each one a state the app was actually in.

---

## 1 · Browse — seven things, and what installing does

![Community Browse: seven cards across skills, agents and tools](1-browse.png)

The rail entry sits **directly above Machine**, and the adjacency is the idea:
Machine installs tools for you, Community installs them for your bots.

Every card carries author, version and licence — licence on every row because
this is meant to be sold, and an AGPL runner inside a bot's kit is a decision
somebody has to make knowingly. And every Install button is followed by the
sentence that the rest of the module is built around:

> **Writes files. Grants nothing.**

---

## 2 · Installed — the state that matters

![Installed tab: two items, both saying no agent can use them](2-installed-ungranted.png)

Two things installed, and the header says the uncomfortable version out loud:

> **2 installed, no agent can use them**

Each row repeats it where a green tick would otherwise go:

> No agent can use this yet. Installing wrote the files; granting is the
> separate step below.

This is the whole design. Installing and granting are two acts, so there is a
state in between — and it is the state a module like this fails in silently. A
row that installed and granted in one click could never show it.

The MCP row carries a second, different limit:

> Declared and grantable, but not callable yet — DevDeck has no MCP client, so
> nothing can run this server.

That is true and it is said on the row, rather than letting a tool look ready
because it appears in a list.

---

## 3 · Granted — reach, not a tick

![Installed tab after granting: in use by dev-a, qa](3-granted.png)

`failure-honesty` → **In use by dev-a, qa**. `MCP fetch` → **In use by dev-a**.
The chips for those agents are lit; the amber header badge is gone, because
nothing is unreachable any more.

Note what did *not* change: the MCP row still says it cannot be called. Granted
and callable are different facts, and the row reports both.

---

## 4 · It landed where the runtime reads

![The Assistant's Skills page listing failure-honesty, used by 2 agents](4-on-the-agent.png)

This is the Assistant's own **Skills** page. It knows nothing about Community —
it existed before this module did. It now lists:

> **failure-honesty** · Never let a failed check look like a success. · **2 agents**

And on disk, `%APPDATA%\devdeck\assistant\agents\dev-a.md`:

```yaml
id: dev-a
name: Developer A
role: developer
provider: boom
model: boom-1
permissions:
  terminal: approval
  git: full
  knowledge: full
  files: full
  process: approval
  tests: full
skills:
- failure-honesty      # ← installed from Community, granted separately
builtin: true
```

Everything else preserved — provider, model, every existing permission, the
body. The grant added one line.

---

## What was found by checking rather than assuming

**The tool grant did not survive a restart, and the screen said it had.**

`failure-honesty` was on disk in `dev-a.md` and `qa.md`. `mcp.fetch` was not
anywhere — and the Installed page cheerfully said *in use by dev-a*.

`Workspace::set_permission` only mutates the in-memory agent list and rebuilds
the tool services. The matrix is persisted separately, as one JSON setting,
which `aiw_set_permission` writes immediately afterwards — and
`community_grant` called the first without the second. So the skill grants were
real and the tool grant was memory-deep.

That is the failure-honesty rule broken by the module that ships a skill about
it. It was caught by reading `aiw.permissions` out of SQLite instead of
trusting the row that said it worked: the screen was the thing under test, so
the screen could not be the evidence.

Fixed in `68d38c3` — `set_tool` pairs them, on granting and on revoking.
Verified the same way:

```
mcp.fetch persisted: True
```

---

## What is deliberately not here

The roadmap entry describes Browse and Trending fed from GitHub, and lists
three things that have to be built first:

1. **A scrape is a dependency on someone else's HTML.** It will break, and the
   list has to say so — an explicit `ok` flag and the last-good timestamp,
   never "nothing is trending" when the truth is "we could not look".
2. **The year needs history DevDeck does not have.** There is no endpoint for
   stars gained over twelve months.
3. **Trending is unfiltered, and this page is not.** That is a manifest
   detection step, with *No manifest* as the honest fallback.

None of it is built. The index here is a starter pack that ships with DevDeck,
and the module is shaped so a GitHub-backed one drops in beside it —
`Item::source` already carries the repository a thing came from. Entries
authored here say **DevDeck** in the author column rather than being filed
under somebody else's repository name, which is the same reason the licence
column exists.

Also not here, and named on the row where it matters: **an MCP client**. Tools
install, appear, and can be granted. Nothing can run one yet.

---

## The tests

10 new, 400 total. The ones worth naming:

| Test | Why it exists |
|---|---|
| `a_fresh_install_reaches_nobody` | The split, in one assertion: files landed, no agent gained anything |
| `a_tool_granted_at_none_is_not_reach` | `none` is stored exactly as a real grant is — counting it would make every install look wired up |
| `a_grant_on_a_different_tool_is_not_this_one` | Reach is about *this* tool, not any grant on the agent |
| `idle_is_about_reach_not_about_age` | Something in use is never nagged about, however old |
| `a_clock_that_went_backwards_is_zero_days_old_not_negative` | Never "installed in the future" |
| `only_a_tool_reports_a_reason_it_cannot_run` | And it names what is missing, not just that something is |
| `the_catalogue_is_internally_consistent` | Every row has a licence, a source, and something to install |

---

**Evidence.** `cargo test` — 400 passed, 0 failed. Screenshots captured from
the running debug build via per-window `PrintWindow`. Agent files quoted
verbatim from `%APPDATA%\devdeck\assistant\agents`. Persistence checked by
reading the `aiw.permissions` setting directly out of `devdeck.sqlite`.
