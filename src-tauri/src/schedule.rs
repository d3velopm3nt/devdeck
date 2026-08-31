//! Things that happen on a clock.
//!
//! Not an agent feature. A schedule runs one of four things:
//!
//!   * a **reminder**, which only tells you,
//!   * a **command**, which runs a shell line in a space's folder,
//!   * a **bot**, which is a space's heartbeat: it reads what that space is
//!     carrying, writes at most one line to your inbox or stays silent, and —
//!     only if the bot names one — wakes an agent. What that agent may do is
//!     decided entirely by the standing grants in `aiw/grants.rs`: an
//!     unattended call that needs approval is refused on the spot, because
//!     there is nobody to ask.
//!
//! The fourth kind, a bare `agent` schedule with no bot behind it, is still
//! deliberately absent. A bot is what gives an unattended run a goal, a place
//! and a record; a naked agent on a timer has none of those.
//!
//! **Catching up is per schedule, not global.** A reminder whose moment has
//! passed must not fire late — being told to go to the gym at nine when you
//! meant half six is noise, and noise is how a scheduler gets ignored. A pull
//! or a brief is still worth having late. So a missed reminder is *recorded*
//! rather than fired: you can see it was missed without being nagged about it.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use tauri::Manager;

use crate::db::{self, Db};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    -- reminder | command | bot | agent
    kind TEXT NOT NULL,
    -- The node this belongs to. Null means it is not about any one space.
    node_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
    -- daily | weekdays | weekly | hourly
    every TEXT NOT NULL DEFAULT 'daily',
    -- Minutes past midnight, local. Ignored by 'hourly'.
    at_min INTEGER NOT NULL DEFAULT 420,
    -- For 'weekly': comma-separated 0-6, Sunday first.
    days TEXT NOT NULL DEFAULT '',
    -- What to run. A shell line for 'command'; unused by 'reminder'.
    payload TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    -- Whether a missed run should happen late.
    catch_up INTEGER NOT NULL DEFAULT 1,
    last_run INTEGER,
    last_ok INTEGER NOT NULL DEFAULT 1,
    last_note TEXT NOT NULL DEFAULT ''
);
";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Schedule {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub node_id: Option<i64>,
    pub every: String,
    pub at_min: i64,
    pub days: String,
    pub payload: String,
    pub enabled: bool,
    pub catch_up: bool,
    pub last_run: Option<i64>,
    pub last_ok: bool,
    pub last_note: String,
    /// Filled on read: when this next fires, as a unix ms timestamp.
    #[serde(default)]
    pub next_run: Option<i64>,
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        node_id: r.get(3)?,
        every: r.get(4)?,
        at_min: r.get(5)?,
        days: r.get(6)?,
        payload: r.get(7)?,
        enabled: r.get::<_, i64>(8)? != 0,
        catch_up: r.get::<_, i64>(9)? != 0,
        last_run: r.get(10)?,
        last_ok: r.get::<_, i64>(11)? != 0,
        last_note: r.get(12)?,
        next_run: None,
    })
}

const COLS: &str = "id, name, kind, node_id, every, at_min, days, payload, enabled, catch_up, \
                    last_run, last_ok, last_note";

// ---------------------------------------------------------------------------
// When does it fire
// ---------------------------------------------------------------------------

/// A schedule's most recent due time at or before `now`, or None if it has
/// never been due. Local time, because "07:00" means seven where you are.
fn last_due(s: &Schedule, now: chrono::DateTime<chrono::Local>) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{Datelike, Duration, Timelike};

    if s.every == "hourly" {
        return now
            .date_naive()
            .and_hms_opt(now.hour(), 0, 0)
            .and_then(|n| n.and_local_timezone(chrono::Local).single());
    }

    let wanted = |d: chrono::DateTime<chrono::Local>| -> bool {
        match s.every.as_str() {
            "daily" => true,
            // Monday is 0 in `weekday().num_days_from_monday()`; the stored
            // list is Sunday-first to match how the picker reads.
            "weekdays" => d.weekday().num_days_from_monday() < 5,
            "weekly" => {
                let dow = d.weekday().num_days_from_sunday() as i64;
                s.days
                    .split(',')
                    .filter_map(|x| x.trim().parse::<i64>().ok())
                    .any(|x| x == dow)
            }
            _ => false,
        }
    };

    // Walk back at most a fortnight: a schedule that has not been due in two
    // weeks has nothing worth catching up on.
    for back in 0..14 {
        let day = now - Duration::days(back);
        if !wanted(day) {
            continue;
        }
        let at = day
            .date_naive()
            .and_hms_opt((s.at_min / 60) as u32, (s.at_min % 60) as u32, 0)
            .and_then(|n| n.and_local_timezone(chrono::Local).single())?;
        if at <= now {
            return Some(at);
        }
    }
    None
}

/// The next time it fires after `now`.
fn next_due(s: &Schedule, now: chrono::DateTime<chrono::Local>) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{Datelike, Duration, Timelike};

    if s.every == "hourly" {
        return (now + Duration::hours(1))
            .date_naive()
            .and_hms_opt((now + Duration::hours(1)).hour(), 0, 0)
            .and_then(|n| n.and_local_timezone(chrono::Local).single());
    }

    let wanted = |d: chrono::DateTime<chrono::Local>| -> bool {
        match s.every.as_str() {
            "daily" => true,
            "weekdays" => d.weekday().num_days_from_monday() < 5,
            "weekly" => {
                let dow = d.weekday().num_days_from_sunday() as i64;
                s.days
                    .split(',')
                    .filter_map(|x| x.trim().parse::<i64>().ok())
                    .any(|x| x == dow)
            }
            _ => false,
        }
    };

    for ahead in 0..14 {
        let day = now + Duration::days(ahead);
        if !wanted(day) {
            continue;
        }
        let at = day
            .date_naive()
            .and_hms_opt((s.at_min / 60) as u32, (s.at_min % 60) as u32, 0)
            .and_then(|n| n.and_local_timezone(chrono::Local).single())?;
        if at > now {
            return Some(at);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

fn all(conn: &Connection) -> Result<Vec<Schedule>, String> {
    let sql = format!("SELECT {COLS} FROM schedules ORDER BY at_min, id");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let mut out = stmt
        .query_map([], row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let now = chrono::Local::now();
    for s in &mut out {
        s.next_run = if s.enabled {
            next_due(s, now).map(|d| d.timestamp_millis())
        } else {
            None
        };
    }
    Ok(out)
}

#[tauri::command]
pub fn schedules_list(db: tauri::State<Db>) -> Result<Vec<Schedule>, String> {
    let conn = db.0.lock().unwrap();
    all(&conn)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn schedule_save(
    db: tauri::State<Db>,
    id: Option<i64>,
    name: String,
    kind: String,
    node_id: Option<i64>,
    every: String,
    at_min: i64,
    days: String,
    payload: String,
    catch_up: bool,
) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give it a name.".into());
    }
    if kind == "command" && payload.trim().is_empty() {
        return Err("A command schedule needs something to run.".into());
    }
    let conn = db.0.lock().unwrap();
    match id {
        Some(id) => {
            conn.execute(
                "UPDATE schedules SET name=?1, kind=?2, node_id=?3, every=?4, at_min=?5, days=?6, \
                 payload=?7, catch_up=?8 WHERE id=?9",
                params![name, kind, node_id, every, at_min, days, payload, catch_up as i64, id],
            )
            .map_err(err)?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO schedules (name, kind, node_id, every, at_min, days, payload, catch_up) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![name, kind, node_id, every, at_min, days, payload, catch_up as i64],
            )
            .map_err(err)?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
pub fn schedule_enable(db: tauri::State<Db>, id: i64, on: bool) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE schedules SET enabled = ?1 WHERE id = ?2",
        params![on as i64, id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn schedule_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM schedules WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

fn dir_for(conn: &Connection, node_id: Option<i64>) -> Option<String> {
    // One rule, in db.rs. This used to hold its own copy of it.
    db::node_dir_by_id(conn, node_id?).map(|p| p.to_string_lossy().to_string())
}

/// Run one schedule and record it. `late` marks a catch-up run, which reads
/// differently in the log.
///
/// Takes no connection on purpose. `activity::record` locks the database
/// itself, so a caller holding that lock while calling this deadlocks the
/// thread — which is exactly what the first version of the tick did.
fn run_one(
    app: &tauri::AppHandle,
    s: &Schedule,
    dir: Option<String>,
    late: bool,
    report: Option<String>,
    bot: Option<crate::bots::Bot>,
) -> (bool, String) {
    let when = if late { " (late)" } else { "" };

    let (ok, note) = match s.kind.as_str() {
        // A reminder does nothing but tell you. That is the whole point.
        "reminder" => (true, String::new()),
        "command" => {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &s.payload])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            if let Some(d) = &dir {
                cmd.current_dir(d);
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            match cmd.output() {
                Ok(out) if out.status.success() => (true, String::new()),
                Ok(out) => {
                    let e = String::from_utf8_lossy(&out.stderr);
                    let first = e.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
                    (false, first.trim().to_string())
                }
                Err(e) => (false, format!("could not run: {e}")),
            }
        }
        // A bot waking reads its space and says at most one thing. `report` is
        // that thing, gathered under the lock by the caller; None means the
        // space had nothing worth mentioning, and then the bot says nothing at
        // all. A heartbeat that reports "all clear" every morning is a
        // heartbeat you learn to scroll past, which costs you the morning it
        // does not.
        "bot" => {
            // Two things can happen on a wake, and the order matters: read the
            // space first, then run the agent if one is named. Reading never
            // touches anything, so a run that fails still leaves you the report.
            //
            // `wake_agent` is called here rather than under the caller's lock
            // because a session can take minutes and takes the database itself.
            let ran = bot
                .as_ref()
                .and_then(|b| crate::bots::wake_agent(app, b));
            match (report, ran) {
                // The wake's own success is the agent's: a bot that ran and was
                // refused everything did not have a good night, and the inbox
                // has to draw it that way.
                (Some(r), Some((ok, a))) => (ok, format!("{r}. {a}")),
                (Some(r), None) => (true, r),
                (None, Some((ok, a))) => (ok, a),
                // Nothing to report and nothing to run. A heartbeat that says
                // "all clear" every morning is one you filter out.
                (None, None) => return (true, String::new()),
            }
        }
        // Deliberately not implemented: an agent run needs a standing grant,
        // and pretending otherwise would mean running one unsupervised.
        _ => (false, "Agent schedules are not available yet.".into()),
    };

    let bot = s.kind == "bot";
    crate::activity::record(
        app,
        if bot { "bot" } else { "schedule" },
        if bot {
            format!("{} woke{when}", s.name)
        } else {
            format!("{}{when}", s.name)
        },
        if ok {
            match s.kind.as_str() {
                "reminder" => "Reminder".to_string(),
                "bot" => note.clone(),
                _ => s.payload.clone(),
            }
        } else {
            note.clone()
        },
        ok,
        Some(s.id),
    );
    (ok, note)
}

/// One pass. Called on a timer while the app is open, and once at startup.
///
/// `startup` is what makes catching up possible at all: while running, a
/// schedule fires because its moment just arrived; at launch, it fires because
/// its moment passed while nothing was watching.
///
/// Decisions are made under the lock and acted on without it — running a
/// command can take seconds, and recording activity needs the same lock.
pub fn tick(app: &tauri::AppHandle, startup: bool) {
    enum Do {
        /// The schedule, its working directory, whether it is late, what a bot
        /// found when it looked, and the bot itself. All of it is gathered
        /// under the lock, because running is done without it — a wake that
        /// starts an agent can take minutes and needs the database.
        Run(Schedule, Option<String>, bool, Option<String>, Option<crate::bots::Bot>),
        Missed(Schedule, i64),
    }

    let Some(db) = app.try_state::<Db>() else { return };
    let now = chrono::Local::now();

    let todo: Vec<Do> = {
        let conn = db.0.lock().unwrap();
        let Ok(list) = all(&conn) else { return };
        let mut todo = Vec::new();
        for s in list.into_iter().filter(|s| s.enabled) {
            let Some(due) = last_due(&s, now) else { continue };
            let due_ms = due.timestamp_millis();
            if s.last_run.is_some_and(|r| r >= due_ms) {
                continue;
            }
            let late = startup || (now - due).num_minutes() > 2;

            // The rule that matters: a reminder whose moment has gone is
            // recorded as missed, not fired.
            if late && (!s.catch_up || s.kind == "reminder") {
                todo.push(Do::Missed(s, due_ms));
            } else {
                let dir = dir_for(&conn, s.node_id);
                let (report, bot) = if s.kind == "bot" {
                    match s.node_id {
                        Some(n) => (
                            crate::bots::wake_report(&conn, n),
                            crate::bots::bot_on(&conn, n),
                        ),
                        None => (None, None),
                    }
                } else {
                    (None, None)
                };
                todo.push(Do::Run(s, dir, late, report, bot));
            }
        }
        todo
    };

    for item in todo {
        match item {
            Do::Run(s, dir, late, report, bot) => {
                let (ok, note) = run_one(app, &s, dir, late, report, bot);
                let conn = db.0.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE schedules SET last_run=?1, last_ok=?2, last_note=?3 WHERE id=?4",
                    params![now.timestamp_millis(), ok as i64, note, s.id],
                );
            }
            Do::Missed(s, due_ms) => {
                crate::activity::record(
                    app,
                    "schedule",
                    format!("Missed: {}", s.name),
                    "DevDeck was not running when this was due.",
                    false,
                    Some(s.id),
                );
                let conn = db.0.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE schedules SET last_run=?1, last_ok=0, last_note=?2 WHERE id=?3",
                    params![due_ms, "missed", s.id],
                );
            }
        }
    }
}

/// Run a schedule by hand, ignoring whether it is due.
#[tauri::command]
pub fn schedule_run_now(app: tauri::AppHandle, db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let (s, dir, report, bot) = {
        let conn = db.0.lock().unwrap();
        let sql = format!("SELECT {COLS} FROM schedules WHERE id = ?1");
        let s = conn.query_row(&sql, params![id], row).map_err(err)?;
        let dir = dir_for(&conn, s.node_id);
        let (report, bot) = if s.kind == "bot" {
            match s.node_id {
                Some(n) => (
                    crate::bots::wake_report(&conn, n),
                    crate::bots::bot_on(&conn, n),
                ),
                None => (None, None),
            }
        } else {
            (None, None)
        };
        (s, dir, report, bot)
    };
    let (ok, note) = run_one(&app, &s, dir, false, report, bot);
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE schedules SET last_run=?1, last_ok=?2, last_note=?3 WHERE id=?4",
        params![chrono::Local::now().timestamp_millis(), ok as i64, note, id],
    )
    .map_err(err)?;
    Ok(())
}
