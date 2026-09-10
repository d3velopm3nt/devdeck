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
        Item {
            tool_id: "mcp.filesystem".into(),
            command: "npx -y @modelcontextprotocol/server-filesystem".into(),
            licence: "permissive".into(),
            author: "Anthropic".into(),
            source: "https://github.com/modelcontextprotocol/servers".into(),
            ..devdeck(
                "tool.mcp-filesystem",
                KIND_TOOL,
                "MCP filesystem",
                "Reads and writes files over MCP, scoped to directories you name.",
                "",
            )
        },
        Item {
            tool_id: "mcp.fetch".into(),
            command: "npx -y @modelcontextprotocol/server-fetch".into(),
            licence: "permissive".into(),
            author: "Anthropic".into(),
            source: "https://github.com/modelcontextprotocol/servers".into(),
            ..devdeck(
                "tool.mcp-fetch",
                KIND_TOOL,
                "MCP fetch",
                "Fetches a URL and returns it as text an agent can read.",
                "",
            )
        },
    ]
}

/// One catalogue entry by id.
pub fn item(id: &str) -> Option<Item> {
    catalog().into_iter().find(|i| i.id == id)
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
/// Only tools have an answer here, and only until there is an MCP client. It
/// is a sentence rather than a flag because the person reading it needs to
/// know what to do next, and "false" tells them nothing.
pub fn blocked_reason(kind: &str) -> String {
    if kind == KIND_TOOL {
        "Declared and grantable, but not callable yet — DevDeck has no MCP \
         client, so nothing can run this server."
            .into()
    } else {
        String::new()
    }
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

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

pub fn all(conn: &Connection) -> Result<Vec<Installed>, String> {
    let mut stmt = conn
        .prepare("SELECT id, kind, name, version, source, licence, at, files FROM community_installed ORDER BY at DESC")
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
        "INSERT OR REPLACE INTO community_installed (id, kind, name, version, source, licence, at, files) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            i.id,
            i.kind,
            i.name,
            i.version,
            i.source,
            i.licence,
            i.at,
            i.files.join("\n")
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
    let entry = item(&id).ok_or_else(|| format!("nothing in the index called '{id}'"))?;

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
    };
    {
        let conn = db.0.lock().unwrap();
        record(&conn, &row)?;
    }
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

    let conn = db.0.lock().unwrap();
    forget(&conn, &id)
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
    fn only_a_tool_reports_a_reason_it_cannot_run() {
        assert!(blocked_reason(KIND_SKILL).is_empty());
        assert!(blocked_reason(KIND_AGENT).is_empty());
        assert!(
            blocked_reason(KIND_TOOL).contains("MCP"),
            "and it says what is missing, not just that something is"
        );
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
        };
        record(&conn, &i).unwrap();
        assert_eq!(all(&conn).unwrap(), vec![i.clone()]);

        // Re-installing replaces rather than duplicating: one install per item.
        record(&conn, &i).unwrap();
        assert_eq!(all(&conn).unwrap().len(), 1);

        forget(&conn, &i.id).unwrap();
        assert!(all(&conn).unwrap().is_empty());
    }
}
