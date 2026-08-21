//! SQLite persistence: workspace hierarchy, commands, services,
//! launch profiles, layouts, and settings. Entirely local.
//!
//! The hierarchy is one self-referencing `nodes` table
//! (workspace → space → folder → project) so new node kinds and
//! arbitrary nesting never require schema changes.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Node {
    pub id: i64,
    pub parent_id: Option<i64>,
    /// workspace → project → folder.
    pub kind: String,
    pub name: String,
    /// For a project: its base path (repo root). For a folder: an
    /// optional absolute-path override (empty = use rel_path under the
    /// project base path). Unused for workspaces.
    pub path: Option<String>,
    /// For a folder: subpath relative to the owning project's base path.
    pub rel_path: String,
    pub sort: i64,
    /// Optional user-picked accent color (hex, e.g. "#7C8CF8"). When null
    /// the UI derives a stable color from the node id.
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandDef {
    pub id: i64,
    pub project_id: Option<i64>, // None = global (legacy launcher commands)
    pub group_name: String,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub shell: String,
    pub sort: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceDef {
    pub id: i64,
    pub project_id: Option<i64>,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub env: String, // JSON object string
    pub auto_restart: bool,
    pub health_port: Option<u16>,
    /// Shell/interpreter to run the command through (path). Empty = cmd.exe.
    #[serde(default)]
    pub shell: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProfileDef {
    pub id: i64,
    pub project_id: Option<i64>,
    pub name: String,
    /// JSON array of steps:
    /// {"type":"service","id":N} | {"type":"command","id":N}
    /// | {"type":"terminal","shell":"...","cwd":"..."} | {"type":"layout","id":N}
    pub steps: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LayoutDef {
    pub id: i64,
    pub name: String,
    pub data: String, // dockview layout JSON
}

pub fn db_path() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("devdeck");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("devdeck.sqlite")
}

pub fn open() -> Connection {
    let conn = Connection::open(db_path()).expect("open sqlite");
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT,
            sort INTEGER NOT NULL DEFAULT 0,
            color TEXT
        );
        CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY,
            project_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
            group_name TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            command TEXT NOT NULL,
            cwd TEXT NOT NULL DEFAULT '',
            shell TEXT NOT NULL DEFAULT '',
            sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY,
            project_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            command TEXT NOT NULL,
            cwd TEXT NOT NULL DEFAULT '',
            env TEXT NOT NULL DEFAULT '{}',
            auto_restart INTEGER NOT NULL DEFAULT 0,
            health_port INTEGER,
            shell TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY,
            project_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            steps TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS layouts (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recents (
            kind TEXT NOT NULL,       -- command | service
            ref_id INTEGER NOT NULL,
            ts INTEGER NOT NULL,      -- unix millis of last run
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (kind, ref_id)
        );
        -- Machine Setup catalog: curated packages are seeded here on first run
        -- (INSERT OR IGNORE), so every package is the user's to edit/override.
        CREATE TABLE IF NOT EXISTS machine_packages (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source TEXT NOT NULL,
            category TEXT NOT NULL,
            blurb TEXT NOT NULL DEFAULT '',
            elevate INTEGER NOT NULL DEFAULT 0,
            custom INTEGER NOT NULL DEFAULT 0,   -- 1 = user-added
            hidden INTEGER NOT NULL DEFAULT 0,   -- 1 = curated pkg removed by user
            sort INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .expect("create schema");

    migrate(&conn);
    conn
}

/// Schema/data migrations that run on every open (each is idempotent).
fn migrate(conn: &Connection) {
    // v2 model: add folder rel_path, and collapse the old
    // workspace→space→folder→project tree into workspace→project→folder.
    let has_rel_path = conn.prepare("SELECT rel_path FROM nodes LIMIT 1").is_ok();
    if !has_rel_path {
        let _ = conn.execute(
            "ALTER TABLE nodes ADD COLUMN rel_path TEXT NOT NULL DEFAULT ''",
            [],
        );
    }
    // Per-node accent color (nullable).
    let has_color = conn.prepare("SELECT color FROM nodes LIMIT 1").is_ok();
    if !has_color {
        let _ = conn.execute("ALTER TABLE nodes ADD COLUMN color TEXT", []);
    }
    // Per-service shell/interpreter.
    let has_svc_shell = conn.prepare("SELECT shell FROM services LIMIT 1").is_ok();
    if !has_svc_shell {
        let _ = conn.execute(
            "ALTER TABLE services ADD COLUMN shell TEXT NOT NULL DEFAULT ''",
            [],
        );
    }
    let done = setting_get_conn(conn, "model_v2").ok().flatten().is_some();
    if !done {
        // Old 'space' nodes become projects (they were the app-grouping
        // level); any old leaf 'project' nodes become folders.
        let _ = conn.execute(
            "UPDATE nodes SET kind = 'folder' WHERE kind = 'project'",
            [],
        );
        let _ = conn.execute("UPDATE nodes SET kind = 'project' WHERE kind = 'space'", []);
        let _ = setting_set_conn(conn, "model_v2", "1");
    }
}

fn row_to_node(row: &rusqlite::Row) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        path: row.get(4)?,
        rel_path: row.get(5)?,
        sort: row.get(6)?,
        color: row.get(7)?,
    })
}

// ---------- tree ----------

#[tauri::command]
pub fn tree_list(db: tauri::State<Db>) -> Result<Vec<Node>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, parent_id, kind, name, path, rel_path, sort, color FROM nodes ORDER BY sort, id")
        .map_err(err)?;
    let nodes = stmt
        .query_map([], row_to_node)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(nodes)
}

#[tauri::command]
pub fn node_create(
    db: tauri::State<Db>,
    parent_id: Option<i64>,
    kind: String,
    name: String,
    path: Option<String>,
    rel_path: Option<String>,
) -> Result<Node, String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO nodes (parent_id, kind, name, path, rel_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            parent_id,
            kind,
            name,
            path,
            rel_path.clone().unwrap_or_default()
        ],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    Ok(Node {
        id,
        parent_id,
        kind,
        name,
        path,
        rel_path: rel_path.unwrap_or_default(),
        sort: 0,
        color: None,
    })
}

#[tauri::command]
pub fn node_rename(db: tauri::State<Db>, id: i64, name: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE nodes SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(err)?;
    Ok(())
}

/// Update a project's base path / a folder's paths (and optionally name).
#[tauri::command]
pub fn node_update(
    db: tauri::State<Db>,
    id: i64,
    name: Option<String>,
    path: Option<String>,
    rel_path: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    if let Some(name) = name {
        conn.execute(
            "UPDATE nodes SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(err)?;
    }
    if let Some(color) = color {
        // Empty string clears the override back to the derived color.
        let val: Option<String> = if color.trim().is_empty() {
            None
        } else {
            Some(color)
        };
        conn.execute(
            "UPDATE nodes SET color = ?1 WHERE id = ?2",
            params![val, id],
        )
        .map_err(err)?;
    }
    if let Some(path) = path {
        conn.execute(
            "UPDATE nodes SET path = ?1 WHERE id = ?2",
            params![path, id],
        )
        .map_err(err)?;
    }
    if let Some(rel_path) = rel_path {
        conn.execute(
            "UPDATE nodes SET rel_path = ?1 WHERE id = ?2",
            params![rel_path, id],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn node_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM nodes WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------- commands ----------

fn row_to_command(row: &rusqlite::Row) -> rusqlite::Result<CommandDef> {
    Ok(CommandDef {
        id: row.get(0)?,
        project_id: row.get(1)?,
        group_name: row.get(2)?,
        name: row.get(3)?,
        command: row.get(4)?,
        cwd: row.get(5)?,
        shell: row.get(6)?,
        sort: row.get(7)?,
    })
}

#[tauri::command]
pub fn commands_list(db: tauri::State<Db>) -> Result<Vec<CommandDef>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, group_name, name, command, cwd, shell, sort
             FROM commands ORDER BY sort, id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], row_to_command)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn command_save(db: tauri::State<Db>, cmd: CommandDef) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if cmd.id <= 0 {
        conn.execute(
            "INSERT INTO commands (project_id, group_name, name, command, cwd, shell)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                cmd.project_id,
                cmd.group_name,
                cmd.name,
                cmd.command,
                cmd.cwd,
                cmd.shell
            ],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE commands SET project_id=?1, group_name=?2, name=?3, command=?4, cwd=?5, shell=?6
             WHERE id=?7",
            params![cmd.project_id, cmd.group_name, cmd.name, cmd.command, cmd.cwd, cmd.shell, cmd.id],
        )
        .map_err(err)?;
        Ok(cmd.id)
    }
}

#[tauri::command]
pub fn command_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM commands WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------- services ----------

fn row_to_service(row: &rusqlite::Row) -> rusqlite::Result<ServiceDef> {
    Ok(ServiceDef {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        command: row.get(3)?,
        cwd: row.get(4)?,
        env: row.get(5)?,
        auto_restart: row.get::<_, i64>(6)? != 0,
        health_port: row.get::<_, Option<i64>>(7)?.map(|p| p as u16),
        shell: row.get(8)?,
    })
}

#[tauri::command]
pub fn services_list(db: tauri::State<Db>) -> Result<Vec<ServiceDef>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, name, command, cwd, env, auto_restart, health_port, shell
             FROM services ORDER BY id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], row_to_service)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

/// Resolve a node's working directory (mirrors the frontend rule):
/// project → base path; folder → absolute override, else project base +
/// rel_path. Returns "" if it can't be resolved.
pub fn resolve_node_dir(conn: &Connection, node_id: i64) -> String {
    let node = conn.query_row(
        "SELECT id, parent_id, kind, name, path, rel_path, sort, color FROM nodes WHERE id = ?1",
        params![node_id],
        row_to_node,
    );
    let Ok(node) = node else { return String::new() };
    match node.kind.as_str() {
        "project" => node.path.unwrap_or_default(),
        "folder" => {
            if let Some(p) = &node.path {
                if !p.trim().is_empty() {
                    return p.clone();
                }
            }
            // Walk up to the owning project for the base path.
            let mut cur = node.parent_id;
            let mut base = String::new();
            while let Some(pid) = cur {
                if let Ok(parent) = conn.query_row(
                    "SELECT id, parent_id, kind, name, path, rel_path, sort, color FROM nodes WHERE id = ?1",
                    params![pid],
                    row_to_node,
                ) {
                    if parent.kind == "project" {
                        base = parent.path.unwrap_or_default();
                        break;
                    }
                    cur = parent.parent_id;
                } else {
                    break;
                }
            }
            let base = base.trim_end_matches(['\\', '/']);
            let sub = node
                .rel_path
                .trim_start_matches(['\\', '/'])
                .replace('/', "\\");
            if base.is_empty() {
                sub
            } else if sub.is_empty() {
                base.to_string()
            } else {
                format!("{base}\\{sub}")
            }
        }
        _ => String::new(),
    }
}

pub fn service_get(conn: &Connection, id: i64) -> Result<ServiceDef, String> {
    conn.query_row(
        "SELECT id, project_id, name, command, cwd, env, auto_restart, health_port, shell
         FROM services WHERE id = ?1",
        params![id],
        row_to_service,
    )
    .map_err(err)
}

#[tauri::command]
pub fn service_save(db: tauri::State<Db>, svc: ServiceDef) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if svc.id <= 0 {
        conn.execute(
            "INSERT INTO services (project_id, name, command, cwd, env, auto_restart, health_port, shell)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                svc.project_id,
                svc.name,
                svc.command,
                svc.cwd,
                svc.env,
                svc.auto_restart as i64,
                svc.health_port.map(|p| p as i64),
                svc.shell
            ],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE services SET project_id=?1, name=?2, command=?3, cwd=?4, env=?5, auto_restart=?6, health_port=?7, shell=?8
             WHERE id=?9",
            params![
                svc.project_id,
                svc.name,
                svc.command,
                svc.cwd,
                svc.env,
                svc.auto_restart as i64,
                svc.health_port.map(|p| p as i64),
                svc.shell,
                svc.id
            ],
        )
        .map_err(err)?;
        Ok(svc.id)
    }
}

#[tauri::command]
pub fn service_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM services WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------- profiles ----------

#[tauri::command]
pub fn profiles_list(db: tauri::State<Db>) -> Result<Vec<ProfileDef>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, project_id, name, steps FROM profiles ORDER BY id")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProfileDef {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                steps: row.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn profile_save(db: tauri::State<Db>, profile: ProfileDef) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if profile.id <= 0 {
        conn.execute(
            "INSERT INTO profiles (project_id, name, steps) VALUES (?1, ?2, ?3)",
            params![profile.project_id, profile.name, profile.steps],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE profiles SET project_id=?1, name=?2, steps=?3 WHERE id=?4",
            params![profile.project_id, profile.name, profile.steps, profile.id],
        )
        .map_err(err)?;
        Ok(profile.id)
    }
}

#[tauri::command]
pub fn profile_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM profiles WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------- layouts ----------

#[tauri::command]
pub fn layouts_list(db: tauri::State<Db>) -> Result<Vec<LayoutDef>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, data FROM layouts ORDER BY name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LayoutDef {
                id: row.get(0)?,
                name: row.get(1)?,
                data: row.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn layout_save(db: tauri::State<Db>, name: String, data: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO layouts (name, data) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET data = excluded.data",
        params![name, data],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn layout_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM layouts WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

// ---------- settings ----------

#[tauri::command]
pub fn setting_get(db: tauri::State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().unwrap();
    setting_get_conn(&conn, &key)
}

pub fn setting_get_conn(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    match conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn setting_set(db: tauri::State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    setting_set_conn(&conn, &key, &value)
}

pub fn setting_set_conn(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(err)?;
    Ok(())
}

// ---------- recents (for the widget's Recent view + search ranking) ----------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Recent {
    pub kind: String, // command | service
    pub ref_id: i64,
    pub ts: i64,
    pub count: i64,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn recent_bump_conn(conn: &Connection, kind: &str, ref_id: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO recents (kind, ref_id, ts, count) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(kind, ref_id) DO UPDATE SET ts = excluded.ts, count = count + 1",
        params![kind, ref_id, now_millis()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn recent_bump(db: tauri::State<Db>, kind: String, ref_id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    recent_bump_conn(&conn, &kind, ref_id)
}

#[tauri::command]
pub fn recents_list(db: tauri::State<Db>) -> Result<Vec<Recent>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT kind, ref_id, ts, count FROM recents ORDER BY ts DESC")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Recent {
                kind: row.get(0)?,
                ref_id: row.get(1)?,
                ts: row.get(2)?,
                count: row.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
