//! What you have read, and what you have not.
//!
//! The Inbox draws three streams that live in three places — approvals and
//! disagreements in memory, failures in the activity table — so read state
//! cannot live with the items. It lives here instead, keyed by the same string
//! the interface uses to identify a row: `activity:123`, `approval:abc`,
//! `conflict:xyz`.
//!
//! **Only decisions are stored.** A row exists because you marked something
//! read, or marked it unread again; everything else is unread by default and
//! costs nothing. That is what makes "mark all as read" on a busy day cheap
//! and "mark as unread" possible at all — the second one is the whole reason
//! this is a table rather than a timestamp.
//!
//! It replaces one: `inbox.seen` was a single moment, and everything older
//! than it counted as read. Opening the page marked the lot, one item could
//! never be singled out, and nothing could be put back. That timestamp
//! survives as a floor for history — see `inbox_floor` — so upgrading does not
//! resurrect a year of read failures as unread.

use rusqlite::params;
use serde::Serialize;

use crate::db::{err, Db};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS inbox_state (
    -- The interface's own id for the row: kind:id.
    item TEXT PRIMARY KEY,
    -- 1 read, 0 deliberately unread. A missing row means nobody has said.
    read INTEGER NOT NULL,
    at INTEGER NOT NULL
);
";

/// How many decisions to keep. Items disappear — an approval is answered, a
/// conflict resolved — and their rows would otherwise sit here for ever.
const KEEP: i64 = 5_000;

#[derive(Serialize, Clone, Debug)]
pub struct Mark {
    pub item: String,
    pub read: bool,
    pub at: i64,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Every decision that has been made. The interface holds them as a map and
/// treats anything absent as unread.
#[tauri::command]
pub fn inbox_marks(db: tauri::State<Db>) -> Result<Vec<Mark>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT item, read, at FROM inbox_state ORDER BY at DESC LIMIT ?1")
        .map_err(err)?;
    let out = stmt
        .query_map(params![KEEP], |r| {
            Ok(Mark {
                item: r.get(0)?,
                read: r.get::<_, i64>(1)? != 0,
                at: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(out)
}

/// Mark items read, or unread again.
///
/// Both directions are one command on purpose: they are the same decision with
/// a different answer, and a pair of commands would let the two drift.
#[tauri::command]
pub fn inbox_mark(db: tauri::State<Db>, items: Vec<String>, read: bool) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let mut conn = db.0.lock().unwrap();
    let at = now_millis();
    let tx = conn.transaction().map_err(err)?;
    for item in &items {
        tx.execute(
            "INSERT INTO inbox_state (item, read, at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(item) DO UPDATE SET read = excluded.read, at = excluded.at",
            params![item, read as i64, at],
        )
        .map_err(err)?;
    }
    tx.execute(
        "DELETE FROM inbox_state WHERE item NOT IN \
         (SELECT item FROM inbox_state ORDER BY at DESC LIMIT ?1)",
        params![KEEP],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}

/// The moment before which history counts as read.
///
/// The old single-timestamp scheme, kept for exactly one job: an inbox that
/// suddenly declares every failure of the last month unread is one you clear
/// once and stop trusting. Nothing writes it any more.
#[tauri::command]
pub fn inbox_floor(db: tauri::State<Db>) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    Ok(crate::db::setting_get_conn(&conn, "inbox.floor")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0))
}

/// Called once at boot with whatever the old localStorage timestamp was, so
/// the floor survives into the database. Later calls are ignored: the floor is
/// history, and history does not move.
#[tauri::command]
pub fn inbox_floor_seed(db: tauri::State<Db>, at: i64) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if let Some(v) = crate::db::setting_get_conn(&conn, "inbox.floor")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
    {
        return Ok(v);
    }
    crate::db::setting_set_conn(&conn, "inbox.floor", &at.to_string())?;
    Ok(at)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c
    }

    fn mark(c: &rusqlite::Connection, item: &str, read: bool) {
        c.execute(
            "INSERT INTO inbox_state (item, read, at) VALUES (?1, ?2, 1) \
             ON CONFLICT(item) DO UPDATE SET read = excluded.read",
            params![item, read as i64],
        )
        .unwrap();
    }

    fn state(c: &rusqlite::Connection, item: &str) -> Option<bool> {
        c.query_row(
            "SELECT read FROM inbox_state WHERE item = ?1",
            params![item],
            |r| r.get::<_, i64>(0),
        )
        .ok()
        .map(|v| v != 0)
    }

    #[test]
    fn nobody_has_said_anything_about_an_item_nobody_has_touched() {
        assert_eq!(state(&db(), "activity:1"), None);
    }

    #[test]
    fn reading_one_says_nothing_about_the_next() {
        let c = db();
        mark(&c, "activity:1", true);
        assert_eq!(state(&c, "activity:1"), Some(true));
        assert_eq!(state(&c, "activity:2"), None);
    }

    #[test]
    fn read_can_be_taken_back() {
        let c = db();
        mark(&c, "approval:7", true);
        mark(&c, "approval:7", false);
        // Deliberately unread is not the same as never touched: it survives,
        // so the next read of the table does not quietly forget the decision.
        assert_eq!(state(&c, "approval:7"), Some(false));
    }
}
