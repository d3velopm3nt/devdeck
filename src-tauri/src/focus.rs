//! A goal, a clock, and permission to ignore everything else.
//!
//! One session at a time, app-wide. That is deliberate: the point of focusing
//! is that the *other* spaces go quiet, so a per-space session would hold back
//! exactly the things it was not meant to and let through exactly the things
//! it was.
//!
//! **This stores almost nothing, because almost nothing is new.** A focus
//! session is a filter over streams that already exist — `activity`, the
//! approvals queue, the conflict list. What is held is not moved, copied or
//! marked; it stays where it was and the inbox declines to show it until the
//! session ends. Nothing is ever dropped, so ending a session cannot lose
//! anything, and killing the app mid-session loses only the session.
//!
//! **Drift detection is deliberately absent.** Telling you that you have
//! strayed needs a signal we do not have — which files you touched, which of
//! them the goal covers — and a rule for reading it. A thing that interrupts
//! you to be wrong gets switched off within a week, and takes the useful half
//! of the feature with it. The useful half is the goal, the hold, and the
//! count.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::Db;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS focus_sessions (
    id INTEGER PRIMARY KEY,
    -- What you are trying to get done. The whole session is this sentence.
    goal TEXT NOT NULL,
    -- The space the goal is about, if it is about one. Null means the goal
    -- spans everything, and then nothing is held.
    node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
    started_at INTEGER NOT NULL,
    -- Null while it is running. Exactly one row may have a null here.
    ended_at INTEGER,
    -- How much never reached you, counted by the inbox at the moment you
    -- ended. The backend cannot work this out: holding is a rendering rule
    -- over three live streams, and only the thing doing the rendering knows
    -- how many rows it declined to draw.
    held INTEGER NOT NULL DEFAULT 0
);
";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Focus {
    pub id: i64,
    pub goal: String,
    pub node_id: Option<i64>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub held: i64,
}

const COLS: &str = "id, goal, node_id, started_at, ended_at, held";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Focus> {
    Ok(Focus {
        id: r.get(0)?,
        goal: r.get(1)?,
        node_id: r.get(2)?,
        started_at: r.get(3)?,
        ended_at: r.get(4)?,
        held: r.get(5)?,
    })
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn open_session(conn: &Connection) -> Result<Option<Focus>, String> {
    let sql = format!("SELECT {COLS} FROM focus_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let mut rows = stmt.query_map([], row).map_err(err)?;
    match rows.next() {
        Some(r) => Ok(Some(r.map_err(err)?)),
        None => Ok(None),
    }
}

/// The session you are in, or None. Read on boot, so a session survives a
/// reload — the clock is wall time, not a timer we would have to keep alive.
#[tauri::command]
pub fn focus_current(db: tauri::State<Db>) -> Result<Option<Focus>, String> {
    let conn = db.0.lock().unwrap();
    open_session(&conn)
}

/// Start one. Any session still open is ended first rather than refused:
/// forgetting to end yesterday's must not stand between you and today's.
#[tauri::command]
pub fn focus_start(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    goal: String,
    node_id: Option<i64>,
) -> Result<Focus, String> {
    let goal = goal.trim().to_string();
    if goal.is_empty() {
        return Err("Say what you are trying to get done.".into());
    }

    // Decide and write under the lock; log outside it. `activity::record`
    // takes the same mutex, and holding it across that call is the deadlock
    // the scheduler's first tick shipped with.
    let (stale, started) = {
        let conn = db.0.lock().unwrap();
        let stale = open_session(&conn)?;
        if let Some(s) = &stale {
            conn.execute(
                "UPDATE focus_sessions SET ended_at = ?1 WHERE id = ?2",
                params![now_millis(), s.id],
            )
            .map_err(err)?;
        }
        let at = now_millis();
        conn.execute(
            "INSERT INTO focus_sessions (goal, node_id, started_at) VALUES (?1, ?2, ?3)",
            params![goal, node_id, at],
        )
        .map_err(err)?;
        (
            stale,
            Focus {
                id: conn.last_insert_rowid(),
                goal: goal.clone(),
                node_id,
                started_at: at,
                ended_at: None,
                held: 0,
            },
        )
    };

    if let Some(s) = stale {
        crate::activity::record(
            &app,
            "focus",
            format!("Ended “{}”", s.goal),
            "A session was still open when a new one started.",
            true,
            Some(s.id),
        );
    }
    crate::activity::record(
        &app,
        "focus",
        format!("Focusing on “{goal}”"),
        "Everything outside this goal is held until you finish.",
        true,
        Some(started.id),
    );
    Ok(started)
}

/// End the running session. `held` is what the inbox counted; it is recorded
/// so the summary can say what you did not see rather than implying nothing
/// happened.
#[tauri::command]
pub fn focus_end(app: tauri::AppHandle, db: tauri::State<Db>, held: i64) -> Result<(), String> {
    let ended = {
        let conn = db.0.lock().unwrap();
        let Some(s) = open_session(&conn)? else {
            return Ok(());
        };
        conn.execute(
            "UPDATE focus_sessions SET ended_at = ?1, held = ?2 WHERE id = ?3",
            params![now_millis(), held.max(0), s.id],
        )
        .map_err(err)?;
        s
    };

    let mins = ((now_millis() - ended.started_at) / 60_000).max(0);
    let detail = if held > 0 {
        format!("{mins} min. {held} thing{} waited.", if held == 1 { "" } else { "s" })
    } else {
        format!("{mins} min. Nothing needed you.")
    };
    crate::activity::record(
        &app,
        "focus",
        format!("Finished “{}”", ended.goal),
        detail,
        true,
        Some(ended.id),
    );
    Ok(())
}

/// The last few, newest first. Enough to answer "what did I actually do this
/// week" without becoming a report nobody asked for.
#[tauri::command]
pub fn focus_recent(db: tauri::State<Db>, limit: i64) -> Result<Vec<Focus>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!(
        "SELECT {COLS} FROM focus_sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let out = stmt
        .query_map(params![limit.clamp(1, 100)], row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::CORE_SCHEMA).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn start(conn: &Connection, goal: &str, at: i64) -> i64 {
        conn.execute(
            "INSERT INTO focus_sessions (goal, node_id, started_at) VALUES (?1, NULL, ?2)",
            params![goal, at],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn no_session_by_default() {
        assert!(open_session(&db()).unwrap().is_none());
    }

    #[test]
    fn finds_the_open_one() {
        let conn = db();
        let a = start(&conn, "old", 1_000);
        conn.execute("UPDATE focus_sessions SET ended_at = 2000 WHERE id = ?1", params![a])
            .unwrap();
        let b = start(&conn, "current", 3_000);

        let open = open_session(&conn).unwrap().expect("a session");
        assert_eq!(open.id, b);
        assert_eq!(open.goal, "current");
    }

    /// Two open sessions would make "what am I focused on" ambiguous, and the
    /// inbox would have to pick one. Starting closes whatever was open.
    #[test]
    fn only_one_is_ever_open() {
        let conn = db();
        start(&conn, "first", 1_000);
        let stale = open_session(&conn).unwrap().unwrap();
        conn.execute(
            "UPDATE focus_sessions SET ended_at = ?1 WHERE id = ?2",
            params![2_000, stale.id],
        )
        .unwrap();
        start(&conn, "second", 3_000);

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM focus_sessions WHERE ended_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    /// Recent is for looking back, so a session still running is not in it.
    #[test]
    fn recent_excludes_the_live_one() {
        let conn = db();
        let done = start(&conn, "done", 1_000);
        conn.execute("UPDATE focus_sessions SET ended_at = 2000, held = 4 WHERE id = ?1", params![done])
            .unwrap();
        start(&conn, "running", 3_000);

        let sql = format!(
            "SELECT {COLS} FROM focus_sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC"
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        let rows: Vec<Focus> = stmt.query_map([], row).unwrap().map(|r| r.unwrap()).collect();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].goal, "done");
        assert_eq!(rows[0].held, 4);
    }
}
