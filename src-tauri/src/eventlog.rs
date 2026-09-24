//! The event bus, kept.
//!
//! The bus holds five thousand events in memory and loses every one of them
//! when the app stops. That is fine for watching something happen and useless
//! for everything else: you cannot ask what a manager did on Tuesday, a phone
//! that was offline cannot catch up, and the one run that mattered is gone the
//! next morning.
//!
//! So the same sink that hands an event to the window writes it here. This
//! lives outside `aiw` on purpose — the bus stays free of Tauri and SQLite,
//! which is the layering rule that keeps the test binary linkable, and the
//! shell is what knows there is a database at all.
//!
//! **A session is one run of the app.** It is the difference between "what has
//! happened since I opened this" and "what has ever happened", which is the
//! only division of history anybody actually asks for.

use rusqlite::params;
use serde::Serialize;
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

use crate::db::{err, Db};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS events (
    -- The bus's own id, so the same event written twice stays one row.
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    -- Which run of the app saw it.
    session TEXT NOT NULL,
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    at INTEGER NOT NULL,
    project_id TEXT,
    feature_id TEXT,
    agent_id TEXT,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);
CREATE INDEX IF NOT EXISTS events_session ON events(session);
";

/// How many to keep. Roughly a year of ordinary use, and small on disk —
/// an event is a few hundred bytes.
const KEEP: i64 = 200_000;

/// This run of the app. Made once, on first use.
pub fn session() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| {
        format!(
            "s{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        )
    })
}

/// One event, in the shape the window already knows how to draw.
///
/// Deliberately the same field names the bus serialises, so a row read back
/// out of here renders through exactly the same code as one arriving live —
/// two shapes for one thing is how a history view drifts from the live one.
#[derive(Serialize, Clone, Debug)]
pub struct Kept {
    pub id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub category: String,
    pub timestamp: String,
    pub session: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub payload: serde_json::Value,
}

/// The log writes on a thread of its own, and that is a correctness rule
/// rather than a performance one.
///
/// `Bus::emit` runs its sink on whichever thread published the event, and
/// most publishers are Tauri commands that are already holding the database
/// mutex when they publish. A sink that locks that same mutex therefore
/// waits for a lock its own thread is holding — `std::sync::Mutex` is not
/// reentrant — so the command never returns, the window stops responding,
/// and nothing anywhere reports a fault. Pressing Agree on a proposal did
/// exactly this.
///
/// Asking every future call site to publish outside the lock would be a rule
/// nobody can see being broken, so the log takes itself off the caller's
/// thread instead and keeps its own connection. Two connections are safe
/// here because the database runs in WAL mode.
static POST: OnceLock<Sender<crate::aiw::events::DomainEvent>> = OnceLock::new();

/// Open the log's own connection and start draining. Called once, at startup.
pub fn start_writer() {
    POST.get_or_init(|| {
        let (tx, rx) = channel::<crate::aiw::events::DomainEvent>();
        std::thread::spawn(move || {
            let Ok(conn) = rusqlite::Connection::open(crate::db::db_path()) else {
                // No history, but the app is otherwise unharmed — which is the
                // whole point of the log being off to one side.
                return;
            };
            let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
            let _ = conn.execute_batch(SCHEMA);
            drain(&conn, rx);
        });
        tx
    });
}

/// Write everything that arrives until the channel closes. Split out from the
/// thread so the off-thread path is something a test can actually run.
fn drain(
    conn: &rusqlite::Connection,
    rx: std::sync::mpsc::Receiver<crate::aiw::events::DomainEvent>,
) {
    for ev in rx {
        keep(conn, &ev);
    }
}

/// Hand an event to the writer. Never blocks the thing that happened, and
/// never touches the connection the caller may be holding.
pub fn post(ev: &crate::aiw::events::DomainEvent) {
    if let Some(tx) = POST.get() {
        let _ = tx.send(ev.clone());
    }
}

/// Write one down. Never fails loudly: losing an event must not break the
/// thing that happened.
pub fn keep(conn: &rusqlite::Connection, e: &crate::aiw::events::DomainEvent) {
    let at = chrono::DateTime::parse_from_rfc3339(&e.timestamp)
        .map(|t| t.timestamp_millis())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());
    let _ = conn.execute(
        "INSERT OR IGNORE INTO events
            (id, seq, session, kind, category, at, project_id, feature_id, agent_id, payload)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            e.id,
            e.seq as i64,
            session(),
            e.kind,
            e.category,
            at,
            e.scope.project_id,
            e.scope.feature_id,
            e.scope.agent_id,
            serde_json::to_string(&e.payload).unwrap_or_else(|_| "{}".into()),
        ],
    );
}

/// Drop the oldest once there are far too many. Called rarely — on startup —
/// because trimming on every write would cost more than it saves.
pub fn trim(conn: &rusqlite::Connection) -> Result<usize, String> {
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
        .map_err(err)?;
    if n <= KEEP {
        return Ok(0);
    }
    let cut = n - KEEP;
    conn.execute(
        "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY at ASC LIMIT ?1)",
        params![cut],
    )
    .map_err(err)?;
    Ok(cut as usize)
}

/// What has happened, newest first.
///
/// `this_session` is the division people actually ask for: what has happened
/// since I opened the app, or everything it has ever seen.
#[tauri::command(async)]
pub fn events_history(
    db: tauri::State<Db>,
    this_session: bool,
    project_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Kept>, String> {
    let conn = db.0.lock().unwrap();
    let limit = limit.unwrap_or(500).clamp(1, 5_000);
    let mut sql = String::from(
        "SELECT id, seq, session, kind, category, at, project_id, feature_id, agent_id, payload
         FROM events WHERE 1 = 1",
    );
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if this_session {
        sql.push_str(" AND session = ?");
        args.push(Box::new(session().to_string()));
    }
    if let Some(p) = project_id.filter(|p| !p.trim().is_empty()) {
        sql.push_str(" AND project_id = ?");
        args.push(Box::new(p));
    }
    sql.push_str(" ORDER BY at DESC, seq DESC LIMIT ?");
    args.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            |r| {
                let at: i64 = r.get(5)?;
                let raw: String = r.get(9)?;
                Ok(Kept {
                    id: r.get(0)?,
                    seq: r.get::<_, i64>(1)? as u64,
                    session: r.get(2)?,
                    kind: r.get(3)?,
                    category: r.get(4)?,
                    timestamp: chrono::DateTime::from_timestamp_millis(at)
                        .unwrap_or_default()
                        .to_rfc3339(),
                    project_id: r.get(6)?,
                    feature_id: r.get(7)?,
                    agent_id: r.get(8)?,
                    payload: serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null),
                })
            },
        )
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// How much history there is, and how much of it is this run.
#[tauri::command(async)]
pub fn events_count(db: tauri::State<Db>) -> Result<(i64, i64), String> {
    let conn = db.0.lock().unwrap();
    let all: i64 = conn
        .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
        .map_err(err)?;
    let mine: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE session = ?1",
            params![session()],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok((all, mine))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c
    }

    fn an_event(id: &str, seq: u64) -> crate::aiw::events::DomainEvent {
        let mut e = crate::aiw::events::DomainEvent::new(
            crate::aiw::events::EventType::AgentStarted,
            crate::aiw::events::in_space(51, None, Some("Mason")),
            serde_json::json!({ "name": "Mason" }),
        );
        // Fixed, because the point of the first test is two writes of *one*
        // event, and the bus hands out a fresh id every time it is asked.
        e.id = id.to_string();
        e.seq = seq;
        e
    }

    /// The bus can hand the same event over twice — once live, once in a
    /// history read — and that must stay one row rather than two.
    #[test]
    fn the_same_event_written_twice_is_one_row() {
        let c = db();
        keep(&c, &an_event("e1", 1));
        keep(&c, &an_event("e1", 1));
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    /// What was written comes back with the actor and the payload intact,
    /// because the whole point is reading it after a restart.
    #[test]
    fn it_comes_back_with_who_did_it() {
        let c = db();
        keep(&c, &an_event("e2", 7));
        let (kind, who, payload): (String, Option<String>, String) = c
            .query_row(
                "SELECT kind, agent_id, payload FROM events WHERE id = 'e2'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kind, "agent.started");
        assert_eq!(who.as_deref(), Some("Mason"));
        assert!(payload.contains("Mason"));
    }

    /// The reason the writer exists: an event handed over while the caller
    /// holds a lock must still be written, by somebody else, without the
    /// caller waiting. Before this, the sink locked the database on the
    /// publisher's thread — and every publisher that already held that lock
    /// froze the app outright.
    #[test]
    fn an_event_posted_under_a_lock_is_written_by_another_thread() {
        let (tx, rx) = channel::<crate::aiw::events::DomainEvent>();
        let held = std::sync::Arc::new(std::sync::Mutex::new(db()));
        let writer = {
            let held = held.clone();
            std::thread::spawn(move || {
                let conn = held.lock().unwrap();
                drain(&conn, rx);
            })
        };

        // Wait until the writer owns the lock, then post while it is held.
        while held.try_lock().is_ok() {
            std::thread::yield_now();
        }
        tx.send(an_event("e3", 1)).unwrap();
        tx.send(an_event("e4", 2)).unwrap();
        drop(tx);
        writer.join().unwrap();

        let n: i64 = held
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
    }
}
