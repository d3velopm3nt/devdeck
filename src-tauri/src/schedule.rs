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
//! **A rhythm or a moment.** `every` was always a recurrence — daily,
//! weekdays, weekly, hourly. A calendar needs the other kind: a thing that
//! happens once, at a stated time, and then is history. `every = "once"` with
//! `at_ms` is that, and `duration_min` gives it a length so a meeting can be
//! an hour rather than an instant. Everything else — catching up, running,
//! recording — is unchanged, because a moment is just a recurrence that
//! recurs no more than once.
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
    -- daily | weekdays | weekly | hourly | once
    every TEXT NOT NULL DEFAULT 'daily',
    -- For 'once': the exact moment, unix ms. Null for every rhythm.
    at_ms INTEGER,
    -- How long it lasts. 0 is a point in time; anything else is a block on a
    -- calendar, which is what makes an hour-long meeting expressible.
    duration_min INTEGER NOT NULL DEFAULT 0,
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
    last_note TEXT NOT NULL DEFAULT '',
    -- How long before it starts you want telling. 0 is no warning, which is
    -- what everything did until now: a reminder arrived at the moment it was
    -- about, which is too late to walk anywhere.
    remind_min INTEGER NOT NULL DEFAULT 0,
    -- Which occurrence has already been warned about, as its unix ms. One
    -- warning per occurrence: the clock ticks every thirty seconds, and a
    -- warning that repeats for ten minutes is not a warning.
    last_remind INTEGER,
    -- What it is for: a feature in a space's deck, and optionally one item on
    -- it. The link is *yours* — it lives here in the database rather than in
    -- the vault, because a reminder to look at something is not part of the
    -- project's record of that thing.
    feature TEXT NOT NULL DEFAULT '',
    work_item TEXT NOT NULL DEFAULT ''
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
    /// For `every = "once"`: when, exactly. Unix milliseconds, local clock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at_ms: Option<i64>,
    /// Minutes. 0 is an instant; more is a block with an end.
    #[serde(default)]
    pub duration_min: i64,
    pub days: String,
    pub payload: String,
    pub enabled: bool,
    pub catch_up: bool,
    pub last_run: Option<i64>,
    pub last_ok: bool,
    pub last_note: String,
    /// Minutes of warning before it starts. 0 says nothing early.
    #[serde(default)]
    pub remind_min: i64,
    /// The occurrence already warned about, unix ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_remind: Option<i64>,
    /// The feature in the space's deck this serves, and one item on it.
    #[serde(default)]
    pub feature: String,
    #[serde(default)]
    pub work_item: String,
    /// Filled on read: when this next fires, as a unix ms timestamp.
    #[serde(default)]
    pub next_run: Option<i64>,
}

/// Public so the calendar can read the same rows without a second mapper —
/// two readers of one table drifting apart is how a calendar starts showing
/// something the scheduler will not run.
pub fn row(r: &rusqlite::Row) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        node_id: r.get(3)?,
        every: r.get(4)?,
        at_min: r.get(5)?,
        at_ms: r.get(6)?,
        duration_min: r.get(7)?,
        days: r.get(8)?,
        payload: r.get(9)?,
        enabled: r.get::<_, i64>(10)? != 0,
        catch_up: r.get::<_, i64>(11)? != 0,
        last_run: r.get(12)?,
        last_ok: r.get::<_, i64>(13)? != 0,
        last_note: r.get(14)?,
        remind_min: r.get(15)?,
        last_remind: r.get(16)?,
        feature: r.get(17)?,
        work_item: r.get(18)?,
        next_run: None,
    })
}

pub const COLS: &str = "id, name, kind, node_id, every, at_min, at_ms, duration_min, days, payload, \
                    enabled, catch_up, last_run, last_ok, last_note, remind_min, last_remind, \
                    feature, work_item";

// ---------------------------------------------------------------------------
// When does it fire
// ---------------------------------------------------------------------------

/// A schedule's most recent due time at or before `now`, or None if it has
/// never been due. Local time, because "07:00" means seven where you are.
fn last_due(s: &Schedule, now: chrono::DateTime<chrono::Local>) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{Datelike, Duration, Timelike};

    // A moment is due once, when it arrives, and never again. `last_run`
    // upstream is what stops it firing twice.
    if s.every == "once" {
        let at = chrono::DateTime::from_timestamp_millis(s.at_ms?)?.with_timezone(&chrono::Local);
        return (at <= now).then_some(at);
    }

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

    if s.every == "once" {
        let at = chrono::DateTime::from_timestamp_millis(s.at_ms?)?.with_timezone(&chrono::Local);
        // Nothing next about a moment that has passed, which is what makes it
        // fall off "what is coming" the instant it is over.
        return (at > now).then_some(at);
    }

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
    // For `every = "once"`: the moment, unix ms.
    at_ms: Option<i64>,
    // Minutes it lasts. 0 is an instant; more is a block on a calendar.
    duration_min: Option<i64>,
    days: String,
    payload: String,
    catch_up: bool,
    // Minutes of warning before it starts. None keeps whatever is there.
    remind_min: Option<i64>,
    // What it serves: a feature in the space's deck, and one item on it.
    feature: Option<String>,
    work_item: Option<String>,
) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give it a name.".into());
    }
    if kind == "command" && payload.trim().is_empty() {
        return Err("A command schedule needs something to run.".into());
    }
    // A moment with no moment would sit in the table being due never, which is
    // indistinguishable from a bug when you go looking for it on a calendar.
    if every == "once" && at_ms.is_none() {
        return Err("A one-off needs a date and a time.".into());
    }
    let duration_min = duration_min.unwrap_or(0).max(0);
    // A warning longer than a day is not a warning, it is a second schedule.
    let remind_min = remind_min.unwrap_or(0).clamp(0, 24 * 60);
    let feature = feature.unwrap_or_default();
    // An item without the feature it belongs to points at nothing findable.
    let work_item = if feature.is_empty() {
        String::new()
    } else {
        work_item.unwrap_or_default()
    };
    let conn = db.0.lock().unwrap();
    match id {
        Some(id) => {
            conn.execute(
                "UPDATE schedules SET name=?1, kind=?2, node_id=?3, every=?4, at_min=?5, days=?6, \
                 payload=?7, catch_up=?8, at_ms=?9, duration_min=?10, remind_min=?11, \
                 feature=?12, work_item=?13 WHERE id=?14",
                params![
                    name, kind, node_id, every, at_min, days, payload, catch_up as i64, at_ms,
                    duration_min, remind_min, feature, work_item, id
                ],
            )
            .map_err(err)?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO schedules (name, kind, node_id, every, at_min, days, payload, \
                 catch_up, at_ms, duration_min, remind_min, feature, work_item) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    name, kind, node_id, every, at_min, days, payload, catch_up as i64, at_ms,
                    duration_min, remind_min, feature, work_item
                ],
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
            // The receipt is the log, and the bot's thread is where the
            // receipt goes — the inbox line and the thread line are the same
            // sentence, so a wake reads the same wherever you meet it.
            let line = match (&report, &ran) {
                (Some(r), Some((_, a))) => format!("{r}. {a}"),
                (Some(r), None) => r.clone(),
                (None, Some((_, a))) => a.clone(),
                (None, None) => String::new(),
            };
            if let Some(b) = bot.as_ref() {
                crate::bots::thread_post(app, b, &line);
            }
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

/// Events that may fire a routine.
///
/// Narrow on purpose. A routine that woke on `tool.executed` would fire a
/// hundred times an hour and wake more agents, which would fire it again — a
/// broad listener is not a feature, it is a loop with a nice name.
const TRIGGERS: &[&str] = &[
    "test.failed",
    "test.completed",
    "git.commit.created",
    "file.changed",
    "conflict.detected",
];

/// The shortest gap between two runs of the same event routine.
///
/// A wake emits events of its own, so without this a routine listening for
/// `file.changed` would re-trigger itself off its own agent's writes. The
/// cooldown is claimed *before* the run, not after, so the window is closed
/// while the run is still going.
const COOLDOWN_MS: i64 = 60_000;

/// Fire the routines listening for this event.
///
/// Called from the bus sink, on whatever thread emitted — so the run itself
/// goes to a thread of its own. A wake can take minutes and takes the database
/// with it; doing that inline would stop the event bus for the duration.
pub fn on_event(app: &tauri::AppHandle, event_type: &str, project_id: Option<&str>) {
    if !TRIGGERS.contains(&event_type) {
        return;
    }
    let Some(db) = app.try_state::<Db>() else { return };
    let node: Option<i64> = project_id.and_then(|p| p.parse().ok());
    let now = chrono::Local::now().timestamp_millis();

    let due: Vec<(Schedule, Option<String>)> = {
        let Ok(conn) = db.0.try_lock() else { return };
        let Ok(all) = all(&conn) else { return };
        let mut out = Vec::new();
        for s in all
            .into_iter()
            .filter(|s| s.enabled && s.every == "event" && s.payload.trim() == event_type)
        {
            // An event about one space must not wake a bot watching another.
            if let (Some(n), Some(sn)) = (node, s.node_id) {
                if n != sn {
                    continue;
                }
            }
            if s.last_run.is_some_and(|r| now - r < COOLDOWN_MS) {
                continue;
            }
            // Claim the cooldown before running, not after.
            let _ = conn.execute(
                "UPDATE schedules SET last_run=?1 WHERE id=?2",
                params![now, s.id],
            );
            let dir = dir_for(&conn, s.node_id);
            out.push((s, dir));
        }
        out
    };

    for (s, dir) in due {
        let h = app.clone();
        std::thread::spawn(move || {
            let (report, bot) = {
                let Some(db) = h.try_state::<Db>() else { return };
                let conn = db.0.lock().unwrap();
                match s.node_id {
                    Some(n) => (crate::bots::wake_report(&conn, n), crate::bots::bot_on(&conn, n)),
                    None => (None, None),
                }
            };
            let (ok, note) = run_one(&h, &s, dir, false, report, bot);
            if let Some(db) = h.try_state::<Db>() {
                let conn = db.0.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE schedules SET last_ok=?1, last_note=?2 WHERE id=?3",
                    params![ok as i64, note, s.id],
                );
            }
        });
    }
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
        /// Tell them it is coming: the schedule, the moment it starts, and how
        /// many minutes away that is.
        Warn(Schedule, i64, i64),
    }

    let Some(db) = app.try_state::<Db>() else { return };
    let now = chrono::Local::now();

    let todo: Vec<Do> = {
        let conn = db.0.lock().unwrap();
        let Ok(list) = all(&conn) else { return };
        let mut todo = Vec::new();
        for s in list.into_iter().filter(|s| s.enabled) {
            // Coming up. Checked before "is it due", because a warning is
            // about the *next* occurrence and firing is about the last one —
            // and a thing due in five minutes is both at once.
            if let Some((next_ms, away)) = warning_due(&s, now) {
                todo.push(Do::Warn(s.clone(), next_ms, away));
            }

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
            Do::Warn(s, next_ms, away) => {
                crate::activity::record(
                    app,
                    "schedule",
                    if away <= 1 {
                        format!("{} starts in a minute", s.name)
                    } else {
                        format!("{} starts in {away} minutes", s.name)
                    },
                    // What it is for, when it says. A warning you cannot act
                    // on is just a noise with a name attached.
                    if s.feature.is_empty() {
                        String::new()
                    } else if s.work_item.is_empty() {
                        s.feature.clone()
                    } else {
                        format!("{} · {}", s.feature, s.work_item)
                    },
                    true,
                    Some(s.id),
                );
                let conn = db.0.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE schedules SET last_remind = ?1 WHERE id = ?2",
                    params![next_ms, s.id],
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

/// Whether this schedule should say "coming up" now, and how far off it is.
///
/// One warning per occurrence, which is the whole difficulty: the clock ticks
/// every thirty seconds, so a rule that only asked "is it within ten minutes"
/// would say so twenty times. `last_remind` holds the occurrence already
/// warned about, so the next one is announced and this one is not announced
/// again.
fn warning_due(s: &Schedule, now: chrono::DateTime<chrono::Local>) -> Option<(i64, i64)> {
    if s.remind_min <= 0 {
        return None;
    }
    let next = next_due(s, now)?;
    let next_ms = next.timestamp_millis();
    let away = (next - now).num_minutes();
    // Not yet in range, or already said for this one.
    if away < 0 || away > s.remind_min || s.last_remind.is_some_and(|r| r == next_ms) {
        return None;
    }
    Some((next_ms, away))
}

/// What one run did, so the row that asked for it can say so.
///
/// A reminder that worked has an empty note — telling you *is* the whole job
/// — and returning nothing at all made a successful run look exactly like a
/// button that does nothing. `ok` and the note together are enough for the
/// screen to say something true either way.
#[derive(serde::Serialize, Clone, Debug)]
pub struct RunOutcome {
    pub ok: bool,
    pub note: String,
    pub ran_at: i64,
}

/// Run a schedule by hand, ignoring whether it is due.
#[tauri::command]
pub fn schedule_run_now(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    id: i64,
) -> Result<RunOutcome, String> {
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
    let ran_at = chrono::Local::now().timestamp_millis();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE schedules SET last_run=?1, last_ok=?2, last_note=?3 WHERE id=?4",
        params![ran_at, ok as i64, note, id],
    )
    .map_err(err)?;
    Ok(RunOutcome { ok, note, ran_at })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(h: u32, m: u32) -> chrono::DateTime<chrono::Local> {
        chrono::Local.with_ymd_and_hms(2026, 9, 7, h, m, 0).single().unwrap()
    }

    /// A daily reminder at 09:00 that wants ten minutes' warning.
    fn daily(remind_min: i64, last_remind: Option<i64>) -> Schedule {
        Schedule {
            id: 1,
            name: "Stand-up".into(),
            kind: "reminder".into(),
            node_id: None,
            every: "daily".into(),
            at_min: 9 * 60,
            at_ms: None,
            duration_min: 0,
            days: String::new(),
            payload: String::new(),
            enabled: true,
            catch_up: false,
            last_run: None,
            last_ok: true,
            last_note: String::new(),
            remind_min,
            last_remind,
            feature: String::new(),
            work_item: String::new(),
            next_run: None,
        }
    }

    #[test]
    fn nothing_is_said_early_when_no_warning_was_asked_for() {
        assert_eq!(warning_due(&daily(0, None), at(8, 55)), None);
    }

    #[test]
    fn nothing_is_said_while_it_is_still_far_off() {
        assert_eq!(warning_due(&daily(10, None), at(8, 30)), None);
    }

    #[test]
    fn it_is_said_once_the_moment_is_in_range() {
        let (_, away) = warning_due(&daily(10, None), at(8, 55)).expect("a warning");
        assert_eq!(away, 5);
    }

    #[test]
    fn the_same_occurrence_is_not_announced_twice() {
        let s = daily(10, None);
        let (next_ms, _) = warning_due(&s, at(8, 55)).expect("a warning");
        // Half a minute later the clock ticks again, and the answer changes.
        let told = daily(10, Some(next_ms));
        assert_eq!(warning_due(&told, at(8, 56)), None);
    }

    #[test]
    fn tomorrow_is_a_different_occurrence_and_says_itself() {
        let s = daily(10, None);
        let (today_ms, _) = warning_due(&s, at(8, 55)).expect("a warning");
        let told = daily(10, Some(today_ms));
        // The next day, in range again: a different moment, so it speaks.
        let tomorrow = chrono::Local
            .with_ymd_and_hms(2026, 9, 8, 8, 55, 0)
            .single()
            .unwrap();
        let (next_ms, _) = warning_due(&told, tomorrow).expect("a warning");
        assert_ne!(next_ms, today_ms);
    }
}
