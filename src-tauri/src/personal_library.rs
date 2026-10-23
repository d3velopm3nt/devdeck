//! Personal text definitions and reusable teams; never executes imported instructions.
use crate::library::WRITE;
use crate::{
    library,
    team_library_model::{self, Team},
    workers,
};
use std::fs;

pub fn save_item(
    id: String,
    kind: String,
    name: String,
    what: String,
    body: String,
    expected: Option<String>,
) -> Result<library::Item, String> {
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    if !team_library_model::valid_id(&id)
        || !matches!(kind.as_str(), "skill" | "brief")
        || name.trim().is_empty()
        || body.trim().is_empty()
        || body.len() > 200_000
    {
        return Err("Use a lowercase ID, choose a skill or agent template, and provide a name and instructions (up to 200 KB).".into());
    }
    let mut ix = library::read_index()?;
    let existing = ix.items.iter().find(|it| it.id == id && it.kind == kind);
    match (existing, expected.as_ref()) {
        (Some(it), Some(revision)) if it.repo == "personal" => {
            if fs::read_to_string(library::item_path(it)?).map_err(|e| e.to_string())? != *revision {
                return Err("This definition changed. Reopen it before saving.".into());
            }
        }
        (Some(_), _) => return Err("That ID already exists. Imported definitions retain their source; choose a new ID for a custom copy.".into()),
        (None, Some(_)) => return Err("This definition was removed. Create it with a new ID.".into()),
        (None, None) => {}
    }
    let item = library::Item {
        id,
        kind,
        name: name.trim().into(),
        what: what.trim().into(),
        repo: "personal".into(),
        commit: String::new(),
        licence: "Personal definition".into(),
        path: String::new(),
        added_at: chrono::Utc::now().to_rfc3339(),
        chars: body.chars().count() as i64,
    };
    let p = library::item_path(&item)?;
    fs::create_dir_all(p.parent().ok_or("Invalid library path")?).map_err(|e| e.to_string())?;
    fs::write(&p, body).map_err(|e| e.to_string())?;
    ix.items
        .retain(|it| !(it.id == item.id && it.kind == item.kind));
    ix.items.push(item.clone());
    library::write_index_pub(&ix)?;
    Ok(item)
}
#[tauri::command(async)]
pub fn library_save_custom(
    id: String,
    kind: String,
    name: String,
    what: String,
    body: String,
    expected: Option<String>,
) -> Result<library::Item, String> {
    save_item(id, kind, name, what, body, expected)
}

pub(crate) fn team_connection(root: &std::path::Path) -> Result<rusqlite::Connection, String> {
    let db = crate::agent_library::connection(root)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS reusable_teams (id TEXT PRIMARY KEY, definition TEXT NOT NULL); CREATE TABLE IF NOT EXISTS team_build_requests (id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL);").map_err(|e| e.to_string())?;
    let legacy = root.join("library/teams.json");
    if legacy.exists() {
        let teams: Vec<Team> = serde_json::from_slice(&fs::read(legacy).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        for team in teams {
            db.execute("INSERT OR IGNORE INTO reusable_teams(id,definition) VALUES (?1,?2)", rusqlite::params![team.id, serde_json::to_string(&team).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        }
    }
    Ok(db)
}

#[tauri::command(async)]
pub fn reusable_teams_list() -> Result<Vec<Team>, String> {
    let store = crate::aiw::personal::PersonalStore::open()?;
    let db = team_connection(store.root())?;
    let mut query = db.prepare("SELECT definition FROM reusable_teams ORDER BY id").map_err(|e| e.to_string())?;
    let rows = query.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect()
}
pub fn validate_worker(handle: &str) -> Result<(), String> {
    if handle.starts_with("agent:") { return crate::native_workflow::definition(handle).map(|_| ()); }
    if !team_library_model::valid_id(handle) {
        return Err(format!("Invalid agent handle '{handle}'."));
    }
    let worker = workers::read_worker(handle)?
        .ok_or_else(|| format!("Agent '{handle}' is missing. Configure it in Agents."))?;
    let library = library::read_index()?;
    for skill in &worker.meta.skills {
        if !library.items.iter().any(|it| {
            it.id == *skill
                && it.kind == "skill"
                && library::item_path(it).is_ok_and(|p| p.is_file())
        }) {
            return Err(format!(
                "Agent '{}' needs missing skill '{skill}'. Open the Library to restore it.",
                worker.meta.name
            ));
        }
    }
    if !worker.meta.brief.is_empty()
        && !library.items.iter().any(|it| {
            it.id == worker.meta.brief
                && it.kind == "brief"
                && library::item_path(it).is_ok_and(|p| p.is_file())
        })
    {
        return Err(format!(
            "Agent '{}' needs missing template '{}'.",
            worker.meta.name, worker.meta.brief
        ));
    }
    Ok(())
}
#[tauri::command(async)]
pub fn reusable_team_save(mut team: Team) -> Result<Team, String> {
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    team_library_model::validate(&team)?;
    for role in &team.roles {
        validate_worker(&role.worker).map_err(|e| format!("Role '{}': {e}", role.name))?;
    }
    let store = crate::aiw::personal::PersonalStore::open()?;
    let mut db = team_connection(store.root())?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    use rusqlite::OptionalExtension;
    let existing: Option<String> = tx.query_row("SELECT definition FROM reusable_teams WHERE id=?1", [&team.id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let revision = existing.map(|raw| serde_json::from_str::<Team>(&raw).map(|t| t.revision)).transpose().map_err(|e| e.to_string())?.unwrap_or(0);
    if revision != team.revision { return Err("This team changed. Reload before saving.".into()); }
    team.revision += 1;
    tx.execute("INSERT INTO reusable_teams(id,definition) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition", rusqlite::params![team.id, serde_json::to_string(&team).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(team)
}
pub fn resolve_definition(d: &mut crate::workflow_model::Definition) -> Result<(), String> {
    if !d.team.is_empty() {
        let team = reusable_teams_list()?
            .into_iter()
            .find(|t| t.id == d.team)
            .ok_or_else(|| format!("Team '{}' is missing. Configure it in Agents.", d.team))?;
        team_library_model::resolve(&team, d)?;
    }
    for step in &d.steps {
        validate_worker(&step.worker).map_err(|e| format!("Step '{}': {e}", step.title))?;
    }
    Ok(())
}

/// Import a reviewed Community text entry into the same reusable library.
/// A stable source identity avoids overwriting unrelated custom definitions.
pub fn import_community(entry: &crate::community::Item) -> Result<library::Item, String> {
    use sha2::{Digest, Sha256};
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let kind = match entry.kind.as_str() {
        "skill" => "skill",
        "agent" => "brief",
        _ => return Err("Only agent templates and skills can be imported as text.".into()),
    };
    if entry.body.trim().is_empty() {
        return Err(
            "This entry has no reusable text. Use its source repository in Add from GitHub.".into(),
        );
    }
    let digest = format!("{:x}", Sha256::digest(entry.id.as_bytes()));
    let id = format!("community-{}", &digest[..16]);
    let mut ix = library::read_index()?;
    if let Some(existing) = ix.items.iter().find(|it| it.id == id && it.kind == kind) {
        if existing.path == entry.id {
            return Ok(existing.clone());
        }
        return Err("This library ID is already used; no definition was replaced.".into());
    }
    let item = library::Item {
        id,
        kind: kind.into(),
        name: entry.name.clone(),
        what: entry.summary.clone(),
        repo: entry.source.clone(),
        commit: entry.version.clone(),
        licence: entry.licence.clone(),
        path: entry.id.clone(),
        added_at: chrono::Utc::now().to_rfc3339(),
        chars: entry.body.chars().count() as i64,
    };
    let p = library::item_path(&item)?;
    fs::create_dir_all(p.parent().ok_or("Invalid library path")?).map_err(|e| e.to_string())?;
    fs::write(p, &entry.body).map_err(|e| e.to_string())?;
    ix.items.push(item.clone());
    library::write_index_pub(&ix)?;
    Ok(item)
}
