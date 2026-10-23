//! Work-item metadata and explicit links to immutable workflow instances.
//! Legacy work and GitHub snapshots remain their own source records.
use crate::{db::Db, folder_workflows};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::{fs, io::Write, path::Path, sync::Mutex};

static WRITE: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct RunLink {
    pub node: i64,
    pub workflow: String,
    pub template: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Record {
    pub id: String,
    pub node: i64,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub acceptance: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub source_url: String,
    pub status: String,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub runs: Vec<RunLink>,
    #[serde(default)]
    pub completion_note: String,
    #[serde(default)]
    pub github_sync: String,
    #[serde(default)]
    pub github_sync_error: String,
}
fn read(path: &Path) -> Result<Vec<Record>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            serde_json::from_str(&raw).map_err(|e| format!("Work items could not be read: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}
fn write(path: &Path, records: &[Record]) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid work item directory")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(
            serde_json::to_string_pretty(records)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
fn update(records: &mut Vec<Record>, mut record: Record, expected: u64) -> Result<Record, String> {
    if record.id.is_empty()
        || record.id.len() > 240
        || record.title.trim().is_empty()
        || record.title.len() > 500
        || record.node <= 0
        || record.description.len() + record.acceptance.len() > 200_000
        || (!record.source_url.is_empty()
            && !record.source_url.starts_with("https://")
            && !record.source_url.starts_with("http://"))
        || !["queued", "working", "review", "blocked", "completed"]
            .contains(&record.status.as_str())
    {
        return Err(
            "Provide a title, target folder and valid work state (up to 200 KB of Markdown)."
                .into(),
        );
    }
    let existing = records.iter().position(|r| r.id == record.id);
    if existing.map(|i| records[i].revision).unwrap_or(0) != expected {
        return Err("This work item changed. Reload before saving.".into());
    }
    if existing
        .map(|i| &records[i].runs)
        .cloned()
        .unwrap_or_default()
        != record.runs
    {
        return Err(
            "Attach workflows through the work item action; run links cannot be edited directly."
                .into(),
        );
    }
    if !record.source_url.is_empty()
        && records
            .iter()
            .any(|r| r.id != record.id && r.source_url == record.source_url)
    {
        return Err("This source already belongs to a work item. Open that item instead.".into());
    }
    record.title = record.title.trim().into();
    record.revision = expected + 1;
    match existing {
        Some(i) => records[i] = record.clone(),
        None => records.push(record.clone()),
    }
    Ok(record)
}
pub(crate) fn contains(conn: &rusqlite::Connection, id: &str) -> Result<bool, String> {
    let root = crate::db::setting_get_conn(conn, crate::vault::ROOT_KEY)?.filter(|s| !s.trim().is_empty()).ok_or("Choose a DevDeck vault first.")?;
    Ok(read(&std::path::PathBuf::from(root).join(".devdeck/work-items.json"))?.iter().any(|r| r.id == id))
}
fn path(db: &Db) -> Result<std::path::PathBuf, String> {
    Ok(crate::visibility::root(db)?.join(".devdeck/work-items.json"))
}
#[tauri::command(async)]
pub fn work_records_list(db: tauri::State<Db>) -> Result<Vec<Record>, String> {
    all(&db)
}
pub(crate) fn all(db: &Db) -> Result<Vec<Record>, String> { read(&path(db)?) }
#[tauri::command(async)]
pub fn work_record_save(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    record: Record,
    expected: u64,
) -> Result<Record, String> {
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    crate::db::node_by_id(&db.conn(), record.node).map_err(|e| e.to_string())?;
    let p = path(&db)?;
    let mut records = read(&p)?;
    let previous = records.iter().find(|r| r.id == record.id);
    if record.status == "completed" && previous.map(|r| r.status.as_str()) != Some("completed") {
        return Err("Use Complete work item to review scope and close the linked issue.".into());
    }
    if let Some(old) = previous {
        if old.status == "completed" && (record.status != "completed" || record.source_url != old.source_url || record.node != old.node) {
            return Err("Completed work retains its source and project. Create a new request for additional work.".into());
        }
    }
    let mut record = record;
    record.completion_note = previous.map(|r| r.completion_note.clone()).unwrap_or_default();
    record.github_sync = previous.map(|r| r.github_sync.clone()).unwrap_or_default();
    record.github_sync_error = previous.map(|r| r.github_sync_error.clone()).unwrap_or_default();
    let saved = update(&mut records, record, expected)?;
    write(&p, &records)?;
    crate::aiw::events::say(
        &app,
        crate::aiw::events::EventType::FileChanged,
        crate::aiw::events::in_space(saved.node, None, None),
        serde_json::json!({"source":"work_items","summary":"Work item updated","work_item_id":saved.id}),
    );
    Ok(saved)
}

#[tauri::command(async)]
pub fn work_record_attach(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    id: String,
    expected: u64,
    node: i64,
    template: String,
    template_expected: String,
    request: String,
) -> Result<Record, String> {
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let p = path(&db)?;
    let mut records = read(&p)?;
    let i = records
        .iter()
        .position(|r| r.id == id)
        .ok_or("Save this work item before attaching a workflow.")?;
    let workflow = format!("work-run-{request}");
    if let Some(link) = records[i]
        .runs
        .iter()
        .find(|link| link.node == node && link.workflow == workflow)
    {
        if link.template != template {
            return Err("This request identity was already used with a different template.".into());
        }
        return Ok(records[i].clone());
    }
    if records[i].revision != expected {
        return Err("This work item changed. Reload before attaching a workflow.".into());
    }
    if records[i].status == "completed" {
        return Err("Reopen this work item before attaching a workflow.".into());
    }
    let record = records[i].clone();
    let (run, created) = folder_workflows::copy_for_work(
        &app,
        &db,
        node,
        &template,
        &template_expected,
        &workflow,
        &record.id,
        &record.title,
        &record.source_url,
        &format!(
            "{}\n\n# Acceptance criteria\n{}",
            record.description, record.acceptance
        ),
    )?;
    records[i].runs.push(RunLink {
        node,
        workflow,
        template,
    });
    records[i].revision += 1;
    if let Err(error) = write(&p, &records) {
        if created {
            folder_workflows::rollback_work_copy(&db, node, &run.path, &run.raw);
        }
        return Err(error);
    }
    folder_workflows::changed(&app, node);
    crate::aiw::events::say(
        &app,
        crate::aiw::events::EventType::FileChanged,
        crate::aiw::events::in_space(record.node, None, None),
        serde_json::json!({"source":"work_items","summary":"Workflow attached to work item","work_item_id":record.id}),
    );
    Ok(records[i].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item() -> Record {
        Record {
            id: "one".into(),
            node: 1,
            title: "A request".into(),
            status: "queued".into(),
            ..Default::default()
        }
    }
    #[test]
    fn failed_issue_sync_is_durable_and_retry_keeps_local_completion() {
        let dir = std::env::temp_dir().join(format!("devdeck-sync-test-{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let file = dir.join("items.json");
        let mut row = item(); row.status="completed".into();row.github_sync="pending".into();row.source_url="https://github.com/owner/repo/issues/37".into();
        let mut records=vec![row];
        let failed=sync_record_with(&file,&mut records,0,|_|Err("No network".into())).unwrap();
        assert_eq!(failed.status,"completed"); assert_eq!(failed.github_sync,"failed");
        assert_eq!(read(&file).unwrap()[0].github_sync_error,"No network");
        let closed=sync_record_with(&file,&mut records,0,|_|Ok(())).unwrap();
        assert_eq!(closed.github_sync,"closed");assert!(closed.github_sync_error.is_empty());
        sync_record_with(&file,&mut records,0,|_|panic!("already confirmed")).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stale_updates_and_duplicate_sources_are_rejected() {
        let mut rows = vec![];
        let mut one = item();
        one.source_url = "https://github.com/owner/repo/issues/1".into();
        let saved = update(&mut rows, one.clone(), 0).unwrap();
        assert_eq!(saved.revision, 1);
        assert!(update(&mut rows, one.clone(), 0).is_err());
        one.id = "two".into();
        assert!(update(&mut rows, one, 0).is_err());
        let mut changed = saved;
        changed.status = "working".into();
        assert_eq!(update(&mut rows, changed, 1).unwrap().revision, 2);
    }
    #[test]
    fn metadata_cannot_invent_run_links() {
        let mut rows = vec![];
        let mut value = item();
        value.runs.push(RunLink {
            node: 1,
            workflow: "fake".into(),
            template: "source".into(),
        });
        assert!(update(&mut rows, value, 0).is_err());
    }
}

#[derive(Clone, Deserialize)]
pub struct Exclusion { pub node: i64, pub workflow: String, pub step: String }

pub(crate) fn ensure_open(db: &Db, node: i64, workflow: &str, url: &str) -> Result<(), String> {
    if read(&path(db)?)?.iter().any(|r| r.status == "completed" &&
        (r.id == format!("workflow:{node}:{workflow}") || (!url.is_empty() && r.source_url == url) || r.runs.iter().any(|l| l.node == node && l.workflow == workflow))) {
        return Err("This work item is completed. Start a new request for additional work.".into());
    }
    Ok(())
}

fn linked_runs(db: &Db, record: &Record) -> Result<Vec<RunLink>, String> {
    let mut links = record.runs.clone();
    if let Some(reference) = record.id.strip_prefix("workflow:") {
        if let Some((node, workflow)) = reference.split_once(':') {
            links.push(RunLink { node:node.parse().map_err(|_| "Invalid workflow link.")?, workflow:workflow.into(), template:String::new() });
        }
    }
    if !record.source_url.is_empty() {
        let snapshot = folder_workflows::snapshot(db);
        if snapshot["warnings"].as_array().is_some_and(|w| !w.is_empty()) { return Err("Resolve unreadable workflow history before completing work.".into()); }
        for item in snapshot["items"].as_array().into_iter().flatten() {
            if item["definition"]["ticket_url"].as_str() == Some(&record.source_url) {
                links.push(RunLink { node:item["node"].as_i64().ok_or("Invalid workflow node")?, workflow:item["id"].as_str().ok_or("Invalid workflow ID")?.into(), template:String::new() });
            }
        }
    }
    links.sort_by(|a,b| (a.node,&a.workflow).cmp(&(b.node,&b.workflow)));
    links.dedup_by(|a,b| a.node == b.node && a.workflow == b.workflow);
    Ok(links)
}

fn sync_record(p: &Path, records: &mut [Record], index: usize) -> Result<Record, String> {
    sync_record_with(p, records, index, crate::github_completion::close)
}
fn sync_record_with(p: &Path, records: &mut [Record], index: usize, close: impl FnOnce(&str) -> Result<(), String>) -> Result<Record, String> {
    if records[index].github_sync == "closed" { return Ok(records[index].clone()); }
    match close(&records[index].source_url) {
        Ok(()) => { records[index].github_sync = "closed".into(); records[index].github_sync_error.clear(); }
        Err(error) => { records[index].github_sync = "failed".into(); records[index].github_sync_error = error; }
    }
    records[index].revision += 1;
    write(p, records)?;
    Ok(records[index].clone())
}

fn complete_blocking(app: tauri::AppHandle, db: tauri::State<Db>, mut record: Record, expected: u64, exclusions: Vec<Exclusion>, reason: String) -> Result<Record, String> {
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    if reason.trim().is_empty() { return Err("Record how the request's acceptance criteria were met.".into()); }
    crate::db::node_by_id(&db.conn(), record.node).map_err(|e| e.to_string())?;
    let p = path(&db)?;
    let mut records = read(&p)?;
    if records.iter().any(|r| r.id == record.id && r.status == "completed") { return Err("This work item is already completed. Retry GitHub sync if needed.".into()); }
    let github = record.source_url.starts_with("https://github.com/");
    if github { crate::github_completion::issue(&record.source_url)?; }
    record.status = "completed".into();
    record.completion_note = reason.trim().into();
    record.github_sync = if github { "pending".into() } else { String::new() };
    record.github_sync_error.clear();
    // Validate revision, identity and user metadata before changing any process.
    let mut saved = update(&mut records, record, expected)?;
    let links = linked_runs(&db, &saved)?;
    let index = records.iter().position(|r| r.id == saved.id).ok_or("Work item unavailable")?;
    saved.runs = links.clone();
    records[index] = saved.clone();
    folder_workflows::complete_work(&db, &links, &exclusions, &reason, || write(&p, &records))?;
    if github { saved = sync_record(&p, &mut records, index)?; }
    folder_workflows::changed(&app, saved.node);
    Ok(saved)
}

fn sync_blocking(app: tauri::AppHandle, db: tauri::State<Db>, id: String, expected: u64) -> Result<Record, String> {
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let p = path(&db)?;
    let mut records = read(&p)?;
    let index = records.iter().position(|r| r.id == id).ok_or("Work item unavailable")?;
    if records[index].revision != expected || records[index].status != "completed" { return Err("Refresh the completed work item before retrying sync.".into()); }
    let saved = sync_record(&p, &mut records, index)?;
    folder_workflows::changed(&app, saved.node);
    Ok(saved)
}

#[tauri::command(async)]
pub async fn work_record_complete(app: tauri::AppHandle, record: Record, expected: u64, exclusions: Vec<Exclusion>, reason: String) -> Result<Record, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let owner = app.clone();
        complete_blocking(app, owner.state::<Db>(), record, expected, exclusions, reason)
    }).await.map_err(|_| "Completion stopped unexpectedly. Refresh the work item and inspect its saved status before retrying.".to_string())?
}

#[tauri::command(async)]
pub async fn work_record_sync(app: tauri::AppHandle, id: String, expected: u64) -> Result<Record, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let owner = app.clone();
        sync_blocking(app, owner.state::<Db>(), id, expected)
    }).await.map_err(|_| "Issue sync stopped unexpectedly. Local completion is retained; refresh and retry sync.".to_string())?
}
