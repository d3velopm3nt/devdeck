//! One activity stream.
//!
//! Everything the app *does* — a service starting, a query running, a repo
//! pulling, a clip landing — arrives here and nowhere else. Home's feed, the
//! widget and usage ranking all read the same table, so a new kind of event
//! shows up everywhere at once instead of needing three integrations.
//!
//! It is durable on purpose. Home used to derive "recent activity" from the
//! `recents` table, which only knows *the last time* something ran — so two
//! runs looked like one, and a crash looked like nothing at all. This records
//! each occurrence, survives a restart, and keeps the outcome.

use rusqlite::params;
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::db::{err, Db};

/// How many events to keep. Old activity is interesting for a while and then
/// it isn't; this bounds the table without anyone having to think about it.
const KEEP: i64 = 2_000;

#[derive(Serialize, Clone, Debug)]
pub struct Activity {
    pub id: i64,
    /// service | query | git | clip | screenshot | setup | update
    pub kind: String,
    pub title: String,
    pub detail: String,
    /// False marks something that failed — a crash, a failed query.
    pub ok: bool,
    /// The service/connection/node this refers to, when there is one.
    pub ref_id: Option<i64>,
    pub project_name: String,
    pub ts: i64,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Record one event. Deliberately infallible: activity is a side effect of
/// doing something useful, and failing to log it must never break the thing
/// that happened.
/// Take the database lock, but give up rather than hanging forever.
fn lock_briefly(db: &Db) -> Option<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match db.0.try_lock() {
            Ok(g) => return Some(g),
            // A poisoned mutex means some other thread panicked mid-write.
            // Nothing here can fix that, and waiting will not help.
            Err(std::sync::TryLockError::Poisoned(_)) => return None,
            Err(std::sync::TryLockError::WouldBlock) => {
                if std::time::Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        }
    }
}

pub fn record(
    app: &tauri::AppHandle,
    kind: &str,
    title: impl Into<String>,
    detail: impl Into<String>,
    ok: bool,
    ref_id: Option<i64>,
) {
    let title = title.into();
    let detail = detail.into();
    let ts = now_millis();
    let project_name = crate::stash::current_context(app).project_name;

    let Some(db) = app.try_state::<Db>() else {
        return;
    };
    // Never block waiting for the database.
    //
    // A caller that still holds the lock when it calls this deadlocks the
    // thread it is on — and when that is the main thread the whole window
    // freezes with no error anywhere. That has happened three times now (the
    // scheduler's first tick, `schedule_run_now`, and a bot learning a skill),
    // and each time it looked like the app had simply stopped rather than like a
    // bug in logging.
    //
    // Real contention clears in microseconds, so a bounded wait costs correct
    // callers nothing and turns the broken case into one missing line and a
    // warning. This module already promises that failing to log must never break
    // the thing that happened; freezing the app was the one way it could.
    let Some(conn) = lock_briefly(&db) else {
        eprintln!(
            "[activity] gave up waiting for the database to log {kind:?} {title:?} — something is holding the lock across this call"
        );
        return;
    };
    let id = {
        if conn
            .execute(
                "INSERT INTO activity (kind, title, detail, ok, ref_id, project_name, ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![kind, title, detail, ok as i64, ref_id, project_name, ts],
            )
            .is_err()
        {
            return;
        }
        let id = conn.last_insert_rowid();
        // Trim occasionally rather than on every insert.
        if id % 200 == 0 {
            let _ = conn.execute(
                "DELETE FROM activity WHERE id <= (SELECT MAX(id) - ?1 FROM activity)",
                params![KEEP],
            );
        }
        id
    };
    drop(conn);

    let _ = app.emit(
        "activity:new",
        Activity {
            id,
            kind: kind.to_string(),
            title,
            detail,
            ok,
            ref_id,
            project_name,
            ts,
        },
    );
}

#[tauri::command]
pub fn activity_list(db: tauri::State<Db>, limit: i64) -> Result<Vec<Activity>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, title, detail, ok, ref_id, project_name, ts
               FROM activity ORDER BY ts DESC, id DESC LIMIT ?1",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![if limit > 0 { limit } else { 60 }], |r| {
            Ok(Activity {
                id: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                detail: r.get(3)?,
                ok: r.get::<_, i64>(4)? != 0,
                ref_id: r.get(5)?,
                project_name: r.get(6)?,
                ts: r.get(7)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn activity_clear(db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM activity", []).map_err(err)?;
    Ok(())
}

/// Durable per-service run history: every start/stop with how long it lived
/// and how it ended. This is the part `recents` could never give us — it only
/// stored the last run, so a service that crashed twice looked identical to
/// one that ran once.
#[derive(Serialize)]
pub struct ServiceRun {
    pub id: i64,
    pub service_id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub exit_code: Option<i64>,
    /// running | stopped | crashed
    pub outcome: String,
}

#[tauri::command]
pub fn service_runs(
    db: tauri::State<Db>,
    service_id: i64,
    limit: i64,
) -> Result<Vec<ServiceRun>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, service_id, started_at, ended_at, exit_code, outcome
               FROM service_runs WHERE service_id = ?1 ORDER BY started_at DESC LIMIT ?2",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(
            params![service_id, if limit > 0 { limit } else { 25 }],
            |r| {
                Ok(ServiceRun {
                    id: r.get(0)?,
                    service_id: r.get(1)?,
                    started_at: r.get(2)?,
                    ended_at: r.get(3)?,
                    exit_code: r.get(4)?,
                    outcome: r.get(5)?,
                })
            },
        )
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

/// Open a run row when a service starts.
pub fn run_started(app: &tauri::AppHandle, service_id: i64) {
    let Some(db) = app.try_state::<Db>() else {
        return;
    };
    let Ok(conn) = db.0.lock() else { return };
    // Close any run left open by a crash or a kill we never saw, so one
    // service can't accumulate phantom "still running" rows across restarts.
    let _ = conn.execute(
        "UPDATE service_runs SET ended_at = ?1, outcome = 'stopped'
          WHERE service_id = ?2 AND ended_at IS NULL",
        params![now_millis(), service_id],
    );
    let _ = conn.execute(
        "INSERT INTO service_runs (service_id, started_at, outcome)
         VALUES (?1, ?2, 'running')",
        params![service_id, now_millis()],
    );
}

/// Close the open run when a service stops or dies.
pub fn run_ended(app: &tauri::AppHandle, service_id: i64, exit_code: Option<i64>, crashed: bool) {
    let Some(db) = app.try_state::<Db>() else {
        return;
    };
    let Ok(conn) = db.0.lock() else { return };
    let _ = conn.execute(
        "UPDATE service_runs SET ended_at = ?1, exit_code = ?2, outcome = ?3
          WHERE service_id = ?4 AND ended_at IS NULL",
        params![
            now_millis(),
            exit_code,
            if crashed { "crashed" } else { "stopped" },
            service_id
        ],
    );
}

/// Mark every open run closed at startup. A run that was "running" when the
/// app was killed did not survive; saying it did would be a lie the history
/// then repeats forever.
pub fn close_orphan_runs(conn: &rusqlite::Connection) {
    let _ = conn.execute(
        "UPDATE service_runs SET outcome = 'stopped', ended_at = coalesce(ended_at, started_at)
          WHERE ended_at IS NULL",
        [],
    );
}
