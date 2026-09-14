//! Clearing old workspaces so a business can be set up again, cleanly.
//!
//! The owner decided: cleared, not archived. So this is careful in the two
//! ways that matter. It says exactly what goes before anything goes, and it
//! never deletes code: a repository lives outside the vault and is never
//! touched, and a space whose folder holds a repository is refused outright
//! rather than deleted with the code inside it.

use std::path::Path;

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::{self, Db};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ClearProject {
    pub node_id: i64,
    pub name: String,
    /// Where the code is. Never deleted.
    pub repo: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ClearSpace {
    pub node_id: i64,
    pub name: String,
    pub label: String,
    /// Tagged Business: ticked by default. Anything else is offered unticked.
    pub suggested: bool,
    pub folders: usize,
    pub projects: Vec<ClearProject>,
    pub managers: Vec<String>,
    pub services: i64,
    pub commands: i64,
    pub reminders: i64,
    /// The space's folder in the vault, which is what gets removed.
    pub vault_dir: String,
    /// Why this one cannot be cleared, when it cannot.
    pub blocked: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ClearPreview {
    pub spaces: Vec<ClearSpace>,
}

/// Every node under `id`, `id` included.
pub fn subtree(conn: &Connection, id: i64) -> Vec<i64> {
    let Ok(mut st) = conn.prepare(
        "WITH RECURSIVE t(id) AS (
             SELECT ?1
             UNION ALL
             SELECT n.id FROM nodes n JOIN t ON n.parent_id = t.id
         )
         SELECT id FROM t",
    ) else {
        return vec![id];
    };
    st.query_map(params![id], |r| r.get::<_, i64>(0))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_else(|_| vec![id])
}

/// Whether a repository is inside the folder about to be removed. Compared
/// case-insensitively with either slash, because Windows paths are both.
pub fn repo_inside(vault_dir: &str, repo: &str) -> bool {
    let norm = |s: &str| s.trim().replace('\\', "/").trim_end_matches('/').to_ascii_lowercase();
    let (v, r) = (norm(vault_dir), norm(repo));
    !v.is_empty() && !r.is_empty() && (r == v || r.starts_with(&format!("{v}/")))
}

fn in_list(ids: &[i64]) -> String {
    ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")
}

fn space_of(conn: &Connection, node: &db::Node, has_record: bool) -> ClearSpace {
    let ids = subtree(conn, node.id);
    let list = in_list(&ids);
    let count = |sql: String| -> i64 { conn.query_row(&sql, [], |r| r.get(0)).unwrap_or(0) };

    let mut projects = Vec::new();
    let mut folders = 0usize;
    if let Ok(mut st) = conn.prepare(&format!("SELECT id, kind, name, COALESCE(path, '') FROM nodes WHERE id IN ({list})")) {
        let rows = st.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        });
        if let Ok(rows) = rows {
            for (id, kind, name, path) in rows.flatten() {
                match kind.as_str() {
                    "project" => projects.push(ClearProject { node_id: id, name, repo: path }),
                    "folder" => folders += 1,
                    _ => {}
                }
            }
        }
    }

    let managers: Vec<String> = crate::managers::all(conn)
        .into_iter()
        .filter(|m| ids.contains(&m.home) || m.businesses.iter().any(|b| ids.contains(b)))
        .map(|m| m.name)
        .collect();

    let vault_dir = db::node_deck_dir(conn, node)
        .map(|d| d.to_string_lossy().to_string())
        .unwrap_or_default();
    let blocked = match projects.iter().find(|p| repo_inside(&vault_dir, &p.repo)) {
        Some(p) => format!(
            "The code for {} is inside this folder, at {}. Clearing it would delete the code, so it is left alone.",
            p.name, p.repo
        ),
        None if has_record => "This business was set up through the business steps, and is not cleared from here.".into(),
        None => String::new(),
    };

    ClearSpace {
        node_id: node.id,
        name: node.name.clone(),
        label: node.label.clone().unwrap_or_default(),
        suggested: node.label.as_deref().is_some_and(|l| l.eq_ignore_ascii_case(crate::business::LABEL)),
        folders,
        projects,
        managers,
        services: count(format!("SELECT COUNT(*) FROM services WHERE project_id IN ({list})")),
        commands: count(format!("SELECT COUNT(*) FROM commands WHERE project_id IN ({list})")),
        reminders: count(format!("SELECT COUNT(*) FROM schedules WHERE node_id IN ({list}) AND kind = 'reminder'")),
        vault_dir,
        blocked,
    }
}

/// Workspaces that could be cleared: everything not tagged Personal and not
/// already a business made through the steps. Personal spaces are never
/// offered.
pub fn preview(conn: &Connection) -> Result<ClearPreview, String> {
    let mut st = conn
        .prepare("SELECT id FROM nodes WHERE parent_id IS NULL AND kind = 'workspace' ORDER BY sort, name")
        .map_err(err)?;
    let ids: Vec<i64> = st.query_map([], |r| r.get(0)).map_err(err)?.flatten().collect();
    let mut spaces = Vec::new();
    for id in ids {
        let node = db::node_by_id(conn, id)?;
        if node.label.as_deref().is_some_and(|l| l.eq_ignore_ascii_case("Personal")) {
            continue;
        }
        let has_record = crate::business::read(conn, id).ok().flatten().is_some();
        if has_record {
            continue;
        }
        spaces.push(space_of(conn, &node, has_record));
    }
    // Suggested first: those are the ones the owner asked to clear.
    spaces.sort_by_key(|s| !s.suggested);
    Ok(ClearPreview { spaces })
}

#[tauri::command(async)]
pub fn business_clear_preview(db: tauri::State<Db>) -> Result<ClearPreview, String> {
    let conn = db.0.lock().unwrap();
    preview(&conn)
}

/// Clear the spaces named. `confirm` must be the word `clear`: the screen
/// sends it only from the red button, and nothing else in the app does.
///
/// For each space: its managers and their heartbeats, its reminders, the
/// services and commands saved on its projects, and its folder in the vault.
/// Not its repositories, which live elsewhere, and not the space at all if
/// one of them lives inside its folder.
#[tauri::command(async)]
pub fn business_clear(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node_ids: Vec<i64>,
    confirm: String,
) -> Result<Vec<String>, String> {
    if confirm != "clear" {
        return Err("Nothing was cleared: the clear was not confirmed.".into());
    }
    let mut done = Vec::new();
    for id in node_ids {
        let (space, handles) = {
            let conn = db.0.lock().unwrap();
            let node = db::node_by_id(&conn, id)?;
            if node.label.as_deref().is_some_and(|l| l.eq_ignore_ascii_case("Personal")) {
                return Err(format!("{} is Personal and is never cleared from here.", node.name));
            }
            if crate::business::read(&conn, id).ok().flatten().is_some() {
                return Err(format!("{} was set up as a business and is not cleared from here.", node.name));
            }
            let space = space_of(&conn, &node, false);
            let ids = subtree(&conn, id);
            let handles: Vec<String> = crate::managers::all(&conn)
                .into_iter()
                .filter(|m| ids.contains(&m.home) || m.businesses.iter().any(|b| ids.contains(b)))
                .map(|m| m.handle)
                .collect();
            (space, handles)
        };
        if !space.blocked.is_empty() {
            done.push(format!("{}: not cleared. {}", space.name, space.blocked));
            continue;
        }
        if !space.vault_dir.is_empty() && !Path::new(&space.vault_dir).starts_with(vault_root(&db)?) {
            done.push(format!("{}: not cleared, its folder is outside the vault.", space.name));
            continue;
        }
        {
            let conn = db.0.lock().unwrap();
            let ids = subtree(&conn, id);
            let list = in_list(&ids);
            for h in &handles {
                crate::managers::delete(&conn, h)?;
                conn.execute("DELETE FROM schedules WHERE kind = 'bot' AND manager = ?1", params![h])
                    .map_err(err)?;
            }
            conn.execute(&format!("DELETE FROM schedules WHERE node_id IN ({list})"), []).map_err(err)?;
            conn.execute(&format!("DELETE FROM services WHERE project_id IN ({list})"), []).map_err(err)?;
            conn.execute(&format!("DELETE FROM commands WHERE project_id IN ({list})"), []).map_err(err)?;
        }
        crate::vault::vault_delete(db.clone(), id)?;
        done.push(format!(
            "{}: cleared. {} folder{}, {} project{}, {} manager{}.",
            space.name,
            space.folders,
            if space.folders == 1 { "" } else { "s" },
            space.projects.len(),
            if space.projects.len() == 1 { "" } else { "s" },
            handles.len(),
            if handles.len() == 1 { "" } else { "s" },
        ));
    }
    crate::activity::record(&app, "space", "Cleared old workspaces", done.join(" "), true, None);
    Ok(done)
}

fn vault_root(db: &tauri::State<Db>) -> Result<std::path::PathBuf, String> {
    let conn = db.0.lock().unwrap();
    db::setting_get_conn(&conn, "vault_root")?
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "No vault folder has been chosen yet.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repository_inside_the_folder_is_seen_whatever_the_slashes() {
        assert!(repo_inside(r"C:\Users\me\DevDeck\Innotrack", "c:/users/me/devdeck/innotrack/x-platform"));
        assert!(repo_inside("C:/v/Innotrack", r"C:\v\Innotrack"));
        assert!(!repo_inside(r"C:\v\Innotrack", r"C:\code\trackx\x-platform"));
        assert!(!repo_inside(r"C:\v\Inno", r"C:\v\Innotrack\x"), "a prefix of a name is not a parent");
        assert!(!repo_inside("", r"C:\code"));
    }

    #[test]
    fn a_subtree_is_everything_under_a_node() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::db::CORE_SCHEMA).unwrap();
        crate::db::migrate(&c);
        c.execute_batch(
            "INSERT INTO nodes (id, parent_id, kind, name, rel_path) VALUES (1, NULL, 'workspace', 'A', 'A');
             INSERT INTO nodes (id, parent_id, kind, name, rel_path) VALUES (2, 1, 'folder', 'B', 'A/B');
             INSERT INTO nodes (id, parent_id, kind, name, rel_path) VALUES (3, 2, 'project', 'C', 'A/B/C');
             INSERT INTO nodes (id, parent_id, kind, name, rel_path) VALUES (4, NULL, 'workspace', 'D', 'D');",
        )
        .unwrap();
        let mut ids = subtree(&c, 1);
        ids.sort();
        assert_eq!(ids, vec![1, 2, 3]);
        assert_eq!(subtree(&c, 4), vec![4]);
    }
}
