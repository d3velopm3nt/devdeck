//! Connections — the SQL layer.
//!
//! A *runner*, not an IDE. DevDeck does not speak any database wire protocol:
//! it drives the clients you already have (`psql`, `sqlite3`, `sqlcmd`), asks
//! them for machine-readable output, and shows you the grid. The surface stays
//! small, it works with whatever versions you have, and every feature of your
//! database stays reachable because we are not standing in front of it.
//!
//! Passwords are never here. They live in Windows Credential Manager
//! (`creds.rs`), are read only to build one command line, and are never
//! returned over IPC or written to SQLite.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::creds;
use crate::db::{err, Db};

/// Rows past this are dropped, and `truncated` says so. A runner should not
/// pretend to be a spreadsheet, and 100k rows in a webview helps nobody.
const MAX_ROWS: usize = 5_000;
/// Seconds before a query is killed. A hung client must not hang DevDeck.
const QUERY_TIMEOUT_SECS: u64 = 60;
const TEST_TIMEOUT_SECS: u64 = 10;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ConnDef {
    pub id: i64,
    pub project_id: Option<i64>,
    pub name: String,
    /// postgres | sqlite | sqlserver
    pub engine: String,
    pub host: String,
    pub port: Option<i64>,
    /// For sqlite this is the file path.
    pub database: String,
    pub username: String,
    pub sort: i64,
    pub created_at: i64,
    /// Whether a password is stored. Note what this is *not*: the password.
    /// That a secret exists is safe to tell the UI; the secret is not.
    #[serde(default)]
    pub has_password: bool,
}

const CONN_COLS: &str =
    "id, project_id, name, engine, host, port, database, username, sort, created_at";

fn row_to_conn(row: &rusqlite::Row) -> rusqlite::Result<ConnDef> {
    let id: i64 = row.get(0)?;
    Ok(ConnDef {
        id,
        project_id: row.get(1)?,
        name: row.get(2)?,
        engine: row.get(3)?,
        host: row.get(4)?,
        port: row.get(5)?,
        database: row.get(6)?,
        username: row.get(7)?,
        sort: row.get(8)?,
        created_at: row.get(9)?,
        has_password: creds::exists(&creds::target_for(id)),
    })
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------- CRUD ----------

#[tauri::command]
pub fn conn_list(db: tauri::State<Db>) -> Result<Vec<ConnDef>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CONN_COLS} FROM connections ORDER BY sort, name"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map([], row_to_conn)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn conn_save(db: tauri::State<Db>, def: ConnDef) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if def.id <= 0 {
        conn.execute(
            "INSERT INTO connections
                (project_id, name, engine, host, port, database, username, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                def.project_id,
                def.name,
                def.engine,
                def.host,
                def.port,
                def.database,
                def.username,
                now_millis()
            ],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE connections
                SET project_id=?1, name=?2, engine=?3, host=?4, port=?5, database=?6, username=?7
              WHERE id=?8",
            params![
                def.project_id,
                def.name,
                def.engine,
                def.host,
                def.port,
                def.database,
                def.username,
                def.id
            ],
        )
        .map_err(err)?;
        Ok(def.id)
    }
}

#[tauri::command]
pub fn conn_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
        .map_err(err)?;
    drop(conn);
    // Take the credential with it. An orphaned secret in Credential Manager,
    // belonging to a connection you deleted, is exactly the quiet residue
    // this design exists to avoid.
    creds::delete(&creds::target_for(id));
    Ok(())
}

/// Store a password. It goes to Windows Credential Manager and is never
/// echoed back — there is deliberately no command to read one out.
#[tauri::command]
pub fn conn_set_password(db: tauri::State<Db>, id: i64, password: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let user: String = conn
        .query_row(
            "SELECT username FROM connections WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(err)?;
    drop(conn);
    if password.is_empty() {
        creds::delete(&creds::target_for(id));
        return Ok(());
    }
    creds::set(&creds::target_for(id), &user, &password)
}

#[tauri::command]
pub fn conn_clear_password(id: i64) -> Result<(), String> {
    creds::delete(&creds::target_for(id));
    Ok(())
}

// ---------- running ----------

#[derive(Serialize, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
    /// True when the result was cut at MAX_ROWS. Never truncate in silence.
    pub truncated: bool,
    pub ms: i64,
    /// Empty on success. A message you can act on, not an exit code.
    pub error: String,
    /// The client binary we could not find, so the UI can offer to install it.
    pub missing_tool: String,
}

/// The CLI that speaks a given engine, plus a human name for messages.
fn client_for(engine: &str) -> (&'static str, &'static str) {
    match engine {
        "sqlite" => ("sqlite3", "SQLite"),
        "sqlserver" => ("sqlcmd", "SQL Server"),
        _ => ("psql", "PostgreSQL"),
    }
}

fn build_command(def: &ConnDef, sql: &str) -> std::process::Command {
    let (bin, _) = client_for(&def.engine);
    let mut cmd = std::process::Command::new(bin);
    match def.engine.as_str() {
        "sqlite" => {
            cmd.args(["-csv", "-header", &def.database, sql]);
        }
        "sqlserver" => {
            let server = match def.port {
                Some(p) => format!("{},{}", def.host, p),
                None => def.host.clone(),
            };
            cmd.args([
                "-S",
                &server,
                "-d",
                &def.database,
                "-s",
                ",",
                "-W",
                "-Q",
                sql,
            ]);
            if def.username.is_empty() {
                cmd.arg("-E"); // trusted connection
            } else {
                cmd.args(["-U", &def.username]);
                if let Some(pw) = creds::get(&creds::target_for(def.id)) {
                    cmd.args(["-P", &pw]);
                }
            }
        }
        _ => {
            let port = def.port.unwrap_or(5432).to_string();
            cmd.args([
                "--csv",
                "-v",
                "ON_ERROR_STOP=1",
                "-h",
                &def.host,
                "-p",
                &port,
                "-U",
                &def.username,
                "-d",
                &def.database,
                "-c",
                sql,
            ]);
            // psql takes the password from the environment, so unlike sqlcmd
            // it never appears in a process listing.
            if let Some(pw) = creds::get(&creds::target_for(def.id)) {
                cmd.env("PGPASSWORD", pw);
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Run a child to completion, killing it if it outstays `secs`.
fn run_capped(
    mut cmd: std::process::Command,
    secs: u64,
) -> Result<std::process::Output, std::io::Error> {
    use std::process::Stdio;
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(secs);
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("no answer after {secs}s — the query was cancelled"),
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

/// CSV as these clients actually emit it: quoted fields, doubled quotes for a
/// literal one, and newlines allowed inside quotes. Small enough to own
/// rather than take a dependency for.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

fn get_conn(conn: &rusqlite::Connection, id: i64) -> Result<ConnDef, String> {
    conn.query_row(
        &format!("SELECT {CONN_COLS} FROM connections WHERE id = ?1"),
        params![id],
        row_to_conn,
    )
    .map_err(err)
}

fn execute(def: &ConnDef, sql: &str, timeout: u64) -> QueryResult {
    let (bin, engine_name) = client_for(&def.engine);
    let started = std::time::Instant::now();
    let out = run_capped(build_command(def, sql), timeout);
    let ms = started.elapsed().as_millis() as i64;

    match out {
        // The one failure worth naming precisely: you don't have the client.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => QueryResult {
            ms,
            error: format!(
                "`{bin}` isn't on your PATH. DevDeck runs your {engine_name} client rather than \
                 speaking to the server itself, so it needs one installed."
            ),
            missing_tool: bin.to_string(),
            ..Default::default()
        },
        Err(e) => QueryResult {
            ms,
            error: e.to_string(),
            ..Default::default()
        },
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if !out.status.success() {
                return QueryResult {
                    ms,
                    error: if stderr.is_empty() {
                        format!("{bin} exited with {}", out.status)
                    } else {
                        stderr
                    },
                    ..Default::default()
                };
            }
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            let mut rows = parse_csv(&text);
            // sqlcmd underlines its header with a row of dashes. Drop it, or
            // every SQL Server result starts with a row of nonsense.
            if def.engine == "sqlserver" && rows.len() > 1 {
                let is_rule = rows[1]
                    .iter()
                    .all(|c| !c.is_empty() && c.chars().all(|ch| ch == '-'));
                if is_rule {
                    rows.remove(1);
                }
            }
            let columns = if rows.is_empty() {
                Vec::new()
            } else {
                rows.remove(0)
            };
            let total = rows.len();
            let truncated = total > MAX_ROWS;
            if truncated {
                rows.truncate(MAX_ROWS);
            }
            QueryResult {
                columns,
                rows,
                row_count: total,
                truncated,
                ms,
                error: String::new(),
                missing_tool: String::new(),
            }
        }
    }
}

/// Is this connection reachable? Same shape as a service's status.
#[tauri::command]
pub fn conn_test(db: tauri::State<Db>, id: i64) -> Result<QueryResult, String> {
    let conn = db.0.lock().unwrap();
    let def = get_conn(&conn, id)?;
    drop(conn);
    Ok(execute(&def, "select 1", TEST_TIMEOUT_SECS))
}

/// Run SQL and return a grid. Every run is recorded, successful or not — a
/// history you only keep when things go well isn't a history.
#[tauri::command]
pub fn conn_run(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    id: i64,
    sql: String,
) -> Result<QueryResult, String> {
    let conn = db.0.lock().unwrap();
    let def = get_conn(&conn, id)?;
    drop(conn);

    let result = execute(&def, &sql, QUERY_TIMEOUT_SECS);

    let conn = db.0.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO conn_runs (connection_id, sql, ok, row_count, ms, error, ran_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            sql,
            result.error.is_empty() as i64,
            result.row_count as i64,
            result.ms,
            result.error,
            now_millis()
        ],
    );
    drop(conn);

    crate::activity::record(
        &app,
        "query",
        format!("query on {}", def.name),
        if result.error.is_empty() {
            format!("{} rows in {}ms", result.row_count, result.ms)
        } else {
            result.error.lines().next().unwrap_or("failed").to_string()
        },
        result.error.is_empty(),
        Some(id),
    );

    // A query run is a thing that happened, like a service starting.
    let _ = app.emit(
        "conn:run",
        serde_json::json!({
            "connection_id": id,
            "name": def.name,
            "ok": result.error.is_empty(),
            "rows": result.row_count,
            "ms": result.ms,
        }),
    );
    Ok(result)
}

// ---------- saved queries + history ----------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedQuery {
    pub id: i64,
    pub connection_id: i64,
    pub name: String,
    pub sql: String,
    pub created_at: i64,
}

#[tauri::command]
pub fn conn_queries_list(db: tauri::State<Db>) -> Result<Vec<SavedQuery>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, connection_id, name, sql, created_at FROM conn_queries ORDER BY name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SavedQuery {
                id: r.get(0)?,
                connection_id: r.get(1)?,
                name: r.get(2)?,
                sql: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn conn_query_save(db: tauri::State<Db>, query: SavedQuery) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if query.id <= 0 {
        conn.execute(
            "INSERT INTO conn_queries (connection_id, name, sql, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![query.connection_id, query.name, query.sql, now_millis()],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE conn_queries SET name=?1, sql=?2 WHERE id=?3",
            params![query.name, query.sql, query.id],
        )
        .map_err(err)?;
        Ok(query.id)
    }
}

#[tauri::command]
pub fn conn_query_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM conn_queries WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

#[derive(Serialize)]
pub struct QueryRun {
    pub id: i64,
    pub connection_id: i64,
    pub sql: String,
    pub ok: bool,
    pub row_count: i64,
    pub ms: i64,
    pub error: String,
    pub ran_at: i64,
}

#[tauri::command]
pub fn conn_runs_list(
    db: tauri::State<Db>,
    connection_id: i64,
    limit: i64,
) -> Result<Vec<QueryRun>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, connection_id, sql, ok, row_count, ms, error, ran_at FROM conn_runs
              WHERE connection_id = ?1 ORDER BY ran_at DESC LIMIT ?2",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(
            params![connection_id, if limit > 0 { limit } else { 50 }],
            |r| {
                Ok(QueryRun {
                    id: r.get(0)?,
                    connection_id: r.get(1)?,
                    sql: r.get(2)?,
                    ok: r.get::<_, i64>(3)? != 0,
                    row_count: r.get(4)?,
                    ms: r.get(5)?,
                    error: r.get(6)?,
                    ran_at: r.get(7)?,
                })
            },
        )
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_handles_what_the_clients_actually_emit() {
        let out = parse_csv("id,name\n1,\"Smith, John\"\n2,\"He said \"\"hi\"\"\"\n");
        assert_eq!(out[0], vec!["id", "name"]);
        assert_eq!(out[1], vec!["1", "Smith, John"], "a comma inside quotes");
        assert_eq!(out[2], vec!["2", "He said \"hi\""], "a doubled quote");
    }

    #[test]
    fn csv_keeps_newlines_inside_quoted_fields() {
        let out = parse_csv("id,note\n1,\"line one\nline two\"\n");
        assert_eq!(out.len(), 2, "an embedded newline must not split the row");
        assert_eq!(out[1][1], "line one\nline two");
    }

    #[test]
    fn csv_preserves_empty_fields() {
        let out = parse_csv("a,b,c\n1,,3\n");
        assert_eq!(out[1], vec!["1", "", "3"]);
    }

    #[test]
    fn a_password_is_never_on_a_postgres_command_line() {
        // psql is handed its password through the environment. If this ever
        // becomes an argument, it shows up in every process listing on the
        // machine — which is why the test is here rather than in a comment.
        let def = ConnDef {
            id: 999_999,
            engine: "postgres".into(),
            host: "db.example.com".into(),
            database: "app".into(),
            username: "app_rw".into(),
            ..Default::default()
        };
        let cmd = build_command(&def, "select 1");
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.iter().all(|a| a != "-P" && !a.contains("password")));
        assert!(
            args.contains(&"--csv".to_string()),
            "we ask for parseable output"
        );
    }
}
