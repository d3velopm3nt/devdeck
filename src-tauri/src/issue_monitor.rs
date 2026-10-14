//! Opt-in GitHub intake and explicitly assigned workflow dispatch.
use crate::{
    db::Db,
    issue_monitor_model::{
        dispatchable, due, may_select, normalize, Binding, Config, Dispatch, Source,
    },
};
use serde::Serialize;
use std::{fs, io::Write, path::Path, sync::Mutex, time::Duration};
use tauri::Manager;
static POLL: Mutex<()> = Mutex::new(());
static CONFIG: Mutex<()> = Mutex::new(());
#[derive(Serialize)]
pub struct View {
    pub raw: String,
    pub enabled: bool,
    pub sources: Vec<Source>,
    pub warnings: Vec<String>,
    pub bindings: Vec<Binding>,
    pub dispatches: Vec<Dispatch>,
}
fn optional(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn write(path: &Path, raw: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid monitor path")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
fn config(db: &Db) -> Result<(String, Config), String> {
    let raw = optional(&crate::visibility::root(db)?.join(".devdeck/issue-monitor.json"))?;
    let value = if raw.is_empty() {
        Config::default()
    } else {
        serde_json::from_str(&raw).map_err(|e| format!("Issue monitor configuration: {e}"))?
    };
    Ok((raw, value))
}
fn cache_path(db: &Db, repository: &str) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(repository.as_bytes()));
    Ok(crate::visibility::root(db)?
        .join(".devdeck/issues")
        .join(format!("{digest}.json")))
}
fn source(db: &Db, repo: &str) -> Result<Source, String> {
    let raw = optional(&cache_path(db, repo)?)?;
    if raw.is_empty() {
        return Ok(Source {
            repository: repo.into(),
            ..Default::default()
        });
    }
    let saved: Source = serde_json::from_str(&raw)
        .map_err(|e| format!("Saved issues for {repo} could not be read: {e}"))?;
    if saved.repository != repo {
        return Err("Saved repository mismatch.".into());
    }
    Ok(saved)
}
pub fn view(db: &Db) -> Result<View, String> {
    let (raw, cfg) = config(db)?;
    let mut sources = vec![];
    let mut warnings = vec![];
    let mut repos: Vec<_> = crate::visibility::connected_products(db)?
        .into_iter()
        .map(|p| p.repository)
        .collect();
    repos.sort();
    repos.dedup();
    for repo in repos {
        match source(db, &repo) {
            Ok(s) => sources.push(s),
            Err(e) => warnings.push(e),
        }
    }
    Ok(View {
        raw,
        enabled: cfg.enabled,
        sources,
        warnings,
        bindings: cfg.bindings,
        dispatches: dispatches(db)?,
    })
}
fn poll(app: &tauri::AppHandle, db: &Db, force: bool) -> Result<(), String> {
    let Ok(_guard) = POLL.try_lock() else {
        return Err("Issue refresh already running.".into());
    };
    let snapshot = view(db)?;
    if !force && !snapshot.enabled {
        return Ok(());
    }
    for mut s in snapshot.sources {
        if !force && !config(db)?.1.enabled {
            break;
        }
        if !force && !due(&s.last_attempt, chrono::Utc::now().timestamp()) {
            continue;
        }
        s.last_attempt = chrono::Utc::now().to_rfc3339();
        match crate::visibility::github_issues_blocking(&s.repository) {
            Ok(result) => {
                s.items = normalize(result.items);
                s.fetched_at = result.fetched_at;
                s.warnings = result.warnings;
                s.truncated = result.truncated;
                s.error.clear();
            }
            Err(e) => {
                s.error = e;
            } // Keep last successfully read issues.
        }
        write(
            &cache_path(db, &s.repository)?,
            &serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?,
        )?;
        if s.error.is_empty() && config(db)?.1.enabled {
            dispatch_source(app, db, &s)?;
        }
        crate::aiw::events::say(
            app,
            crate::aiw::events::EventType::FileChanged,
            Default::default(),
            serde_json::json!({"source":"issue_monitor","repository":s.repository,"summary":"Issue intake refreshed","ok":s.error.is_empty()}),
        );
    }
    Ok(())
}
#[tauri::command(async)]
pub fn issue_monitor_get(db: tauri::State<Db>) -> Result<View, String> {
    view(&db)
}
#[tauri::command(async)]
pub fn issue_monitor_save(
    db: tauri::State<Db>,
    expected: String,
    enabled: bool,
    bindings: Option<Vec<Binding>>,
) -> Result<View, String> {
    let _guard = CONFIG.lock().map_err(|e| e.to_string())?;
    if config(&db)?.0 != expected {
        return Err("Issue monitor settings changed. Reload before saving.".into());
    }
    let previous = config(&db)?.1.bindings;
    let bindings = bindings.unwrap_or_else(|| previous.clone());
    let connected = crate::visibility::connected_products(&db)?;
    let mut seen = std::collections::HashSet::new();
    for binding in &bindings {
        // Retained assignments must never prevent pausing when a folder/repo
        // was removed. Validate only newly assigned targets.
        if previous
            .iter()
            .any(|old| old.repository == binding.repository && old.node == binding.node)
        {
            if !seen.insert(binding.repository.clone()) {
                return Err("Assign each connected repository at most once".into());
            }
            continue;
        }
        if !connected.iter().any(|p| p.repository == binding.repository)
            || !seen.insert(binding.repository.clone())
        {
            return Err("Assign each connected repository at most once".into());
        }
        crate::folder_workflows::folder_workflow_list(db.clone(), binding.node)?;
    }
    write(
        &crate::visibility::root(&db)?.join(".devdeck/issue-monitor.json"),
        &serde_json::to_string_pretty(&Config { enabled, bindings }).map_err(|e| e.to_string())?,
    )?;
    view(&db)
}
#[tauri::command(async)]
pub fn issue_monitor_refresh(app: tauri::AppHandle, db: tauri::State<Db>) -> Result<View, String> {
    poll(&app, &db, true)?;
    view(&db)
}
pub fn install(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        let db = app.state::<Db>();
        // An unconfigured vault is normal at first launch. UI reads expose errors.
        let _ = poll(&app, &db, false);
        std::thread::sleep(Duration::from_secs(5));
    });
}

fn dispatches(db: &Db) -> Result<Vec<Dispatch>, String> {
    let raw = optional(&crate::visibility::root(db)?.join(".devdeck/issue-dispatches.json"))?;
    if raw.is_empty() {
        Ok(Vec::new())
    } else {
        serde_json::from_str(&raw).map_err(|e| format!("Issue dispatch records: {e}"))
    }
}
fn save_dispatches(db: &Db, rows: &[Dispatch]) -> Result<(), String> {
    write(
        &crate::visibility::root(db)?.join(".devdeck/issue-dispatches.json"),
        &serde_json::to_string_pretty(rows).map_err(|e| e.to_string())?,
    )
}
pub fn dispatch_allowed(app: &tauri::AppHandle, node: i64, repository: &str) -> Result<(), String> {
    use crate::aiw::{assistant::ASSISTANT_ID, state::Workspace, tools::Permission};
    use std::sync::Arc;
    let cfg = config(&app.state::<Db>())?.1;
    if !cfg.enabled
        || !cfg
            .bindings
            .iter()
            .any(|b| b.node == node && b.repository == repository)
    {
        return Err("Automatic dispatch is paused or this folder is no longer assigned".into());
    }
    let ws = app.state::<Arc<Workspace>>();
    if ws.permission_matrix().get(ASSISTANT_ID, "workflow") != Permission::Full {
        return Err("Dev needs Full workflow permission for unattended dispatch; approval-only waits for a person".into());
    }
    Ok(())
}
fn dispatch_source(app: &tauri::AppHandle, db: &Db, source: &Source) -> Result<(), String> {
    let Some(binding) = config(db)?
        .1
        .bindings
        .into_iter()
        .find(|b| b.repository == source.repository)
    else {
        return Ok(());
    };
    let mut rows = dispatches(db)?;
    for issue in source.items.iter().filter(|i| dispatchable(i)) {
        let number = issue["number"].as_u64().ok_or("Invalid issue number")?;
        let index = rows
            .iter()
            .position(|d| d.repository == source.repository && d.number == number)
            .unwrap_or_else(|| {
                rows.push(Dispatch {
                    repository: source.repository.clone(),
                    number,
                    node: binding.node,
                    status: "pending".into(),
                    ..Default::default()
                });
                rows.len() - 1
            });
        if rows[index].node != binding.node {
            rows[index].message = "Already routed to another folder; existing work is retained and will not be duplicated".into();
            save_dispatches(db, &rows)?;
            continue;
        }
        if rows[index].status == "done" {
            continue;
        }
        if let Err(error) = dispatch_allowed(app, binding.node, &source.repository) {
            rows[index].message = error;
            save_dispatches(db, &rows)?;
            continue;
        }
        if rows[index].workflow.is_empty() {
            if rows[index].status == "selecting" {
                rows[index].status = "blocked".into();
                rows[index].message =
                    "Selection was interrupted. Retry explicitly to avoid duplicate model calls."
                        .into();
                save_dispatches(db, &rows)?;
                continue;
            }
            if !may_select(&rows[index]) {
                continue;
            }
            rows[index].status = "selecting".into();
            save_dispatches(db, &rows)?; // durable claim before inference
            let result = (|| -> Result<String, String> {
                let selected = crate::folder_workflows::select_for_issue(app, binding.node, issue)?;
                dispatch_allowed(app, binding.node, &source.repository)?;
                let template = crate::folder_workflows::folder_workflow_get(
                    app.clone(),
                    app.state::<Db>(),
                    binding.node,
                    Some(selected.clone()),
                )?;
                let routed = crate::folder_workflows::folder_workflow_route(
                    app.clone(),
                    app.state::<Db>(),
                    binding.node,
                    selected,
                    template.raw,
                    source.repository.clone(),
                    number,
                    issue["title"].as_str().unwrap_or("GitHub issue").into(),
                )?;
                Ok(routed.id)
            })();
            match result {
                Ok(id) => {
                    rows[index].workflow = id;
                    rows[index].status = "pending".into();
                    rows[index].message.clear();
                }
                Err(error) => {
                    rows[index].status = "blocked".into();
                    rows[index].message = error;
                }
            }
            save_dispatches(db, &rows)?;
        }
        if rows[index].workflow.is_empty() {
            continue;
        }
        match crate::folder_workflows::advance_issue(
            app,
            binding.node,
            &rows[index].workflow,
            &source.repository,
        ) {
            Ok(status) => {
                rows[index].status = status;
                rows[index].message.clear();
            }
            Err(error) => {
                rows[index].status = "blocked".into();
                rows[index].message = error;
            }
        }
        save_dispatches(db, &rows)?;
    }
    Ok(())
}
#[tauri::command(async)]
pub fn issue_monitor_retry(
    db: tauri::State<Db>,
    repository: String,
    number: u64,
) -> Result<View, String> {
    let _guard = POLL
        .try_lock()
        .map_err(|_| "Issue refresh running; retry shortly")?;
    let mut rows = dispatches(&db)?;
    let row = rows
        .iter_mut()
        .find(|d| d.repository == repository && d.number == number)
        .ok_or("Dispatch record not found")?;
    if !row.workflow.is_empty() {
        return Err("Review or retry the failed step in its workflow".into());
    }
    row.status = "pending".into();
    row.message.clear();
    save_dispatches(&db, &rows)?;
    view(&db)
}
