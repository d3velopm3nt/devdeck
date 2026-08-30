//! The vault: the folder tree that *is* the Explorer.
//!
//! Every node you see is a real directory under one root, and each directory
//! carries a `_devdeck.md` saying what it is. That inverts what came before —
//! the database used to be the tree, and a node's `path` pointed at a code
//! repo. Now:
//!
//!   * **The folder is the node.** Its name is the node's name, its position
//!     is the node's position. A topic has a folder, so its context has
//!     somewhere to live — which is the thing the old model could not do.
//!   * **A repo is a reference, not an identity.** `repo:` in the meta file
//!     points at code somewhere else entirely. The vault folder and the repo
//!     are unrelated directories; one merely knows about the other.
//!   * **You never choose a kind.** Depth and the presence of `repo:` decide
//!     it, so there is no question to get wrong when you add something.
//!
//! SQLite keeps an index of all this, because commands, services and profiles
//! reference nodes by integer id and need something stable to point at. The
//! index is derived: delete it and a rescan rebuilds it. Rows are matched on
//! their relative path, so ids survive a rescan and a renamed folder keeps its
//! commands.
//!
//! ```text
//! <root>/
//!   Business/                 depth 0 → a workspace
//!     _devdeck.md
//!     TyreX/                  a folder; label: Product
//!       _devdeck.md
//!       context.md
//!       tyrex-api/            has repo: → a project
//!         _devdeck.md
//! ```

use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::db::{self, Db};

const META: &str = "_devdeck.md";
pub const ROOT_KEY: &str = "vault_root";

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Directories that are never nodes: version control, dependency trees, and
/// anything hidden. Without this a vault holding a repo would show you every
/// folder in it.
fn skip(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "__pycache__" | "vendor"
        )
}

/// A folder name we are willing to create. The name is the identity here, so a
/// character Windows refuses would leave a node that cannot be written.
pub fn valid_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("A name is required.".into());
    }
    if n.starts_with('.') {
        return Err("A name cannot start with a dot.".into());
    }
    if n.chars().any(|c| r#"\/:*?"<>|"#.contains(c)) {
        return Err(r#"A name cannot contain \ / : * ? " < > |"#.into());
    }
    Ok(n.to_string())
}

// ---------------------------------------------------------------------------
// The meta file
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, Default)]
pub struct Meta {
    /// A word for what this is — Product, Topic, Client. Free text.
    pub label: String,
    /// Absolute path to the code this node is about, if any. Its presence is
    /// what makes the node a project.
    pub repo: String,
    /// Accent colour override (hex); empty means derive from the id.
    pub color: String,
    /// Everything after the frontmatter: what this folder is for, in prose.
    pub body: String,
}

/// Parse `_devdeck.md`. A missing or malformed file is an empty Meta rather
/// than an error: a folder someone made by hand is still a node, it just has
/// nothing declared yet.
fn read_meta(dir: &Path) -> Meta {
    let raw = match fs::read_to_string(dir.join(META)) {
        Ok(s) => s,
        Err(_) => return Meta::default(),
    };
    let mut m = Meta::default();
    let rest = match raw.strip_prefix("---") {
        Some(after) => match after.find("\n---") {
            Some(end) => {
                for line in after[..end].lines() {
                    let Some((k, v)) = line.split_once(':') else { continue };
                    let v = v.trim().trim_matches('"').to_string();
                    match k.trim() {
                        "label" => m.label = v,
                        "repo" => m.repo = v,
                        "color" => m.color = v,
                        _ => {}
                    }
                }
                after[end + 4..].trim_start_matches('\n')
            }
            None => raw.as_str(),
        },
        None => raw.as_str(),
    };
    m.body = rest.trim().to_string();
    m
}

fn write_meta(dir: &Path, m: &Meta) -> Result<(), String> {
    let mut out = String::from("---\n");
    if !m.label.trim().is_empty() {
        out.push_str(&format!("label: {}\n", m.label.trim()));
    }
    if !m.repo.trim().is_empty() {
        out.push_str(&format!("repo: {}\n", m.repo.trim()));
    }
    if !m.color.trim().is_empty() {
        out.push_str(&format!("color: \"{}\"\n", m.color.trim()));
    }
    out.push_str("---\n");
    if !m.body.trim().is_empty() {
        out.push('\n');
        out.push_str(m.body.trim());
        out.push('\n');
    }
    fs::write(dir.join(META), out).map_err(err)
}

// ---------------------------------------------------------------------------
// The root
// ---------------------------------------------------------------------------

/// Where the vault lives, or None until the user has chosen.
#[tauri::command]
pub fn vault_root(db: tauri::State<Db>) -> Result<Option<String>, String> {
    let conn = db.0.lock().unwrap();
    let v = db::setting_get_conn(&conn, ROOT_KEY)?;
    Ok(v.filter(|s| !s.trim().is_empty()))
}

/// The folder we suggest, so setup opens with an answer rather than a blank.
///
/// `~/DevDeck` is chosen for being somewhere a person already backs up and can
/// find in File Explorer without being told where it is. Nothing enforces it —
/// it is a default, not a location the app depends on.
#[tauri::command]
pub fn vault_default_root() -> String {
    dirs::home_dir()
        .map(|h| h.join("DevDeck"))
        .unwrap_or_else(|| PathBuf::from("DevDeck"))
        .to_string_lossy()
        .to_string()
}

/// What the pre-vault tree still holds.
///
/// The setup screen cannot count this itself: with no root chosen a scan
/// returns nothing, so the rows it is about to delete are invisible from the
/// frontend. Asked here instead, so the warning can carry real numbers.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Legacy {
    pub nodes: i64,
    pub commands: i64,
    pub services: i64,
}

#[tauri::command]
pub fn vault_legacy(db: tauri::State<Db>) -> Result<Legacy, String> {
    let conn = db.0.lock().unwrap();
    let one = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    Ok(Legacy {
        nodes: one("SELECT COUNT(*) FROM nodes WHERE rel_path = ''"),
        commands: one(
            "SELECT COUNT(*) FROM commands c JOIN nodes n ON n.id = c.project_id              WHERE n.rel_path = ''",
        ),
        services: one(
            "SELECT COUNT(*) FROM services s JOIN nodes n ON n.id = s.project_id              WHERE n.rel_path = ''",
        ),
    })
}

/// Adopt `path` as the vault. Creates it if it does not exist, and optionally
/// runs `git init` so the whole thing can be pushed somewhere.
#[tauri::command]
pub fn vault_set_root(
    db: tauri::State<Db>,
    path: String,
    git_init: bool,
    adopt_existing_tree: bool,
) -> Result<String, String> {
    let root = PathBuf::from(path.trim());
    if root.as_os_str().is_empty() {
        return Err("Choose a folder for the vault.".into());
    }
    fs::create_dir_all(&root).map_err(|e| format!("could not create {}: {e}", root.display()))?;

    if git_init && !root.join(".git").exists() {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("init")
            .current_dir(&root)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        // A failed init is not a failed setup — the vault works either way, so
        // say nothing rather than refusing a root that is otherwise fine.
        let _ = cmd.status();
    }

    let conn = db.0.lock().unwrap();

    // Rows from before the vault have no folder behind them, and leaving them
    // that way is never right — they would sit in the tree pointing at nothing.
    // Adopting gives each one a folder and keeps its id, so the commands and
    // services hanging off it survive; discarding takes them with it.
    if adopt_existing_tree {
        adopt_existing(&conn, &root)?;
    } else {
        conn.execute("DELETE FROM nodes WHERE rel_path = ''", [])
            .map_err(err)?;
    }
    scan_into(&conn, &root)?;

    db::setting_set_conn(&conn, ROOT_KEY, &root.to_string_lossy())?;
    Ok(root.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

struct Found {
    rel: String,
    parent_rel: Option<String>,
    name: String,
    depth: usize,
    meta: Meta,
}

fn walk(dir: &Path, parent_rel: Option<String>, depth: usize, out: &mut Vec<Found>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut kids: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    kids.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());

    for e in kids {
        let name = e.file_name().to_string_lossy().to_string();
        if skip(&name) {
            continue;
        }
        let rel = match &parent_rel {
            Some(p) => format!("{p}/{name}"),
            None => name.clone(),
        };
        let path = e.path();
        out.push(Found {
            rel: rel.clone(),
            parent_rel: parent_rel.clone(),
            name,
            depth,
            meta: read_meta(&path),
        });
        // Bounded: a vault pointed at a huge tree by accident should not hang
        // the app, and nobody organises eight levels deep on purpose.
        if depth < 8 {
            walk(&path, Some(rel), depth + 1, out);
        }
    }
}

/// Kind is derived, never chosen: top level is a workspace, a folder naming a
/// repo is a project, everything else is a folder.
fn kind_of(f: &Found) -> &'static str {
    if f.depth == 0 {
        "workspace"
    } else if !f.meta.repo.trim().is_empty() {
        "project"
    } else {
        "folder"
    }
}

/// Re-read the vault into the node index.
///
/// Matching is by relative path, so a node keeps its id — and therefore its
/// commands and services — across a rescan. Rows whose folder has gone are
/// deleted, which cascades exactly as deleting the folder should.
pub fn scan_into(conn: &Connection, root: &Path) -> Result<usize, String> {
    let mut found = Vec::new();
    walk(root, None, 0, &mut found);

    // Existing rows by rel_path, so ids survive.
    let mut existing: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, rel_path FROM nodes WHERE rel_path <> ''")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        for row in rows {
            let (id, rel) = row.map_err(err)?;
            existing.insert(rel, id);
        }
    }

    // Insert or update, parents first — `found` is already in walk order, so a
    // parent is always seen before its children.
    let mut ids: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for (sort, f) in found.iter().enumerate() {
        let parent_id = f.parent_rel.as_ref().and_then(|p| ids.get(p).copied());
        let kind = kind_of(f);
        let repo = f.meta.repo.trim();
        let color = f.meta.color.trim();
        let label = f.meta.label.trim();

        let id = match existing.get(&f.rel).copied() {
            Some(id) => {
                conn.execute(
                    "UPDATE nodes SET parent_id = ?1, kind = ?2, name = ?3, path = ?4, sort = ?5, \
                     color = ?6, label = ?7 WHERE id = ?8",
                    params![
                        parent_id,
                        kind,
                        f.name,
                        if repo.is_empty() { None } else { Some(repo) },
                        sort as i64,
                        if color.is_empty() { None } else { Some(color) },
                        if label.is_empty() { None } else { Some(label) },
                        id
                    ],
                )
                .map_err(err)?;
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO nodes (parent_id, kind, name, path, rel_path, sort, color, label) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        parent_id,
                        kind,
                        f.name,
                        if repo.is_empty() { None } else { Some(repo) },
                        f.rel,
                        sort as i64,
                        if color.is_empty() { None } else { Some(color) },
                        if label.is_empty() { None } else { Some(label) }
                    ],
                )
                .map_err(err)?;
                conn.last_insert_rowid()
            }
        };
        ids.insert(f.rel.clone(), id);
    }

    // Anything indexed but no longer on disk is gone.
    for (rel, id) in existing {
        if !ids.contains_key(&rel) {
            conn.execute("DELETE FROM nodes WHERE id = ?1", params![id])
                .map_err(err)?;
        }
    }
    Ok(ids.len())
}

/// Rescan, and hand back the tree the UI should now show.
#[tauri::command]
pub fn vault_scan(db: tauri::State<Db>) -> Result<Vec<db::Node>, String> {
    let conn = db.0.lock().unwrap();
    let Some(root) = db::setting_get_conn(&conn, ROOT_KEY)? else {
        return Ok(Vec::new());
    };
    if root.trim().is_empty() {
        return Ok(Vec::new());
    }
    scan_into(&conn, Path::new(&root))?;
    db::nodes_on(&conn)
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

fn root_of(conn: &Connection) -> Result<PathBuf, String> {
    let root = db::setting_get_conn(conn, ROOT_KEY)?
        .filter(|s| !s.trim().is_empty())
        .ok_or("No vault folder has been chosen yet.")?;
    Ok(PathBuf::from(root))
}

fn rel_of(conn: &Connection, id: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT rel_path FROM nodes WHERE id = ?1",
        params![id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| "That folder is no longer in the vault.".to_string())
}

/// Create a folder. `parent_id` of None puts it at the top, where it becomes a
/// workspace by virtue of its depth.
#[tauri::command]
pub fn vault_create(
    db: tauri::State<Db>,
    parent_id: Option<i64>,
    name: String,
) -> Result<db::Node, String> {
    let conn = db.0.lock().unwrap();
    let root = root_of(&conn)?;
    let name = valid_name(&name)?;

    let parent_rel = match parent_id {
        Some(id) => Some(rel_of(&conn, id)?),
        None => None,
    };
    let dir = match &parent_rel {
        Some(p) => root.join(p).join(&name),
        None => root.join(&name),
    };
    if dir.exists() {
        return Err(format!("“{name}” already exists here."));
    }
    fs::create_dir_all(&dir).map_err(err)?;
    write_meta(&dir, &Meta::default())?;

    scan_into(&conn, &root)?;
    let rel = match &parent_rel {
        Some(p) => format!("{p}/{name}"),
        None => name.clone(),
    };
    let id = conn
        .query_row(
            "SELECT id FROM nodes WHERE rel_path = ?1",
            params![rel],
            |r| r.get::<_, i64>(0),
        )
        .map_err(err)?;
    db::node_by_id(&conn, id)
}

/// Rename a node — which renames its folder, since the folder is the node.
#[tauri::command]
pub fn vault_rename(db: tauri::State<Db>, id: i64, name: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let root = root_of(&conn)?;
    let name = valid_name(&name)?;
    let rel = rel_of(&conn, id)?;
    let from = root.join(&rel);
    let to = from
        .parent()
        .ok_or("That folder has no parent.")?
        .join(&name);
    if to.exists() {
        return Err(format!("“{name}” already exists here."));
    }
    fs::rename(&from, &to).map_err(err)?;
    // The rel_path of this node and everything under it has changed, so the
    // index is rebuilt rather than patched — the ids are re-matched by path.
    conn.execute(
        "UPDATE nodes SET rel_path = ?1 WHERE id = ?2",
        params![
            {
                let parent = rel.rsplit_once('/').map(|(p, _)| p.to_string());
                match parent {
                    Some(p) => format!("{p}/{name}"),
                    None => name.clone(),
                }
            },
            id
        ],
    )
    .map_err(err)?;
    scan_into(&conn, &root)?;
    Ok(())
}

/// Update a node's meta file. Empty strings clear a field.
#[tauri::command]
pub fn vault_set_meta(
    db: tauri::State<Db>,
    id: i64,
    label: Option<String>,
    repo: Option<String>,
    color: Option<String>,
    body: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let root = root_of(&conn)?;
    let rel = rel_of(&conn, id)?;
    let dir = root.join(&rel);

    let mut m = read_meta(&dir);
    if let Some(v) = label {
        m.label = v;
    }
    if let Some(v) = repo {
        m.repo = v;
    }
    if let Some(v) = color {
        m.color = v;
    }
    if let Some(v) = body {
        m.body = v;
    }
    write_meta(&dir, &m)?;
    scan_into(&conn, &root)?;
    Ok(())
}

/// Read a node's meta file, for the page that edits it.
#[tauri::command]
pub fn vault_meta(db: tauri::State<Db>, id: i64) -> Result<Meta, String> {
    let conn = db.0.lock().unwrap();
    let root = root_of(&conn)?;
    let rel = rel_of(&conn, id)?;
    Ok(read_meta(&root.join(rel)))
}

/// Delete a node's folder, and everything in it.
#[tauri::command]
pub fn vault_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let root = root_of(&conn)?;
    let rel = rel_of(&conn, id)?;
    let dir = root.join(&rel);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(err)?;
    }
    scan_into(&conn, &root)?;
    Ok(())
}

/// The absolute path of a node's own folder — for "Reveal in File Explorer",
/// and for anything that needs somewhere to write context.
#[tauri::command]
pub fn vault_dir(db: tauri::State<Db>, id: i64) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let root = root_of(&conn)?;
    let rel = rel_of(&conn, id)?;
    Ok(root.join(rel).to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Bringing the pre-vault tree across
// ---------------------------------------------------------------------------

/// Turn a legacy name into a folder name, rather than refusing it.
///
/// These names were typed before folders were involved, so a colon or a slash
/// in one is nobody's mistake. Replacing the character keeps the node; erroring
/// would strand it and the commands hanging off it.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "Untitled".to_string()
    } else {
        cleaned
    }
}

/// Give every pre-vault node a folder, keeping its id.
///
/// The id is the point: commands, services and profiles reference nodes by it,
/// so adopting rather than recreating is what stops a migration quietly
/// throwing away everything the tree was configured to run.
fn adopt_existing(conn: &Connection, root: &Path) -> Result<usize, String> {
    struct Row {
        id: i64,
        parent: Option<i64>,
        name: String,
        repo: Option<String>,
    }

    let rows: Vec<Row> = {
        let mut stmt = conn
            .prepare("SELECT id, parent_id, name, path FROM nodes WHERE rel_path = '' ORDER BY sort, id")
            .map_err(err)?;
        let it = stmt
            .query_map([], |r| {
                Ok(Row {
                    id: r.get(0)?,
                    parent: r.get(1)?,
                    name: r.get(2)?,
                    repo: r.get(3)?,
                })
            })
            .map_err(err)?;
        it.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    if rows.is_empty() {
        return Ok(0);
    }

    // Parents before children, so a child's folder has somewhere to go.
    let mut rels: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    let mut done = 0usize;
    let mut pending: Vec<&Row> = rows.iter().collect();

    // Bounded rather than recursive: a cycle in parent_id would otherwise hang.
    for _ in 0..16 {
        let mut progressed = false;
        pending.retain(|row| {
            let parent_rel = match row.parent {
                None => None,
                Some(p) => match rels.get(&p) {
                    Some(r) => Some(r.clone()),
                    // Parent not placed yet — try again on the next pass.
                    None => return true,
                },
            };

            // Find a free folder name next to its siblings.
            let base = safe_name(&row.name);
            let parent_dir = match &parent_rel {
                Some(r) => root.join(r),
                None => root.to_path_buf(),
            };
            let mut name = base.clone();
            let mut n = 2;
            while parent_dir.join(&name).exists() {
                name = format!("{base} {n}");
                n += 1;
            }

            let dir = parent_dir.join(&name);
            if fs::create_dir_all(&dir).is_err() {
                return false;
            }
            let meta = Meta {
                repo: row.repo.clone().unwrap_or_default(),
                ..Default::default()
            };
            let _ = write_meta(&dir, &meta);

            let rel = match &parent_rel {
                Some(r) => format!("{r}/{name}"),
                None => name.clone(),
            };
            let _ = conn.execute(
                "UPDATE nodes SET rel_path = ?1, name = ?2 WHERE id = ?3",
                params![rel, name, row.id],
            );
            rels.insert(row.id, rel);
            done += 1;
            progressed = true;
            false
        });
        if pending.is_empty() || !progressed {
            break;
        }
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// The columns the vault touches. Enough to exercise adoption and scanning
    /// without dragging the whole application schema into a unit test.
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE nodes (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                path TEXT,
                rel_path TEXT NOT NULL DEFAULT '',
                sort INTEGER NOT NULL DEFAULT 0,
                color TEXT,
                label TEXT
            );",
        )
        .unwrap();
        conn
    }

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("devdeck-vault-test-{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rel_of_id(conn: &Connection, id: i64) -> String {
        conn.query_row("SELECT rel_path FROM nodes WHERE id = ?1", params![id], |r| {
            r.get::<_, String>(0)
        })
        .unwrap()
    }

    /// The migration's whole reason for existing: a node keeps its id, so the
    /// commands and services pointing at it survive. Recreating the tree
    /// instead would silently discard every configured thing in it.
    #[test]
    fn adopting_the_old_tree_keeps_ids_and_repos() {
        let root = tmp("adopt");
        let conn = db();
        conn.execute_batch(
            r"INSERT INTO nodes (id, parent_id, kind, name, path, rel_path) VALUES
               (1, NULL, 'workspace', 'Innotrack', NULL, ''),
               (2, 1,    'project',   'x-platform', 'C:\code\x', ''),
               (6, 1,    'solution',  'TyreX Platform', NULL, '');",
        )
        .unwrap();

        let moved = adopt_existing(&conn, &root).unwrap();
        assert_eq!(moved, 3, "every legacy node is adopted");

        // Ids are untouched, so anything referencing them still resolves.
        assert_eq!(rel_of_id(&conn, 1), "Innotrack");
        assert_eq!(rel_of_id(&conn, 2), "Innotrack/x-platform");
        assert_eq!(rel_of_id(&conn, 6), "Innotrack/TyreX Platform");

        // Real folders, with the repo carried into the meta file.
        assert!(root.join("Innotrack/x-platform").is_dir());
        assert_eq!(read_meta(&root.join("Innotrack/x-platform")).repo, r"C:\code\x");
        assert!(read_meta(&root.join("Innotrack")).repo.is_empty());
    }

    /// Kind is derived, never stored by the user: depth makes a workspace, a
    /// repo makes a project, everything else is a folder.
    #[test]
    fn scanning_derives_kind_from_depth_and_repo() {
        let root = tmp("kinds");
        fs::create_dir_all(root.join("Business/TyreX/tyrex-api")).unwrap();
        fs::create_dir_all(root.join("Personal/Finance")).unwrap();
        write_meta(
            &root.join("Business/TyreX"),
            &Meta { label: "Product".into(), ..Default::default() },
        )
        .unwrap();
        write_meta(
            &root.join("Business/TyreX/tyrex-api"),
            &Meta { repo: r"C:\code\api".into(), ..Default::default() },
        )
        .unwrap();
        write_meta(
            &root.join("Personal/Finance"),
            &Meta { label: "Topic".into(), ..Default::default() },
        )
        .unwrap();

        let conn = db();
        scan_into(&conn, &root).unwrap();

        let kind = |rel: &str| -> (String, Option<String>, Option<String>) {
            conn.query_row(
                "SELECT kind, path, label FROM nodes WHERE rel_path = ?1",
                params![rel],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
        };

        assert_eq!(kind("Business").0, "workspace", "top level is a workspace");
        assert_eq!(kind("Business/TyreX").0, "folder", "no repo, so a folder");
        assert_eq!(kind("Business/TyreX").2.as_deref(), Some("Product"));
        assert_eq!(kind("Business/TyreX/tyrex-api").0, "project", "a repo makes a project");
        assert_eq!(
            kind("Business/TyreX/tyrex-api").1.as_deref(),
            Some(r"C:\code\api"),
        );
        assert_eq!(kind("Personal/Finance").2.as_deref(), Some("Topic"));
    }

    /// A rescan must not churn ids, or every scan would orphan the commands and
    /// services that point at them. Folders that disappear take their rows with
    /// them; the ones that stay keep everything.
    #[test]
    fn rescanning_keeps_ids_and_drops_what_is_gone() {
        let root = tmp("rescan");
        fs::create_dir_all(root.join("Business/Keep")).unwrap();
        fs::create_dir_all(root.join("Business/Goes")).unwrap();

        let conn = db();
        scan_into(&conn, &root).unwrap();
        let keep_before = conn
            .query_row(
                "SELECT id FROM nodes WHERE rel_path = 'Business/Keep'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap();

        fs::remove_dir_all(root.join("Business/Goes")).unwrap();
        scan_into(&conn, &root).unwrap();

        let keep_after = conn
            .query_row(
                "SELECT id FROM nodes WHERE rel_path = 'Business/Keep'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(keep_before, keep_after, "a surviving folder keeps its id");

        let gone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE rel_path = 'Business/Goes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0, "a deleted folder leaves no row behind");
    }

    /// Pointing the vault at anything near a repo must not enumerate it.
    #[test]
    fn scanning_skips_noise_directories() {
        let root = tmp("skip");
        fs::create_dir_all(root.join("Business/.git/refs")).unwrap();
        fs::create_dir_all(root.join("Business/node_modules/react")).unwrap();
        fs::create_dir_all(root.join("Business/Real")).unwrap();

        let conn = db();
        scan_into(&conn, &root).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "only Business and Business/Real are nodes");
    }
}

// ---------------------------------------------------------------------------
// Changing where the vault lives
// ---------------------------------------------------------------------------

/// Copy a directory tree, for when a plain rename cannot cross the drive.
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(err)?;
    for entry in fs::read_dir(from).map_err(err)? {
        let entry = entry.map_err(err)?;
        let target = to.join(entry.file_name());
        if entry.file_type().map_err(err)?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(err)?;
        }
    }
    Ok(())
}

/// Move the vault somewhere else, contents and all.
///
/// This is the safe way to change the root: every folder goes with it, so the
/// relative paths the index is keyed on still match and nothing loses its id —
/// which means nothing loses its commands or services either.
#[tauri::command]
pub fn vault_move(db: tauri::State<Db>, new_path: String) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let old = root_of(&conn)?;
    let new = PathBuf::from(new_path.trim());
    if new.as_os_str().is_empty() {
        return Err("Choose a folder to move the vault to.".into());
    }
    if new == old {
        return Ok(old.to_string_lossy().to_string());
    }
    // Moving a folder inside itself would recurse forever.
    if new.starts_with(&old) {
        return Err("That folder is inside the vault. Choose one outside it.".into());
    }
    if new.exists() && fs::read_dir(&new).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err(format!(
            "{} already has something in it. Choose an empty folder, or use Switch to adopt it.",
            new.display()
        ));
    }

    // A rename is atomic and instant; across drives it fails, and only then is
    // the slow copy worth paying for.
    if fs::rename(&old, &new).is_err() {
        copy_tree(&old, &new)?;
        fs::remove_dir_all(&old)
            .map_err(|e| format!("copied to {}, but could not remove the old folder: {e}", new.display()))?;
    }

    db::setting_set_conn(&conn, ROOT_KEY, &new.to_string_lossy())?;
    scan_into(&conn, &new)?;
    Ok(new.to_string_lossy().to_string())
}

/// What switching to `path` would cost, before anything is changed.
///
/// Switching adopts whatever is already in the target — so anything the index
/// knows about that is *not* there disappears, taking its commands and
/// services with it. That number belongs on screen before the click, not in a
/// dialog afterwards.
#[derive(Serialize, Clone, Debug, Default)]
pub struct SwitchCost {
    pub keeps: i64,
    pub drops: i64,
    pub losing_commands: i64,
    pub losing_services: i64,
}

#[tauri::command]
pub fn vault_switch_cost(db: tauri::State<Db>, path: String) -> Result<SwitchCost, String> {
    let conn = db.0.lock().unwrap();
    let target = PathBuf::from(path.trim());
    if !target.is_dir() {
        return Err("That folder does not exist.".into());
    }

    let mut found = Vec::new();
    walk(&target, None, 0, &mut found);
    let present: std::collections::HashSet<String> = found.into_iter().map(|f| f.rel).collect();

    let mut cost = SwitchCost::default();
    let mut stmt = conn
        .prepare("SELECT id, rel_path FROM nodes WHERE rel_path <> ''")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    for row in rows {
        let (id, rel) = row.map_err(err)?;
        if present.contains(&rel) {
            cost.keeps += 1;
        } else {
            cost.drops += 1;
            cost.losing_commands += conn
                .query_row(
                    "SELECT COUNT(*) FROM commands WHERE project_id = ?1",
                    params![id],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0);
            cost.losing_services += conn
                .query_row(
                    "SELECT COUNT(*) FROM services WHERE project_id = ?1",
                    params![id],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0);
        }
    }
    Ok(cost)
}

/// Point the vault at a folder that already holds one — a clone of your config
/// repo on another machine, say. Nothing is moved; the index is rebuilt from
/// what is there.
#[tauri::command]
pub fn vault_switch(db: tauri::State<Db>, path: String) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let target = PathBuf::from(path.trim());
    if !target.is_dir() {
        return Err("That folder does not exist.".into());
    }
    db::setting_set_conn(&conn, ROOT_KEY, &target.to_string_lossy())?;
    scan_into(&conn, &target)?;
    Ok(target.to_string_lossy().to_string())
}
