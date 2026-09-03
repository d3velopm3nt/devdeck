//! Every model call, kept.
//!
//! What went in, what came back, whose turn it was, what it cost. One row per
//! call — not per session, not per message — because a turn is the unit you
//! are billed for and the unit that goes wrong.
//!
//! **It exists to answer two questions.** "Why did that agent do nothing?" is
//! read one row at a time in the bottom bar, with the prompt and the reply in
//! front of you. "What is this costing?" is the same rows added up per space,
//! per bot, per model on the Analytics page.
//!
//! **Usage is `NULL` when the provider did not say**, never zero. A provider
//! that reports nothing and a turn that cost nothing are different facts, and
//! summing the second as if it were the first is how a bill surprises you.
//!
//! **The text is capped, and the cap is visible.** A context can be tens of
//! thousands of characters; the store keeps the head of each and records the
//! true length beside it, so a truncated prompt never reads as a short one.

use rusqlite::params;
use serde::Serialize;

use crate::db::{err, Db};

/// How many calls to keep. Old ones stop being interesting long before they
/// stop taking space; this bounds the table without anyone thinking about it.
const KEEP: i64 = 5_000;

/// The most of one text that is stored. Enough to read a prompt and see what
/// a model was told; not enough for one call to weigh a megabyte.
const CAP: usize = 24_000;

/// The log stream the AI's own failures go to, beside setup, git and the
/// updater. Negative, like every other system stream.
///
/// The Models tab holds every call in full; this is the other half of the same
/// idea — when a turn fails, you should not have to know where to look. It
/// appears in Logs with everything else that went wrong today.
pub const AI_LOG_ID: i64 = -500_000;

/// Say something on the AI's log stream. Best effort: a line that cannot be
/// written must never fail the thing it was describing.
pub fn log_line(app: &tauri::AppHandle, stream: &str, line: String) {
    crate::services::push_log(app, AI_LOG_ID, "ai", stream, line);
}

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    -- Who spoke: an agent id, or bot:<node> for a bot with no agent.
    speaker TEXT NOT NULL,
    speaker_name TEXT NOT NULL DEFAULT '',
    -- agent | bot | assistant
    kind TEXT NOT NULL DEFAULT 'agent',
    -- The agent whose provider and model actually did the talking.
    runs_as TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    -- Where it happened.
    project_id TEXT NOT NULL DEFAULT '',
    project_name TEXT NOT NULL DEFAULT '',
    feature TEXT NOT NULL DEFAULT '',
    conversation TEXT NOT NULL DEFAULT '',
    session TEXT NOT NULL DEFAULT '',
    turn INTEGER NOT NULL DEFAULT 0,
    ms INTEGER NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL DEFAULT 1,
    error TEXT NOT NULL DEFAULT '',
    -- What went in and what came back, capped; the true sizes beside them.
    prompt TEXT NOT NULL DEFAULT '',
    prompt_len INTEGER NOT NULL DEFAULT 0,
    reply TEXT NOT NULL DEFAULT '',
    reply_len INTEGER NOT NULL DEFAULT 0,
    tools INTEGER NOT NULL DEFAULT 0,
    -- NULL when the provider did not report. Never write 0 for 'unknown'.
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_at ON llm_calls(at DESC);
";

/// What happened the last time a model was actually called.
///
/// A catalogue is a list of names. Whether your key may call one of them, and
/// whether it answers at all, is only knowable by trying — NVIDIA publishes
/// eighty-odd ids of which most return "not found for account" and a few take
/// the request and go quiet. So the answer is remembered per model, and the
/// picker shows what is known and stays silent about the rest.
pub const CHECKS_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS model_checks (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    ok INTEGER NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL,
    PRIMARY KEY (provider, model)
);
";

#[derive(Serialize, Clone, Debug)]
pub struct ModelCheck {
    pub provider: String,
    pub model: String,
    pub ok: bool,
    pub detail: String,
    pub at: i64,
}

/// Every verdict for one provider, for badging its list.
#[tauri::command]
pub fn model_checks(db: tauri::State<Db>, provider: String) -> Result<Vec<ModelCheck>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT provider, model, ok, detail, at FROM model_checks WHERE provider = ?1")
        .map_err(err)?;
    let out = stmt
        .query_map(params![provider], |r| {
            Ok(ModelCheck {
                provider: r.get(0)?,
                model: r.get(1)?,
                ok: r.get::<_, i64>(2)? != 0,
                detail: r.get(3)?,
                at: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(out)
}

/// Remember one verdict, replacing whatever was known before.
pub fn remember_check(conn: &rusqlite::Connection, c: &ModelCheck) {
    let _ = conn.execute(
        "INSERT INTO model_checks (provider, model, ok, detail, at) VALUES (?1,?2,?3,?4,?5)          ON CONFLICT(provider, model) DO UPDATE SET ok = excluded.ok, detail = excluded.detail,          at = excluded.at",
        params![c.provider, c.model, c.ok as i64, c.detail, c.at],
    );
}

#[derive(Serialize, Clone, Debug)]
pub struct Call {
    pub id: i64,
    pub at: i64,
    pub speaker: String,
    pub speaker_name: String,
    pub kind: String,
    pub runs_as: String,
    pub provider: String,
    pub model: String,
    pub project_id: String,
    pub project_name: String,
    pub feature: String,
    pub conversation: String,
    pub session: String,
    pub turn: i64,
    pub ms: i64,
    pub ok: bool,
    pub error: String,
    pub prompt: String,
    pub prompt_len: i64,
    pub reply: String,
    pub reply_len: i64,
    pub tools: i64,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_write_tokens: Option<i64>,
}

const COLS: &str = "id, at, speaker, speaker_name, kind, runs_as, provider, model, project_id, \
                    project_name, feature, conversation, session, turn, ms, ok, error, prompt, \
                    prompt_len, reply, reply_len, tools, input_tokens, output_tokens, \
                    cache_read_tokens, cache_write_tokens";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Call> {
    Ok(Call {
        id: r.get(0)?,
        at: r.get(1)?,
        speaker: r.get(2)?,
        speaker_name: r.get(3)?,
        kind: r.get(4)?,
        runs_as: r.get(5)?,
        provider: r.get(6)?,
        model: r.get(7)?,
        project_id: r.get(8)?,
        project_name: r.get(9)?,
        feature: r.get(10)?,
        conversation: r.get(11)?,
        session: r.get(12)?,
        turn: r.get(13)?,
        ms: r.get(14)?,
        ok: r.get::<_, i64>(15)? != 0,
        error: r.get(16)?,
        prompt: r.get(17)?,
        prompt_len: r.get(18)?,
        reply: r.get(19)?,
        reply_len: r.get(20)?,
        tools: r.get(21)?,
        input_tokens: r.get(22)?,
        output_tokens: r.get(23)?,
        cache_read_tokens: r.get(24)?,
        cache_write_tokens: r.get(25)?,
    })
}

/// One grouped column as a string, whatever SQLite decided it was.
///
/// The groupings are not all text: a day bucket is `at / 86400000`, an
/// integer. Asking rusqlite for a `String` there fails the whole query with
/// "Invalid column type Integer", which is how the Analytics page arrived
/// empty behind an error banner the first time it was opened. Reading the
/// value and converting it here means a new grouping cannot break the page by
/// being a number.
fn text_at(r: &rusqlite::Row, i: usize) -> rusqlite::Result<String> {
    use rusqlite::types::ValueRef;
    Ok(match r.get_ref(i)? {
        ValueRef::Null => String::new(),
        ValueRef::Integer(n) => n.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Blob(_) => String::new(),
    })
}

fn head(s: &str) -> (String, i64) {
    let len = s.chars().count() as i64;
    if len as usize <= CAP {
        return (s.to_string(), len);
    }
    (s.chars().take(CAP).collect(), len)
}

/// Write one call down. Deliberately infallible: logging is a side effect of
/// doing something useful, and failing to log must never fail the turn.
pub fn record(app: &tauri::AppHandle, c: crate::aiw::state::CallRecord) {
    use tauri::Manager;
    let Some(db) = app.try_state::<Db>() else { return };
    let Ok(conn) = db.0.lock() else { return };

    let (prompt, prompt_len) = head(&c.prompt);
    let (reply, reply_len) = head(&c.reply);
    let u = c.usage;
    let res = conn.execute(
        "INSERT INTO llm_calls (at, speaker, speaker_name, kind, runs_as, provider, model, \
         project_id, project_name, feature, conversation, session, turn, ms, ok, error, prompt, \
         prompt_len, reply, reply_len, tools, input_tokens, output_tokens, cache_read_tokens, \
         cache_write_tokens) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,\
         ?18,?19,?20,?21,?22,?23,?24,?25)",
        params![
            c.at,
            c.speaker,
            c.speaker_name,
            c.kind,
            c.runs_as,
            c.provider,
            c.model,
            c.project_id,
            c.project_name,
            c.feature,
            c.conversation,
            c.session,
            c.turn as i64,
            c.ms,
            c.ok as i64,
            c.error,
            prompt,
            prompt_len,
            reply,
            reply_len,
            c.tools as i64,
            u.map(|x| x.input as i64),
            u.map(|x| x.output as i64),
            u.map(|x| x.cache_read as i64),
            u.map(|x| x.cache_write as i64),
        ],
    );
    if let Err(e) = res {
        eprintln!("[calls] could not record a model call: {e}");
        return;
    }
    // A failed turn goes to the log as well as the table. The table is where
    // you look when you already suspect the model; the log is where you look
    // when you only know something went wrong.
    if !c.ok {
        log_line(
            app,
            "stderr",
            format!(
                "{} ({} · {}) failed after {}ms: {}",
                c.speaker_name, c.provider, c.model, c.ms, c.error
            ),
        );
    }
    let _ = conn.execute(
        "DELETE FROM llm_calls WHERE id NOT IN (SELECT id FROM llm_calls ORDER BY at DESC LIMIT ?1)",
        params![KEEP],
    );
}

/// The calls, newest first.
#[tauri::command]
pub fn calls_list(db: tauri::State<Db>, limit: Option<i64>) -> Result<Vec<Call>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!("SELECT {COLS} FROM llm_calls ORDER BY at DESC LIMIT ?1");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let out = stmt
        .query_map(params![limit.unwrap_or(200)], row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(out)
}

/// Tokens added up along one dimension.
#[derive(Serialize, Clone, Debug)]
pub struct UsageRow {
    /// The thing being counted: a space, a speaker, a model.
    pub key: String,
    pub label: String,
    pub calls: i64,
    /// Calls whose provider reported nothing. Shown, not hidden: an average
    /// over half the data is a number that lies quietly.
    pub unreported: i64,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    /// For a per-model row: which provider it belongs to.
    pub provider: String,
}

/// Usage grouped by space, speaker and model, over a window in days.
///
/// Three groupings from one query rather than three round trips, because they
/// are three views of the same rows and a page that fetched them separately
/// could show three totals that disagree.
#[derive(Serialize, Clone, Debug)]
pub struct UsageReport {
    pub since: i64,
    pub calls: i64,
    pub unreported: i64,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub by_space: Vec<UsageRow>,
    pub by_speaker: Vec<UsageRow>,
    pub by_model: Vec<UsageRow>,
    /// Calls per day, oldest first, for the shape of it.
    pub by_day: Vec<UsageRow>,
}

#[tauri::command]
pub fn calls_usage(db: tauri::State<Db>, days: Option<i64>) -> Result<UsageReport, String> {
    let conn = db.0.lock().unwrap();
    let days = days.unwrap_or(30).clamp(1, 3650);
    let since = chrono::Local::now().timestamp_millis() - days * 86_400_000;

    let group = |by: &str, label: &str| -> Result<Vec<UsageRow>, String> {
        let sql = format!(
            "SELECT {by} AS k, MAX({label}) AS lbl, COUNT(*) AS n, \
             SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END) AS unreported, \
             COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), \
             COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_write_tokens),0), \
             MAX(provider) \
             FROM llm_calls WHERE at >= ?1 GROUP BY k ORDER BY \
             (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) DESC, n DESC"
        );
        let mut stmt = conn.prepare(&sql).map_err(err)?;
        let rows = stmt
            .query_map(params![since], |r| {
                Ok(UsageRow {
                    key: text_at(r, 0)?,
                    label: text_at(r, 1)?,
                    calls: r.get(2)?,
                    unreported: r.get(3)?,
                    input: r.get(4)?,
                    output: r.get(5)?,
                    cache_read: r.get(6)?,
                    cache_write: r.get(7)?,
                    provider: r.get::<_, Option<String>>(8)?.unwrap_or_default(),
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(rows)
    };

    let by_space = group("project_id", "project_name")?;
    let by_speaker = group("speaker", "speaker_name")?;
    let by_model = group("model", "model")?;
    // SQLite has no date type; the millisecond stamp divided by a day is the
    // day, and formatting is the frontend's business.
    let by_day = group("CAST(at / 86400000 AS INTEGER)", "''")?;

    let sum = |f: fn(&UsageRow) -> i64| by_space.iter().map(f).sum::<i64>();
    Ok(UsageReport {
        since,
        calls: sum(|r| r.calls),
        unreported: sum(|r| r.unreported),
        input: sum(|r| r.input),
        output: sum(|r| r.output),
        cache_read: sum(|r| r.cache_read),
        cache_write: sum(|r| r.cache_write),
        by_space,
        by_speaker,
        by_model,
        by_day,
    })
}

#[tauri::command]
pub fn calls_clear(db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM llm_calls", []).map_err(err)?;
    Ok(())
}
