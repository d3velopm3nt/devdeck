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
use serde::{Deserialize, Serialize};

use crate::db::{err, Db};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS inbox_requests (id TEXT PRIMARY KEY, vault TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, evidence TEXT NOT NULL, recommendation TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'needs-you', at TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS inbox_dispatch_state (id TEXT PRIMARY KEY, state TEXT NOT NULL, generation INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_request_events (id TEXT PRIMARY KEY);
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
#[tauri::command(async)]
pub fn inbox_marks(db: tauri::State<Db>) -> Result<Vec<Mark>, String> {
    let conn = db.conn();
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
#[tauri::command(async)]
pub fn inbox_mark(db: tauri::State<Db>, items: Vec<String>, read: bool) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let mut conn = db.conn();
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
#[tauri::command(async)]
pub fn inbox_floor(db: tauri::State<Db>) -> Result<i64, String> {
    let conn = db.conn();
    Ok(crate::db::setting_get_conn(&conn, "inbox.floor")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0))
}

/// Called once at boot with whatever the old localStorage timestamp was, so
/// the floor survives into the database. Later calls are ignored: the floor is
/// history, and history does not move.
#[tauri::command(async)]
pub fn inbox_floor_seed(db: tauri::State<Db>, at: i64) -> Result<i64, String> {
    let conn = db.conn();
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Request {
    pub id: String,
    pub version: String,
    pub source: String,
    pub title: String,
    pub evidence: String,
    pub recommendation: String,
    pub kind: String,
    pub target: String,
    pub status: String,
    pub at: String,
    pub resolution: String,
}
pub fn keep_request(
    conn: &rusqlite::Connection,
    e: &crate::aiw::events::DomainEvent,
) -> Result<bool, String> {
    if e.kind != "inbox.requested" {
        return Ok(false);
    }
    let field = |key: &str| e.payload[key].as_str().unwrap_or_default().to_string();
    let id = field("request_id");
    if id.is_empty() {
        return Ok(false);
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    if tx
        .execute(
            "INSERT OR IGNORE INTO inbox_request_events(id) VALUES (?1)",
            [&e.id],
        )
        .map_err(err)?
        == 0
    {
        return Ok(false);
    }
    tx.execute("INSERT INTO inbox_requests(id,vault,version,source,title,evidence,recommendation,kind,target,at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET version=excluded.version,title=excluded.title,evidence=excluded.evidence,recommendation=excluded.recommendation,kind=excluded.kind,target=excluded.target,at=excluded.at,status='needs-you',resolution='' WHERE inbox_requests.version != excluded.version",params![id,e.scope.workspace_id.clone().unwrap_or_default(),field("version"),field("repository"),field("title"),field("evidence"),field("recommendation"),field("kind"),field("target"),e.timestamp]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(true)
}
pub fn requests(db: &Db) -> Result<Vec<Request>, String> {
    let vault = crate::visibility::root(db)?.to_string_lossy().to_string();
    let conn = db.conn();
    let mut q=conn.prepare("SELECT id,version,source,title,evidence,recommendation,kind,target,status,at,resolution FROM inbox_requests WHERE vault=?1 ORDER BY at DESC LIMIT 500").map_err(err)?;
    let rows = q
        .query_map([vault], |r| {
            Ok(Request {
                id: r.get(0)?,
                version: r.get(1)?,
                source: r.get(2)?,
                title: r.get(3)?,
                evidence: r.get(4)?,
                recommendation: r.get(5)?,
                kind: r.get(6)?,
                target: r.get(7)?,
                status: r.get(8)?,
                at: r.get(9)?,
                resolution: r.get(10)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}
#[tauri::command(async)]
pub fn inbox_requests(db: tauri::State<Db>) -> Result<Vec<Request>, String> {
    let snapshot = crate::issue_monitor::view(&db)?;
    dispatch_requests(&db, &snapshot.dispatches)?;
    requests(&db)
}
#[tauri::command(async)]
pub fn inbox_request_resolve(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    id: String,
    version: String,
    resolution: String,
) -> Result<(), String> {
    let note = resolution.trim();
    if note.is_empty() || note.len() > 4000 {
        return Err("Describe the decision or outcome (up to 4000 characters).".into());
    }
    let vault = crate::visibility::root(&db)?.to_string_lossy().to_string();
    let conn = db.conn();
    let changed=conn.execute("UPDATE inbox_requests SET status='resolved',resolution=?1 WHERE id=?2 AND version=?3 AND vault=?4 AND status='needs-you'",params![note,id,version,vault]).map_err(err)?;
    if changed == 0 {
        let same=conn.query_row("SELECT resolution FROM inbox_requests WHERE id=?1 AND version=?2 AND vault=?3 AND status='resolved'",params![id,version,vault],|r|r.get::<_,String>(0)).ok();
        if same.as_deref() != Some(note) {
            return Err(
                "This request changed or was already resolved. Refresh before deciding.".into(),
            );
        }
    }
    drop(conn);
    {
        use tauri::Emitter;
        let _ = app.emit("devdeck:inbox", ());
    }
    Ok(())
}
pub fn dispatch_requests(
    db: &Db,
    rows: &[crate::issue_monitor_model::Dispatch],
) -> Result<(), String> {
    use crate::aiw::events::{DomainEvent, EventScope, EventType};
    use sha2::{Digest, Sha256};
    let vault = crate::visibility::root(db)?.to_string_lossy().to_string();
    for row in rows {
        let id = format!("github:{}:{}:{}", vault, row.repository, row.number);
        let version = format!(
            "{:x}",
            Sha256::digest(format!("{}:{}:{}", row.status, row.workflow, row.message).as_bytes())
        );
        let generation = {
            let conn = db.conn();
            conn.execute("INSERT INTO inbox_dispatch_state(id,state,generation) VALUES (?1,?2,1) ON CONFLICT(id) DO UPDATE SET state=excluded.state,generation=generation+1 WHERE inbox_dispatch_state.state != excluded.state",params![id,version]).map_err(err)?;
            conn.query_row(
                "SELECT generation FROM inbox_dispatch_state WHERE id=?1",
                [&id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(err)?
        };
        let version = format!("{}:{}", version, generation);
        let (kind,recommendation)=match row.status.as_str(){"blocked"=>("blocker","Inspect the workflow and its setup, then choose the recovery action there. No retry has been started."),"review"|"needs-review"=>("review","Review changes and checks in the source workflow before deciding. No merge or deployment is authorized."),_=>continue};
        let mut scope = EventScope::project(&row.node.to_string());
        scope.workspace_id = Some(vault.clone());
        scope.work_item_id = Some(id.clone());
        let mut event = DomainEvent::new(
            EventType::FileChanged,
            scope,
            serde_json::json!({"request_id":id,"version":version,"repository":row.repository,"title":format!("{} — {}",crate::issue_monitor::ticket_title(db, &row.repository, row.number).unwrap_or_else(|| format!("{} #{}", row.repository, row.number)),if kind=="review"{"Ready for review"}else{"Needs your input"}),"evidence":if row.message.is_empty(){format!("Workflow {} reports {}",row.workflow,row.status)}else{row.message.clone()},"recommendation":recommendation,"kind":kind,"target":format!("work-item:github:{}:{}",row.repository.to_lowercase(),row.number)}),
        );
        event.kind = "inbox.requested".into();
        event.id = format!("inbox:{}:{}", id, version);
        crate::eventlog::post(&event);
    }
    Ok(())
}

#[cfg(test)]
mod request_tests {
    use super::*;
    fn event(version: &str) -> crate::aiw::events::DomainEvent {
        use crate::aiw::events::{DomainEvent, EventScope, EventType};
        let mut e = DomainEvent::new(
            EventType::FileChanged,
            EventScope::project("1"),
            serde_json::json!({"request_id":"one","version":version,"repository":"owner/repo","title":"Needs review","evidence":"checks passed","recommendation":"Review changes","kind":"review","target":"space:1"}),
        );
        e.kind = "inbox.requested".into();
        e.id = format!("event-{version}");
        e
    }
    #[test]
    fn request_read_and_duplicate_events_do_not_resolve_or_reopen() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        assert!(keep_request(&c, &event("a")).unwrap());
        c.execute("INSERT INTO inbox_state VALUES ('request:one:a',1,1)", [])
            .unwrap();
        let status: String = c
            .query_row("SELECT status FROM inbox_requests", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "needs-you");
        c.execute(
            "UPDATE inbox_requests SET status='resolved',resolution='Reviewed in workflow'",
            [],
        )
        .unwrap();
        assert!(!keep_request(&c, &event("a")).unwrap());
        let status: String = c
            .query_row("SELECT status FROM inbox_requests", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "resolved");
        assert!(keep_request(&c, &event("b")).unwrap());
        let (status, note): (String, String) = c
            .query_row("SELECT status,resolution FROM inbox_requests", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(status, "needs-you");
        assert_eq!(note, "");
        let count: i64 = c
            .query_row("SELECT count(*) FROM inbox_requests", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
    #[test]
    fn informational_events_never_create_requests() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        let mut e = event("a");
        e.kind = "file.changed".into();
        assert!(!keep_request(&c, &e).unwrap());
    }
}
