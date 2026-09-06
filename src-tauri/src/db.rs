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
use tauri::Manager;

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
        -- Fold the write-ahead log back into devdeck.sqlite often. The default
        -- threshold (1000 pages) is never reached by a database this small, so
        -- without this the main file stays empty on a fresh install and every
        -- workspace you create lives only in devdeck.sqlite-wal. Anything that
        -- drops that sidecar -- a roaming-profile sync, a cleanup tool, copying
        -- just the .sqlite -- then looks exactly like "my workspaces vanished".
        PRAGMA wal_autocheckpoint = 32;
        "#,
    )
    .expect("pragmas");
    conn.execute_batch(CORE_SCHEMA).expect("create schema");

    conn.execute_batch(STASH_SCHEMA)
        .expect("create stash schema");
    conn.execute_batch(CONN_SCHEMA)
        .expect("create connections schema");
    conn.execute_batch(MAIL_SCHEMA)
        .expect("create mail schema");
    conn.execute_batch(ACTIVITY_SCHEMA)
        .expect("create activity schema");
    // A run that was "running" when the app was killed did not survive.
    crate::activity::close_orphan_runs(&conn);

    migrate(&conn);
    // Startup recovery has just replayed any leftover WAL; write it into the
    // main file straight away so devdeck.sqlite is a complete standalone copy.
    checkpoint(&conn);
    conn
}

/// The core model: the node hierarchy plus everything hanging off it. Split
/// out as a const (like the schemas below) so the full boot sequence an
/// upgrade replays can be exercised against an in-memory database.
pub const CORE_SCHEMA: &str = r#"
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
"#;

/// Stash: the context-aware clip vault. `content` is NULL for anything the
/// secret heuristic flagged -- those rows are metadata only, the value never
/// reaches the disk (see stash.rs). Split out as a const so the schema and
/// its full-text index can be exercised against an in-memory database.
pub const STASH_SCHEMA: &str = r#"
        CREATE TABLE IF NOT EXISTS stash_items (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL DEFAULT 'clip',     -- clip | note | screenshot
            item_type TEXT NOT NULL DEFAULT 'text',-- json|sql|url|path|jwt|uuid|hex|stacktrace|text
            title TEXT NOT NULL DEFAULT '',
            content TEXT,                          -- NULL when is_secret = 1
            note TEXT NOT NULL DEFAULT '',         -- your own text, indexed for search
            -- Screenshots: the image stays where Windows put it, so this is a
            -- link, never a copy. `content` holds the OCR text instead, which
            -- means the existing FTS triggers index it for free.
            file_path TEXT NOT NULL DEFAULT '',
            thumb TEXT NOT NULL DEFAULT '',        -- small data: URI for the list
            preview TEXT NOT NULL DEFAULT '',      -- redacted when is_secret = 1
            bytes INTEGER NOT NULL DEFAULT 0,
            hash TEXT NOT NULL DEFAULT '',         -- content fingerprint, for dedupe
            project_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
            project_name TEXT NOT NULL DEFAULT '', -- snapshot: survives the node
            workspace_name TEXT NOT NULL DEFAULT '',
            source_app TEXT NOT NULL DEFAULT '',
            is_secret INTEGER NOT NULL DEFAULT 0,
            secret_reason TEXT NOT NULL DEFAULT '',
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            used_count INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS stash_created ON stash_items(created_at DESC);
        CREATE INDEX IF NOT EXISTS stash_project ON stash_items(project_id);

        -- User tags. NOCASE so "Bug" and "bug" are one tag; the first spelling
        -- you type is the one kept. A tag with no items left is pruned, so the
        -- sidebar only ever offers tags that lead somewhere.
        CREATE TABLE IF NOT EXISTS stash_tags (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS stash_item_tags (
            item_id INTEGER NOT NULL REFERENCES stash_items(id) ON DELETE CASCADE,
            tag_id INTEGER NOT NULL REFERENCES stash_tags(id) ON DELETE CASCADE,
            PRIMARY KEY (item_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS stash_item_tags_tag ON stash_item_tags(tag_id);
"#;

/// One activity stream, plus durable per-service run history. Home's feed
/// used to be derived from `recents`, which only remembers the *last* time
/// something ran -- so two runs looked like one and a crash looked like
/// nothing. These record each occurrence and survive a restart.
pub const ACTIVITY_SCHEMA: &str = r#"
        CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,   -- service|query|git|clip|screenshot|setup|update
            title TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            ok INTEGER NOT NULL DEFAULT 1,
            ref_id INTEGER,
            project_name TEXT NOT NULL DEFAULT '',
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts DESC);
        CREATE TABLE IF NOT EXISTS service_runs (
            id INTEGER PRIMARY KEY,
            service_id INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            exit_code INTEGER,
            outcome TEXT NOT NULL DEFAULT 'running'  -- running|stopped|crashed
        );
        CREATE INDEX IF NOT EXISTS service_runs_svc
            ON service_runs(service_id, started_at DESC);
"#;

/// Connections: the SQL layer. Note what is *not* here -- there is no password
/// column, and there never will be one. Credentials live in Windows Credential
/// Manager under `devdeck:connection:<id>`; SQLite holds only the parts of a
/// connection you would happily read out loud.
pub const CONN_SCHEMA: &str = r#"
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY,
            project_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            engine TEXT NOT NULL DEFAULT 'postgres',  -- postgres | sqlite | sqlserver
            host TEXT NOT NULL DEFAULT '',
            port INTEGER,
            database TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            sort INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0
        );
        -- Saved queries hang off their connection; deleting one takes them.
        CREATE TABLE IF NOT EXISTS conn_queries (
            id INTEGER PRIMARY KEY,
            connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sql TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT 0
        );
        -- Every run, so the history is durable rather than a UI buffer.
        CREATE TABLE IF NOT EXISTS conn_runs (
            id INTEGER PRIMARY KEY,
            connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
            sql TEXT NOT NULL,
            ok INTEGER NOT NULL DEFAULT 0,
            row_count INTEGER NOT NULL DEFAULT 0,
            ms INTEGER NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '',
            ran_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conn_runs_conn ON conn_runs(connection_id, ran_at DESC);
"#;

/// Mail. Same rule as Connections: there is no password column here and there
/// never will be one. IMAP and SMTP credentials live in Windows Credential
/// Manager under `devdeck:mail:<id>`; SQLite holds only the parts of an
/// account you would happily read out loud.
///
/// Messages are cached locally so search is full-text and mail still opens
/// with the network down. Attachments are metadata only until you save one --
/// syncing a mailbox must not quietly fill the disk.
pub const MAIL_SCHEMA: &str = r#"
        CREATE TABLE IF NOT EXISTS mail_accounts (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'imap',   -- imap | gmail
            imap_host TEXT NOT NULL DEFAULT '',
            imap_port INTEGER NOT NULL DEFAULT 993,
            smtp_host TEXT NOT NULL DEFAULT '',
            smtp_port INTEGER NOT NULL DEFAULT 465,
            username TEXT NOT NULL DEFAULT '',
            signature TEXT NOT NULL DEFAULT '',
            is_default INTEGER NOT NULL DEFAULT 0,
            sort INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            last_sync INTEGER NOT NULL DEFAULT 0,
            last_error TEXT NOT NULL DEFAULT ''
        );
        CREATE UNIQUE INDEX IF NOT EXISTS mail_accounts_addr ON mail_accounts(address);

        -- People. A contact is one person; the client they belong to is a node
        -- in the project tree, which is what makes a thread, an invoice and a
        -- repo able to find each other.
        CREATE TABLE IF NOT EXISTS mail_contacts (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL,
            alt_email TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT '',
            company TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
            kind TEXT NOT NULL DEFAULT 'person', -- person | bot
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS mail_contacts_email ON mail_contacts(email);

        CREATE TABLE IF NOT EXISTS mail_messages (
            id INTEGER PRIMARY KEY,
            account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
            uid INTEGER NOT NULL DEFAULT 0,
            message_id TEXT NOT NULL DEFAULT '',
            thread_key TEXT NOT NULL DEFAULT '',
            mailbox TEXT NOT NULL DEFAULT 'INBOX',  -- INBOX | Sent | Drafts | Archive
            from_name TEXT NOT NULL DEFAULT '',
            from_addr TEXT NOT NULL DEFAULT '',
            to_addrs TEXT NOT NULL DEFAULT '',
            cc_addrs TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT '',
            preview TEXT NOT NULL DEFAULT '',
            body_text TEXT NOT NULL DEFAULT '',
            body_html TEXT NOT NULL DEFAULT '',
            raw_headers TEXT NOT NULL DEFAULT '',
            ts INTEGER NOT NULL DEFAULT 0,
            unread INTEGER NOT NULL DEFAULT 1,
            flagged INTEGER NOT NULL DEFAULT 0,
            is_bot INTEGER NOT NULL DEFAULT 0,
            contact_id INTEGER REFERENCES mail_contacts(id) ON DELETE SET NULL,
            node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL
        );
        -- One row per (account, mailbox, uid): a re-sync updates rather than
        -- duplicating, which is the difference between an inbox and a pile.
        CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_uid
            ON mail_messages(account_id, mailbox, uid);
        CREATE INDEX IF NOT EXISTS mail_messages_ts ON mail_messages(ts DESC);
        CREATE INDEX IF NOT EXISTS mail_messages_thread ON mail_messages(thread_key);

        CREATE TABLE IF NOT EXISTS mail_attachments (
            id INTEGER PRIMARY KEY,
            message_id INTEGER NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
            filename TEXT NOT NULL DEFAULT '',
            mime TEXT NOT NULL DEFAULT '',
            bytes INTEGER NOT NULL DEFAULT 0,
            part_index INTEGER NOT NULL DEFAULT 0,
            file_path TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS mail_attachments_msg ON mail_attachments(message_id);

        -- What the assistant said or did about a thread, kept beside the mail
        -- so its suggestions and its actions are auditable after the fact.
        CREATE TABLE IF NOT EXISTS mail_assistant (
            id INTEGER PRIMARY KEY,
            thread_key TEXT NOT NULL,
            account_id INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL DEFAULT 'summary', -- summary | draft | action
            body TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new',   -- new | accepted | dismissed | done
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS mail_assistant_thread ON mail_assistant(thread_key);
"#;

/// The Stash full-text index: an external-content FTS5 table kept in sync by
/// triggers, over title + content + your note. Secrets index as an empty
/// string for content, since theirs is NULL -- so a flagged clip stays
/// findable by its title and note without its value ever entering the index.
pub const STASH_FTS_SCHEMA: &str = r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS stash_fts
            USING fts5(title, content, note, content='stash_items', content_rowid='id');
        CREATE TRIGGER IF NOT EXISTS stash_fts_ai AFTER INSERT ON stash_items BEGIN
            INSERT INTO stash_fts(rowid, title, content, note)
                VALUES (new.id, new.title, coalesce(new.content, ''), new.note);
        END;
        CREATE TRIGGER IF NOT EXISTS stash_fts_ad AFTER DELETE ON stash_items BEGIN
            INSERT INTO stash_fts(stash_fts, rowid, title, content, note)
                VALUES ('delete', old.id, old.title, coalesce(old.content, ''), old.note);
        END;
        CREATE TRIGGER IF NOT EXISTS stash_fts_au AFTER UPDATE ON stash_items BEGIN
            INSERT INTO stash_fts(stash_fts, rowid, title, content, note)
                VALUES ('delete', old.id, old.title, coalesce(old.content, ''), old.note);
            INSERT INTO stash_fts(rowid, title, content, note)
                VALUES (new.id, new.title, coalesce(new.content, ''), new.note);
        END;
"#;

/// Bump when STASH_FTS_SCHEMA's columns change -- the index is dropped and
/// rebuilt, since `CREATE VIRTUAL TABLE IF NOT EXISTS` won't reshape one that
/// already exists (and a stale index silently returns wrong results).
const STASH_FTS_VERSION: &str = "2";

/// Fold the write-ahead log into the main database file and reset it, so
/// devdeck.sqlite alone holds every workspace, project, command and service.
/// Called on open and again before the app exits or hides to the tray.
pub fn checkpoint(conn: &Connection) {
    // execute_batch (not pragma_update) because wal_checkpoint returns a row.
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
}

/// Checkpoint via the managed connection, skipping quietly if the state is
/// gone or the lock is poisoned -- this runs on shutdown paths that must not
/// panic.
pub fn checkpoint_state(app: &tauri::AppHandle) {
    if let Some(db) = app.try_state::<Db>() {
        if let Ok(conn) = db.0.lock() {
            checkpoint(&conn);
        }
    }
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
    // Stash full-text index. FTS5 is compiled into the bundled SQLite, but a
    // build without it must not take the whole app down on startup -- so this
    // runs on its own and the outcome is remembered. When it fails, search
    // degrades to a substring scan and the UI says so, rather than quietly
    // returning nothing.
    // Stash notes: added after the vault shipped, so existing rows need the
    // column before the FTS triggers below can reference it.
    let has_note = conn.prepare("SELECT note FROM stash_items LIMIT 1").is_ok();
    if !has_note {
        let _ = conn.execute(
            "ALTER TABLE stash_items ADD COLUMN note TEXT NOT NULL DEFAULT ''",
            [],
        );
    }

    // Screenshots: link + thumbnail, added after the vault shipped.
    for (col, ddl) in [
        (
            "file_path",
            "ALTER TABLE stash_items ADD COLUMN file_path TEXT NOT NULL DEFAULT ''",
        ),
        (
            "thumb",
            "ALTER TABLE stash_items ADD COLUMN thumb TEXT NOT NULL DEFAULT ''",
        ),
    ] {
        if conn
            .prepare(&format!("SELECT {col} FROM stash_items LIMIT 1"))
            .is_err()
        {
            let _ = conn.execute(ddl, []);
        }
    }
    // One row per screenshot file, so a rescan can't stash the same one twice.
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS stash_file ON stash_items(file_path)
           WHERE file_path <> ''",
        [],
    );

    // Reshape the full-text index when its column set changes. Dropping the
    // triggers first matters: they reference stash_fts, and a rebuild against
    // the old shape would fail halfway and leave a half-indexed vault.
    let fts_v = setting_get_conn(conn, "stash_fts_v").ok().flatten();
    if fts_v.as_deref() != Some(STASH_FTS_VERSION) {
        let _ = conn.execute_batch(
            "DROP TRIGGER IF EXISTS stash_fts_ai;
             DROP TRIGGER IF EXISTS stash_fts_ad;
             DROP TRIGGER IF EXISTS stash_fts_au;
             DROP TABLE IF EXISTS stash_fts;",
        );
    }
    let fts_ok = conn.execute_batch(STASH_FTS_SCHEMA).is_ok();
    if fts_ok && fts_v.as_deref() != Some(STASH_FTS_VERSION) {
        // Repopulate from stash_items, then record the version -- only after a
        // clean rebuild, so a failure here retries on the next launch.
        if conn
            .execute("INSERT INTO stash_fts(stash_fts) VALUES ('rebuild')", [])
            .is_ok()
        {
            let _ = setting_set_conn(conn, "stash_fts_v", STASH_FTS_VERSION);
        }
    }
    crate::stash::set_fts_available(fts_ok);

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Everything `open()` does to an existing database, minus the PRAGMAs and
    /// the on-disk path -- i.e. exactly what the first launch after an upgrade
    /// replays.
    fn boot(conn: &Connection) {
        conn.execute_batch(CORE_SCHEMA).expect("core schema");
        conn.execute_batch(STASH_SCHEMA).expect("stash schema");
        conn.execute_batch(CONN_SCHEMA).expect("conn schema");
        conn.execute_batch(MAIL_SCHEMA).expect("mail schema");
        conn.execute_batch(ACTIVITY_SCHEMA)
            .expect("activity schema");
        migrate(conn);
    }

    fn read_tree(conn: &Connection) -> Vec<Node> {
        let mut stmt = conn
            .prepare(
                "SELECT id, parent_id, kind, name, path, rel_path, sort, color
                 FROM nodes ORDER BY sort, id",
            )
            .expect("tree_list prepares");
        stmt.query_map([], row_to_node)
            .expect("tree_list runs")
            .collect::<Result<Vec<_>, _>>()
            .expect("every row decodes")
    }

    /// "My workspaces vanished after the update" was never the database, and
    /// this is the assertion that keeps it that way: a tree saved by an older
    /// DevDeck survives the boot migrations and is still readable through the
    /// exact query `tree_list` uses.
    #[test]
    fn upgrading_an_old_database_keeps_its_workspaces() {
        let conn = Connection::open_in_memory().unwrap();
        // The pre-v2 shape: no rel_path, no color, and the old
        // workspace -> space -> project nesting.
        conn.execute_batch(
            r#"
            CREATE TABLE nodes (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                path TEXT,
                sort INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO nodes (id, parent_id, kind, name, path) VALUES
                (1, NULL, 'workspace', 'Innotrack', NULL),
                (2, 1,    'space',     'x-platform', 'C:\repos\x-platform'),
                (3, 2,    'project',   'api',       NULL);
            "#,
        )
        .unwrap();

        boot(&conn);

        let nodes = read_tree(&conn);
        assert_eq!(nodes.len(), 3, "the migration must not drop a single node");
        assert_eq!(nodes[0].kind, "workspace");
        assert_eq!(nodes[0].name, "Innotrack");
        // v2 model: the old grouping 'space' becomes the project, and an old
        // leaf 'project' becomes a folder inside it.
        assert_eq!(nodes[1].kind, "project");
        assert_eq!(nodes[1].path.as_deref(), Some(r"C:\repos\x-platform"));
        assert_eq!(nodes[2].kind, "folder");
        // The columns added by migrations must decode, not error: a NULL in
        // either would make tree_list fail and the deck render empty.
        assert_eq!(nodes[1].rel_path, "");
        assert!(nodes[1].color.is_none());
    }

    /// Migrations run on every open, so the second launch after an upgrade has
    /// to be a no-op rather than a reshuffle -- the v2 pass would otherwise
    /// demote every project to a folder on each start.
    #[test]
    fn booting_again_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        boot(&conn);
        conn.execute(
            "INSERT INTO nodes (id, parent_id, kind, name, path, rel_path)
             VALUES (1, NULL, 'workspace', 'Innotrack', NULL, ''),
                    (2, 1, 'project', 'x-platform', 'C:\\repos\\x-platform', '')",
            [],
        )
        .unwrap();

        let before = read_tree(&conn);
        boot(&conn);
        boot(&conn);
        let after = read_tree(&conn);

        assert_eq!(after.len(), before.len());
        for (a, b) in after.iter().zip(before.iter()) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.kind, b.kind, "kinds must survive a repeated migration");
            assert_eq!(a.name, b.name);
        }
    }
}
