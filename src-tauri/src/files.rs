//! The tree, reaching into the repository.
//!
//! Until now the Explorer stopped at the vault: a node, and under it five rows
//! that were not folders at all — Assistant, Context, Git, Commands, Services
//! wearing folder costumes. Those are things the node *has*, and they belong
//! on its page. What a tree is for is showing where things are, so this is the
//! part that was missing: the real folders and files under a node.
//!
//! **A chip says what a folder is part of.** Not a label anyone maintains —
//! derived from which feature's work items name files in it. A folder whose
//! path appears in the areas of `Offline sync`'s items carries that chip, and
//! the files inside inherit it. When no work item names anything, no chip
//! appears, which is the honest answer rather than a guess.
//!
//! Noise is skipped rather than shown greyed out: `.git`, `node_modules`,
//! `target` and friends are never what you opened a tree to find, and a first
//! screen of them is how people stop expanding it.

use serde::Serialize;
use std::path::Path;

use crate::db::{self, Db};

/// Directories that are never worth a row.
const SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    "__pycache__",
    ".venv",
    ".idea",
    ".vs",
];

#[derive(Serialize, Clone, Debug)]
pub struct FileRow {
    pub name: String,
    /// Path relative to the node's own root, with forward slashes.
    pub rel: String,
    pub dir: bool,
    /// The feature this is part of, derived from work items naming it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<String>,
}

/// What a work item says it touches, as lowercase forward-slashed paths.
fn areas_by_feature(deck: &crate::aiw::deck::Deck) -> Vec<(String, Vec<String>)> {
    deck.feature_slugs()
        .into_iter()
        .filter_map(|slug| {
            let name = deck
                .feature(&slug)
                .map(|f| f.meta.name)
                .unwrap_or_else(|_| slug.clone());
            let areas: Vec<String> = deck
                .work(&slug)
                .map(|w| {
                    w.meta
                        .items
                        .into_iter()
                        .flat_map(|i| i.areas)
                        .map(|a| a.trim().replace('\\', "/").trim_matches('/').to_lowercase())
                        .filter(|a| !a.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            if areas.is_empty() {
                None
            } else {
                Some((name, areas))
            }
        })
        .collect()
}

/// Which feature, if any, claims this path.
///
/// A match is an area that *is* the path or contains it — so naming
/// `src/sync` chips the folder and everything under it, and naming
/// `src/sync/engine.ts` chips only that file. Longest area wins, because the
/// more specific claim is the more useful one.
fn chip(rel: &str, features: &[(String, Vec<String>)]) -> Option<String> {
    let path = rel.to_lowercase();
    let mut best: Option<(usize, &str)> = None;
    for (name, areas) in features {
        for a in areas {
            let hit = path == *a || path.starts_with(&format!("{a}/")) || a.starts_with(&format!("{path}/"));
            if hit && best.map(|(n, _)| a.len() > n).unwrap_or(true) {
                best = Some((a.len(), name));
            }
        }
    }
    best.map(|(_, n)| n.to_string())
}

/// One directory of a node, on disk.
///
/// `rel` empty means the node's own root. Directories first, then files, both
/// alphabetically — a listing whose order depends on the filesystem is one you
/// cannot scan twice the same way.
#[tauri::command]
pub fn node_files(
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
    db: tauri::State<Db>,
    node_id: i64,
    rel: String,
) -> Result<Vec<FileRow>, String> {
    let root = {
        let conn = db.0.lock().unwrap();
        let node = db::node_by_id(&conn, node_id)?;
        db::node_dir(&conn, &node).ok_or("that node has no folder yet")?
    };
    // A path that climbs out of the node is not a listing, it is a way out of
    // the sandbox. Refuse rather than normalising it into something plausible.
    if rel.contains("..") {
        return Err("that path leaves the node".into());
    }
    let here = if rel.trim().is_empty() {
        root.clone()
    } else {
        root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
    };
    if !here.is_dir() {
        return Err(format!("{} is not a folder", here.display()));
    }

    let features = ws
        .project(&node_id.to_string())
        .map(|p| areas_by_feature(&p.deck()))
        .unwrap_or_default();

    let mut dirs: Vec<FileRow> = Vec::new();
    let mut files: Vec<FileRow> = Vec::new();
    for e in std::fs::read_dir(&here).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if SKIP.contains(&name.as_str()) {
            continue;
        }
        let is_dir = e.path().is_dir();
        let child = if rel.trim().is_empty() {
            name.clone()
        } else {
            format!("{}/{name}", rel.trim_matches('/'))
        };
        let row = FileRow {
            item: chip(&child, &features),
            name,
            rel: child,
            dir: is_dir,
        };
        if is_dir {
            dirs.push(row)
        } else {
            files.push(row)
        }
    }
    let by_name = |a: &FileRow, b: &FileRow| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.extend(files);
    Ok(dirs)
}

/// Whether a node has a folder worth expanding at all.
pub fn has_files(conn: &rusqlite::Connection, node_id: i64) -> bool {
    db::node_dir_by_id(conn, node_id)
        .map(|p| Path::new(&p).is_dir())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn features() -> Vec<(String, Vec<String>)> {
        vec![
            ("Offline sync".into(), vec!["src/sync".into(), "docs/sync.md".into()]),
            ("Billing".into(), vec!["src".into()]),
        ]
    }

    #[test]
    fn a_folder_named_by_a_work_item_carries_that_feature() {
        assert_eq!(chip("src/sync", &features()).as_deref(), Some("Offline sync"));
    }

    #[test]
    fn files_inherit_the_folder_that_was_named() {
        assert_eq!(
            chip("src/sync/engine.ts", &features()).as_deref(),
            Some("Offline sync")
        );
    }

    #[test]
    fn the_more_specific_claim_wins() {
        // Both "src" (Billing) and "src/sync" (Offline sync) match; the longer
        // one is the one that says something.
        assert_eq!(chip("src/sync", &features()).as_deref(), Some("Offline sync"));
        assert_eq!(chip("src/api.ts", &features()).as_deref(), Some("Billing"));
    }

    #[test]
    fn nothing_named_means_no_chip_rather_than_a_guess() {
        assert!(chip("README.md", &features()).is_none());
    }

    #[test]
    fn a_parent_of_a_named_file_is_chipped_too() {
        // "docs" contains docs/sync.md, so the folder is part of that feature.
        assert_eq!(chip("docs", &features()).as_deref(), Some("Offline sync"));
    }
}
