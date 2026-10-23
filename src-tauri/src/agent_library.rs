//! Canonical agent definitions. Legacy files are migration inputs, never mirrors.
use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::aiw::{deck::Doc, personal::AgentMeta};
use crate::workers::{Worker, WorkerMeta};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentDefinition {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub skills: Vec<String>,
    pub execution: String,
    pub configuration: serde_json::Value,
}

pub(crate) fn connection(root: &Path) -> Result<rusqlite::Connection, String> {
    let dir = root.join("library");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db = rusqlite::Connection::open(dir.join("agents.sqlite")).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(10)).map_err(|e| e.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS agent_definitions (id TEXT PRIMARY KEY, definition TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);").map_err(|e| e.to_string())?;
    Ok(db)
}

pub fn save(root: &Path, definition: &AgentDefinition, migrate: bool) -> Result<(), String> {
    let db = connection(root)?;
    let json = serde_json::to_string(definition).map_err(|e| e.to_string())?;
    let sql = if migrate { "INSERT OR IGNORE INTO agent_definitions(id,definition) VALUES (?1,?2)" } else { "INSERT INTO agent_definitions(id,definition) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,deleted=0" };
    db.execute(sql, rusqlite::params![definition.id, json]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list(root: &Path) -> Result<Vec<AgentDefinition>, String> {
    let db = connection(root)?;
    let mut statement = db.prepare("SELECT definition FROM agent_definitions WHERE deleted=0 ORDER BY id").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect()
}

pub fn create(root: &Path, definition: &AgentDefinition) -> Result<(), String> {
    let json = serde_json::to_string(definition).map_err(|e| e.to_string())?;
    connection(root)?.execute("INSERT INTO agent_definitions(id,definition) VALUES (?1,?2)", rusqlite::params![definition.id, json])
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(ref code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => "An agent with that name already exists. Choose another name.".into(),
            _ => e.to_string(),
        })?;
    Ok(())
}

pub fn has_history(root: &Path) -> Result<bool, String> {
    connection(root)?.query_row("SELECT EXISTS(SELECT 1 FROM agent_definitions)", [], |r| r.get(0)).map_err(|e| e.to_string())
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    connection(root)?.execute("UPDATE agent_definitions SET deleted=1 WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn from_runtime(doc: &Doc<AgentMeta>) -> Result<AgentDefinition, String> {
    let mut configuration = serde_json::to_value(&doc.meta).map_err(|e| e.to_string())?;
    if let Some(object) = configuration.as_object_mut() { object.remove("name"); object.remove("skills"); }
    Ok(AgentDefinition { id: format!("runtime:{}", doc.meta.id), name: doc.meta.name.clone(), instructions: doc.body.clone(), skills: doc.meta.skills.clone(), execution: "model".into(), configuration })
}

pub fn runtime(definition: &AgentDefinition) -> Result<Doc<AgentMeta>, String> {
    let mut metadata = definition.configuration.clone();
    metadata["name"] = definition.name.clone().into();
    metadata["skills"] = serde_json::to_value(&definition.skills).map_err(|e| e.to_string())?;
    Ok(Doc { meta: serde_json::from_value(metadata).map_err(|e| e.to_string())?, body: definition.instructions.clone() })
}

pub fn from_worker(worker: &Worker) -> Result<AgentDefinition, String> {
    let mut configuration = serde_json::to_value(&worker.meta).map_err(|e| e.to_string())?;
    if let Some(object) = configuration.as_object_mut() { object.remove("name"); object.remove("skills"); }
    Ok(AgentDefinition { id: format!("worker:{}", worker.meta.handle), name: worker.meta.name.clone(), instructions: worker.body.clone(), skills: worker.meta.skills.clone(), execution: "cli".into(), configuration })
}

pub fn worker(definition: &AgentDefinition) -> Result<Worker, String> {
    let mut metadata = definition.configuration.clone();
    metadata["name"] = definition.name.clone().into();
    metadata["skills"] = serde_json::to_value(&definition.skills).map_err(|e| e.to_string())?;
    Ok(Worker { meta: serde_json::from_value::<WorkerMeta>(metadata).map_err(|e| e.to_string())?, body: definition.instructions.clone() })
}

pub fn from_manager(manager: &crate::managers::Manager, vault: &Path) -> Result<AgentDefinition, String> {
    let mut configuration = serde_json::to_value(manager).map_err(|e| e.to_string())?;
    for key in ["name", "body", "skills"] { configuration.as_object_mut().unwrap().remove(key); }
    configuration["vault"] = vault.to_string_lossy().to_string().into();
    Ok(AgentDefinition { id: format!("manager:{}:{}", vault.to_string_lossy(), manager.handle), name: manager.name.clone(), instructions: manager.body.clone(), skills: manager.skills.clone(), execution: "manager".into(), configuration })
}

pub fn manager(definition: &AgentDefinition) -> Result<crate::managers::Manager, String> {
    let mut metadata = definition.configuration.clone();
    metadata["name"] = definition.name.clone().into();
    metadata["body"] = definition.instructions.clone().into();
    metadata["skills"] = serde_json::to_value(&definition.skills).map_err(|e| e.to_string())?;
    serde_json::from_value(metadata).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_manager_save(db: tauri::State<crate::db::Db>, expected: AgentDefinition, name: String, instructions: String, goal: String) -> Result<(), String> {
    let conn = db.conn();
    let vault = crate::managers::dir(&conn).and_then(|p| p.parent().map(Path::to_path_buf)).ok_or("Choose a vault first.")?;
    let handle = expected.configuration["handle"].as_str().ok_or("Missing manager handle.")?;
    let mut current = crate::managers::get(&conn, handle).ok_or("This manager is no longer available in the active vault.")?;
    let actual = from_manager(&current, &vault)?;
    if serde_json::to_value(actual).map_err(|e| e.to_string())? != serde_json::to_value(expected).map_err(|e| e.to_string())? {
        return Err("This manager or the active vault changed. Reopen it before saving.".into());
    }
    if name.trim().is_empty() || name.contains(['\n', '\r']) { return Err("Enter a single-line manager name.".into()); }
    current.name = name.trim().into();
    current.body = instructions;
    current.goal = goal;
    crate::managers::save(&conn, &current)
}

#[tauri::command]
pub fn library_agents(db: tauri::State<crate::db::Db>, ws: tauri::State<'_, std::sync::Arc<crate::aiw::state::Workspace>>) -> Result<Vec<AgentDefinition>, String> {
    crate::aiw::commands::ensure_team_planner(ws.inner())?;
    let store = crate::aiw::personal::PersonalStore::open()?;
    let _ = store.agents();
    let _ = crate::workers::all_workers()?;
    let mut definitions = list(store.root())?;
    let conn = db.conn();
    if let Some(vault) = crate::managers::dir(&conn).and_then(|p| p.parent().map(Path::to_path_buf)) {
        for manager in crate::managers::all(&conn) { definitions.push(from_manager(&manager, &vault)?); }
    }
    Ok(definitions)
}

/// Immutable run configuration. Credentials are resolved separately at execution time.
pub fn snapshot<T: Serialize + for<'de> Deserialize<'de>>(root: &Path, key: &str, proposed: &T) -> Result<T, String> {
    let db = connection(root)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS agent_run_snapshots (id TEXT PRIMARY KEY, definition TEXT NOT NULL);").map_err(|e| e.to_string())?;
    db.execute("INSERT OR IGNORE INTO agent_run_snapshots(id,definition) VALUES (?1,?2)", rusqlite::params![key, serde_json::to_string(proposed).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    let raw: String = db.query_row("SELECT definition FROM agent_run_snapshots WHERE id=?1", [key], |r| r.get(0)).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_survive_reload_and_new_runs_pick_up_changes() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("devdeck-snapshot-{nonce}"));
        let first = serde_json::json!({"model":"original","instructions":"first"});
        let changed = serde_json::json!({"model":"updated","instructions":"second"});
        assert_eq!(snapshot(&root,"run-one",&first).unwrap(), first);
        assert_eq!(snapshot(&root,"run-one",&changed).unwrap(), first);
        assert_eq!(snapshot(&root,"run-two",&changed).unwrap(), changed);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn worker_adapter_preserves_execution_and_shared_definition_fields() {
        let source = Worker { meta: WorkerMeta { handle: "reviewer".into(), name: "Reviewer".into(), runner: "claude-code".into(), model: "sonnet".into(), skills: vec!["review".into()], brief: "imported-template".into(), minutes: 20, usd: 2.0, ..Default::default() }, body: "Review carefully".into() };
        let mut definition = from_worker(&source).unwrap();
        definition.instructions = "Updated in Library".into();
        definition.name = "Code Reviewer".into();
        let restored = worker(&definition).unwrap();
        assert_eq!(restored.meta.handle, source.meta.handle);
        assert_eq!(restored.meta.runner, source.meta.runner);
        assert_eq!(restored.meta.brief, source.meta.brief);
        assert_eq!(restored.meta.skills, source.meta.skills);
        assert_eq!(restored.body, "Updated in Library");
        assert_eq!(restored.meta.name, "Code Reviewer");
        assert_ne!(definition.id, from_runtime(&Doc { meta: AgentMeta { id: "reviewer".into(), ..Default::default() }, body: String::new() }).unwrap().id);
    }
    #[test]
    fn migration_preserves_updates_and_deleted_agents() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("devdeck-agent-library-{}-{nonce}", std::process::id()));
        let mut definition = from_runtime(&Doc { meta: AgentMeta { id: "planner".into(), name: "Planner".into(), ..Default::default() }, body: "Original".into() }).unwrap();
        save(&root, &definition, true).unwrap();
        assert!(create(&root, &definition).is_err());
        definition.instructions = "Updated".into();
        save(&root, &definition, false).unwrap();
        let mut old = definition.clone(); old.instructions = "Old backup".into();
        save(&root, &old, true).unwrap();
        assert_eq!(runtime(&list(&root).unwrap()[0]).unwrap().body, "Updated");
        remove(&root, &definition.id).unwrap();
        save(&root, &old, true).unwrap();
        assert!(list(&root).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// Inspect the configuration already pinned by a turn without creating a snapshot.
pub fn read_snapshot<T: for<'de> Deserialize<'de>>(root: &Path, key: &str) -> Result<Option<T>, String> {
    use rusqlite::OptionalExtension;
    let db=connection(root)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS agent_run_snapshots (id TEXT PRIMARY KEY, definition TEXT NOT NULL);").map_err(|e|e.to_string())?;
    let raw:Option<String>=db.query_row("SELECT definition FROM agent_run_snapshots WHERE id=?1",[key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    raw.map(|s|serde_json::from_str(&s).map_err(|e|e.to_string())).transpose()
}
