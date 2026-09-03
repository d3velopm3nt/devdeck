//! A bot is a file in a folder.
//!
//! Not a new entity, and deliberately so. A bot needs three things and the app
//! already has all of them: a place (a vault node), a clock (`schedule.rs`),
//! and workers (the agents in `aiw`). What was missing was somewhere to write
//! down *what this space is trying to do* — so that is all this adds, as
//! `_bot.md` beside the `_devdeck.md` that already says what the folder is.
//!
//! **What the bot is lives here; what it knows about you does not.** The
//! frontmatter and the prose are the bot's definition: its name, its goal, when
//! it wakes. Those belong to the folder, travel with it, and are safe in a pull
//! request. Everything it learns about *you* — the interview answers, the
//! corrections, the suggestions you turned down — belongs in the personal
//! store, which refuses to be created inside a repository at all. Putting
//! "daily reminders are why you stopped using the last app" in a committed file
//! is the exact mistake that split exists to prevent.
//!
//! **The routine is written twice, and the file wins.** `_bot.md` holds when
//! the bot should wake; a `schedules` row holds when it last did. That is the
//! same rule as the vault — the filesystem is the truth, SQLite is a
//! rebuildable index — and it is why a bot copied into another machine's vault
//! still has its routine.
//!
//! **Waking reads the space, and runs an agent only if you named one.** By
//! default a heartbeat gathers: it writes at most one line to your inbox, and
//! nothing at all when there is nothing to say. Naming an agent in the bot's
//! settings is the deliberate step that turns watching into working.
//!
//! Even then, what it may actually do is decided entirely by standing grants
//! (`aiw/grants.rs`). An unattended call that needs approval is refused on the
//! spot — there is nobody to ask, and waiting for the timeout would only reach
//! the same answer slowly. So a bot with an agent and no grants runs, refuses
//! every tool call, and tells you exactly that. Nothing can happen to your
//! machine that you did not agree to in advance, by name.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::db::{self, Db};

pub const FILE: &str = "_bot.md";

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Bot {
    /// The node it runs. A bot has exactly one, and a node has at most one bot.
    pub node_id: i64,
    pub node_name: String,
    pub dir: String,
    pub name: String,
    /// The sentence the whole bot is about. A bot without one is a chat window.
    pub goal: String,
    /// daily | weekdays | weekly | hourly, or empty for no heartbeat.
    pub every: String,
    /// Minutes past midnight, local.
    pub at_min: i64,
    /// For 'weekly': comma-separated 0-6, Sunday first.
    pub days: String,
    /// Everything after the frontmatter — what this bot is for, in your words.
    pub body: String,
    /// Skills appended to its instructions, by name. Words, no permissions —
    /// the cheapest rung on the ladder, and the one most bots stop at.
    #[serde(default)]
    pub skills: Vec<String>,
    /// Which starter it came from, or empty when it was made by hand. Kept so
    /// the bot can still be told what that starter offers.
    #[serde(default)]
    pub template: String,
    /// The `.devdeck` feature holding its work items. Empty until it has a plan.
    #[serde(default)]
    pub feature: String,
    /// The agent its heartbeat wakes, or empty for a heartbeat that only reads
    /// and reports.
    ///
    /// Naming one is the whole difference between a bot that watches and a bot
    /// that works, so it is opt-in and never a default. What that agent may
    /// actually do unattended is decided entirely by standing grants: with none,
    /// it will get through its turn refusing every tool call, which is safe and
    /// says so.
    #[serde(default)]
    pub agent: String,
    /// Every agent this bot may put work on, its lead included — the part of
    /// the team written down in the file.
    ///
    /// Not the whole answer any more: see [`effective_team`]. Someone you pull
    /// into the bot's thread by hand counts too, and that list is not stored
    /// twice.
    ///
    /// A bot manages; it does not do the work. The team is who it is allowed
    /// to hand that work to, and it is a limit rather than a hint: an agent
    /// that is not on it gets nothing, the same way an agent missing from the
    /// permission matrix gets nothing. An empty team means the bot has nobody
    /// yet and can only watch — a true thing to say about a bot with no one
    /// to manage, not a failure.
    #[serde(default)]
    pub team: Vec<String>,
    /// What to ask it when it wakes. Empty means the goal.
    #[serde(default)]
    pub wake_intent: String,
    /// Where it must stop and ask, whatever its permissions say.
    ///
    /// "before any push" is the one everybody wants, and permissions cannot
    /// express it: `git` is one tool, and an agent that may commit may push.
    /// A review point is the other kind of rule — not "may you", but "not
    /// without me" — so it is written in words in the bot's own file and
    /// honoured by the runtime rather than by the permission matrix.
    #[serde(default)]
    pub stop_at: Vec<String>,
    /// The schedule row backing the heartbeat, when there is one.
    pub schedule_id: Option<i64>,
    pub last_woke: Option<i64>,
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

fn parse_at(v: &str) -> i64 {
    let (h, m) = v.split_once(':').unwrap_or((v, "0"));
    let h: i64 = h.trim().parse().unwrap_or(7);
    let m: i64 = m.trim().parse().unwrap_or(0);
    (h.clamp(0, 23) * 60 + m.clamp(0, 59)).clamp(0, 1439)
}

fn fmt_at(at_min: i64) -> String {
    format!("{:02}:{:02}", at_min / 60, at_min % 60)
}

/// Read `_bot.md`, or None when the folder has no bot. A malformed file is
/// still a bot — the same forgiveness `_devdeck.md` gets, for the same reason:
/// someone editing it by hand should not lose it to a typo.
fn read(dir: &Path) -> Option<Bot> {
    let raw = fs::read_to_string(dir.join(FILE)).ok()?;
    let mut b = Bot {
        at_min: 420,
        ..Default::default()
    };

    let rest = match raw.strip_prefix("---") {
        Some(after) => match after.find("\n---") {
            Some(end) => {
                for line in after[..end].lines() {
                    let Some((k, v)) = line.split_once(':') else { continue };
                    let v = v.trim().trim_matches('"').to_string();
                    match k.trim() {
                        "name" => b.name = v,
                        "goal" => b.goal = v,
                        "every" => b.every = v,
                        "at" => b.at_min = parse_at(&v),
                        "days" => b.days = v,
                        "template" => b.template = v,
                        "agent" => b.agent = v,
                        "team" => {
                            b.team = v
                                .trim_matches(|c| c == '[' || c == ']')
                                .split(',')
                                .map(|x| x.trim().trim_matches('"').to_string())
                                .filter(|x| !x.is_empty())
                                .collect()
                        }
                        "wake_intent" => b.wake_intent = v,
                        "stop_at" => {
                            b.stop_at = v
                                .trim_matches(|c| c == '[' || c == ']')
                                .split(',')
                                .map(|x| x.trim().trim_matches('"').to_string())
                                .filter(|x| !x.is_empty())
                                .collect()
                        }
                        "feature" => b.feature = v,
                        "skills" => {
                            b.skills = v
                                .trim_matches(|c| c == '[' || c == ']')
                                .split(',')
                                .map(|x| x.trim().trim_matches('"').to_string())
                                .filter(|x| !x.is_empty())
                                .collect()
                        }
                        _ => {}
                    }
                }
                &after[end + 4..]
            }
            None => raw.as_str(),
        },
        None => raw.as_str(),
    };
    b.body = rest.trim().to_string();
    Some(b)
}

fn write(dir: &Path, b: &Bot) -> Result<(), String> {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", b.name.trim()));
    if !b.goal.trim().is_empty() {
        out.push_str(&format!("goal: {}\n", b.goal.trim()));
    }
    if !b.every.trim().is_empty() {
        out.push_str(&format!("every: {}\n", b.every.trim()));
        out.push_str(&format!("at: \"{}\"\n", fmt_at(b.at_min)));
        if b.every == "weekly" && !b.days.trim().is_empty() {
            out.push_str(&format!("days: {}\n", b.days.trim()));
        }
    }
    if !b.template.trim().is_empty() {
        out.push_str(&format!("template: {}\n", b.template.trim()));
    }
    if !b.feature.trim().is_empty() {
        out.push_str(&format!("feature: {}\n", b.feature.trim()));
    }
    if !b.skills.is_empty() {
        out.push_str(&format!("skills: [{}]\n", b.skills.join(", ")));
    }
    if !b.agent.trim().is_empty() {
        out.push_str(&format!("agent: {}\n", b.agent.trim()));
    }
    if !b.team.is_empty() {
        out.push_str(&format!("team: [{}]\n", b.team.join(", ")));
    }
    if !b.wake_intent.trim().is_empty() {
        out.push_str(&format!("wake_intent: {}\n", b.wake_intent.trim()));
    }
    if !b.stop_at.is_empty() {
        out.push_str(&format!("stop_at: [{}]\n", b.stop_at.join(", ")));
    }
    out.push_str("---\n");
    if !b.body.trim().is_empty() {
        out.push('\n');
        out.push_str(b.body.trim());
        out.push('\n');
    }
    fs::write(dir.join(FILE), out).map_err(err)
}

// ---------------------------------------------------------------------------
// The heartbeat row
// ---------------------------------------------------------------------------

fn heartbeat(conn: &Connection, node_id: i64) -> Option<(i64, Option<i64>)> {
    conn.query_row(
        "SELECT id, last_run FROM schedules WHERE kind = 'bot' AND node_id = ?1 LIMIT 1",
        params![node_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .ok()
}

/// Keep the `schedules` row in step with the file. The file decides; this only
/// makes the clock agree with it.
fn sync_heartbeat(conn: &Connection, b: &Bot) -> Result<Option<i64>, String> {
    let existing = heartbeat(conn, b.node_id).map(|(id, _)| id);

    if b.every.trim().is_empty() {
        if let Some(id) = existing {
            conn.execute("DELETE FROM schedules WHERE id = ?1", params![id])
                .map_err(err)?;
        }
        return Ok(None);
    }

    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE schedules SET name=?1, every=?2, at_min=?3, days=?4, enabled=1, catch_up=1 \
                 WHERE id=?5",
                params![b.name.trim(), b.every, b.at_min, b.days, id],
            )
            .map_err(err)?;
            Ok(Some(id))
        }
        None => {
            // catch_up = 1, unlike a reminder. A reminder cannot be late
            // because it is about a moment that has passed; a wake reads the
            // space at the instant it runs, so a late one reports today, not
            // yesterday. Marking it missed instead would put "Missed: X bot" in
            // your inbox every morning you left the app closed overnight —
            // which is a stream you stop reading, for the sake of a distinction
            // that does not exist here.
            conn.execute(
                "INSERT INTO schedules (name, kind, node_id, every, at_min, days, payload, catch_up) \
                 VALUES (?1, 'bot', ?2, ?3, ?4, ?5, '', 1)",
                params![b.name.trim(), b.node_id, b.every, b.at_min, b.days],
            )
            .map_err(err)?;
            Ok(Some(conn.last_insert_rowid()))
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Where a bot lives: the vault folder, always.
///
/// This used to be `node_dir`, which answers a different question — where
/// work *runs* — and returns the repository for a node that names one. That
/// put `_bot.md` and `.devdeck/features` inside the repository while the agent
/// runtime read features from the vault folder, so on any project with a
/// repository a bot's plan was invisible to the agent it woke. It also put our
/// files in somebody's pull request, which is the thing the AI Workspace
/// deliberately moved out of the repository to avoid.
fn dir_of(conn: &Connection, node: &db::Node) -> Option<PathBuf> {
    let deck = db::node_deck_dir(conn, node)?;
    // A bot written under the old rule is sitting in the repository, where
    // nothing will look for it again. Move it once rather than letting it
    // quietly stop existing — a bot that vanishes reads exactly like a bot
    // that was never made.
    if let Some(code) = db::node_dir(conn, node) {
        if code != deck {
            let (from, to) = (code.join(FILE), deck.join(FILE));
            if from.is_file() && !to.is_file() {
                if fs::create_dir_all(&deck).is_ok() && fs::rename(&from, &to).is_ok() {
                    eprintln!(
                        "[bots] moved {} out of the repository and into the vault",
                        from.display()
                    );
                }
            }
        }
    }
    Some(deck)
}

/// Every bot in the vault, read through a connection someone else is holding.
///
/// The listing command reconciles heartbeats as well; this one only reads, so
/// it is safe to call from inside another command's lock — which is what a
/// thread does when it has to work out whether `@marketing` is anybody.
pub fn all_bots(conn: &Connection) -> Vec<Bot> {
    let mut out = Vec::new();
    for n in db::nodes_on(conn).unwrap_or_default() {
        let Some(dir) = dir_of(conn, &n) else { continue };
        let Some(mut b) = read(&dir) else { continue };
        b.node_id = n.id;
        b.node_name = n.name.clone();
        b.dir = dir.to_string_lossy().to_string();
        if b.name.trim().is_empty() {
            b.name = format!("{} bot", n.name);
        }
        out.push(b);
    }
    out
}

/// Whether a bot answers to `@name`.
///
/// People type the short thing: `@x-platform` for "x-platform bot", or
/// `@marketing` for "Marketing site bot". So a mention matches the node's
/// name, the bot's name with spaces hyphenated, or the first word of either —
/// and never on a bare prefix of something longer, which would make `@dev`
/// silently reach a bot called "dev-tools bot".
pub fn answers_to(b: &Bot, mention: &str) -> bool {
    let m = mention.trim().to_lowercase();
    if m.is_empty() {
        return false;
    }
    let slug = |s: &str| s.trim().to_lowercase().replace(' ', "-");
    let first = |s: &str| s.trim().to_lowercase().split_whitespace().next().unwrap_or("").to_string();
    slug(&b.node_name) == m
        || slug(&b.name) == m
        || format!("{}-bot", slug(&b.node_name)) == m
        || first(&b.node_name) == m
        || first(&b.name) == m
}

/// Every bot in the vault. Cheap enough to call on every visit: it is one
/// small read per node that has a folder, and nodes are counted in dozens.
///
/// Listing also *reconciles* — a `_bot.md` written by hand, pulled from a
/// colleague's branch or restored from a backup gets its `schedules` row here.
/// Without that a bot could sit on disk saying "weekdays at 07:00" and never
/// once wake, which is the flavour of silent failure the update checker taught
/// us to design out: a routine that is displayed must be a routine that runs.
#[tauri::command]
pub fn bots_list(db: tauri::State<Db>) -> Result<Vec<Bot>, String> {
    let conn = db.0.lock().unwrap();
    let mut out = Vec::new();
    let mut seen = Vec::new();
    for n in db::nodes_on(&conn)? {
        let Some(dir) = dir_of(&conn, &n) else { continue };
        let Some(mut b) = read(&dir) else { continue };
        b.node_id = n.id;
        b.node_name = n.name.clone();
        b.dir = dir.to_string_lossy().to_string();
        if b.name.trim().is_empty() {
            b.name = format!("{} bot", n.name);
        }
        b.schedule_id = sync_heartbeat(&conn, &b)?;
        if let Some((_, last)) = heartbeat(&conn, n.id) {
            b.last_woke = last;
        }
        seen.push(n.id);
        out.push(b);
    }

    // A heartbeat whose `_bot.md` is gone — deleted in Explorer, or on a branch
    // that never had it — has nothing left to wake for.
    if !seen.is_empty() {
        let list = seen
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        conn.execute(
            &format!("DELETE FROM schedules WHERE kind = 'bot' AND node_id NOT IN ({list})"),
            [],
        )
        .map_err(err)?;
    } else {
        conn.execute("DELETE FROM schedules WHERE kind = 'bot'", [])
            .map_err(err)?;
    }
    Ok(out)
}

#[tauri::command]
pub fn bot_get(db: tauri::State<Db>, node_id: i64) -> Result<Option<Bot>, String> {
    let conn = db.0.lock().unwrap();
    let n = db::node_by_id(&conn, node_id)?;
    let Some(dir) = dir_of(&conn, &n) else {
        return Ok(None);
    };
    let Some(mut b) = read(&dir) else {
        return Ok(None);
    };
    b.node_id = n.id;
    b.node_name = n.name;
    b.dir = dir.to_string_lossy().to_string();
    if let Some((id, last)) = heartbeat(&conn, node_id) {
        b.schedule_id = Some(id);
        b.last_woke = last;
    }
    Ok(Some(b))
}

/// Set when something happens, from a sentence.
///
/// The whole point is that this writes *the same two things the form writes*:
/// a line in `_bot.md` and a row on the clock. A sentence that produced a
/// third kind of routine would be a second way to configure the same thing,
/// and the two would drift the first week.
///
/// A space with no bot gets a plain reminder instead of one being invented for
/// it — a routine is a small thing to agree to, a bot is not.
pub fn set_routine(
    conn: &Connection,
    node_id: i64,
    what: &str,
    every: &str,
    at_min: i64,
    on: &str,
) -> Result<String, String> {
    let n = db::node_by_id(conn, node_id)?;
    let bot = dir_of(conn, &n).and_then(|dir| {
        read(&dir).map(|mut b| {
            b.node_id = node_id;
            b.node_name = n.name.clone();
            b.dir = dir.to_string_lossy().to_string();
            b
        })
    });

    // An event routine wakes a bot, so it needs one. Saying so beats writing a
    // row that can never fire.
    if every == "event" {
        let Some(b) = bot else {
            return Err(format!(
                "An event routine wakes a bot, and {} has none yet. Give it a bot first.",
                n.name
            ));
        };
        if on.trim().is_empty() {
            return Err("Say which event should fire it, e.g. test.failed.".into());
        }
        let name = format!("{} · {}", b.name.trim(), what.trim());
        conn.execute(
            "DELETE FROM schedules WHERE kind='bot' AND node_id=?1 AND every='event' AND payload=?2",
            params![node_id, on.trim()],
        )
        .map_err(err)?;
        conn.execute(
            "INSERT INTO schedules (name, kind, node_id, every, at_min, days, payload, catch_up) \
             VALUES (?1, 'bot', ?2, 'event', 0, '', ?3, 0)",
            params![name, node_id, on.trim()],
        )
        .map_err(err)?;
        return Ok(format!(
            "Set. \"{}\" now runs when {} happens — an event on the clock, not a time.",
            what.trim(),
            on.trim()
        ));
    }

    match bot {
        Some(mut b) => {
            b.every = every.trim().to_string();
            b.at_min = at_min;
            let dir = std::path::PathBuf::from(&b.dir);
            write(&dir, &b)?;
            sync_heartbeat(conn, &b)?;
            Ok(format!(
                "Set. {} wakes {} at {} — it is a row on the clock and a line in {}, so editing \
                 either changes it.",
                b.name.trim(),
                if b.every == "hourly" { "every hour".into() } else { b.every.clone() },
                fmt_at(b.at_min),
                FILE
            ))
        }
        None => {
            conn.execute(
                "INSERT INTO schedules (name, kind, node_id, every, at_min, days, payload, catch_up) \
                 VALUES (?1, 'reminder', ?2, ?3, ?4, '', ?1, 0)",
                params![what.trim(), node_id, every.trim(), at_min],
            )
            .map_err(err)?;
            Ok(format!(
                "Set. \"{}\" is a reminder on {} — {} at {}. Nothing watches this space yet, so \
                 it tells you rather than doing anything.",
                what.trim(),
                n.name,
                every.trim(),
                fmt_at(at_min)
            ))
        }
    }
}

/// Write a bot's file and make the clock agree with it.
///
/// Split out from the command so the whole lifecycle can be driven in a test
/// without a running app — the behaviour worth checking should not be reachable
/// only through a window.
#[allow(clippy::too_many_arguments)]
/// Tidy a team and refuse a lead who is not on it.
///
/// A bot manages, so the team is who it may put work on — a limit, not a
/// description. Letting it wake an agent that is not on the team would make
/// the limit read like an answer while being none.
fn vet_team(name: &str, agent: &str, team: Vec<String>) -> Result<Vec<String>, String> {
    let team: Vec<String> = team
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .collect();
    if !agent.trim().is_empty() && !team.iter().any(|a| a == agent.trim()) {
        return Err(format!(
            "{} is not on {}'s team, so it cannot be the one it wakes. Add it to the team first.",
            agent.trim(),
            name
        ));
    }
    Ok(team)
}

fn save_into(
    conn: &Connection,
    node_id: i64,
    name: &str,
    goal: &str,
    every: &str,
    at_min: i64,
    days: &str,
    body: &str,
    skills: Vec<String>,
    agent: &str,
    team: Vec<String>,
    wake_intent: &str,
) -> Result<(Bot, bool), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the bot a name.".into());
    }
    if goal.trim().is_empty() {
        return Err(
            "A bot needs a goal. Without one it has nothing to judge a suggestion against.".into(),
        );
    }

    let n = db::node_by_id(conn, node_id)?;
    let dir = dir_of(conn, &n).ok_or("That folder has no place on disk yet.")?;
    if !dir.is_dir() {
        return Err(format!("{} is not there.", dir.display()));
    }

    let team = vet_team(name, agent, team)?;

    // Two fields the editor never sends, and must never lose: which starter it
    // came from and which feature holds its work. Saving a name change is not a
    // reason to forget where a bot's plan lives.
    let existing = read(&dir);
    let created = existing.is_none();

    let mut b = Bot {
        node_id,
        node_name: n.name.clone(),
        dir: dir.to_string_lossy().to_string(),
        name: name.to_string(),
        goal: goal.trim().to_string(),
        every: every.trim().to_string(),
        at_min: at_min.clamp(0, 1439),
        days: days.to_string(),
        body: body.to_string(),
        skills: skills.into_iter().filter(|s| !s.trim().is_empty()).collect(),
        template: existing.as_ref().map(|e| e.template.clone()).unwrap_or_default(),
        feature: existing.as_ref().map(|e| e.feature.clone()).unwrap_or_default(),
        agent: agent.trim().to_string(),
        team,
        wake_intent: wake_intent.trim().to_string(),
        // Review points are edited in the file rather than in the form:
        // "not without me" is a sentence, and a checkbox would have to
        // pretend it is a permission.
        stop_at: existing.as_ref().map(|e| e.stop_at.clone()).unwrap_or_default(),
        schedule_id: None,
        last_woke: None,
    };
    write(&dir, &b)?;
    b.schedule_id = sync_heartbeat(conn, &b)?;
    if let Some((_, last)) = heartbeat(conn, node_id) {
        b.last_woke = last;
    }
    Ok((b, created))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn bot_save(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node_id: i64,
    name: String,
    goal: String,
    every: String,
    at_min: i64,
    days: String,
    body: String,
    skills: Vec<String>,
    agent: String,
    team: Vec<String>,
    wake_intent: String,
) -> Result<Bot, String> {
    let (bot, created) = {
        let conn = db.0.lock().unwrap();
        save_into(
            &conn, node_id, &name, &goal, &every, at_min, &days, &body, skills, &agent, team,
            &wake_intent,
        )?
    };

    crate::activity::record(
        &app,
        "bot",
        format!("{} {}", bot.name, if created { "created" } else { "changed" }),
        bot.goal.clone(),
        true,
        Some(node_id),
    );
    Ok(bot)
}

/// Remove the bot, and only the bot.
///
/// The folder, its work items and everything else in the space stay. What it
/// knew about *you* goes — leaving that behind would mean the next bot on this
/// folder inheriting a stranger's answers, and a bot quoting an interview you
/// never gave it is worse than one that knows nothing.
fn delete_into(conn: &Connection, mind: &Mind, node_id: i64) -> Result<String, String> {
    let n = db::node_by_id(conn, node_id)?;
    let dir = dir_of(conn, &n).ok_or("That folder has no place on disk.")?;
    let name = read(&dir).map(|b| b.name).unwrap_or_else(|| n.name.clone());
    let _ = fs::remove_file(dir.join(FILE));
    conn.execute(
        "DELETE FROM schedules WHERE kind = 'bot' AND node_id = ?1",
        params![node_id],
    )
    .map_err(err)?;
    mind.forget(node_id);
    Ok(name)
}

#[tauri::command]
pub fn bot_delete(app: tauri::AppHandle, db: tauri::State<Db>, node_id: i64) -> Result<(), String> {
    let name = {
        let conn = db.0.lock().unwrap();
        delete_into(&conn, &mind()?, node_id)?
    };
    crate::activity::record(
        &app,
        "bot",
        format!("{name} removed"),
        "Its folder and its work items are untouched. What it knew about you is gone.",
        true,
        Some(node_id),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// The work
// ---------------------------------------------------------------------------

/// A work item, plus the feature it sits in. The bot does not own these — they
/// are the project's, in `.devdeck`, committed, and a teammate who never opens
/// DevDeck can still read them.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkRow {
    pub id: String,
    pub title: String,
    /// unclaimed | claimed | in-progress | blocked | done
    pub status: String,
    pub assignee: Option<String>,
    pub feature: String,
}

pub const STATUSES: [&str; 5] = ["unclaimed", "claimed", "in-progress", "blocked", "done"];

fn deck_of(conn: &Connection, node_id: i64) -> Result<(crate::aiw::deck::Deck, PathBuf), String> {
    let n = db::node_by_id(conn, node_id)?;
    let dir = dir_of(conn, &n).ok_or("That folder has no place on disk.")?;
    Ok((crate::aiw::deck::Deck::new(&dir), dir))
}

/// Every step this bot is managing. Reads the bot's own feature when it has
/// one, and everything in the deck otherwise — a bot dropped onto a project
/// that already had features should show you the work that is there, not
/// pretend the space is empty.
#[tauri::command]
pub fn bot_work(db: tauri::State<Db>, node_id: i64) -> Result<Vec<WorkRow>, String> {
    let conn = db.0.lock().unwrap();
    let (deck, dir) = deck_of(&conn, node_id)?;
    if !deck.exists() {
        return Ok(vec![]);
    }
    let only = read(&dir).map(|b| b.feature).unwrap_or_default();

    let mut out = Vec::new();
    for slug in deck.feature_slugs() {
        if !only.is_empty() && slug != only {
            continue;
        }
        let Ok(work) = deck.work(&slug) else { continue };
        for item in work.meta.items {
            out.push(WorkRow {
                id: item.id,
                title: item.title,
                status: if item.status.is_empty() { "unclaimed".into() } else { item.status },
                assignee: item.assignee,
                feature: slug.clone(),
            });
        }
    }
    Ok(out)
}

/// Give the bot's goal a plan: a feature in the deck, one work item per step.
///
/// This writes into the project's committed context, which is a bigger gesture
/// than dropping one file in a folder — so it happens on purpose, from a
/// button, and never as a side effect of creating a bot.
fn plan_into(conn: &Connection, node_id: i64, steps: &[String]) -> Result<(String, String, usize), String> {
    let (deck, dir) = deck_of(conn, node_id)?;
    let n = db::node_by_id(conn, node_id)?;
    let mut bot = read(&dir).ok_or("There is no bot in that folder.")?;

    if !deck.exists() {
        deck.init(&node_id.to_string(), &n.name)?;
    }

    // Reuse the bot's feature when it has one; the plan is a living list, and a
    // second "add steps" must not fork it.
    //
    // And when it has none, *adopt* a feature that already carries this slug
    // rather than refusing. Work items outlive the bot on purpose — they are
    // the project's — so deleting a bot and making another one for the same
    // goal is an ordinary thing to do, and it used to fail with
    // "feature already exists" after the new `_bot.md` had already been
    // written. Adopting is also what you want: those steps are about this goal.
    // Both adoption paths check for `feature.md`, not just the directory. A
    // directory alone is half a feature — the agent runtime loads the feature
    // document, so adopting one without it produces a plan that reads fine on
    // the Plan tab and fails the moment an agent is asked to work on it. The
    // first version of this guard only covered the second branch, which meant a
    // bot that already had a feature name skipped it entirely.
    let slug = if !bot.feature.is_empty() && deck.feature_md(&bot.feature).is_file() {
        bot.feature.clone()
    } else if !bot.feature.is_empty() && deck.feature_dir(&bot.feature).exists() {
        return Err(format!(
            ".devdeck/features/{} exists but has no feature.md, so an agent could not load it. Move or remove it, then try again.",
            bot.feature
        ));
    } else {
        let base = if bot.goal.trim().is_empty() { bot.name.clone() } else { bot.goal.clone() };
        let candidate = crate::aiw::deck::slugify(&base);
        if candidate.is_empty() {
            deck.create_feature(&base, &bot.goal, &[])?
        } else if deck.feature_md(&candidate).is_file() {
            // A complete feature from a previous bot on this space: adopt it.
            candidate
        } else if deck.feature_dir(&candidate).exists() {
            // A directory with no `feature.md` is a half-made feature, and
            // adopting one produces a plan the agent runtime cannot load. Say
            // so rather than writing work items into something broken.
            return Err(format!(
                ".devdeck/features/{candidate} exists but has no feature.md. Move or remove it, then try again."
            ));
        } else {
            deck.create_feature(&base, &bot.goal, &[])?
        }
    };

    let mut work = deck.work(&slug)?.meta;
    work.feature = slug.clone();
    let mut added = 0usize;
    for title in steps {
        // Titles are the identity here — applying the same plan twice should
        // not double every line.
        if work.items.iter().any(|i| i.title.eq_ignore_ascii_case(title)) {
            continue;
        }
        work.items.push(crate::aiw::deck::WorkItem {
            id: next_work_id(&work.items),
            title: title.clone(),
            status: "unclaimed".into(),
            assignee: None,
            areas: vec![],
        });
        added += 1;
    }
    deck.save_work(&slug, &work)?;

    bot.feature = slug.clone();
    write(&dir, &bot)?;
    Ok((slug, bot.name, added))
}

#[tauri::command]
pub fn bot_plan(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node_id: i64,
    steps: Vec<String>,
) -> Result<String, String> {
    let steps: Vec<String> = steps
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if steps.is_empty() {
        return Err("A plan needs at least one step.".into());
    }

    let (slug, name, added) = {
        let conn = db.0.lock().unwrap();
        plan_into(&conn, node_id, &steps)?
    };

    crate::activity::record(
        &app,
        "bot",
        format!("{name} has a plan"),
        format!(
            "{added} step{} in .devdeck/features/{slug}",
            if added == 1 { "" } else { "s" }
        ),
        true,
        Some(node_id),
    );
    Ok(slug)
}

fn next_work_id(items: &[crate::aiw::deck::WorkItem]) -> String {
    let mut n = items.len() + 1;
    loop {
        let candidate = format!("w{n}");
        if !items.iter().any(|i| i.id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Add or change one step. `id` empty means a new one.
#[tauri::command]
pub fn bot_work_save(
    db: tauri::State<Db>,
    node_id: i64,
    id: String,
    title: String,
    status: String,
    assignee: Option<String>,
) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("A step needs a title.".into());
    }
    if !STATUSES.contains(&status.as_str()) {
        return Err(format!("{status} is not a status a step can be in."));
    }

    let conn = db.0.lock().unwrap();
    let (deck, dir) = deck_of(&conn, node_id)?;
    let mut bot = read(&dir).ok_or("There is no bot in that folder.")?;
    let n = db::node_by_id(&conn, node_id)?;
    if !deck.exists() {
        deck.init(&node_id.to_string(), &n.name)?;
    }

    let slug = if !bot.feature.is_empty() && deck.feature_dir(&bot.feature).exists() {
        bot.feature.clone()
    } else {
        let base = if bot.goal.trim().is_empty() { bot.name.clone() } else { bot.goal.clone() };
        let s = deck.create_feature(&base, &bot.goal, &[])?;
        bot.feature = s.clone();
        write(&dir, &bot)?;
        s
    };

    let mut work = deck.work(&slug)?.meta;
    work.feature = slug.clone();
    match work.items.iter_mut().find(|i| i.id == id) {
        Some(item) => {
            item.title = title;
            item.status = status;
            item.assignee = assignee.filter(|a| !a.trim().is_empty());
        }
        None => work.items.push(crate::aiw::deck::WorkItem {
            id: if id.trim().is_empty() { next_work_id(&work.items) } else { id },
            title,
            status,
            assignee: assignee.filter(|a| !a.trim().is_empty()),
            areas: vec![],
        }),
    }
    deck.save_work(&slug, &work)
}

#[tauri::command]
pub fn bot_work_delete(db: tauri::State<Db>, node_id: i64, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let (deck, dir) = deck_of(&conn, node_id)?;
    let bot = read(&dir).ok_or("There is no bot in that folder.")?;
    let slug = if bot.feature.is_empty() { return Ok(()) } else { bot.feature };
    let mut work = deck.work(&slug)?.meta;
    work.items.retain(|i| i.id != id);
    deck.save_work(&slug, &work)
}

// ---------------------------------------------------------------------------
// Starters
// ---------------------------------------------------------------------------

/// Make a bot from a starter: the file, its standards, its skills, and — when
/// asked — its steps as work items.
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_into(
    conn: &Connection,
    node_id: i64,
    template_id: &str,
    name: &str,
    goal: &str,
    every: &str,
    at_min: i64,
    days: &str,
    with_plan: bool,
) -> Result<Bot, String> {
    let tpl = crate::botcatalog::get(template_id);
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the bot a name.".into());
    }
    if goal.trim().is_empty() {
        return Err(
            "A bot needs a goal. Without one it has nothing to judge a suggestion against.".into(),
        );
    }

    let n = db::node_by_id(conn, node_id)?;
    let dir = dir_of(conn, &n).ok_or("That folder has no place on disk yet.")?;
    if !dir.is_dir() {
        return Err(format!("{} is not there.", dir.display()));
    }
    // A folder has at most one bot. Two would each think they owned the goal.
    if read(&dir).is_some() {
        return Err(format!("{} already has a bot.", n.name));
    }

    // Standards go in the body, not the frontmatter, because they are the part
    // you will argue with — and a standard you cannot edit is someone else's.
    let body = match &tpl {
        Some(t) if !t.standards.is_empty() => {
            let mut s = String::from("## What it holds the work to\n\n");
            for line in &t.standards {
                s.push_str(&format!("- {line}\n"));
            }
            s
        }
        _ => String::new(),
    };

    let mut b = Bot {
        node_id,
        node_name: n.name.clone(),
        dir: dir.to_string_lossy().to_string(),
        name: name.to_string(),
        goal: goal.trim().to_string(),
        every: every.trim().to_string(),
        at_min: at_min.clamp(0, 1439),
        days: days.to_string(),
        body,
        skills: tpl.as_ref().map(|t| t.skills.clone()).unwrap_or_default(),
        template: tpl.as_ref().map(|t| t.id.clone()).unwrap_or_default(),
        feature: String::new(),
        // A new bot watches. Naming who it manages — and which of them it
        // wakes — is a separate, deliberate act.
        agent: String::new(),
        team: vec![],
        wake_intent: String::new(),
        // A new bot has no review points. They are the kind of rule you add
        // once you have seen it do something you would rather see first.
        stop_at: vec![],
        schedule_id: None,
        last_woke: None,
    };
    write(&dir, &b)?;
    b.schedule_id = sync_heartbeat(conn, &b)?;

    // "Make it" makes what you asked for, or nothing. A bot left on disk beside
    // an error about its plan is a state you then have to clean up by hand.
    if with_plan {
        if let Some(t) = &tpl {
            if !t.steps.is_empty() {
                if let Err(e) = plan_into(conn, node_id, &t.steps) {
                    let _ = fs::remove_file(dir.join(FILE));
                    let _ = conn.execute(
                        "DELETE FROM schedules WHERE kind = 'bot' AND node_id = ?1",
                        params![node_id],
                    );
                    return Err(e);
                }
            }
        }
    }

    // Re-read so the caller gets the feature the plan just set.
    let mut fresh = read(&dir).unwrap_or(b);
    fresh.node_id = node_id;
    fresh.node_name = n.name;
    fresh.dir = dir.to_string_lossy().to_string();
    if let Some((id, last)) = heartbeat(conn, node_id) {
        fresh.schedule_id = Some(id);
        fresh.last_woke = last;
    }
    Ok(fresh)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn bot_create(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node_id: i64,
    template_id: String,
    name: String,
    goal: String,
    every: String,
    at_min: i64,
    days: String,
    with_plan: bool,
) -> Result<Bot, String> {
    let bot = {
        let conn = db.0.lock().unwrap();
        create_into(
            &conn,
            node_id,
            &template_id,
            &name,
            &goal,
            &every,
            at_min,
            &days,
            with_plan,
        )?
    };

    crate::activity::record(
        &app,
        "bot",
        format!("{} created", bot.name),
        bot.goal.clone(),
        true,
        Some(node_id),
    );
    Ok(bot)
}

// ---------------------------------------------------------------------------
// Waking
// ---------------------------------------------------------------------------

/// What the bot found when it woke, or None when there is nothing worth
/// saying. Silence is the common case and the correct one — a heartbeat that
/// reports "all clear" every morning is a heartbeat you filter out.
pub fn wake_report(conn: &Connection, node_id: i64) -> Option<String> {
    let n = db::node_by_id(conn, node_id).ok()?;
    let dir = dir_of(conn, &n)?;
    let deck = crate::aiw::deck::Deck::new(&dir);
    if !deck.exists() {
        return None;
    }

    let mut unclaimed = 0usize;
    let mut blocked = 0usize;
    for slug in deck.feature_slugs() {
        let Ok(work) = deck.work(&slug) else { continue };
        for item in &work.meta.items {
            match item.status.as_str() {
                "unclaimed" | "" => unclaimed += 1,
                "blocked" => blocked += 1,
                _ => {}
            }
        }
    }

    if unclaimed == 0 && blocked == 0 {
        return None;
    }
    let mut parts = Vec::new();
    if blocked > 0 {
        parts.push(format!("{blocked} blocked"));
    }
    if unclaimed > 0 {
        parts.push(format!("{unclaimed} waiting to be picked up"));
    }
    Some(parts.join(", "))
}

// ---------------------------------------------------------------------------
// What it knows about you
// ---------------------------------------------------------------------------
//
// Everything below reads and writes the *personal* store. It is in this file
// rather than in `botmind.rs` because these are the Tauri entry points and the
// UI can only call what is registered — but not one of them touches the vault,
// and none of it is committable.

use crate::botmind::{self as mind_ops, BeliefView, InterviewView, Mind, Suggestion};

fn mind() -> Result<Mind, String> {
    Mind::open()
}

fn now() -> String {
    crate::aiw::events::now_iso()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[tauri::command]
pub fn bot_interview(node_id: i64) -> Result<InterviewView, String> {
    mind_ops::interview(&mind()?, node_id)
}

#[tauri::command]
pub fn bot_answer(
    node_id: i64,
    step: usize,
    answer: String,
    skipped: bool,
) -> Result<InterviewView, String> {
    mind_ops::answer_question(&mind()?, node_id, step, &answer, skipped, &now())
}

#[tauri::command]
pub fn bot_interview_reset(node_id: i64) -> Result<InterviewView, String> {
    mind_ops::reset_interview(&mind()?, node_id)
}

#[tauri::command]
pub fn bot_beliefs(node_id: i64) -> Result<Vec<BeliefView>, String> {
    mind_ops::beliefs(&mind()?, node_id, now_ms())
}

#[tauri::command]
pub fn bot_belief_add(node_id: i64, text: String) -> Result<(), String> {
    mind_ops::add_belief(&mind()?, node_id, &text, &now())
}

#[tauri::command]
pub fn bot_belief_correct(node_id: i64, id: String, text: String) -> Result<(), String> {
    mind_ops::correct_belief(&mind()?, node_id, &id, &text)
}

#[tauri::command]
pub fn bot_belief_pin(node_id: i64, id: String, pinned: bool) -> Result<(), String> {
    mind_ops::pin_belief(&mind()?, node_id, &id, pinned)
}

#[tauri::command]
pub fn bot_belief_drop(node_id: i64, id: String) -> Result<(), String> {
    mind_ops::drop_belief(&mind()?, node_id, &id)
}

#[tauri::command]
pub fn bot_belief_drop_stale(node_id: i64) -> Result<usize, String> {
    mind_ops::drop_stale(&mind()?, node_id, now_ms())
}

// -- what it could use -----------------------------------------------------

/// A tool the bot could use, and what you have already said about it.
#[derive(Serialize, Clone, Debug)]
pub struct ToolView {
    #[serde(flatten)]
    pub offer: crate::botcatalog::ToolOffer,
    /// added | declined | empty when you have not said.
    pub decided: String,
}

#[tauri::command]
pub fn bot_tools(db: tauri::State<Db>, node_id: i64) -> Result<Vec<ToolView>, String> {
    let bot = {
        let conn = db.0.lock().unwrap();
        let (_, dir) = deck_of(&conn, node_id)?;
        read(&dir)
    };
    let Some(bot) = bot else { return Ok(vec![]) };

    // A bot made by hand still gets offered things: its template is empty, so
    // it sees the whole catalog rather than nothing at all.
    let offers: Vec<crate::botcatalog::ToolOffer> = match crate::botcatalog::get(&bot.template) {
        Some(t) if !t.tools.is_empty() => t.tools,
        _ => crate::botcatalog::all().into_iter().flat_map(|t| t.tools).collect(),
    };

    let decided = mind()?.read(node_id)?.meta.tools;
    Ok(offers
        .into_iter()
        .map(|o| ToolView {
            decided: decided
                .iter()
                .find(|d| d.id == o.id)
                .map(|d| d.response.clone())
                .unwrap_or_default(),
            offer: o,
        })
        .collect())
}

/// Say yes or no to a tool.
///
/// Saying yes to a *skill* writes it onto the bot, because a skill is only
/// words. Every other rung returns a sentence saying what you would have to do
/// yourself — this never installs anything, starts anything, or grants
/// anything, and pretending otherwise would be the worst lie this app could
/// tell.
#[tauri::command]
pub fn bot_tool_decide(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node_id: i64,
    tool_id: String,
    response: String,
) -> Result<String, String> {
    if response != "added" && response != "declined" {
        return Err("A tool is either added or declined.".into());
    }
    let offer = crate::botcatalog::tool_by_id(&tool_id).ok_or("No such tool.")?;

    mind_ops::record_tool(&mind()?, node_id, &tool_id, &response, &now())?;

    if response == "declined" {
        return Ok(String::new());
    }

    match offer.kind.as_str() {
        "skill" => {
            // Write under the lock, log without it. `activity::record` takes the
            // same mutex, so recording while still holding it deadlocks the main
            // thread — the app then freezes with no error at all, which is the
            // third time this exact shape has bitten this codebase (the
            // scheduler's first tick, and `schedule_run_now` before it).
            let name = {
                let conn = db.0.lock().unwrap();
                let (_, dir) = deck_of(&conn, node_id)?;
                let mut bot = read(&dir).ok_or("There is no bot in that folder.")?;
                let slug = crate::aiw::deck::slugify(&offer.name);
                if !bot.skills.contains(&slug) {
                    bot.skills.push(slug);
                }
                write(&dir, &bot)?;
                bot.name
            };
            crate::activity::record(
                &app,
                "bot",
                format!("{name} learned {}", offer.name),
                "A skill is words. Nothing was installed and nothing gained permissions.",
                true,
                Some(node_id),
            );
            Ok(String::new())
        }
        "agent" => Ok(format!(
            "Noted. {} is not wired to the agent runtime yet — you would add it under Assistant.",
            offer.name
        )),
        "software" => Ok(format!(
            "Noted. Install {} yourself from Machine. DevDeck never installs anything on your behalf.",
            offer.name
        )),
        _ => Ok(format!(
            "Noted. {} would run as a service in this space; set it up on the project when you want it.",
            offer.name
        )),
    }
}

// -- what it suggests ------------------------------------------------------

#[tauri::command]
pub fn bot_suggestions(db: tauri::State<Db>, node_id: i64) -> Result<Vec<Suggestion>, String> {
    let (bot, work) = {
        let conn = db.0.lock().unwrap();
        let (deck, dir) = deck_of(&conn, node_id)?;
        let Some(bot) = read(&dir) else { return Ok(vec![]) };
        let mut items = Vec::new();
        if deck.exists() {
            for slug in deck.feature_slugs() {
                if !bot.feature.is_empty() && slug != bot.feature {
                    continue;
                }
                if let Ok(w) = deck.work(&slug) {
                    items.extend(w.meta.items);
                }
            }
        }
        (bot, items)
    };

    let doc = mind()?.read(node_id)?;
    let offers: Vec<crate::botcatalog::ToolOffer> = match crate::botcatalog::get(&bot.template) {
        Some(t) => t.tools,
        None => vec![],
    };
    let now = chrono::Utc::now().timestamp_millis();

    let sig = crate::botmind::Signals {
        goal: bot.goal.clone(),
        every: bot.every.clone(),
        last_woke: bot.last_woke,
        work: &work,
        answered: doc.meta.answers.iter().filter(|a| !a.skipped).count(),
        skipped: doc.meta.answers.iter().filter(|a| a.skipped).count(),
        offers: &offers,
        decided: &doc.meta.tools,
        now_ms: now,
    };
    Ok(crate::botmind::filter_answered(
        crate::botmind::derive(&sig),
        &doc.meta.suggestions,
        now,
    ))
}

/// Answer a suggestion. "Not now" comes back in a week; "wrong" never does, and
/// the reason you gave becomes something it knows — which is the whole point of
/// asking for one.
#[tauri::command]
pub fn bot_suggestion_answer(
    node_id: i64,
    id: String,
    response: String,
    why: String,
) -> Result<(), String> {
    mind_ops::answer_suggestion(&mind()?, node_id, &id, &response, &why, now_ms(), &now())
}

/// The bot on a node, read under a lock the caller already holds.
///
/// Separate from `bot_get` because the scheduler gathers everything it needs
/// while it has the database and then lets go — running a wake can take
/// minutes, and holding the lock across it would freeze the app.
pub fn bot_on(conn: &Connection, node_id: i64) -> Option<Bot> {
    let n = db::node_by_id(conn, node_id).ok()?;
    let dir = dir_of(conn, &n)?;
    let mut b = read(&dir)?;
    b.node_id = node_id;
    b.node_name = n.name;
    b.dir = dir.to_string_lossy().to_string();
    Some(b)
}

/// The repository a node names, if it names one. Read through the database
/// because the bot file does not carry it — `_devdeck.md` does.
fn repo_of(app: &tauri::AppHandle, node_id: i64) -> Option<PathBuf> {
    use tauri::Manager;
    let db = app.try_state::<Db>()?;
    let conn = db.0.lock().ok()?;
    let n = db::node_by_id(&conn, node_id).ok()?;
    n.path.filter(|p| !p.trim().is_empty()).map(PathBuf::from)
}

// ---------------------------------------------------------------------------
// The bot's own thread
// ---------------------------------------------------------------------------

/// The voice a bot speaks in. Built from `_bot.md` every time, so editing the
/// file changes the bot — nothing is cached about who it is.
///
/// Permissions are the named agent's, when there is one. A bot with no agent
/// is given an id the matrix has never heard of, which gets it nothing: it
/// can answer questions about its space and cannot touch anything. That is
/// the honest shape of "a bot that watches", and it is the same rule that
/// governs its wake.
pub fn persona(bot: &Bot) -> crate::aiw::assistant::Persona {
    let acts = !bot.agent.trim().is_empty();
    let mut system = format!(
        "You are {}, the bot managing {}. You run this space: you read it, keep its plan, and get its work done — mostly by putting other people on it, and sometimes by doing it yourself. Be brief and concrete. Say plainly what you did, what you did not, and what needs a person.

The receipts in the thread are the record. A line such as \"claimed by @dev-a\" means work moved; a line such as \"could not take it\" or \"nothing moved\" means it did not, whatever you intended. Never say a claim moved, an item was assigned, or work is in progress unless a receipt in this thread says so. If a handover was refused, say it was refused and why.",
        bot.name, bot.node_name
    );
    if !bot.goal.trim().is_empty() {
        system.push_str(&format!("\n\nYour goal: {}", bot.goal.trim()));
    }
    if !bot.body.trim().is_empty() {
        system.push_str(&format!("\n\n{}", bot.body.trim()));
    }
    if !bot.team.is_empty() {
        system.push_str(&format!(
            "\n\nYour team — the agents you may put work on: {}. Anyone the person pulls into \
             your thread with @ joins it.",
            bot.team.join(", ")
        ));
    }
    system.push_str(
        "\n\nWhat you can actually do, and how:\n\
         - Put someone on an item: write @name take \"title\" in your reply. That starts them \
           in a session and posts a receipt here.\n\
         - Keep the plan: work.add to put something on it, work.done when a receipt shows it \
           finished, work.drop to let go of one nobody is doing. work.list to see it.",
    );
    if acts {
        system.push_str(&format!(
            "\n         - Do it yourself: @{} take \"title\", or @me take \"title\". You run as \
             that agent, in a real session, with a receipt like anyone else's. Prefer handing \
             work to your team when there is someone for it; take it yourself when there is not, \
             or when it is small.",
            bot.agent.trim()
        ));
    } else {
        system.push_str(
            "\n         - You name no agent, so you cannot run tools on the machine or a session yourself. You can still \
             plan, and put your team on things. If something needs hands and nobody has them, \
             say so — someone will name an agent for you under Settings.",
        );
    }
    crate::aiw::assistant::Persona {
        hand_on_to: Vec::new(),
        // A manager keeps its own plan, with or without an agent. This is the
        // only thing a bot may do without a row in the permission matrix, and
        // it writes work items in the deck — never the machine.
        manages_with: vec![crate::aiw::tools::TOOL_WORK.to_string()],
        agent_id: if acts { bot.agent.trim().to_string() } else { format!("bot:{}", bot.node_id) },
        runs_as: if acts {
            bot.agent.trim().to_string()
        } else {
            crate::aiw::assistant::ASSISTANT_ID.to_string()
        },
        name: bot.name.clone(),
        system,
        // A bot's gate is its team, not the matrix — see `Persona`. This is
        // the file's list; `persona_for` widens it with the thread's.
        may_delegate_to: Some(bot.team.clone()),
        plan: if bot.feature.trim().is_empty() {
            None
        } else {
            Some(bot.feature.trim().to_string())
        },
        talk_only: false,
    }
}

/// The voice, with the team it actually has: the file's list plus anyone a
/// person pulled into its thread.
pub fn persona_for(
    ws: &std::sync::Arc<crate::aiw::state::Workspace>,
    bot: &Bot,
) -> crate::aiw::assistant::Persona {
    let mut p = persona(bot);
    p.may_delegate_to = Some(effective_team(ws, bot));
    p
}

/// The same, plus the managers it may pass work to — which needs the tree, and
/// so needs a connection.
pub fn persona_in(
    conn: &Connection,
    ws: &std::sync::Arc<crate::aiw::state::Workspace>,
    bot: &Bot,
) -> crate::aiw::assistant::Persona {
    let mut p = persona_for(ws, bot);
    p.hand_on_to = colleagues(conn, ws, bot);
    if !p.hand_on_to.is_empty() {
        p.system.push_str(&format!(
            "\n\nThe managers you may pass an item to, when it belongs to them rather than to \
             you: {}. Write @handle take \"title\" and it goes onto their plan and is announced \
             in their thread — it does not start anyone, because they decide who does it.",
            p.hand_on_to
                .iter()
                .map(|c| format!("@{} ({})", c.handle, c.name))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    p
}

/// Put a line the bot said on its own — a wake report — into its thread.
///
/// Best effort, and says so: a wake that cannot reach the personal store still
/// happened and is still in the activity feed, so failing the wake over its
/// transcript would be backwards. The line is logged instead.
pub fn thread_post(app: &tauri::AppHandle, bot: &Bot, text: &str) {
    use tauri::Manager;
    if text.trim().is_empty() {
        return;
    }
    let Some(ws) = app.try_state::<std::sync::Arc<crate::aiw::state::Workspace>>() else {
        return;
    };
    let result = (|| -> Result<(), String> {
        let convs = ws.convs()?;
        let conv = convs.for_bot(bot.node_id, &bot.node_id.to_string(), &bot.name)?;
        convs.post_as_bot(&conv.id, text)?;
        Ok(())
    })();
    if let Err(e) = result {
        eprintln!("[bots] {} woke but its thread could not be written: {e}", bot.name);
    }
}

/// The bot's thread, found or made.
#[tauri::command]
pub fn bot_thread(
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
    db: tauri::State<Db>,
    node_id: i64,
) -> Result<crate::aiw::assistant::ConversationMeta, String> {
    let bot = {
        let conn = db.0.lock().unwrap();
        bot_on(&conn, node_id).ok_or("There is no bot in that folder.")?
    };
    let convs = ws.convs()?;
    convs.for_bot(node_id, &node_id.to_string(), &bot.name)
}

/// Say something to a bot in its own thread, and get its answer.
///
/// The same loop the assistant uses, run as the bot: its voice from
/// `_bot.md`, its permissions from the agent it names. Streams progress on the
/// assistant's channel, keyed by conversation, so the page that asked is the
/// only one that hears it.
#[tauri::command]
pub async fn bot_thread_send(
    app: tauri::AppHandle,
    ws: tauri::State<'_, std::sync::Arc<crate::aiw::state::Workspace>>,
    db: tauri::State<'_, Db>,
    node_id: i64,
    text: String,
) -> Result<crate::aiw::assistant::AssistantReply, String> {
    use tauri::Emitter;
    let bot = {
        let conn = db.0.lock().unwrap();
        bot_on(&conn, node_id).ok_or("There is no bot in that folder.")?
    };
    // The space has to be registered before the bot can read it — the same
    // step a wake takes, for the same reason.
    if ws.project(&node_id.to_string()).is_none() {
        let dir = std::path::PathBuf::from(&bot.dir);
        let code_root = repo_of(&app, node_id).unwrap_or_else(|| dir.clone());
        ws.register_project(&node_id.to_string(), &bot.node_name, code_root, dir);
    }
    let workspace = ws.inner().clone();
    let who = persona_for(&workspace, &bot);
    tauri::async_runtime::spawn_blocking(move || {
        let progress = app.clone();
        let sink = move |e: crate::aiw::assistant::ChatEvent| {
            let _ = progress.emit("aiw:chat", e);
        };
        let convs = workspace.convs()?;
        let conv = convs.for_bot(node_id, &node_id.to_string(), &bot.name)?;
        let reply = crate::aiw::assistant::Assistant::send_as(
            &workspace, convs, &conv.id, &text, &sink, &who,
        )?;
        // Then every agent the message named, as itself. A room where you can
        // name someone and they never speak is a room where @ looks broken.
        crate::threads::answer_as_agents(&app, &workspace, &conv.id, &text, &who.agent_id);
        Ok(reply)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Who this bot may actually put work on.
///
/// The file's list, plus anyone *you* pulled into its thread. The second half
/// is the point of item 15: a team is who is in the room, and maintaining that
/// as a separate list in a form was a second place to keep the same fact.
///
/// The widening is safe in exactly one direction, and only because of how
/// participants are written: a mention is recorded when a *typed* message is
/// sent, and nothing a bot posts on its own goes through that path. So a
/// person can add to a team by talking; a bot cannot add to its own.
/// The other managers this bot may pass an item to.
///
/// Two kinds, and the rule for each is the same rule the tree already
/// implies: the bots on nodes *under* this one, because a parent manages what
/// is beneath it; and any bot someone pulled into this thread, because being
/// asked into a room is how anyone joins a conversation here.
///
/// Deliberately not "every bot on the machine". A bot that could put work on
/// any other bot anywhere is not a manager, it is a loose end.
pub fn colleagues(
    conn: &Connection,
    ws: &std::sync::Arc<crate::aiw::state::Workspace>,
    bot: &Bot,
) -> Vec<crate::aiw::assistant::Colleague> {
    let nodes = db::nodes_on(conn).unwrap_or_default();

    // Everything under this bot's node, however deep.
    let mut under: Vec<i64> = Vec::new();
    let mut frontier = vec![bot.node_id];
    while let Some(id) = frontier.pop() {
        for n in nodes.iter().filter(|n| n.parent_id == Some(id)) {
            under.push(n.id);
            frontier.push(n.id);
        }
    }

    // Plus whoever is in the room.
    if let Ok(convs) = ws.convs() {
        if let Some(thread) = convs.list().into_iter().find(|c| c.bot_node == Some(bot.node_id)) {
            for p in thread.participants {
                if let Some(id) = p.strip_prefix("bot:").and_then(|n| n.parse::<i64>().ok()) {
                    if id != bot.node_id && !under.contains(&id) {
                        under.push(id);
                    }
                }
            }
        }
    }

    all_bots(conn)
        .into_iter()
        .filter(|b| under.contains(&b.node_id))
        .map(|b| crate::aiw::assistant::Colleague {
            handle: handle_of(&b),
            name: b.name.clone(),
            node_id: b.node_id,
            project_id: b.node_id.to_string(),
            plan: Some(b.feature.trim().to_string()).filter(|f| !f.is_empty()),
        })
        .collect()
}

/// What people type after the `@` to reach this bot.
///
/// `answers_to` accepts several spellings; this is the one to print back, so
/// a receipt names a handle that will work if you copy it.
pub fn handle_of(b: &Bot) -> String {
    let slug = |s: &str| s.trim().to_lowercase().replace(' ', "-");
    if !b.node_name.trim().is_empty() {
        slug(&b.node_name)
    } else {
        slug(&b.name)
    }
}

pub fn effective_team(
    ws: &std::sync::Arc<crate::aiw::state::Workspace>,
    bot: &Bot,
) -> Vec<String> {
    let mut team = bot.team.clone();
    let Ok(convs) = ws.convs() else { return team };
    let Some(thread) = convs.list().into_iter().find(|c| c.bot_node == Some(bot.node_id)) else {
        return team;
    };
    for p in thread.participants {
        // `bot:` ids are other bots. A bot is someone you talk to, not someone
        // work is handed to — that is what agents are for.
        if p.starts_with("bot:") || team.iter().any(|t| t == &p) {
            continue;
        }
        if ws.agent(&p).is_some() {
            team.push(p);
        }
    }
    team
}

/// Wake the agent this bot names, if it names one.
///
/// Returns the line for your inbox. `None` means it had nothing to say, which
/// stays the common case.
///
/// Runs with `unattended` set, so every tool call that is not covered by a
/// standing grant is refused immediately rather than blocking for the approval
/// timeout. That matters more than it sounds: an agent making ten uncovered
/// calls would otherwise take ten timeouts to finish failing, in the middle of
/// the night, holding up every other schedule behind it.
pub fn wake_agent(app: &tauri::AppHandle, bot: &Bot) -> Option<(bool, String)> {
    use tauri::Manager;

    if bot.agent.trim().is_empty() {
        return None;
    }
    let ws = app.try_state::<std::sync::Arc<crate::aiw::state::Workspace>>()?;
    let workspace: std::sync::Arc<crate::aiw::state::Workspace> = (*ws).clone();
    let team = effective_team(&workspace, bot);
    if !team.iter().any(|a| a == bot.agent.trim()) {
        return Some((
            false,
            if team.is_empty() {
                format!(
                    "{} has no team, so there is nobody it may put work on. Add {} to its team on the bot's page.",
                    bot.name, bot.agent
                )
            } else {
                format!(
                    "{} is not on {}'s team ({}), so it was not woken.",
                    bot.agent,
                    bot.name,
                    team.join(", ")
                )
            },
        ));
    }
    // Make sure the Assistant knows this space before asking it to work there.
    //
    // The startup catch-up tick runs before the frontend has had a chance to
    // sync the tree, so without this the first wake after every launch failed
    // with "unknown project" — which is exactly the wake you most want to
    // happen. Registering is idempotent, and uses the same rule the sync does:
    // context in the node's own folder, code wherever the repository is.
    if workspace.project(&bot.node_id.to_string()).is_none() {
        // `bot.dir` is the deck folder, which is exactly what the frontend's
        // sync registers as the deck root. Registering anything else here
        // meant the same project id described two different directories
        // depending on whether a bot woke before the tree synced.
        let dir = std::path::PathBuf::from(&bot.dir);
        let code_root = repo_of(app, bot.node_id).unwrap_or_else(|| dir.clone());
        workspace.register_project(&bot.node_id.to_string(), &bot.node_name, code_root, dir);
    }

    // An agent works inside a feature, so a bot with no plan has nowhere to put
    // it. Better to say that than to hand the runtime an empty feature id and
    // report whatever it makes of it.
    if bot.feature.trim().is_empty() {
        return Some((
            false,
            format!(
                "{} names {} but has no plan yet — an agent needs steps to work on. Give it some                  on the bot's Plan tab.",
                bot.name, bot.agent
            ),
        ));
    }

    let intent = if bot.wake_intent.trim().is_empty() {
        bot.goal.clone()
    } else {
        bot.wake_intent.clone()
    };

    let cmd = crate::aiw::runtime::StartAgentCommand {
        project_id: bot.node_id.to_string(),
        feature_id: bot.feature.clone(),
        agent_id: bot.agent.clone(),
        work_item_id: None,
        intent: Some(intent),
        areas: vec![],
        depends_on: vec![],
        unattended: true,
        // The bot's own review points travel with the run. A wake is exactly
        // when nobody is watching, so this is when they matter most.
        stop_at: bot.stop_at.clone(),
    };

    // The line lands in your inbox, so the agent gets its name rather than its
    // id. "QA Agent" and "qa" are the same thing to the runtime and not at all
    // the same thing at seven in the morning.
    let agent_name = workspace
        .agents()
        .into_iter()
        .find(|a| a.id == bot.agent)
        .map(|a| a.name)
        .unwrap_or_else(|| bot.agent.clone());

    match crate::aiw::runtime::AgentRuntime::run(&workspace, &cmd) {
        Ok(out) => {
            let did = format!(
                "{} ran {agent_name} — {} turn{}, {} file{} touched",
                bot.name,
                out.turns,
                if out.turns == 1 { "" } else { "s" },
                out.files_touched.len(),
                if out.files_touched.len() == 1 { "" } else { "s" },
            );
            // A run that was refused everything is not good news wearing a
            // summary. It says how many and what would change it, and it is
            // recorded as *not ok* so the inbox draws it as something that went
            // wrong rather than in the same grey as a stashed screenshot.
            if out.refused > 0 {
                Some((
                    false,
                    format!(
                        "{did}. {} call{} refused — nothing is granted for {agent_name} to do \
                         unattended. Give it a standing grant for what it should be allowed to do.",
                        out.refused,
                        if out.refused == 1 { "" } else { "s" },
                    ),
                ))
            } else if out.summary.trim().is_empty() {
                Some((true, format!("{did}. {}", out.status)))
            } else {
                Some((true, format!("{did}. {}", out.summary)))
            }
        }
        // A failed wake is worth saying. A heartbeat that silently stops
        // working is one you keep believing in.
        Err(e) => Some((false, format!("{} could not run {agent_name}: {e}", bot.name))),
    }
}

#[cfg(test)]
#[path = "bots_scenarios.rs"]
mod scenarios;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_the_file() {
        let dir = std::env::temp_dir().join(format!("devdeck-bot-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let b = Bot {
            name: "TyreX bot".into(),
            goal: "Ship the demo on 12 September".into(),
            every: "weekdays".into(),
            at_min: 7 * 60,
            body: "Cares about the three repos that ship together.".into(),
            ..Default::default()
        };
        write(&dir, &b).unwrap();

        let back = read(&dir).expect("a bot");
        assert_eq!(back.name, "TyreX bot");
        assert_eq!(back.goal, "Ship the demo on 12 September");
        assert_eq!(back.every, "weekdays");
        assert_eq!(back.at_min, 420);
        assert!(back.body.contains("three repos"));

        let _ = fs::remove_dir_all(&dir);
    }

    /// A folder with no `_bot.md` has no bot. That is what makes "which folders
    /// have bots" answerable by looking rather than by asking the database.
    /// The team is a limit, and one only the editor enforced would not be:
    /// `_bot.md` is a file, so a hand-edited `agent:` has to be refused at the
    /// point the work is handed out too. That check is in `wake_agent`; this
    /// one covers the rule itself.
    #[test]
    fn a_lead_who_is_not_on_the_team_is_refused() {
        let e = vet_team("Site", "dev-a", vec!["qa".into()]).unwrap_err();
        assert!(e.contains("dev-a") && e.contains("team"), "{e}");
    }

    #[test]
    fn a_bot_with_no_lead_may_have_no_team() {
        assert_eq!(vet_team("Site", "", vec![]).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn blank_names_are_dropped_rather_than_counted() {
        let t = vet_team("Site", "qa", vec!["  ".into(), "qa".into(), String::new()]).unwrap();
        assert_eq!(t, vec!["qa".to_string()]);
    }

    /// The team travels with the bot, like everything else about it.
    #[test]
    fn the_team_survives_the_file() {
        let dir = std::env::temp_dir().join(format!("devdeck-team-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let b = Bot {
            name: "Site".into(),
            goal: "Ship it".into(),
            agent: "dev-a".into(),
            team: vec!["dev-a".into(), "qa".into()],
            ..Default::default()
        };
        write(&dir, &b).unwrap();
        let back = read(&dir).expect("a bot");
        assert_eq!(back.team, vec!["dev-a".to_string(), "qa".to_string()]);
        assert_eq!(back.agent, "dev-a");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A bot with no agent can talk but not act. That is enforced by giving
    /// it an id the permission matrix has never heard of — the matrix fails
    /// closed — while the assistant's provider does the talking. Naming an
    /// agent makes the bot that agent for both.
    #[test]
    fn a_bot_with_no_agent_speaks_as_nobody_the_matrix_knows() {
        let b = Bot {
            node_id: 8,
            name: "Fitness bot".into(),
            node_name: "Fitness".into(),
            goal: "Four sessions a week".into(),
            ..Default::default()
        };
        let p = persona(&b);
        assert_eq!(p.agent_id, "bot:8", "an id no permission row matches");
        assert_eq!(p.runs_as, crate::aiw::assistant::ASSISTANT_ID);
        assert!(p.system.contains("Fitness bot"), "{}", p.system);
        assert!(p.system.contains("Four sessions a week"), "{}", p.system);
        assert!(
            p.system.contains("cannot run tools"),
            "it is told, so it can say so: {}",
            p.system
        );
    }

    #[test]
    fn a_bot_with_an_agent_is_that_agent_for_permissions_and_voice() {
        let b = Bot {
            node_id: 2,
            name: "x-platform bot".into(),
            node_name: "x-platform".into(),
            goal: "Ship offline sync".into(),
            agent: "dev-a".into(),
            team: vec!["dev-a".into(), "qa".into()],
            ..Default::default()
        };
        let p = persona(&b);
        assert_eq!(p.agent_id, "dev-a");
        assert_eq!(p.runs_as, "dev-a");
        assert!(p.system.contains("dev-a, qa"), "the team is named: {}", p.system);
        assert!(!p.system.contains("cannot run tools"));
    }

    #[test]
    fn no_file_means_no_bot() {
        let dir = std::env::temp_dir().join(format!("devdeck-nobot-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        assert!(read(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn times_survive_both_ways() {
        assert_eq!(parse_at("07:00"), 420);
        assert_eq!(parse_at("18:30"), 1110);
        assert_eq!(parse_at("nonsense"), 420);
        assert_eq!(fmt_at(420), "07:00");
        assert_eq!(fmt_at(1110), "18:30");
    }

    /// An empty routine is a bot with no heartbeat, not a bot that wakes at
    /// midnight.
    #[test]
    fn no_routine_writes_no_time() {
        let dir = std::env::temp_dir().join(format!("devdeck-quietbot-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        write(
            &dir,
            &Bot {
                name: "Quiet".into(),
                goal: "Just be there".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let raw = fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!raw.contains("every:"));
        assert!(!raw.contains("at:"));
        assert_eq!(read(&dir).unwrap().every, "");

        let _ = fs::remove_dir_all(&dir);
    }
}
