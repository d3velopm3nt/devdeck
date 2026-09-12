//! Community — open-source AI your bots can use.
//!
//! The pairing is the idea: Machine installs tools for *you*, Community
//! installs them for *your bots*. Three kinds of thing come through it —
//! skills, agents, and tools (MCP servers).
//!
//! **Installing is not granting, and this module is built around that split.**
//! An install writes files. It gives no agent the ability to call anything:
//! every agent lands on `none`, and a separate, deliberate act says who may
//! use it and how. That is why `installed()` reports *reach* — which agents
//! can actually use each item — and why the honest answer for a fresh install
//! is nobody. A page that showed a green tick the moment files landed would be
//! claiming a capability that does not exist yet.
//!
//! **What this slice is not.** The roadmap entry describes Browse and Trending
//! fed from GitHub, and lists three things that have to be built first: a
//! scrape that says so when it breaks, a year of star history DevDeck does not
//! have, and a manifest-detection step. None of that is here. The index is a
//! starter pack that ships with DevDeck, and the module is shaped so a
//! GitHub-backed index drops in beside it — `Item::source` already carries the
//! repository a thing came from.
//!
//! **And a boundary worth stating rather than hiding.** A skill and an agent
//! land as files the runtime already reads, so installing one is genuinely
//! finished: grant it and the model sees it. A tool is an MCP server, and
//! there is no MCP client in this codebase yet. Installing one records the
//! declaration and puts it in the permission matrix, where it can be granted
//! — and it cannot be *called* until the runner exists. `Installed` says that
//! out loud rather than showing a row that looks ready.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::err;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS community_installed (
    -- The catalogue id. One install per item; re-installing replaces.
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    licence TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL,
    -- What this install agreed to run. Recorded rather than looked up, so a
    -- cache that changes cannot change what a granted server executes.
    command TEXT NOT NULL DEFAULT '',
    tool_id TEXT NOT NULL DEFAULT '',
    -- Newline-separated paths this install wrote, so uninstall removes
    -- exactly what was added and nothing a person edited afterwards by hand.
    files TEXT NOT NULL DEFAULT ''
);
";

/// What kind of thing an entry is. Three, deliberately: models and runners are
/// in the design and are not in this slice, and a `Kind` that exists with
/// nothing behind it is a menu item that does nothing.
pub const KIND_SKILL: &str = "skill";
pub const KIND_AGENT: &str = "agent";
pub const KIND_TOOL: &str = "tool";

/// One thing you could install.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Item {
    pub id: String,
    /// skill | agent | tool
    pub kind: String,
    pub name: String,
    /// One line: what it is for, in the words of someone deciding.
    pub summary: String,
    pub author: String,
    /// Where it came from. A starter-pack entry says DevDeck; a GitHub-backed
    /// index would put the repository here.
    pub source: String,
    /// permissive | copyleft | restricted | missing — shown on every row,
    /// because this is meant to be sold and an AGPL runner inside a bot's kit
    /// is a decision somebody has to make knowingly.
    pub licence: String,
    pub version: String,
    /// The instructions, for a skill or an agent.
    #[serde(default)]
    pub body: String,
    /// An agent's role: architect | developer | qa | reviewer, or its own.
    #[serde(default)]
    pub role: String,
    /// A tool's id in the permission matrix.
    #[serde(default)]
    pub tool_id: String,
    /// What a tool would run, once there is a runner to run it. Recorded now
    /// so the trust modal has something concrete to show.
    #[serde(default)]
    pub command: String,
    /// Total stars, when the source reports one.
    ///
    /// `None` is not zero. A registry entry has no star count at all, and a
    /// repository with no stars has one that happens to be nothing — ranking
    /// the first as if it were the second puts every registry entry at the
    /// bottom of a list it was never in.
    #[serde(default)]
    pub stars: Option<i64>,
    /// Stars gained over whatever window this row belongs to.
    ///
    /// Deliberately a different field from `stars`, because they answer
    /// different questions: a trending row's "+1,204 this week" and a search
    /// row's "41,234 in total" are not comparable, and one sort offering both
    /// under "Most starred" would be a lie with a tidy label.
    #[serde(default)]
    pub gained: Option<i64>,
}

/// A row of `community_installed`, as stored.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Installed {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub licence: String,
    /// Unix millis.
    pub at: i64,
    pub files: Vec<String>,
    /// What this install agreed to run, recorded at install time.
    ///
    /// Not re-derived from the index later. The index is a cache that changes
    /// under you — a registry entry can be republished or withdrawn — and the
    /// thing somebody read in the trust modal is the thing that should still
    /// run tomorrow. It also used to be derivable only for the starter
    /// catalogue, which is why a registry entry could install and then never
    /// become a callable tool.
    #[serde(default)]
    pub command: String,
    /// Its id in the permission matrix.
    #[serde(default)]
    pub tool_id: String,
}

/// An installed item, plus the thing the Installed page exists to say.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Standing {
    #[serde(flatten)]
    pub installed: Installed,
    /// Agents that can actually use it right now. Empty is the normal state
    /// straight after an install, and the page says so rather than implying
    /// the install achieved something it did not.
    pub reach: Vec<String>,
    /// Whole days since it was installed.
    pub days: i64,
    /// True when it has been sitting there unreachable long enough to be worth
    /// mentioning. Not an error — a decision nobody has made yet.
    pub idle: bool,
    /// Why it cannot be called even when granted, or empty when it can.
    pub blocked: String,
}

/// After how many days an unreachable install is worth pointing at.
///
/// Long enough that installing something and granting it tomorrow is not
/// nagged at; short enough that a thing nobody ever wired up gets noticed.
const IDLE_DAYS: i64 = 3;

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/// The starter pack: what ships with DevDeck.
///
/// Authored here rather than scraped, and `author` says so. That matters —
/// putting DevDeck's own wording under someone else's repository name would be
/// misattribution, and the whole point of the licence column is that people
/// can tell whose work they are installing.
pub fn catalog() -> Vec<Item> {
    let devdeck = |id: &str,
                   kind: &str,
                   name: &str,
                   summary: &str,
                   body: &str|
     -> Item {
        Item {
            id: id.into(),
            kind: kind.into(),
            name: name.into(),
            summary: summary.into(),
            author: "DevDeck".into(),
            source: "https://github.com/d3velopm3nt/devdeck".into(),
            licence: "permissive".into(),
            version: "1.0.0".into(),
            body: body.into(),
            ..Default::default()
        }
    };

    vec![
        devdeck(
            "skill.conventional-commits",
            KIND_SKILL,
            "conventional-commits",
            "Write commit messages in the Conventional Commits format.",
            "When you write a commit message, use Conventional Commits:\n\n\
             `type(scope): summary` where type is one of feat, fix, docs, style,\n\
             refactor, test, chore. The summary is imperative and lower case, and\n\
             it does not end in a full stop.\n\n\
             Explain *why* in the body, not what — the diff already says what.\n\
             A commit that needs no body is allowed to have none.",
        ),
        devdeck(
            "skill.failure-honesty",
            KIND_SKILL,
            "failure-honesty",
            "Never let a failed check look like a success.",
            "Never let a failed check look like a success.\n\n\
             When something cannot be determined, say that, and say it in the\n\
             place the answer would have gone. An empty list means \"there is\n\
             nothing\"; it must never mean \"we could not look\". Carry an\n\
             explicit ok flag rather than inferring success from the absence of\n\
             an error, and keep the last known-good answer on screen with the\n\
             time it was taken.",
        ),
        devdeck(
            "skill.small-diffs",
            KIND_SKILL,
            "small-diffs",
            "Change one thing at a time, and say what you did not change.",
            "Change one thing at a time.\n\n\
             When a task turns out to need two unrelated changes, do the one you\n\
             were asked for and say plainly what else you found. A diff that\n\
             fixes a bug and reformats a file is two reviews pretending to be\n\
             one, and the formatting hides the fix.",
        ),
        Item {
            role: "reviewer".into(),
            ..devdeck(
                "agent.docs-writer",
                KIND_AGENT,
                "docs-writer",
                "Turns a finished change into documentation someone can act on.",
                "You write documentation for changes that have already landed.\n\n\
                 Read the diff and the tests before you write a word — the tests\n\
                 say what the change actually guarantees, which is usually\n\
                 narrower than the commit message claims.\n\n\
                 Write for someone who has the problem, not for someone\n\
                 admiring the solution. Lead with what they can now do.\n\n\
                 You do not change code. If the documentation cannot be written\n\
                 honestly because the behaviour is wrong, say so instead of\n\
                 describing the wrong behaviour well.",
            )
        },
        Item {
            role: "reviewer".into(),
            ..devdeck(
                "agent.dependency-auditor",
                KIND_AGENT,
                "dependency-auditor",
                "Reads what a project depends on and reports what it costs.",
                "You audit dependencies.\n\n\
                 For each one: what it is for, its licence, when it was last\n\
                 released, and whether anything in this project would break\n\
                 without it. Say which are load-bearing and which are one import\n\
                 in one file.\n\n\
                 Report, do not remove. A dependency that looks unused may be\n\
                 pulled in by a build step you cannot see from the manifest, and\n\
                 finding that out is the maintainer's call to make.",
            )
        },
        // One MCP server, and it is one that has actually been run against
        // this client: handshake, tools/list, the lot. The starter pack used
        // to carry two, and one of them named an npm package that does not
        // exist — `@modelcontextprotocol/server-fetch` is a 404, and nobody
        // would have found out until they clicked Install.
        //
        // It does not need to be a catalogue of servers any more. Discover
        // reads the official registry, which is where servers actually
        // publish themselves.
        Item {
            tool_id: "mcp.memory".into(),
            command: "npx -y @modelcontextprotocol/server-memory".into(),
            licence: "permissive".into(),
            author: "Anthropic".into(),
            source: "https://github.com/modelcontextprotocol/servers".into(),
            ..devdeck(
                "tool.mcp-memory",
                KIND_TOOL,
                "MCP memory",
                "A knowledge graph an agent can write to and read back later.",
                "",
            )
        },
    ]
}

/// One catalogue entry by id.
pub fn item(id: &str) -> Option<Item> {
    catalog().into_iter().find(|i| i.id == id)
}

/// Can this entry be installed at all, and if not, why not?
///
/// A registry entry declares how to run it, so it can. A GitHub search or
/// trending row declares nothing — that is the manifest problem, and the
/// honest answer is a sentence rather than an Install button that writes a row
/// nothing can ever use.
pub fn installable(i: &Item) -> Result<(), String> {
    match i.kind.as_str() {
        KIND_SKILL | KIND_AGENT => {
            if i.body.trim().is_empty() {
                Err("this entry carries no instructions, so installing it would write an empty \
                     file. That is the manifest problem, not something to guess at."
                    .into())
            } else {
                Ok(())
            }
        }
        KIND_TOOL => {
            if i.command.trim().is_empty() {
                Err("nothing here says how to run it. A repository is not a server declaration \
                     — DevDeck would have to guess a command, and a guess is how you end up \
                     running something nobody chose."
                    .into())
            } else if i.tool_id.trim().is_empty() {
                Err("this entry has no tool id, so it could not appear in the permission matrix \
                     and nothing could ever be granted it."
                    .into())
            } else {
                Ok(())
            }
        }
        other => Err(format!("unknown kind '{other}'")),
    }
}

/// Would installing this collide with something already installed?
///
/// Two servers can slug to the same tool id — `Notes` and `notes!` both become
/// `mcp.notes`. Left alone, a grant meant for one would silently apply to the
/// other, which is the permission matrix quietly meaning something other than
/// what it says.
pub fn collision(entry: &Item, installed: &[Installed]) -> Option<String> {
    if entry.tool_id.trim().is_empty() {
        return None;
    }
    installed
        .iter()
        .find(|i| i.id != entry.id && !i.tool_id.is_empty() && i.tool_id == entry.tool_id)
        .map(|clash| {
            format!(
                "'{}' is already installed and uses the same permission id ({}). Granting one \
                 would grant the other, so this one is refused rather than shadowing it.",
                clash.name, entry.tool_id
            )
        })
}

// ---------------------------------------------------------------------------
// One repo, in full
// ---------------------------------------------------------------------------
//
// The design's page shows contributors, a readme, a version history and a
// verified requirements list. Most of that is data DevDeck does not have, and
// the honest page is the one built from what it does:
//
//  * What the row says about itself — name, licence, stars, where it came from.
//  * **What it actually gives your bots.** Not guessed from a manifest: an MCP
//    server declares its tools when it starts, so this is the real list, read
//    over the protocol, or an explicit reason why it could not be read.
//  * Who can use it, from the permission matrix rather than from the install.
//  * What it needs to run, checked against this machine.
//
// The thing it deliberately does not have is the design's "What it can reach"
// list. That comes from a manifest nobody verifies, and a page that printed it
// under DevDeck's own heading would be lending authority to a claim it had not
// checked. The tool list below is the honest version of the same question.

/// Something the command needs before it can run.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Need {
    pub what: String,
    /// Checked against this machine, not read from a manifest.
    pub present: bool,
    /// How to get it, when it is missing.
    pub hint: String,
}

/// Everything known about one entry, gathered in one call.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Repo {
    pub item: Item,
    /// Which list it was found in: `catalog`, or an index source.
    pub found_in: String,
    pub installed: Option<Installed>,
    /// The tools the server declares, read from the running server.
    pub tools: Vec<crate::mcp::McpTool>,
    /// Why `tools` is empty. Empty string when it is not — "no tools" and "we
    /// could not ask" are different facts and the page shows which one it has.
    pub tools_note: String,
    /// Agent id to level, for this item's tool id. Empty for a skill or an
    /// agent, which are not rows in the matrix.
    pub grants: Vec<(String, String)>,
    /// What the command needs, checked against this machine.
    pub needs: Vec<Need>,
}

/// Find one entry by id, across the catalogue and every cached index.
///
/// The catalogue wins when both have it: a starter entry carries a body and a
/// tool id, and an index row with the same id carries neither, so preferring
/// the index would lose the half that makes it installable.
pub fn find_item(id: &str, catalog: &[Item], feeds: &[(String, Vec<Item>)]) -> Option<(Item, String)> {
    if let Some(i) = catalog.iter().find(|i| i.id == id) {
        return Some((i.clone(), "catalog".to_string()));
    }
    for (source, items) in feeds {
        if let Some(i) = items.iter().find(|i| i.id == id) {
            return Some((i.clone(), source.clone()));
        }
    }
    None
}

/// The program a command needs, and how somebody would get it.
///
/// Pure, so the mapping is checkable without a PATH to look at. Returns
/// nothing for a command whose runner we do not recognise — better an absent
/// row than a confident "not installed" about a thing we cannot name.
/// The probe is the command's **own** program, not a stand-in for it.
///
/// It used to answer "node" for an `npx` command, which read as a green tick
/// beside "could not start 'npx'" — two checks disagreeing on one screen,
/// because only one of them was asking about the thing that actually runs.
pub fn runner_of(command: &str) -> Option<(String, &'static str, &'static str)> {
    // The same quote-aware split the runner itself uses, so what is named here
    // is what would actually be executed. Splitting on whitespace read a
    // quoted path under Program Files as a program called `C:\Program`.
    let (first, _) = crate::mcp::split_command(command)?;
    // `npx.cmd` on Windows, `npx` elsewhere.
    let bare = first.rsplit(['/', '\\']).next().unwrap_or(&first);
    let bare = bare.split('.').next().unwrap_or(bare);
    let probe = bare.to_string();
    match bare.to_ascii_lowercase().as_str() {
        "npx" | "npm" | "node" => Some((probe, "Node.js", "winget install OpenJS.NodeJS.LTS")),
        "uvx" | "uv" => Some((probe, "uv", "winget install astral-sh.uv")),
        "python" | "python3" => Some((probe, "Python", "winget install Python.Python.3.12")),
        "docker" => Some((probe, "Docker", "winget install Docker.DockerDesktop")),
        _ => None,
    }
}

/// Why the tool list is empty, in the words of somebody deciding what to do.
///
/// Four states, not two. "It is not a server", "it is not installed",
/// "we could not start it" and "it started and declares nothing" are different
/// facts, and only one of them is a problem to fix.
pub fn tools_note(kind: &str, installed: bool, err: Option<&str>, found: usize) -> String {
    if kind != KIND_TOOL {
        return format!(
            "A {kind} is instructions, not a server — it has no tools of its own. Granting it \
             puts its text in front of an agent."
        );
    }
    if !installed {
        return "A server declares its tools when it starts, so this list is only knowable \
                once it is installed. Nothing here is guessed from a manifest."
            .into();
    }
    if let Some(e) = err {
        return format!("Installed, but it would not start, so its tools could not be read — {e}");
    }
    if found == 0 {
        return "It started and declared no tools at all. That is the server's answer, not a \
                failure to ask."
            .into();
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Bundles — a kit, and the grants it suggests
// ---------------------------------------------------------------------------
//
// A bundle is several things installed together. The roadmap flags the tension
// it creates: a Community bundle *also carries grants*, and this module exists
// to keep installing and granting apart.
//
// So a bundle does not grant. It installs its items, and then hands back the
// grants it *proposes* — named, one line each, for a person to accept in a
// single deliberate step or not at all. The split survives, and the
// convenience survives with it: one review instead of six clicks, which is a
// different thing from no review.

/// One grant a bundle suggests. Never applied by installing.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Suggestion {
    /// Catalogue id of the installed thing.
    pub item: String,
    pub agent: String,
    /// none | read | approval | full. A skill ignores it; its grant is binary.
    pub level: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Bundle {
    pub id: String,
    pub name: String,
    pub summary: String,
    /// Catalogue ids.
    pub items: Vec<String>,
    pub grants: Vec<Suggestion>,
}

/// What installing a bundle would do, worked out before anything happens.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Plan {
    pub bundle: String,
    /// Not installed yet; these would be written.
    pub to_install: Vec<String>,
    /// Already installed; left alone rather than reinstalled.
    pub already: Vec<String>,
    /// Named in the bundle and not in the index. Shown rather than skipped
    /// silently — a bundle pointing at something that does not exist is a
    /// broken bundle, and the person choosing it should be told.
    pub missing: Vec<String>,
    /// The grants it would then offer. Still not applied.
    pub grants: Vec<Suggestion>,
    /// Grants naming an agent this machine does not have. Kept out of `grants`
    /// so nothing is offered that cannot be granted.
    pub unknown_agents: Vec<String>,
}

pub fn bundles() -> Vec<Bundle> {
    vec![
        Bundle {
            id: "bundle.careful-dev".into(),
            name: "A careful developer".into(),
            summary: "The three habits worth having before an agent touches a repository: \
                      small diffs, honest failures, and commit messages someone can read."
                .into(),
            items: vec![
                "skill.small-diffs".into(),
                "skill.failure-honesty".into(),
                "skill.conventional-commits".into(),
            ],
            grants: vec![
                Suggestion { item: "skill.small-diffs".into(), agent: "dev-a".into(), level: String::new() },
                Suggestion { item: "skill.failure-honesty".into(), agent: "dev-a".into(), level: String::new() },
                Suggestion { item: "skill.conventional-commits".into(), agent: "dev-a".into(), level: String::new() },
            ],
        },
        Bundle {
            id: "bundle.reviewer".into(),
            name: "A second opinion".into(),
            summary: "Two agents that read rather than write: one documents what landed, \
                      one reports what the dependencies cost."
                .into(),
            items: vec!["agent.docs-writer".into(), "agent.dependency-auditor".into()],
            grants: Vec::new(),
        },
        Bundle {
            id: "bundle.memory".into(),
            name: "Something to remember with".into(),
            summary: "A knowledge graph an agent can write to and read back later, and the \
                      habit of being honest about what it could not find."
                .into(),
            items: vec!["tool.mcp-memory".into(), "skill.failure-honesty".into()],
            grants: vec![
                // A server's first grant asks rather than deciding: nobody has
                // watched this one run yet.
                Suggestion { item: "tool.mcp-memory".into(), agent: "dev-a".into(), level: "approval".into() },
                Suggestion { item: "skill.failure-honesty".into(), agent: "dev-a".into(), level: String::new() },
            ],
        },
    ]
}

/// Work out what a bundle would do, given what is installed and who exists.
///
/// Pure, so the awkward cases are checkable: a bundle naming something that
/// has left the index, and one naming an agent this machine does not have.
pub fn plan(b: &Bundle, installed: &[Installed], agents: &[String]) -> Plan {
    let have = |id: &str| installed.iter().any(|i| i.id == id);
    let known = |a: &str| agents.iter().any(|x| x.eq_ignore_ascii_case(a));

    let mut to_install = Vec::new();
    let mut already = Vec::new();
    let mut missing = Vec::new();
    for id in &b.items {
        if item(id).is_none() {
            missing.push(id.clone());
        } else if have(id) {
            already.push(id.clone());
        } else {
            to_install.push(id.clone());
        }
    }

    let mut grants = Vec::new();
    let mut unknown_agents = Vec::new();
    for g in &b.grants {
        // A grant for an item the bundle cannot install is not offered: it
        // would point at nothing.
        if missing.contains(&g.item) {
            continue;
        }
        if known(&g.agent) {
            grants.push(g.clone());
        } else if !unknown_agents.contains(&g.agent) {
            unknown_agents.push(g.agent.clone());
        }
    }

    Plan {
        bundle: b.id.clone(),
        to_install,
        already,
        missing,
        grants,
        unknown_agents,
    }
}

// ---------------------------------------------------------------------------
// Pure decisions, kept out of the database so they can be checked
// ---------------------------------------------------------------------------

/// Which agents can actually use an installed item right now.
///
/// A skill reaches an agent when that agent lists it; a tool reaches one when
/// the permission matrix says anything other than `none`. An agent reaches
/// itself — it exists, so it is usable — which is the one case where installing
/// really is enough.
pub fn reach(
    kind: &str,
    name: &str,
    tool_id: &str,
    agents: &[(String, Vec<String>, Vec<(String, String)>)],
) -> Vec<String> {
    let mut out = Vec::new();
    for (id, skills, perms) in agents {
        let hit = match kind {
            KIND_SKILL => skills.iter().any(|s| s.eq_ignore_ascii_case(name)),
            KIND_TOOL => perms
                .iter()
                .any(|(t, level)| t == tool_id && level != "none" && !level.is_empty()),
            // An installed agent is reachable by being itself, and by nobody
            // else — "which agents can use this agent" is a question about
            // delegation, not about installing.
            KIND_AGENT => id.eq_ignore_ascii_case(name),
            _ => false,
        };
        if hit {
            out.push(id.clone());
        }
    }
    out
}

/// Whole days between two instants, floored, never negative.
///
/// A clock that has gone backwards since the install — a timezone change, a
/// corrected system time — reads as zero rather than as a negative age, so the
/// Installed page never says something was installed in the future.
pub fn days_since(at_ms: i64, now_ms: i64) -> i64 {
    if now_ms <= at_ms {
        return 0;
    }
    (now_ms - at_ms) / 86_400_000
}

/// Why an item cannot be called even after it is granted, or empty when it can.
///
/// It used to say, for every tool, that DevDeck had no MCP client. It has one
/// now, so the sentence is gone rather than softened — a caveat kept past the
/// day it stopped being true teaches people to skip caveats.
///
/// The function stays because the question does: a runner that will not start,
/// a server whose command is missing. Those answers belong here when they
/// exist, and until then the honest answer is silence.
pub fn blocked_reason(_kind: &str) -> String {
    String::new()
}

/// Turn a stored row plus the current agent list into what the page shows.
pub fn standing(
    installed: Installed,
    agents: &[(String, Vec<String>, Vec<(String, String)>)],
    now_ms: i64,
) -> Standing {
    let reach = reach(&installed.kind, &installed.name, &tool_id_of(&installed), agents);
    let days = days_since(installed.at, now_ms);
    Standing {
        idle: reach.is_empty() && days >= IDLE_DAYS,
        blocked: blocked_reason(&installed.kind),
        reach,
        days,
        installed,
    }
}

/// A stored row does not carry the catalogue's `tool_id`, so it is looked back
/// up. An item that has left the catalogue keeps its files and loses its
/// reach, which is honest: we can no longer say what it was wired to.
fn tool_id_of(i: &Installed) -> String {
    item(&i.id).map(|c| c.tool_id).unwrap_or_default()
}

/// The MCP servers that are installed, as the runtime wants them.
///
/// Read from the catalogue rather than stored: the command a server runs is
/// the index's to say, and an install that had frozen its own copy would go on
/// running last month's command after the entry was corrected.
pub fn servers(installed: &[Installed]) -> Vec<crate::mcp::ServerSpec> {
    installed
        .iter()
        .filter(|i| i.kind == KIND_TOOL)
        .filter_map(|i| {
            // The row first. Falling back to the catalogue keeps rows written
            // before the columns existed working, rather than making an
            // upgrade quietly unregister somebody's granted server.
            let (tool_id, command) = if i.tool_id.is_empty() && i.command.is_empty() {
                let entry = item(&i.id)?;
                (entry.tool_id, entry.command)
            } else {
                (i.tool_id.clone(), i.command.clone())
            };
            if command.trim().is_empty() {
                return None;
            }
            let id = crate::mcp::server_of(&tool_id)?.to_string();
            Some(crate::mcp::ServerSpec {
                id,
                name: i.name.clone(),
                command,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

pub fn all(conn: &Connection) -> Result<Vec<Installed>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, name, version, source, licence, at, files, command, tool_id \
             FROM community_installed ORDER BY at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let files: String = r.get(7)?;
            Ok(Installed {
                id: r.get(0)?,
                kind: r.get(1)?,
                name: r.get(2)?,
                version: r.get(3)?,
                source: r.get(4)?,
                licence: r.get(5)?,
                at: r.get(6)?,
                files: files.lines().filter(|l| !l.is_empty()).map(String::from).collect(),
                command: r.get(8)?,
                tool_id: r.get(9)?,
            })
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

pub fn record(conn: &Connection, i: &Installed) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO community_installed \
         (id, kind, name, version, source, licence, at, files, command, tool_id) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            i.id,
            i.kind,
            i.name,
            i.version,
            i.source,
            i.licence,
            i.at,
            i.files.join("\n"),
            i.command,
            i.tool_id
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn forget(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM community_installed WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands — the only thing the UI can call
// ---------------------------------------------------------------------------
//
// Everything here goes through `Workspace`, never `PersonalStore` directly.
// The workspace's own `save_skill` / `save_agent` reload the agent list
// afterwards, and agents embed skill bodies at load — so writing the file
// without that reload would put a skill on disk that no running agent could
// see until the next restart.

use std::sync::Arc;

use crate::aiw::state::Workspace;
use crate::db::Db;

type Ws<'a> = tauri::State<'a, Arc<Workspace>>;

/// A catalogue row with what we know about it locally folded in.
#[derive(Serialize, Clone, Debug)]
pub struct Listing {
    #[serde(flatten)]
    pub item: Item,
    pub installed: bool,
    /// Present only when installed.
    pub standing: Option<Standing>,
}

/// The agent shape `reach` wants, read once from the live workspace.
fn agent_view(ws: &Arc<Workspace>) -> Vec<(String, Vec<String>, Vec<(String, String)>)> {
    ws.agents()
        .into_iter()
        .map(|a| (a.id, a.skills, a.permissions.into_iter().collect::<Vec<_>>()))
        .collect()
}

/// Tell the workspace which MCP servers exist, so its tool services can reach
/// them. Called after anything that changes the installed set — and at
/// startup, where nothing else would.
pub fn sync_servers(db: &Db, ws: &Arc<Workspace>) -> Result<(), String> {
    let rows = {
        let conn = db.0.lock().unwrap();
        all(&conn)?
    };
    ws.set_mcp_servers(servers(&rows));
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Everything you could install, and what has been.
#[tauri::command]
pub fn community_catalog(db: tauri::State<Db>, ws: Ws) -> Result<Vec<Listing>, String> {
    let installed = {
        let conn = db.0.lock().unwrap();
        all(&conn)?
    };
    let agents = agent_view(&ws);
    let now = now_ms();
    Ok(catalog()
        .into_iter()
        .map(|item| {
            let row = installed.iter().find(|i| i.id == item.id).cloned();
            Listing {
                installed: row.is_some(),
                standing: row.map(|r| standing(r, &agents, now)),
                item,
            }
        })
        .collect())
}

/// What is installed, and whether anything can actually use it.
#[tauri::command]
pub fn community_installed(db: tauri::State<Db>, ws: Ws) -> Result<Vec<Standing>, String> {
    let rows = {
        let conn = db.0.lock().unwrap();
        all(&conn)?
    };
    let agents = agent_view(&ws);
    let now = now_ms();
    Ok(rows.into_iter().map(|r| standing(r, &agents, now)).collect())
}

/// Install one catalogue entry.
///
/// Writes files and records the install. It grants nothing: a new agent has an
/// empty permission map, which the matrix reads as `none` on every tool, and a
/// skill is written where the runtime can find it without being added to
/// anybody. The separate act is `community_grant`, and keeping the two apart
/// is the whole design.
#[tauri::command]
pub fn community_install(db: tauri::State<Db>, ws: Ws, id: String) -> Result<Standing, String> {
    // Resolved against the catalogue *and* every cached index, so a registry
    // entry can be installed from Discover. It used to look only in the
    // starter catalogue, which made the whole index read-only.
    let (entry, rows) = {
        let conn = db.0.lock().unwrap();
        let rows = all(&conn)?;
        let feeds: Vec<(String, Vec<Item>)> = crate::community_index::SOURCES
            .iter()
            .map(|src| {
                let f = crate::community_index::cached(&conn, src);
                (f.source, f.items)
            })
            .collect();
        let (entry, _) = find_item(&id, &catalog(), &feeds).ok_or_else(|| {
            format!("nothing in the catalogue or any cached index called '{id}'")
        })?;
        (entry, rows)
    };

    // Two refusals rather than a row that could never work: an entry with no
    // way to run it, and one whose permission id is already somebody else's.
    installable(&entry)?;
    if let Some(clash) = collision(&entry, &rows) {
        return Err(clash);
    }

    let mut files = Vec::new();
    match entry.kind.as_str() {
        KIND_SKILL => {
            ws.save_skill(&crate::aiw::deck::Doc {
                meta: crate::aiw::personal::SkillMeta {
                    name: entry.name.clone(),
                    description: entry.summary.clone(),
                },
                body: entry.body.clone(),
            })?;
            files.push(format!("skills/{}.md", entry.name));
        }
        KIND_AGENT => {
            // No permissions at all, deliberately. An installed agent that
            // arrived able to touch the machine would be an install granting
            // itself, which is the one thing this module exists to prevent.
            ws.save_agent(&crate::aiw::deck::Doc {
                meta: crate::aiw::personal::AgentMeta {
                    id: entry.name.clone(),
                    name: entry.name.clone(),
                    role: entry.role.clone(),
                    ..Default::default()
                },
                body: entry.body.clone(),
            })?;
            files.push(format!("agents/{}.md", entry.name));
        }
        KIND_TOOL => {
            // Nothing on disk. A tool is a declaration until there is a runner
            // to run it, and writing a file nothing reads would be theatre.
        }
        other => return Err(format!("unknown kind '{other}'")),
    }

    let row = Installed {
        id: entry.id.clone(),
        kind: entry.kind.clone(),
        name: entry.name.clone(),
        version: entry.version.clone(),
        source: entry.source.clone(),
        licence: entry.licence.clone(),
        at: now_ms(),
        files,
        // Recorded, not looked up later: the command somebody read in the
        // trust modal is the one that should still run tomorrow.
        command: entry.command.clone(),
        tool_id: entry.tool_id.clone(),
    };
    {
        let conn = db.0.lock().unwrap();
        record(&conn, &row)?;
    }
    sync_servers(&db, &ws)?;
    let agents = agent_view(&ws);
    Ok(standing(row, &agents, now_ms()))
}

/// Remove an install: the thing it wrote, and the grants that pointed at it.
///
/// Revoking first matters. A permission row naming a tool that is no longer
/// installed is a grant to nothing, and it would come back the moment the tool
/// was reinstalled — silently re-granting something a person had removed.
#[tauri::command]
pub fn community_uninstall(db: tauri::State<Db>, ws: Ws, id: String) -> Result<(), String> {
    let row = {
        let conn = db.0.lock().unwrap();
        all(&conn)?.into_iter().find(|i| i.id == id)
    };
    let Some(row) = row else { return Ok(()) };
    let entry = item(&id);

    match row.kind.as_str() {
        KIND_SKILL => {
            for a in ws.agents() {
                if a.skills.iter().any(|s| s.eq_ignore_ascii_case(&row.name)) {
                    let _ = set_skill(&ws, &a.id, &row.name, false);
                }
            }
            ws.delete_skill(&row.name)?;
        }
        KIND_AGENT => {
            ws.delete_agent(&row.name)?;
        }
        KIND_TOOL => {
            if let Some(e) = &entry {
                for a in ws.agents() {
                    if a.permissions.get(&e.tool_id).is_some_and(|p| p != "none") {
                        set_tool(&db, &ws, &a.id, &e.tool_id, "none")?;
                    }
                }
            }
        }
        _ => {}
    }

    {
        let conn = db.0.lock().unwrap();
        forget(&conn, &id)?;
    }
    // A server whose install is gone must stop being reachable *and* stop
    // running: the process would otherwise outlive the only thing that knew
    // why it was there.
    if let Some(e) = &entry {
        if let Some(server) = crate::mcp::server_of(&e.tool_id) {
            ws.mcp.stop(server);
        }
    }
    sync_servers(&db, &ws)
}

/// Change a tool permission *and* write the matrix down.
///
/// `Workspace::set_permission` only touches the in-memory list and rebuilds
/// the tool services; the whole matrix is persisted separately, as one JSON
/// setting. Calling the first without the second gives a grant that works
/// until the next restart and then silently is not there — the Installed page
/// would go on saying "in use by dev-a" about a permission that no longer
/// exists. `aiw_set_permission` pairs them for the same reason.
fn set_tool(
    db: &tauri::State<Db>,
    ws: &Arc<Workspace>,
    agent_id: &str,
    tool: &str,
    level: &str,
) -> Result<(), String> {
    ws.set_permission(agent_id, tool, level)?;
    let json = serde_json::to_string(&ws.permission_grants()).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    crate::db::setting_set_conn(&conn, crate::aiw::commands::PERMISSIONS_KEY, &json)
}

/// Add or remove a skill on one agent, through the agent's own file.
///
/// Its own function because both granting and uninstalling need it, and a
/// second copy of "read the doc, edit the list, save it" is a second place for
/// the case-insensitive match to be got wrong.
fn set_skill(ws: &Arc<Workspace>, agent_id: &str, skill: &str, on: bool) -> Result<(), String> {
    let mut doc = ws.agent_doc(agent_id)?;
    let has = doc.meta.skills.iter().any(|s| s.eq_ignore_ascii_case(skill));
    if on == has {
        return Ok(());
    }
    if on {
        doc.meta.skills.push(skill.to_string());
    } else {
        doc.meta.skills.retain(|s| !s.eq_ignore_ascii_case(skill));
    }
    ws.save_agent(&doc)
}

/// The index, from every source, cache-first.
///
/// Never fetches. Opening the page must not spend a rate limit, and a list
/// that refetched on every visit would be unusable at ten searches a minute.
#[tauri::command]
pub fn community_index(db: tauri::State<Db>) -> Vec<crate::community_index::Feed> {
    let conn = db.0.lock().unwrap();
    let mut feeds: Vec<_> = crate::community_index::SOURCES
        .iter()
        .map(|s| crate::community_index::describe(crate::community_index::cached(&conn, s)))
        .collect();
    // The year is computed, not fetched, so it is never cached and never
    // stale — it is whatever the readings say right now.
    feeds.push(crate::community_index::describe(
        crate::community_index::year_feed(&conn, now_ms()),
    ));
    feeds
}

/// Go and look. Deliberately a button rather than something that happens on
/// its own: this is the only outbound call the module makes, and it should be
/// somebody's decision rather than a surprise in a network log.
#[tauri::command]
pub async fn community_refresh_index(
    app: tauri::AppHandle,
    source: Option<String>,
) -> Result<Vec<crate::community_index::Feed>, String> {
    // Every source here is an HTTP request to GitHub. Refreshing the index
    // from the UI thread froze the window for the length of the slowest one.
    //
    // The database cannot cross a thread boundary by value, so the worker asks
    // the app handle for the same managed instance the command would have been
    // given.
    tauri::async_runtime::spawn_blocking(move || {
        let db = <tauri::AppHandle as tauri::Manager<tauri::Wry>>::state::<Db>(&app);
        refresh_index_now(&db, source)
    })
    .await
    .map_err(|e| format!("the refresh did not finish: {e}"))?
}

fn refresh_index_now(
    db: &Db,
    source: Option<String>,
) -> Result<Vec<crate::community_index::Feed>, String> {
    let wanted: Vec<String> = match source {
        Some(s) => vec![s],
        None => crate::community_index::SOURCES
            .iter()
            .map(|s| s.to_string())
            .collect(),
    };
    let conn = db.0.lock().unwrap();
    let mut feeds: Vec<_> = wanted
        .iter()
        .map(|s| crate::community_index::describe(crate::community_index::refresh(&conn, s)))
        .collect();
    feeds.push(crate::community_index::describe(
        crate::community_index::year_feed(&conn, now_ms()),
    ));
    Ok(feeds)
}

/// The starter catalogue and every index, searched and ordered as one call.
///
/// Cache-only and therefore free: this never goes near the network, which is
/// what lets it run on every keystroke. `source` names one feed, or `catalog`
/// for the things that ship with DevDeck.
#[tauri::command]
pub fn community_arrange(
    db: tauri::State<Db>,
    source: String,
    q: String,
    kinds: Vec<String>,
    permissive: bool,
    sort: String,
) -> Vec<Item> {
    let conn = db.0.lock().unwrap();
    let items = if source == "catalog" {
        catalog()
    } else if source == crate::community_index::SOURCE_YEAR {
        crate::community_index::year_feed(&conn, now_ms()).items
    } else {
        crate::community_index::cached(&conn, &source).items
    };
    crate::community_index::arrange(&items, &q, &kinds, permissive, &sort)
}

/// One entry, with everything this machine can honestly say about it.
///
/// The expensive part is the tool list, and it is only reached for an
/// installed server: `Hub::ensure` starts the process if it is not already
/// running, which is a thing to do when somebody opened the page for that
/// server and not a thing to do while rendering a list.
#[tauri::command]
pub fn community_repo(db: tauri::State<Db>, ws: Ws, id: String) -> Result<Repo, String> {
    let (rows, feeds) = {
        let conn = db.0.lock().unwrap();
        let rows = all(&conn)?;
        let feeds: Vec<(String, Vec<Item>)> = crate::community_index::SOURCES
            .iter()
            .map(|src| {
                let f = crate::community_index::cached(&conn, src);
                (f.source, f.items)
            })
            .collect();
        (rows, feeds)
    };

    let (item, found_in) = find_item(&id, &catalog(), &feeds)
        .ok_or_else(|| format!("nothing in the catalogue or any cached index called '{id}'"))?;
    let installed = rows.iter().find(|r| r.id == id).cloned();

    // Who can use it, straight from the matrix rather than from the install —
    // every agent, including the ones on `none`, because "four other agents
    // have None" is the sentence this page exists to be able to say.
    let grants: Vec<(String, String)> = if item.tool_id.is_empty() {
        Vec::new()
    } else {
        ws.agents()
            .into_iter()
            .map(|a| {
                let level = a
                    .permissions
                    .get(&item.tool_id)
                    .cloned()
                    .unwrap_or_else(|| "none".into());
                (a.id, if level.is_empty() { "none".into() } else { level })
            })
            .collect()
    };

    // What it needs, checked here rather than read from a manifest.
    let needs = match runner_of(&item.command) {
        Some((probe, label, hint)) => vec![Need {
            what: label.into(),
            // Asked the way the spawn asks, so the two cannot disagree.
            present: crate::mcp::program_present(&probe),
            hint: hint.into(),
        }],
        None => Vec::new(),
    };

    // And the real answer to "what does it give your bots".
    let mut tools = Vec::new();
    let mut err = None;
    if item.kind == KIND_TOOL && installed.is_some() && !item.command.is_empty() {
        let spec = crate::mcp::ServerSpec {
            id: item.tool_id.trim_start_matches(crate::mcp::PREFIX).to_string(),
            name: item.name.clone(),
            command: item.command.clone(),
        };
        match ws.mcp.ensure(&spec) {
            Ok(t) => tools = t,
            Err(e) => err = Some(e),
        }
    }
    let tools_note = tools_note(&item.kind, installed.is_some(), err.as_deref(), tools.len());

    Ok(Repo {
        item,
        found_in,
        installed,
        tools,
        tools_note,
        grants,
        needs,
    })
}

/// Every bundle, with what installing it would do right now.
#[tauri::command]
pub fn community_bundles(db: tauri::State<Db>, ws: Ws) -> Result<Vec<(Bundle, Plan)>, String> {
    let rows = {
        let conn = db.0.lock().unwrap();
        all(&conn)?
    };
    let agents: Vec<String> = ws.agents().into_iter().map(|a| a.id).collect();
    Ok(bundles()
        .into_iter()
        .map(|b| {
            let p = plan(&b, &rows, &agents);
            (b, p)
        })
        .collect())
}

/// Install a bundle's items — and grant nothing.
///
/// Returns the grants it proposes, for a person to accept in one deliberate
/// step through `community_grant`. A bundle that applied them here would be
/// the one thing this module exists to prevent, dressed up as convenience.
#[tauri::command]
pub fn community_install_bundle(
    db: tauri::State<Db>,
    ws: Ws,
    id: String,
) -> Result<Plan, String> {
    let b = bundles()
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| format!("no bundle called '{id}'"))?;

    for item_id in &b.items {
        if item(item_id).is_none() {
            continue;
        }
        community_install(db.clone(), ws.clone(), item_id.clone())?;
    }

    let rows = {
        let conn = db.0.lock().unwrap();
        all(&conn)?
    };
    let agents: Vec<String> = ws.agents().into_iter().map(|a| a.id).collect();
    Ok(plan(&b, &rows, &agents))
}

/// MCP servers running right now.
///
/// An MCP server is a process, and a process nobody can see is a process
/// nobody can stop. It is not in the Processes bottom bar — that watches
/// services you configured, and these start themselves on an agent's first
/// call — so Community answers the question instead.
#[tauri::command]
pub fn community_servers(ws: Ws) -> Vec<crate::mcp::ServerStatus> {
    ws.mcp.statuses()
}

/// Stop a running server. It restarts on the next call that needs it.
#[tauri::command]
pub fn community_stop_server(ws: Ws, id: String) -> bool {
    ws.mcp.stop(&id)
}

/// The separate, deliberate act: say who may use an installed thing.
///
/// Two shapes, because the two kinds are granted differently. A skill goes on
/// an agent's own list; a tool is a row in the permission matrix. Both are
/// refused when the item is not installed — a permission pointing at something
/// that is not there is worse than no permission, because it reads as one.
#[tauri::command]
pub fn community_grant(
    db: tauri::State<Db>,
    ws: Ws,
    id: String,
    agent_id: String,
    // `level` is for a tool: none | read | approval | full. A skill's grant is
    // binary, so it is ignored there.
    level: Option<String>,
    on: bool,
) -> Result<(), String> {
    let installed = {
        let conn = db.0.lock().unwrap();
        all(&conn)?.into_iter().any(|i| i.id == id)
    };
    if !installed {
        return Err(format!("'{id}' is not installed"));
    }
    let entry = item(&id).ok_or_else(|| format!("nothing in the index called '{id}'"))?;

    match entry.kind.as_str() {
        KIND_SKILL => set_skill(&ws, &agent_id, &entry.name, on),
        KIND_TOOL => {
            // `approval` rather than `full` by default: the first grant of a
            // community server should stop and ask, because nobody has watched
            // it run yet.
            let level = if on {
                level.unwrap_or_else(|| "approval".into())
            } else {
                "none".into()
            };
            set_tool(&db, &ws, &agent_id, &entry.tool_id, &level)
        }
        _ => Err("an agent is not granted to another agent".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, skills: &[&str], perms: &[(&str, &str)]) -> (String, Vec<String>, Vec<(String, String)>) {
        (
            id.to_string(),
            skills.iter().map(|s| s.to_string()).collect(),
            perms.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
        )
    }

    #[test]
    fn a_fresh_install_reaches_nobody() {
        // The whole split in one assertion: files landed, and not one agent
        // gained the ability to use them.
        let agents = [agent("dev-a", &[], &[]), agent("qa", &[], &[])];
        assert!(reach(KIND_SKILL, "failure-honesty", "", &agents).is_empty());
        assert!(reach(KIND_TOOL, "", "mcp.fetch", &agents).is_empty());
    }

    #[test]
    fn a_skill_reaches_only_the_agents_that_list_it() {
        let agents = [
            agent("dev-a", &["failure-honesty"], &[]),
            agent("qa", &["small-diffs"], &[]),
        ];
        assert_eq!(reach(KIND_SKILL, "failure-honesty", "", &agents), vec!["dev-a"]);
    }

    #[test]
    fn a_tool_granted_at_none_is_not_reach() {
        // `none` is what every install writes, and it is stored the same way a
        // real grant is. Counting it would make every install look wired up.
        let agents = [agent("dev-a", &[], &[("mcp.fetch", "none")])];
        assert!(reach(KIND_TOOL, "", "mcp.fetch", &agents).is_empty());

        let granted = [agent("dev-a", &[], &[("mcp.fetch", "approval")])];
        assert_eq!(reach(KIND_TOOL, "", "mcp.fetch", &granted), vec!["dev-a"]);
    }

    #[test]
    fn a_grant_on_a_different_tool_is_not_this_one() {
        let agents = [agent("dev-a", &[], &[("files", "full")])];
        assert!(reach(KIND_TOOL, "", "mcp.fetch", &agents).is_empty());
    }

    #[test]
    fn an_installed_agent_is_reachable_as_itself() {
        let agents = [agent("docs-writer", &[], &[]), agent("qa", &[], &[])];
        assert_eq!(
            reach(KIND_AGENT, "docs-writer", "", &agents),
            vec!["docs-writer"]
        );
    }

    #[test]
    fn a_clock_that_went_backwards_is_zero_days_old_not_negative() {
        assert_eq!(days_since(1_000, 1_000), 0);
        assert_eq!(days_since(5_000, 1_000), 0, "installed in the future reads as today");
        assert_eq!(days_since(0, 86_400_000), 1);
        assert_eq!(days_since(0, 86_400_000 - 1), 0, "part of a day is not a day");
    }

    #[test]
    fn idle_is_about_reach_not_about_age() {
        let used = [agent("dev-a", &["failure-honesty"], &[])];
        let unused: [(String, Vec<String>, Vec<(String, String)>); 1] = [agent("dev-a", &[], &[])];
        let old = Installed {
            id: "skill.failure-honesty".into(),
            kind: KIND_SKILL.into(),
            name: "failure-honesty".into(),
            at: 0,
            ..Default::default()
        };
        let long_ago = 30 * 86_400_000;

        assert!(
            !standing(old.clone(), &used, long_ago).idle,
            "something in use is never nagged about, however old"
        );
        assert!(
            standing(old.clone(), &unused, long_ago).idle,
            "a month unreachable is worth saying"
        );
        assert!(
            !standing(old, &unused, 86_400_000).idle,
            "one day is too soon to nag"
        );
    }

    #[test]
    fn nothing_is_blocked_now_that_there_is_an_mcp_client() {
        // This test used to assert the opposite: that a tool always reported
        // "DevDeck has no MCP client". It does now, so the caveat is gone
        // rather than softened, and the assertion is inverted rather than
        // deleted — a claim that stopped being true is worth a test saying so.
        for kind in [KIND_SKILL, KIND_AGENT, KIND_TOOL] {
            assert!(
                blocked_reason(kind).is_empty(),
                "{kind} should have nothing to apologise for"
            );
        }
    }

    #[test]
    fn the_catalogue_is_internally_consistent() {
        let all = catalog();
        assert!(!all.is_empty());
        for i in &all {
            assert!(!i.id.is_empty() && !i.name.is_empty(), "{i:?}");
            assert!(!i.summary.is_empty(), "every row says what it is for: {}", i.id);
            assert!(!i.licence.is_empty(), "licence is shown on every row: {}", i.id);
            assert!(!i.source.is_empty(), "and where it came from: {}", i.id);
            match i.kind.as_str() {
                KIND_SKILL | KIND_AGENT => assert!(
                    !i.body.is_empty(),
                    "a skill or agent with no instructions installs nothing: {}",
                    i.id
                ),
                KIND_TOOL => {
                    assert!(!i.tool_id.is_empty(), "a tool needs a matrix id: {}", i.id);
                    assert!(!i.command.is_empty(), "and something to run: {}", i.id);
                }
                other => panic!("unknown kind {other} on {}", i.id),
            }
        }
        let mut ids: Vec<_> = all.iter().map(|i| i.id.clone()).collect();
        ids.sort();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "ids are unique");
    }

    #[test]
    fn installs_round_trip_through_the_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let i = Installed {
            id: "skill.small-diffs".into(),
            kind: KIND_SKILL.into(),
            name: "small-diffs".into(),
            version: "1.0.0".into(),
            source: "https://example.invalid/x".into(),
            licence: "permissive".into(),
            at: 1_700_000_000_000,
            files: vec!["skills/small-diffs.md".into()],
            command: String::new(),
            tool_id: String::new(),
        };
        record(&conn, &i).unwrap();
        assert_eq!(all(&conn).unwrap(), vec![i.clone()]);

        // Re-installing replaces rather than duplicating: one install per item.
        record(&conn, &i).unwrap();
        assert_eq!(all(&conn).unwrap().len(), 1);

        forget(&conn, &i.id).unwrap();
        assert!(all(&conn).unwrap().is_empty());
    }

    fn have(id: &str) -> Installed {
        Installed { id: id.into(), ..Default::default() }
    }

    fn who(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_bundle_plan_separates_what_it_would_write_from_what_it_would_offer() {
        // The whole reason a bundle is allowed to exist here: it installs, and
        // it *proposes* grants. Nothing in a plan is applied.
        let b = bundles().iter().find(|b| b.id == "bundle.memory").unwrap().clone();
        let p = plan(&b, &[], &who(&["dev-a", "qa"]));

        assert_eq!(p.to_install.len(), 2, "{:?}", p.to_install);
        assert!(p.already.is_empty());
        assert!(p.missing.is_empty(), "the starter bundles point at real entries");
        assert_eq!(p.grants.len(), 2);
        // A server's first grant asks rather than deciding — nobody has
        // watched this one run yet.
        let tool = p.grants.iter().find(|g| g.item == "tool.mcp-memory").unwrap();
        assert_eq!(tool.level, "approval");
        // A skill's grant is binary, so it carries no level to misread.
        let skill = p.grants.iter().find(|g| g.item == "skill.failure-honesty").unwrap();
        assert!(skill.level.is_empty());
    }

    #[test]
    fn what_is_already_installed_is_left_alone_rather_than_reinstalled() {
        let b = bundles().iter().find(|b| b.id == "bundle.memory").unwrap().clone();
        let p = plan(&b, &[have("skill.failure-honesty")], &who(&["dev-a"]));
        assert_eq!(p.already, vec!["skill.failure-honesty"]);
        assert_eq!(p.to_install, vec!["tool.mcp-memory"]);
        assert_eq!(p.grants.len(), 2, "and both grants are still offered");
    }

    #[test]
    fn a_bundle_naming_something_that_left_the_index_says_so() {
        // A broken bundle is the person choosing it's business, not something
        // to skip quietly — and the grant that pointed at it is dropped,
        // because it would point at nothing.
        let b = Bundle {
            id: "b".into(),
            name: "B".into(),
            summary: String::new(),
            items: vec!["skill.small-diffs".into(), "skill.gone-away".into()],
            grants: vec![
                Suggestion { item: "skill.gone-away".into(), agent: "dev-a".into(), level: String::new() },
                Suggestion { item: "skill.small-diffs".into(), agent: "dev-a".into(), level: String::new() },
            ],
        };
        let p = plan(&b, &[], &who(&["dev-a"]));
        assert_eq!(p.missing, vec!["skill.gone-away"]);
        assert_eq!(p.to_install, vec!["skill.small-diffs"]);
        assert_eq!(p.grants.len(), 1, "no grant for a thing that cannot be installed");
        assert_eq!(p.grants[0].item, "skill.small-diffs");
    }

    #[test]
    fn a_grant_naming_an_agent_this_machine_does_not_have_is_named_not_offered() {
        // Offering it would produce a button that fails, and dropping it
        // silently would lose the fact that the bundle expected somebody.
        let b = Bundle {
            id: "b".into(),
            name: "B".into(),
            summary: String::new(),
            items: vec!["skill.small-diffs".into()],
            grants: vec![
                Suggestion { item: "skill.small-diffs".into(), agent: "nobody".into(), level: String::new() },
                Suggestion { item: "skill.small-diffs".into(), agent: "dev-a".into(), level: String::new() },
            ],
        };
        let p = plan(&b, &[], &who(&["dev-a"]));
        assert_eq!(p.unknown_agents, vec!["nobody"]);
        assert_eq!(p.grants.len(), 1);
        assert_eq!(p.grants[0].agent, "dev-a");
    }

    #[test]
    fn every_starter_bundle_points_only_at_entries_that_exist() {
        // The bundles ship with the app, so a typo in one is a broken product
        // rather than a broken import.
        for b in bundles() {
            assert!(!b.items.is_empty(), "{} has nothing in it", b.id);
            let p = plan(&b, &[], &who(&["dev-a", "dev-b", "qa", "architect", "reviewer"]));
            assert!(p.missing.is_empty(), "{} names {:?}", b.id, p.missing);
            assert!(
                p.unknown_agents.is_empty(),
                "{} suggests granting to {:?}, who do not ship",
                b.id,
                p.unknown_agents
            );
        }
    }


    // -- one repo, in full -------------------------------------------------

    fn idx(id: &str) -> Item {
        Item { id: id.into(), name: "from an index".into(), ..Default::default() }
    }

    #[test]
    fn the_catalogue_wins_over_an_index_row_with_the_same_id() {
        // A starter entry carries a body and a tool id; an index row with the
        // same id carries neither. Preferring the index would lose the half
        // that makes it installable, and the page would offer to install
        // something with nothing to write.
        let cat = catalog();
        let real = cat.first().unwrap().clone();
        let feeds = vec![("github".to_string(), vec![idx(&real.id)])];
        let (found, source) = find_item(&real.id, &cat, &feeds).unwrap();
        assert_eq!(source, "catalog");
        assert_eq!(found.name, real.name);
        assert!(!found.body.is_empty() || !found.tool_id.is_empty());
    }

    #[test]
    fn an_index_row_is_found_and_says_which_index_it_came_from() {
        // Where a row was found is part of what the page has to say — a
        // registry entry and a trending row are trusted differently.
        let feeds = vec![
            ("registry".to_string(), vec![idx("tool.registry.x")]),
            ("trending-week".to_string(), vec![idx("trend.week.a/b")]),
        ];
        let (_, source) = find_item("trend.week.a/b", &catalog(), &feeds).unwrap();
        assert_eq!(source, "trending-week");
        assert!(find_item("nope", &catalog(), &feeds).is_none());
    }

    #[test]
    fn the_first_index_holding_a_row_is_the_one_reported() {
        // A repository can be in the search list and in trending at once under
        // different ids, but the same id in two feeds must resolve to one
        // answer rather than depending on iteration order.
        let feeds = vec![
            ("github".to_string(), vec![idx("repo.a/b")]),
            ("trending-week".to_string(), vec![idx("repo.a/b")]),
        ];
        assert_eq!(find_item("repo.a/b", &[], &feeds).unwrap().1, "github");
    }

    #[test]
    fn a_command_names_the_thing_that_has_to_be_on_the_machine() {
        // The probe is the command's *own* program, not a stand-in. Answering
        // "node" for an `npx` command put a green "on PATH" beside a spawn
        // that said "could not start 'npx'" — two checks disagreeing on one
        // screen because only one was asking about what actually runs.
        let npx = runner_of("npx -y @modelcontextprotocol/server-memory").unwrap();
        assert_eq!(npx.0, "npx", "probe the program that runs");
        assert_eq!(npx.1, "Node.js", "named for a person in the label");

        assert_eq!(runner_of("uvx mcp-server-git").unwrap().0, "uvx");
        assert_eq!(runner_of("python -m server").unwrap().0, "python");
        // Windows spells it npx.cmd; the extension is not part of the name to
        // look up, because resolving one is the spawn's job.
        assert_eq!(runner_of("npx.cmd -y thing").unwrap().0, "npx");
        // Quoted, because that is how a path with a space is actually written
        // and how the runner itself parses one.
        assert_eq!(
            runner_of(r#""C:\Program Files\nodejs\npx.cmd" -y thing"#).unwrap().0,
            "npx"
        );
    }

    #[test]
    fn the_requirements_row_agrees_with_what_a_spawn_would_do() {
        // The two used to be able to disagree, and did: "Node.js on PATH"
        // printed directly under "could not start 'npx': program not found".
        // They share one resolution now, so the row is a promise the spawn
        // can keep.
        let (probe, _, _) = runner_of("npx -y @modelcontextprotocol/server-memory").unwrap();
        assert_eq!(
            crate::mcp::program_present(&probe),
            crate::mcp::resolve_program(&probe) != probe || crate::runners::on_path(&probe),
        );
    }

    #[test]
    fn a_runner_we_cannot_name_produces_no_row_rather_than_a_wrong_one() {
        // An absent requirement beats a confident "not installed" about a
        // thing we could not identify — the second would send somebody to
        // install software they already have under another name.
        assert!(runner_of("some-bespoke-binary --serve").is_none());
        assert!(runner_of("").is_none());
    }

    #[test]
    fn an_empty_tool_list_always_says_which_kind_of_empty_it_is() {
        // Four states, not two. Only one of them is a problem to fix, and a
        // page that showed the same blank for all four would hide the one
        // that is.
        let not_a_server = tools_note(KIND_SKILL, true, None, 0);
        assert!(not_a_server.contains("instructions"), "{not_a_server}");

        let not_installed = tools_note(KIND_TOOL, false, None, 0);
        assert!(not_installed.contains("once it is installed"), "{not_installed}");
        assert!(
            not_installed.contains("guessed from a manifest"),
            "and says it is not guessing: {not_installed}"
        );

        let broken = tools_note(KIND_TOOL, true, Some("spawn failed: ENOENT"), 0);
        assert!(broken.contains("would not start"), "{broken}");
        assert!(broken.contains("ENOENT"), "carrying the real reason: {broken}");

        let genuinely_none = tools_note(KIND_TOOL, true, None, 0);
        assert!(genuinely_none.contains("declared no tools"), "{genuinely_none}");
        assert_ne!(genuinely_none, broken, "a server with none is not a server that failed");
    }

    #[test]
    fn a_tool_list_that_was_read_carries_no_note_at_all() {
        // The note is the explanation for an absence. Text beside a real list
        // would read as a caveat about the list.
        assert_eq!(tools_note(KIND_TOOL, true, None, 3), "");
    }


    // -- installing from an index -------------------------------------------

    fn server(id: &str, tool_id: &str, command: &str) -> Item {
        Item {
            id: id.into(),
            kind: KIND_TOOL.into(),
            name: id.into(),
            tool_id: tool_id.into(),
            command: command.into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_registry_entry_declares_enough_to_install() {
        // The point of the whole slice: a registry row carries a command and a
        // tool id, so it is installable in a way a repository is not.
        let e = server("tool.registry.x", "mcp.x", "npx -y @scope/server-x");
        assert!(installable(&e).is_ok());
    }

    #[test]
    fn a_repository_row_is_refused_with_the_reason_rather_than_a_button() {
        // A GitHub search or trending row declares nothing. Installing it
        // would write a row nothing could ever use, and inventing a command
        // would mean running something nobody chose.
        let repo = Item { kind: KIND_TOOL.into(), name: "cool-thing".into(), ..Default::default() };
        let why = installable(&repo).unwrap_err();
        assert!(why.contains("how to run it"), "{why}");
        assert!(why.contains("guess"), "and says why guessing is not the answer: {why}");
    }

    #[test]
    fn a_server_with_no_tool_id_could_never_be_granted_so_is_refused() {
        let e = server("tool.x", "", "npx -y thing");
        let why = installable(&e).unwrap_err();
        assert!(why.contains("permission matrix"), "{why}");
    }

    #[test]
    fn a_skill_with_no_instructions_would_write_an_empty_file() {
        let empty = Item { kind: KIND_SKILL.into(), name: "hollow".into(), ..Default::default() };
        assert!(installable(&empty).is_err());
        // And every starter entry passes, or the catalogue ships broken.
        for i in catalog() {
            assert!(installable(&i).is_ok(), "{} is not installable: {:?}", i.id, installable(&i));
        }
    }

    #[test]
    fn two_servers_that_slug_to_one_permission_id_do_not_shadow_each_other() {
        // `Notes` and `notes!` both become `mcp.notes`. Left alone, a grant
        // meant for one would silently apply to the other — the permission
        // matrix quietly meaning something other than what it says.
        let already = Installed {
            id: "tool.registry.a/notes".into(),
            name: "Notes".into(),
            tool_id: "mcp.notes".into(),
            ..Default::default()
        };
        let incoming = server("tool.registry.b/notes", "mcp.notes", "npx -y other");
        let why = collision(&incoming, &[already.clone()]).expect("a collision");
        assert!(why.contains("Notes"), "names the one already there: {why}");
        assert!(why.contains("mcp.notes"), "and the id they share: {why}");

        // Re-installing the same id is an upgrade, not a collision.
        let same = server("tool.registry.a/notes", "mcp.notes", "npx -y newer");
        assert!(collision(&same, &[already]).is_none());
    }

    #[test]
    fn a_skill_never_collides_because_it_holds_no_permission_id() {
        let skill = Item { id: "skill.a".into(), kind: KIND_SKILL.into(), ..Default::default() };
        let held = Installed { id: "other".into(), tool_id: "mcp.x".into(), ..Default::default() };
        assert!(collision(&skill, &[held]).is_none());
    }

    #[test]
    fn what_a_server_runs_is_recorded_not_looked_up_again() {
        // The index is a cache that changes under you: a registry entry can be
        // republished with a different command, or withdrawn entirely. What
        // somebody read in the trust modal is what should still run tomorrow.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let row = Installed {
            id: "tool.registry.a/notes".into(),
            kind: KIND_TOOL.into(),
            name: "Notes".into(),
            at: 1,
            command: "npx -y @a/notes@1.2.3".into(),
            tool_id: "mcp.notes".into(),
            ..Default::default()
        };
        record(&conn, &row).unwrap();

        let back = all(&conn).unwrap();
        assert_eq!(back[0].command, "npx -y @a/notes@1.2.3");

        // And it becomes a real server spec without the catalogue knowing it,
        // which is what a registry install could never do before.
        let specs = servers(&back);
        assert_eq!(specs.len(), 1, "{specs:?}");
        assert_eq!(specs[0].id, "notes");
        assert_eq!(specs[0].command, "npx -y @a/notes@1.2.3");
    }

    #[test]
    fn an_install_written_before_the_columns_existed_still_registers() {
        // Upgrading must not quietly unregister somebody's granted server.
        // A row with no command falls back to the catalogue, as it always did.
        let from_catalog = catalog().into_iter().find(|i| i.kind == KIND_TOOL).unwrap();
        let old_row = Installed {
            id: from_catalog.id.clone(),
            kind: KIND_TOOL.into(),
            name: from_catalog.name.clone(),
            at: 1,
            command: String::new(),
            tool_id: String::new(),
            ..Default::default()
        };
        let specs = servers(&[old_row]);
        assert_eq!(specs.len(), 1, "an older install still becomes a server");
        assert_eq!(specs[0].command, from_catalog.command);
    }

    #[test]
    fn the_migration_adds_the_columns_to_a_database_that_predates_them() {
        // The original shape, exactly as a running copy of DevDeck would have
        // it, then migrate — a test that builds the current schema instead
        // would be testing a database nobody has.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE community_installed (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
                licence TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL,
                files TEXT NOT NULL DEFAULT ''
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO community_installed (id, kind, name, at) VALUES ('skill.x','skill','x',1)",
            [],
        )
        .unwrap();

        crate::db::migrate(&conn);

        // Reads back through the real query, which is what would have broken.
        let rows = all(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "skill.x");
        assert_eq!(rows[0].command, "");
    }

}
