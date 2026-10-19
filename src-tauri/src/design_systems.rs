//! Thin desktop boundary. Assignment state belongs in the selected vault folder.
use crate::{
    db::{self, Db},
    design_system_model::{self as model, Assignment, DesignSystem},
};
fn root(db: &Db, node_id: i64) -> Result<std::path::PathBuf, String> {
    let conn = db.conn();
    let node = db::node_by_id(&conn, node_id)?;
    if node.kind != "project" && node.path.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Choose a project or a folder linked to a repository".into());
    }
    db::node_deck_dir(&conn, &node).ok_or("Project has no vault folder".into())
}
#[tauri::command(async)]
pub fn design_systems_list() -> Result<Vec<DesignSystem>, String> {
    model::catalog()
}
#[tauri::command(async)]
pub fn design_system_assignment(
    db: tauri::State<Db>,
    node_id: i64,
) -> Result<Option<Assignment>, String> {
    model::read(&root(&db, node_id)?)
}
#[tauri::command(async)]
pub fn design_system_assign(
    db: tauri::State<Db>,
    node_id: i64,
    design_id: Option<String>,
    expected: Option<Assignment>,
) -> Result<Assignment, String> {
    model::save(&root(&db, node_id)?, design_id, expected)
}

/// Nearest explicit project selection wins; an explicit clear stops inheritance.
pub fn context_for_node(conn: &rusqlite::Connection, node_id: i64) -> Result<String, String> {
    let mut current = Some(node_id);
    let mut seen = std::collections::HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id) {
            return Err("Cycle in project hierarchy".into());
        }
        let node = db::node_by_id(conn, id)?;
        if let Some(root) = db::node_deck_dir(conn, &node) {
            if model::read(&root)?.is_some() {
                return model::context(&root);
            }
        }
        current = node.parent_id;
    }
    Ok(String::new())
}
