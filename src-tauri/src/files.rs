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
///
/// **Which root, said out loud.** A node has two directories and they are
/// different questions: `work` is where things *run* — the repository, when
/// the node names one — and `vault` is where what we *know* lives, the folder
/// under `~/DevDeck` holding `.devdeck`, `_bot.md` and the features. The
/// Explorer only ever listed the first, so the vault was invisible in an app
/// whose whole point is keeping one. The caller says which; there is no
/// default that guesses, because one function answering both is the bug that
/// put `_bot.md` in somebody's repository.
#[tauri::command]
pub fn node_files(
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
    db: tauri::State<Db>,
    node_id: i64,
    rel: String,
    root: Option<String>,
) -> Result<Vec<FileRow>, String> {
    let vault = root.as_deref() == Some("vault");
    let root = {
        let conn = db.0.lock().unwrap();
        let node = db::node_by_id(&conn, node_id)?;
        if vault {
            db::node_deck_dir(&conn, &node)
                .ok_or("that node has no vault folder — it lives outside the vault")?
        } else {
            db::node_dir(&conn, &node).ok_or("that node has no folder yet")?
        }
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

/// The vault itself, from the top.
///
/// `node_files` answers "what is in this node", which cannot see two things
/// that matter: the workspaces as folders on disk, and `.devdeck/team` at the
/// root, which belongs to no node by design. Browsing the vault whole is the
/// only way to look at what the app has actually written down.
///
/// Hidden folders are *not* skipped here. `.devdeck` is the point of the
/// vault, and hiding it in the one view meant for seeing everything would be
/// the same mistake as a file manager that hides the folder you came to find.
#[tauri::command]
pub fn vault_files(db: tauri::State<Db>, rel: String) -> Result<Vec<FileRow>, String> {
    let root = {
        let conn = db.0.lock().unwrap();
        let raw = crate::db::setting_get_conn(&conn, "vault_root")?
            .filter(|s| !s.trim().is_empty())
            .ok_or("No vault folder has been chosen yet.")?;
        std::path::PathBuf::from(raw)
    };
    // Same refusal as everywhere else: a path that climbs out is not a listing.
    if rel.contains("..") {
        return Err("that path leaves the vault".into());
    }
    let here = if rel.trim().is_empty() {
        root.clone()
    } else {
        root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
    };
    if !here.is_dir() {
        return Err(format!("{} is not a folder", here.display()));
    }

    let mut dirs: Vec<FileRow> = Vec::new();
    let mut files: Vec<FileRow> = Vec::new();
    for e in std::fs::read_dir(&here).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        // `.git` stays out: it is thousands of objects and none of them are
        // anything you came here to read.
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let is_dir = e.path().is_dir();
        let child = if rel.trim().is_empty() {
            name.clone()
        } else {
            format!("{}/{name}", rel.trim_matches('/'))
        };
        let row = FileRow {
            item: None,
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

/// One file anywhere in the vault, as text. Same root, same refusal.
#[tauri::command]
pub fn vault_file_text(db: tauri::State<Db>, rel: String) -> Result<FileText, String> {
    let root = {
        let conn = db.0.lock().unwrap();
        let raw = crate::db::setting_get_conn(&conn, "vault_root")?
            .filter(|s| !s.trim().is_empty())
            .ok_or("No vault folder has been chosen yet.")?;
        std::path::PathBuf::from(raw)
    };
    if rel.contains("..") {
        return Err("that path leaves the vault".into());
    }
    read_text_at(&root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)), &rel)
}

/// A file's text, with everything the viewer needs to say what it is holding.
#[derive(Serialize, Clone, Debug)]
pub struct FileText {
    pub rel: String,
    /// The absolute path, for "reveal in explorer" and for saying where you are.
    pub path: String,
    /// What is in it. Empty when `readable` is false.
    pub text: String,
    pub bytes: u64,
    /// Whether this is text at all. A PNG opened in an editor is a screenful
    /// of noise and a lie about what the file is.
    pub readable: bool,
    /// Why not, when not — shown instead of the text rather than beside it.
    pub why: String,
    /// True when the text stops before the file does.
    pub truncated: bool,
}

/// The most of a file the viewer will take.
///
/// Monaco will happily open a hundred megabytes and then stop responding. A
/// vault file is a page of YAML; anything past this is a log or a dump, and
/// the honest move is to show the head and say so.
const MAX_TEXT: u64 = 2_000_000;

/// One file of a node, as text.
///
/// Same two roots as `node_files`, same refusal to climb out of them: a path
/// with `..` in it is not a file, it is a way out of the sandbox.
#[tauri::command]
pub fn file_text(
    db: tauri::State<Db>,
    node_id: i64,
    rel: String,
    root: Option<String>,
) -> Result<FileText, String> {
    let vault = root.as_deref() == Some("vault");
    let base = {
        let conn = db.0.lock().unwrap();
        let node = db::node_by_id(&conn, node_id)?;
        if vault {
            db::node_deck_dir(&conn, &node)
                .ok_or("that node has no vault folder — it lives outside the vault")?
        } else {
            db::node_dir(&conn, &node).ok_or("that node has no folder yet")?
        }
    };
    if rel.contains("..") {
        return Err("that path leaves the node".into());
    }
    read_text_at(&base.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)), &rel)
}

/// One file, read honestly: binary says so, too big says so, and a cut
/// multi-byte character at the end of a truncated read is not a broken file.
///
/// Shared by the node reader and the vault reader, because "what is in this
/// file" cannot be allowed to mean two different things depending on which
/// tree you were looking at.
fn read_text_at(path: &std::path::Path, rel: &str) -> Result<FileText, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.is_dir() {
        return Err(format!("{} is a folder", path.display()));
    }

    let bytes = meta.len();
    let mut out = FileText {
        rel: rel.to_string(),
        path: path.to_string_lossy().to_string(),
        text: String::new(),
        bytes,
        readable: true,
        why: String::new(),
        truncated: false,
    };

    if bytes > MAX_TEXT {
        // Read the head rather than refusing outright: the first page of a
        // huge file is usually the part you wanted.
        out.truncated = true;
    }

    let raw = std::fs::read(path).map_err(|e| e.to_string())?;
    let head = if raw.len() as u64 > MAX_TEXT {
        &raw[..MAX_TEXT as usize]
    } else {
        &raw[..]
    };

    // A NUL byte in the first few kilobytes is the oldest and still the best
    // test for "this is not text".
    if head.iter().take(8_000).any(|b| *b == 0) {
        out.readable = false;
        out.why = "This is a binary file.".into();
        return Ok(out);
    }

    match String::from_utf8(head.to_vec()) {
        Ok(t) => out.text = t,
        Err(e) => {
            // A truncated read can cut a multi-byte character in half; that is
            // not a broken file, so keep what decoded and drop the tail.
            let good = e.utf8_error().valid_up_to();
            if out.truncated && good > 0 {
                out.text = String::from_utf8_lossy(&head[..good]).into_owned();
            } else {
                out.readable = false;
                out.why = "This file is not UTF-8 text.".into();
            }
        }
    }
    Ok(out)
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
