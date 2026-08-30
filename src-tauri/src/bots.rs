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
//! **Waking does not run an agent.** It reads the space and writes at most one
//! line to your inbox, and only when there is something to say. An unattended
//! agent needs a standing grant the permission model does not offer, so a
//! heartbeat that quietly gathers is the honest version of the feature: nothing
//! can happen to your machine while you are asleep.

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

fn dir_of(conn: &Connection, node: &db::Node) -> Option<PathBuf> {
    if node.rel_path.trim().is_empty() {
        return None;
    }
    let root = db::setting_get_conn(conn, crate::vault::ROOT_KEY).ok()??;
    Some(Path::new(&root).join(node.rel_path.replace('/', std::path::MAIN_SEPARATOR_STR)))
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
) -> Result<Bot, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Give the bot a name.".into());
    }
    if goal.trim().is_empty() {
        return Err("A bot needs a goal. Without one it has nothing to judge a suggestion against.".into());
    }

    let (bot, created) = {
        let conn = db.0.lock().unwrap();
        let n = db::node_by_id(&conn, node_id)?;
        let dir = dir_of(&conn, &n).ok_or("That folder has no place on disk yet.")?;
        if !dir.is_dir() {
            return Err(format!("{} is not there.", dir.display()));
        }
        let created = read(&dir).is_none();

        let mut b = Bot {
            node_id,
            node_name: n.name.clone(),
            dir: dir.to_string_lossy().to_string(),
            name,
            goal: goal.trim().to_string(),
            every: every.trim().to_string(),
            at_min: at_min.clamp(0, 1439),
            days,
            body,
            schedule_id: None,
            last_woke: None,
        };
        write(&dir, &b)?;
        b.schedule_id = sync_heartbeat(&conn, &b)?;
        if let Some((_, last)) = heartbeat(&conn, node_id) {
            b.last_woke = last;
        }
        (b, created)
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

#[tauri::command]
pub fn bot_delete(app: tauri::AppHandle, db: tauri::State<Db>, node_id: i64) -> Result<(), String> {
    let name = {
        let conn = db.0.lock().unwrap();
        let n = db::node_by_id(&conn, node_id)?;
        let dir = dir_of(&conn, &n).ok_or("That folder has no place on disk.")?;
        let name = read(&dir).map(|b| b.name).unwrap_or_else(|| n.name.clone());
        // The file goes; the folder and everything else in it stays. Deleting a
        // bot must never look like deleting a space.
        let _ = fs::remove_file(dir.join(FILE));
        conn.execute(
            "DELETE FROM schedules WHERE kind = 'bot' AND node_id = ?1",
            params![node_id],
        )
        .map_err(err)?;
        name
    };
    crate::activity::record(&app, "bot", format!("{name} removed"), "Its folder is untouched.", true, Some(node_id));
    Ok(())
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
